import type { Call } from "@axo/shared";
import { checkCallable } from "../compliance/dnd";
import { global, platformOf, repo } from "../db/repo";
import { bus } from "../lib/events";
import { logger } from "../lib/logger";
import { locationVars, modelDetailsVars } from "../messaging/content";
import { conversationIdFor, sendOrgMessage } from "../messaging/service";
import { findModel } from "../tools/catalog";

const SKIP_OUTCOMES = new Set(["opted_out", "wrong_number", "no_answer", "busy", "failed"]);

/**
 * After an answered call: a WhatsApp thank-you with what was discussed (model price range + brochure, or the
 * showroom location), skipping anything already sent during the call. The call summary is also attached to
 * the customer's WhatsApp thread so the chatbot carries on from where the call ended.
 */
export async function sendPostCallWhatsapp(orgId: string, call: Call): Promise<boolean> {
  const org = await global.orgs().get(orgId);
  const p = platformOf(org);
  if (!org || !p.features.whatsapp || !p.features.postCallWhatsapp) return false;
  if (!call.transcript.some((t) => t.role === "caller") || SKIP_OUTCOMES.has(call.outcome ?? "")) return false;
  const phone = call.direction === "outbound" ? call.to : call.from;
  if (!phone || (await checkCallable(orgId, phone, { allowTransactional: true }))) return false;

  const r = repo(orgId);
  const sent = (await r.messages.list({ where: { callId: call.id } })).filter((m) => m.direction === "out" && m.audience === "customer" && m.status !== "blocked" && m.status !== "failed");
  const sentTemplates = new Set(sent.map((m) => m.template));
  const parts: string[] = [];

  if (org.business) {
    const b = org.business;
    const acknowledged = ["appointment_request", "order_received", "business_location"].some((t) => sentTemplates.has(t));
    if (!acknowledged && (b.mapLink || b.address)) parts.push(`Find us at: ${b.mapLink || b.address}.`);
    const res = await sendOrgMessage({ orgId, to: phone, template: "business_followup", vars: { showroom: org.showroomName, name: call.extracted.name ? `, ${call.extracted.name}` : "", details: parts.length ? `${parts.join(" ")}\n` : "" }, language: call.language, callId: call.id });
    await attachCallContext(orgId, phone, call);
    return res.ok;
  }

  const model = call.extracted.interestedModel ? findModel(await r.catalog.list(), call.extracted.interestedModel) : null;
  if (model && !sentTemplates.has("model_details") && !sentTemplates.has("brochure")) {
    const v = modelDetailsVars(model, org.showroomName);
    parts.push(`${v.model}: on-road ${v.price_range}.${model.brochureUrl ? ` Brochure: ${model.brochureUrl}` : ""}`);
  }
  const booked = sentTemplates.has("testdrive_confirmation") || sentTemplates.has("service_confirmation");
  if (!booked && !sentTemplates.has("showroom_location")) {
    const [branches, leads] = await Promise.all([r.branches.list(), r.leads.list({ where: { phone } })]);
    const branch = branches.find((b) => b.id === leads[0]?.branchId) ?? branches.find((b) => !/service/i.test(b.name)) ?? branches[0];
    if (branch) {
      const loc = locationVars(branch, org.showroomName);
      parts.push(`Visit us at ${loc.branch}: ${loc.map || loc.address}.`);
    }
  }

  const res = await sendOrgMessage({
    orgId,
    to: phone,
    template: "post_call_followup",
    vars: { showroom: org.showroomName, name: call.extracted.name ? `, ${call.extracted.name}` : "", details: parts.length ? `${parts.join(" ")}\n` : "" },
    language: call.language,
    callId: call.id,
  });
  await attachCallContext(orgId, phone, call);
  return res.ok;
}

/** Put the call summary on the customer's WhatsApp thread so the chatbot carries on from the call. */
async function attachCallContext(orgId: string, phone: string, call: Call) {
  const r = repo(orgId);
  const conv = await r.conversations.get(conversationIdFor(phone));
  if (conv && call.summary) {
    const when = new Date(Date.parse(call.startedAt) + 5.5 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
    await r.conversations.update(conv.id, { callContext: `Phone call on ${when} IST (${call.outcome ?? "ended"}): ${call.summary}` });
  }
}

export function wirePostCallWhatsapp() {
  bus.onEvent("call.finished", ({ orgId, call }) =>
    void sendPostCallWhatsapp(orgId, call).catch((err) => logger.warn({ orgId, callId: call.id, err: (err as Error).message }, "post-call WhatsApp failed")),
  );
}
