import { parse } from "csv-parse/sync";
import { COLD_REENGAGE_DAYS, type Campaign, type CampaignContact, type CampaignType } from "@axo/shared";
import { isWithinCallingHours } from "../compliance/calling-hours";
import { checkCallable, TRANSACTIONAL_CAMPAIGNS } from "../compliance/dnd";
import { placeOutboundCall } from "../calls/outbound";
import { global, nowIso, repo } from "../db/repo";
import { bus } from "../lib/events";
import { logger } from "../lib/logger";
import { normalizePhone } from "../lib/mask";
import { jobQueue } from "../queue";
import { decideRetry } from "./retry";

/** Parse a contacts CSV: needs a phone column; name and any other columns become agent context. */
export function parseContactsCsv(csv: string): { phone: string; name?: string; data: Record<string, string> }[] {
  const rows = parse(csv, { columns: (h: string[]) => h.map((c) => c.trim().toLowerCase()), skip_empty_lines: true, trim: true }) as Record<string, string>[];
  return rows
    .map((r) => {
      const phone = r.phone ?? r.mobile ?? r.number ?? "";
      const { phone: _p, mobile: _m, number: _n, name, ...data } = r;
      return { phone: phone ? normalizePhone(phone) : "", name: name || undefined, data };
    })
    .filter((r) => r.phone.length >= 12);
}

export async function addContacts(orgId: string, campaignId: string, contacts: { phone: string; name?: string; data?: Record<string, string>; id?: string }[]) {
  const r = repo(orgId);
  const existing = new Set((await r.campaignContacts.list({ where: { campaignId } })).map((c) => c.id));
  let added = 0;
  for (const c of contacts) {
    const id = c.id ?? `${campaignId}:${normalizePhone(c.phone)}`;
    if (existing.has(id)) continue;
    await r.campaignContacts.set({ id, orgId, campaignId, phone: normalizePhone(c.phone), name: c.name, data: c.data ?? {}, status: "pending", attempts: 0, callIds: [] });
    added++;
  }
  await refreshStats(orgId, campaignId);
  return added;
}

export async function refreshStats(orgId: string, campaignId: string) {
  const r = repo(orgId);
  const contacts = await r.campaignContacts.list({ where: { campaignId } });
  const count = (s: CampaignContact["status"]) => contacts.filter((c) => c.status === s).length;
  const stats: Campaign["stats"] = {
    total: contacts.length,
    queued: count("pending") + count("queued") + count("calling"),
    completed: count("completed"),
    connected: contacts.filter((c) => c.status === "completed" && c.lastOutcome && !["no_answer", "busy", "failed"].includes(c.lastOutcome)).length,
    failed: count("failed"),
    optedOut: count("opted_out"),
    skippedDnd: count("skipped_dnd"),
  };
  const campaign = await r.campaigns.get(campaignId);
  if (!campaign) return;
  const done = stats.total > 0 && stats.queued === 0;
  await r.campaigns.update(campaignId, { stats, status: done && campaign.status === "running" ? "completed" : campaign.status });
}

/** Find or create a system campaign (used for reminders and follow-ups). */
export async function systemCampaign(orgId: string, type: CampaignType, name: string, script = ""): Promise<Campaign> {
  const r = repo(orgId);
  const id = `sys-${type}`;
  const existing = await r.campaigns.get(id);
  if (existing) {
    if (existing.status === "completed") await r.campaigns.update(id, { status: "running" });
    return { ...existing, status: existing.status === "completed" ? "running" : existing.status };
  }
  const c: Campaign = { id, orgId, name, type, status: "running", script, maxAttempts: 3, retryMinutes: [30, 180, 1440], concurrency: 3, createdAt: nowIso(), stats: { total: 0, queued: 0, completed: 0, connected: 0, failed: 0, optedOut: 0, skippedDnd: 0 } };
  await r.campaigns.set(c);
  return c;
}

/**
 * Dial due contacts for every running campaign, respecting concurrency, calling hours, DND and opt-outs.
 * Runs every minute and immediately when a campaign starts.
 */
