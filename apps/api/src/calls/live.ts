import type { CallOutcome } from "@axo/shared";
import { bus } from "../lib/events";
import type { CallSession, CallSessionOptions } from "../voice/session";

/** Registry of in-progress calls on this instance (live dashboard counters, graceful shutdown). */
export const liveSessions = new Map<string, { session: CallSession; orgId: string; direction: string; startedAt: number }>();

const UNANSWERED: CallOutcome[] = ["no_answer", "busy", "failed"];

/** Register a session and publish the attempt result when it ends. */
export function trackSession(session: CallSession, o: Pick<CallSessionOptions, "orgId" | "direction" | "campaign">) {
  liveSessions.set(session.callId, { session, orgId: o.orgId, direction: o.direction, startedAt: Date.now() });
  session.once("ended", () => {
    liveSessions.delete(session.callId);
    const outcome = session.inspect().outcome ?? "other";
    bus.emitEvent("call.attempt.finished", {
      orgId: o.orgId,
      callId: session.callId,
      outcome,
      answered: !UNANSWERED.includes(outcome),
      campaignId: o.campaign?.id,
      contactId: o.campaign?.contactId,
    });
  });
}

export function liveCount(orgId: string) {
  return [...liveSessions.values()].filter((s) => s.orgId === orgId).length;
}
