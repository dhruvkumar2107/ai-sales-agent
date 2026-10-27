import { checkCallable, TRANSACTIONAL_CAMPAIGNS, type BlockReason } from "../compliance/dnd";
import { isWithinCallingHours, nextCallingTime } from "../compliance/calling-hours";
import { getStore } from "../db/store";
import { newId, nowIso, repo } from "../db/repo";
import { logger } from "../lib/logger";
import { maskPhone, normalizePhone } from "../lib/mask";
import { telephony, type PendingCall } from "../providers/telephony";

export const pendingCalls = () => getStore().collection<PendingCall>("pendingCalls");

export interface OutboundRequest {
  orgId: string;
  to: string;
  agentId?: string;
  campaignId?: string;
  campaignType?: string;
  campaignScript?: string;
  contactId?: string;
  contactData?: Record<string, string>;
  customerName?: string;
  leadId?: string;
  /** Skip the calling-hours check (e.g. "call my phone" from the test console) */
  ignoreCallingHours?: boolean;
}

export type OutboundResult =
  | { status: "placed"; callId: string; providerCallId: string }
  | { status: "blocked"; reason: Exclude<BlockReason, null> }
  | { status: "deferred"; until: string }
  | { status: "failed"; error: string };

/** Compliance-checked outbound call. Media-stream start looks the context up by callId. */
export async function placeOutboundCall(req: OutboundRequest): Promise<OutboundResult> {
  const to = normalizePhone(req.to);
  const blocked = await checkCallable(req.orgId, to, { allowTransactional: !req.campaignType || TRANSACTIONAL_CAMPAIGNS.has(req.campaignType) });
  if (blocked) return { status: "blocked", reason: blocked };

  const settings = await repo(req.orgId).settings();
  const now = new Date();
  if (!req.ignoreCallingHours && !isWithinCallingHours(now, settings.callingHours)) {
    return { status: "deferred", until: nextCallingTime(now, settings.callingHours).toISOString() };
  }

  const callId = newId("call_");
  await pendingCalls().set({
    id: callId,
    orgId: req.orgId,
    agentId: req.agentId,
    to,
    campaignId: req.campaignId,
    campaignType: req.campaignType,
    campaignScript: req.campaignScript,
    contactId: req.contactId,
    contactData: req.contactData,
    customerName: req.customerName,
    leadId: req.leadId,
    createdAt: nowIso(),
  });
  try {
    const providerCallId = await telephony().placeCall({ to, callId, orgId: req.orgId });
    logger.info(`outbound call ${callId} placed to ${maskPhone(to)} via ${telephony().name}`);
    return { status: "placed", callId, providerCallId };
  } catch (err) {
    await pendingCalls().delete(callId);
    logger.error({ err: (err as Error).message }, "outbound call failed");
    return { status: "failed", error: (err as Error).message };
  }
}