export async function campaignTick(orgId?: string) {
  const orgs = orgId ? [orgId] : (await global.orgs().list()).map((o) => o.id);
  for (const id of orgs) {
    const r = repo(id);
    const settings = await r.settings();
    if (!isWithinCallingHours(new Date(), settings.callingHours)) continue;
    for (const campaign of await r.campaigns.list({ where: { status: "running" } })) {
      const contacts = await r.campaignContacts.list({ where: { campaignId: campaign.id } });
      const inFlight = contacts.filter((c) => c.status === "calling").length;
      const now = nowIso();
      const due = contacts.filter((c) => c.status === "pending" && (!c.nextAttemptAt || c.nextAttemptAt <= now)).slice(0, Math.max(0, campaign.concurrency - inFlight));
      for (const contact of due) await dialContact(id, campaign, contact);
      if (due.length) await refreshStats(id, campaign.id);
    }
  }
}

async function dialContact(orgId: string, campaign: Campaign, contact: CampaignContact) {
  const r = repo(orgId);
  const blocked = await checkCallable(orgId, contact.phone, { allowTransactional: TRANSACTIONAL_CAMPAIGNS.has(campaign.type) });
  if (blocked) {
    await r.campaignContacts.update(contact.id, { status: blocked === "opted_out" ? "opted_out" : "skipped_dnd" });
    return;
  }
  await r.campaignContacts.update(contact.id, { status: "calling", attempts: contact.attempts + 1, lastAttemptAt: nowIso() });
  const res = await placeOutboundCall({
    orgId,
    to: contact.phone,
    agentId: campaign.agentId,
    campaignId: campaign.id,
    campaignType: campaign.type,
    campaignScript: campaign.script,
    contactId: contact.id,
    contactData: contact.data,
    customerName: contact.name,
  });
  if (res.status === "placed") {
    await r.campaignContacts.update(contact.id, { callIds: [...contact.callIds, res.callId] });
  } else if (res.status === "deferred") {
    await r.campaignContacts.update(contact.id, { status: "pending", attempts: contact.attempts, nextAttemptAt: res.until });
  } else if (res.status === "blocked") {
    await r.campaignContacts.update(contact.id, { status: res.reason === "opted_out" ? "opted_out" : "skipped_dnd" });
  } else {
    await onAttemptFinished(orgId, campaign.id, contact.id, "failed");
  }
}

async function onAttemptFinished(orgId: string, campaignId: string, contactId: string, outcome: string) {
  const r = repo(orgId);
  const [campaign, contact] = await Promise.all([r.campaigns.get(campaignId), r.campaignContacts.get(contactId)]);
  if (!campaign || !contact) return;
  const settings = await r.settings();
  const d = decideRetry({ outcome, attempts: contact.attempts, maxAttempts: campaign.maxAttempts, retryMinutes: campaign.retryMinutes, window: settings.callingHours });
  await r.campaignContacts.update(contactId, { status: d.status, nextAttemptAt: d.nextAttemptAt, lastOutcome: outcome });
  await refreshStats(orgId, campaignId);
}

// ------------------------------------------------------------------ new-lead follow-up

/** Called by the lead webhook: dial within 2 minutes, then schedule cold re-engagement on day 2, 7 and 21. */
export async function scheduleLeadFollowups(orgId: string, leadId: string) {
  await jobQueue().add("lead-followup", { orgId, leadId, kind: "first" }, { jobId: `lead-first:${leadId}`, delayMs: 5_000 });
  for (const day of COLD_REENGAGE_DAYS) {
    await jobQueue().add("lead-followup", { orgId, leadId, kind: `day${day}` }, { jobId: `lead-day${day}:${leadId}`, delayMs: day * 86400_000 });
  }
}

