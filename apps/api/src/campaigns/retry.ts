import { nextCallingTime } from "../compliance/calling-hours";

/** Outcomes worth retrying: the customer never really got the conversation. */
export const RETRYABLE = new Set(["no_answer", "busy", "failed", "dropped", "silence"]);
/** Outcomes that end the contact for good. */
export const TERMINAL = new Set(["opted_out", "wrong_number"]);

export interface RetryDecision {
  status: "completed" | "pending" | "failed" | "opted_out";
  nextAttemptAt?: string;
}

/**
 * Decide what happens to a campaign contact after an attempt.
 * `attempts` counts attempts made so far (including this one). Retry delays come from
 * `retryMinutes[attempts - 1]` (last value repeats) and are pushed into the calling window.
 */
export function decideRetry(o: {
  outcome: string;
  attempts: number;
  maxAttempts: number;
  retryMinutes: number[];
  now?: Date;
  window: { start: string; end: string };
}): RetryDecision {
  if (o.outcome === "opted_out") return { status: "opted_out" };
  if (TERMINAL.has(o.outcome)) return { status: "completed" };
  if (!RETRYABLE.has(o.outcome)) return { status: "completed" };
  if (o.attempts >= o.maxAttempts) return { status: "failed" };
  const delays = o.retryMinutes.length ? o.retryMinutes : [60];
  const delay = delays[Math.min(o.attempts - 1, delays.length - 1)]!;
  const now = o.now ?? new Date();
  const next = nextCallingTime(new Date(now.getTime() + delay * 60_000), o.window);
  return { status: "pending", nextAttemptAt: next.toISOString() };
}
