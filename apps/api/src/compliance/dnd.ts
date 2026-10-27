import { global, nowIso, repo } from "../db/repo";
import { normalizePhone } from "../lib/mask";

export type BlockReason = "opted_out" | "dnd" | null;

/**
 * Checks the org's opt-out list and the DND/NDNC registry cache before any outbound call.
 * Transactional/service calls to existing customers (service due, booking updates) may be exempt under
 * TRAI TCCCPR when the customer has a relationship with the dealer; `allowTransactional` models that,
 * but explicit opt-outs are always honoured.
 */
export async function checkCallable(orgId: string, rawPhone: string, opts: { allowTransactional?: boolean } = {}): Promise<BlockReason> {
  const phone = normalizePhone(rawPhone);
  if (await repo(orgId).optOuts.get(phone)) return "opted_out";
  if (!opts.allowTransactional && (await global.dnd().get(phone))) return "dnd";
  return null;
}

export async function recordOptOut(orgId: string, rawPhone: string, reason = "caller_request") {
  const phone = normalizePhone(rawPhone);
  const r = repo(orgId);
  await r.optOuts.set({ id: phone, orgId, phone, reason, createdAt: nowIso() });
  for (const lead of await r.leads.list({ where: { phone } })) await r.leads.update(lead.id, { optedOut: true, updatedAt: nowIso() });
  for (const c of await r.campaignContacts.list({ where: { phone } })) {
    if (c.status === "pending" || c.status === "queued") await r.campaignContacts.update(c.id, { status: "opted_out" });
  }
}

/** Import numbers from an operator DND scrub file (one number per line). */
export async function importDndList(numbers: string[]) {
  for (const n of numbers) {
    const phone = normalizePhone(n);
    if (phone.length >= 12) await global.dnd().set({ id: phone, phone, addedAt: nowIso() });
  }
}

/** Campaign types that are service/transactional rather than promotional. */
export const TRANSACTIONAL_CAMPAIGNS = new Set(["service_due", "insurance_expiry", "puc_expiry", "booking_update", "feedback", "new_lead_followup"]);