export async function runLeadFollowup(data: { orgId: string; leadId: string; kind: string; missedCallId?: string; phone?: string }) {
  const r = repo(data.orgId);
  if (data.kind === "missed") {
    const res = await placeOutboundCall({ orgId: data.orgId, to: data.phone!, campaignId: "missed-call", campaignType: "new_lead_followup", campaignScript: "The customer called the showroom earlier but the call dropped before they could speak. Apologise for the missed call and ask how you can help." });
    if (res.status === "deferred") await jobQueue().add("lead-followup", data, { delayMs: new Date(res.until).getTime() - Date.now() });
    return;
  }
  const lead = await r.leads.get(data.leadId);
  if (!lead || lead.optedOut || ["won", "lost"].includes(lead.stage)) return;
  // Re-engagement only for leads that went quiet.
  if (data.kind !== "first" && (lead.stage !== "new" && lead.stage !== "contacted" || lead.score === "hot")) return;
  const type: CampaignType = data.kind === "first" ? "new_lead_followup" : "cold_reengagement";
  const res = await placeOutboundCall({
    orgId: data.orgId,
    to: lead.phone,
    campaignType: type,
    campaignScript: data.kind === "first" ? `New ${lead.source.replace(/_/g, " ")} enquiry${lead.interestedModel ? ` about the ${lead.interestedModel}` : ""}. Qualify and offer a test drive.` : `Re-engagement (${data.kind}). Ask if they are still looking${lead.interestedModel ? ` for the ${lead.interestedModel}` : ""} and offer a test drive or current offers.`,
    customerName: lead.name,
    leadId: lead.id,
  });
  if (res.status === "deferred") {
    await jobQueue().add("lead-followup", data, { delayMs: new Date(res.until).getTime() - Date.now(), jobId: `lead-${data.kind}-deferred:${lead.id}` });
  } else if (res.status === "placed") {
    await r.leads.update(lead.id, { firstContactedAt: lead.firstContactedAt ?? nowIso(), updatedAt: nowIso() });
  }
  logger.info({ leadId: lead.id, kind: data.kind, status: res.status }, "lead follow-up");
}

// ------------------------------------------------------------------ reminders

const addDays = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);

/** Daily scan: service due (date or km based), insurance and PUC expiry, and post-service feedback calls. */
export async function reminderScan(orgId?: string) {
  const orgs = orgId ? [orgId] : (await global.orgs().list()).map((o) => o.id);
  const month = new Date().toISOString().slice(0, 7);
  for (const id of orgs) {
    const r = repo(id);
    const vehicles = await r.customerVehicles.list();
    const svc: Parameters<typeof addContacts>[2] = [];
    const ins: Parameters<typeof addContacts>[2] = [];
    const puc: Parameters<typeof addContacts>[2] = [];
    for (const v of vehicles) {
      const base = { phone: v.phone, name: v.customerName, data: { vehicle: v.vehicleNo, model: v.model } };
      let dueByKm = false;
      if (v.lastServiceDate && v.avgKmPerMonth && v.lastServiceKm !== undefined) {
        const months = (Date.now() - new Date(v.lastServiceDate).getTime()) / (30 * 86400_000);
        dueByKm = months * v.avgKmPerMonth >= 9000; // ~10,000 km interval, remind a little early
      }
      if ((v.nextServiceDue && v.nextServiceDue <= addDays(7)) || dueByKm) svc.push({ ...base, id: `sys-service_due:${v.id}:${month}`, data: { ...base.data, due: v.nextServiceDue ?? "by kilometres" } });
      if (v.insuranceExpiry && v.insuranceExpiry >= addDays(-3) && v.insuranceExpiry <= addDays(15)) ins.push({ ...base, id: `sys-insurance_expiry:${v.id}:${month}`, data: { ...base.data, expiry: v.insuranceExpiry } });
      if (v.pucExpiry && v.pucExpiry >= addDays(-3) && v.pucExpiry <= addDays(7)) puc.push({ ...base, id: `sys-puc_expiry:${v.id}:${month}`, data: { ...base.data, expiry: v.pucExpiry } });
    }
    if (svc.length) await addContacts(id, (await systemCampaign(id, "service_due", "Service due reminders", "Remind about the due service and book a slot by voice.")).id, svc);
    if (ins.length) await addContacts(id, (await systemCampaign(id, "insurance_expiry", "Insurance renewal reminders", "Mention the insurance expiry date. Never quote premiums; offer an insurance desk callback.")).id, ins);
    if (puc.length) await addContacts(id, (await systemCampaign(id, "puc_expiry", "PUC renewal reminders", "Mention the PUC expiry date and offer to book a quick check.")).id, puc);

    // Feedback calls for vehicles delivered yesterday.
    const yesterday = addDays(-1);
    const delivered = (await r.serviceBookings.list({ where: { status: "delivered" } })).filter((b) => b.start.slice(0, 10) === yesterday);
    if (delivered.length) {
      const fb = await systemCampaign(id, "feedback", "Post-service feedback", "Ask for a rating out of 5 for yesterday's service and any comments.");
      await addContacts(id, fb.id, delivered.map((b) => ({ id: `sys-feedback:${b.id}`, phone: b.phone, name: b.customerName, data: { vehicle: b.vehicleNo, service: b.serviceType } })));
    }
  }
  await campaignTick(orgId);
}

