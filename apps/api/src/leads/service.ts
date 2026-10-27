import { leadSchema, type Lead, type LeadFields, type LeadScore, type LeadSource, type Member } from "@axo/shared";
import { newId, nowIso, repo } from "../db/repo";
import { pushDmsEvent } from "../integrations/dms";
import { bus } from "../lib/events";
import { normalizePhone } from "../lib/mask";
import { findModel } from "../tools/catalog";
import { scoreLead } from "./scoring";

const ORDER: Record<LeadScore, number> = { cold: 0, warm: 1, hot: 2 };

/**
 * Pick a sales executive: available, in the lead's branch, preferring those whose model focus matches,
 * then the one with the fewest open leads (simple load balancing).
 */
export async function assignExecutive(orgId: string, o: { branchId?: string; model?: string }): Promise<Member | null> {
  const r = repo(orgId);
  const execs = (await r.members.list({ where: { role: "sales_executive" } })).filter((m) => m.available);
  if (!execs.length) return null;
  const inBranch = o.branchId ? execs.filter((m) => !m.branchIds.length || m.branchIds.includes(o.branchId!)) : execs;
  const pool = inBranch.length ? inBranch : execs;
  const focused = o.model ? pool.filter((m) => m.modelFocus.some((f) => f.toLowerCase() === o.model!.toLowerCase())) : [];
  const candidates = focused.length ? focused : pool;
  const open = await r.leads.list();
  const load = (id: string) => open.filter((l) => l.assignedTo === id && l.stage !== "won" && l.stage !== "lost").length;
  return [...candidates].sort((a, b) => load(a.id) - load(b.id))[0] ?? null;
}

/** Infer branch from the model: the branch holding a demo vehicle for it, else by vehicle type. */
export async function inferBranch(orgId: string, model?: string): Promise<string | undefined> {
  const r = repo(orgId);
  const branches = await r.branches.list();
  if (model) {
    const m = findModel(await r.catalog.list(), model);
    if (m) {
      const tdv = (await r.testDriveVehicles.list()).find((v) => v.model.toLowerCase() === m.model.toLowerCase() && v.active);
      if (tdv) return tdv.branchId;
      const byType = branches.find((b) => (m.type === "car" ? /car/i : /two|bike|2w/i).test(b.name));
      if (byType) return byType.id;
    }
  }
  return branches.find((b) => !/service/i.test(b.name))?.id ?? branches[0]?.id;
}

export interface UpsertLeadInput extends LeadFields {
  phone: string;
  source?: LeadSource;
  branchId?: string;
  score?: LeadScore;
  testDriveBooked?: boolean;
  note?: string;
}

/** Create or update the lead for a phone number, re-scoring and auto-assigning it. */
export async function upsertLead(orgId: string, input: UpsertLeadInput): Promise<{ lead: Lead; created: boolean }> {
  const r = repo(orgId);
  const phone = normalizePhone(input.phone);
  const existing = (await r.leads.list({ where: { phone } }))[0];
  const fields = Object.fromEntries(Object.entries(input).filter(([k, v]) => v !== undefined && v !== "" && !["score", "note", "testDriveBooked", "source"].includes(k))) as LeadFields;
  if (fields.interestedModel) {
    const m = findModel(await r.catalog.list(), fields.interestedModel);
    if (m) {
      fields.interestedModel = m.model;
      fields.vehicleType ??= m.type;
    }
  }
  const merged = { ...(existing ?? {}), ...fields, phone };
  const computed = scoreLead({ ...merged, testDriveBooked: input.testDriveBooked || existing?.stage === "test_drive_booked" });
  const claimed = input.score ?? "cold";
  const score = [computed.score, claimed, existing?.score ?? "cold"].sort((a, b) => ORDER[b] - ORDER[a])[0]!;
  const now = nowIso();
  const notesLog = [...(existing?.notesLog ?? [])];
  if (input.note) notesLog.push({ at: now, by: "AI agent", text: input.note });

  if (existing) {
    const lead = leadSchema.parse({ ...existing, ...fields, score, scoreValue: Math.max(computed.value, existing.scoreValue), notesLog, updatedAt: now, stage: input.testDriveBooked && ["new", "contacted"].includes(existing.stage) ? "test_drive_booked" : existing.stage });
    await r.leads.set(lead);
    return { lead, created: false };
  }

  const branchId = input.branchId ?? (await inferBranch(orgId, fields.interestedModel));
  const exec = await assignExecutive(orgId, { branchId, model: fields.interestedModel });
  const lead = leadSchema.parse({
    ...fields,
    id: newId("lead_"),
    orgId,
    phone,
    branchId,
    stage: input.testDriveBooked ? "test_drive_booked" : "new",
    score,
    scoreValue: computed.value,
    source: input.source ?? "inbound_call",
    assignedTo: exec?.id,
    notesLog,
    createdAt: now,
    updatedAt: now,
  });
  await r.leads.set(lead);
  bus.emitEvent("lead.created", { orgId, leadId: lead.id, source: lead.source });
  void pushDmsEvent(orgId, "lead.created", lead as unknown as Record<string, unknown>);
  return { lead, created: true };
}