// ------------------------------------------------------------------ booking-to-delivery updates

const BOOKING_STATUS_TEXT: Record<string, string> = {
  booked: "Your booking is confirmed",
  allotted: "A vehicle has been allotted to you",
  documents_pending: "Some documents are pending",
  delivery_scheduled: "Your delivery date is scheduled",
  delivered: "Congratulations on your new vehicle",
};

export async function onBookingStatusChange(orgId: string, bookingId: string) {
  const r = repo(orgId);
  const b = await r.vehicleBookings.get(bookingId);
  if (!b) return;
  const details = [b.status === "documents_pending" && b.pendingDocuments.length ? `Pending: ${b.pendingDocuments.join(", ")}.` : "", b.deliveryDate ? `Delivery date: ${b.deliveryDate}.` : ""].filter(Boolean).join(" ");
  const campaign = await systemCampaign(orgId, "booking_update", "Booking & delivery updates");
  const script =
    b.status === "delivered"
      ? "Post-delivery thank-you call: congratulate them, ask how the delivery experience was, and tell them a review link has been sent on WhatsApp."
      : `Booking update for ${b.model}: ${BOOKING_STATUS_TEXT[b.status] ?? b.status}. ${details} Answer questions using only these facts; for anything else offer a callback.`;
  // The per-booking brief travels with the contact (campaign scripts are shared across contacts).
  await addContacts(orgId, campaign.id, [{ id: `${campaign.id}:${b.id}:${b.status}`, phone: b.phone, name: b.customerName, data: { model: b.model, status: b.status, details, brief: script } }]);
  await jobQueue().add("send-message", { orgId, to: b.phone, template: b.status === "delivered" ? "review_request" : "booking_update", vars: { name: b.customerName, model: b.model, status: BOOKING_STATUS_TEXT[b.status] ?? b.status, details } }, { delayMs: b.status === "delivered" ? 6 * 3600_000 : 0 });
  await campaignTick(orgId);
}

// ------------------------------------------------------------------ event wiring

let wired = false;

/** Subscribe campaign bookkeeping to call outcomes (once per process). */
export function wireCampaignEvents() {
  if (wired) return;
  wired = true;
  bus.onEvent("call.attempt.finished", async (e) => {
    if (e.campaignId === "missed-call") {
      if (e.answered) await repo(e.orgId).calls.update(e.callId, { missedCallRecovered: true });
      return;
    }
    if (e.campaignId && e.contactId) await onAttemptFinished(e.orgId, e.campaignId, e.contactId, e.outcome);
    // Missed inbound call (dropped before the caller spoke): call back in 2 minutes.
    if (!e.campaignId && e.outcome === "dropped") {
      const call = await repo(e.orgId).calls.get(e.callId);
      if (call?.direction === "inbound" && call.durationSec < 20 && !call.transcript.some((t) => t.role === "caller") && call.from) {
        await jobQueue().add("lead-followup", { orgId: e.orgId, leadId: "", kind: "missed", phone: call.from, missedCallId: call.id }, { delayMs: 2 * 60_000, jobId: `missed:${call.id}` });
      }
    }
  });
}

