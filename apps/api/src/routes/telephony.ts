import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CallOutcome } from "@axo/shared";
import { pendingCalls } from "../calls/outbound";
import { env } from "../config";
import { global, nowIso, repo } from "../db/repo";
import { safeEqual } from "../lib/crypto";
import { bus } from "../lib/events";
import { logger } from "../lib/logger";
import { normalizePhone } from "../lib/mask";
import { takeExotelTransfer } from "../providers/telephony/exotel";
import { streamTwiml, validateTwilioSignature } from "../providers/telephony/twilio";


const STATUS_TO_OUTCOME: Record<string, CallOutcome> = {
  "no-answer": "no_answer",
  busy: "busy",
  failed: "failed",
  canceled: "failed",
};

function twilioGuard(req: FastifyRequest, reply: FastifyReply): boolean {
  if (env.SKIP_SIGNATURE_VALIDATION) return true;
  const url = `${env.PUBLIC_BASE_URL}${req.url}`;
  const ok = validateTwilioSignature(url, (req.body ?? {}) as Record<string, string>, req.headers["x-twilio-signature"] as string | undefined);
  if (!ok) {
    logger.warn("rejected Twilio webhook with invalid signature");
    reply.code(403).send("invalid signature");
  }
  return ok;
}

function exotelGuard(req: FastifyRequest, reply: FastifyReply): boolean {
  if (env.SKIP_SIGNATURE_VALIDATION || !env.EXOTEL_WEBHOOK_SECRET) return true;
  const secret = (req.query as Record<string, string>).secret ?? "";
  if (safeEqual(secret, env.EXOTEL_WEBHOOK_SECRET)) return true;
  reply.code(403).send("invalid secret");
  return false;
}

/** Record an outbound attempt that never reached our media stream (no answer, busy, failed). */
async function recordUnanswered(orgId: string, callId: string, outcome: CallOutcome, provider: string, providerCallId: string) {
  const pending = await pendingCalls().get(callId);
  const r = repo(orgId);
  if (await r.calls.get(callId)) return; // the call connected; the session records it
  await r.calls.set({
    id: callId,
    orgId,
    agentId: pending?.agentId,
    direction: "outbound",
    provider,
    providerCallId,
    from: "",
    to: pending?.to ?? "",
    campaignId: pending?.campaignId,
    leadId: pending?.leadId,
    startedAt: nowIso(),
    endedAt: nowIso(),
    durationSec: 0,
    status: outcome === "busy" ? "busy" : outcome === "no_answer" ? "no_answer" : "failed",
    outcome,
    recordingConsent: false,
    transcript: [],
    extracted: {},
    latency: [],
    toolCalls: [],
    cost: { telephony: 0, stt: 0, tts: 0, llm: 0, messaging: 0, total: 0, currency: "INR" },
    usage: { sttSeconds: 0, ttsChars: 0, llmInputTokens: 0, llmOutputTokens: 0, messages: 0 },
  });
  await pendingCalls().delete(callId);
  bus.emitEvent("call.attempt.finished", { orgId, callId, outcome, answered: false, campaignId: pending?.campaignId, contactId: pending?.contactId });
}

export async function telephonyRoutes(app: FastifyInstance) {
  // Webhooks are hit by providers, so keep a generous but bounded rate limit.
  const rl = { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } };

  // ---------- Twilio ----------
  /** Inbound call webhook: answer by connecting the call to our media stream. */
  app.post("/telephony/twilio/voice", rl, async (req, reply) => {
    if (!twilioGuard(req, reply)) return;
    const b = req.body as Record<string, string>;
    const to = normalizePhone(b.To ?? "");
    const route = await global.phoneRoutes().get(to);
    reply.type("text/xml").send(streamTwiml({ orgId: route?.orgId ?? env.DEV_ORG_ID, agentId: route?.agentId, from: b.From, to: b.To, direction: "inbound" }));
  });

  app.post("/telephony/twilio/status", rl, async (req, reply) => {
    if (!twilioGuard(req, reply)) return;
    const q = req.query as Record<string, string>;
    const b = req.body as Record<string, string>;
    const outcome = b.AnsweredBy?.startsWith("machine") ? "no_answer" : STATUS_TO_OUTCOME[b.CallStatus ?? ""];
    if (q.callId && q.orgId && outcome) await recordUnanswered(q.orgId, q.callId, outcome, "twilio", b.CallSid ?? "");
    return reply.send({ ok: true });
  });

  // ---------- Exotel ----------
  /** Voicebot applet "dynamic URL": tells Exotel which WebSocket to stream to for this call. */
  app.get("/telephony/exotel/voicebot-url", rl, async (req, reply) => {
    if (!exotelGuard(req, reply)) return;
    const q = req.query as Record<string, string>;
    let custom: Record<string, string> = {};
    try {
      custom = q.CustomField ? JSON.parse(q.CustomField) : {};
    } catch {
      /* not JSON */
    }
    const params = new URLSearchParams({ from: q.From ?? "", to: q.To ?? q.CallTo ?? "", ...(custom.callId ? { callId: custom.callId } : {}), ...(env.EXOTEL_WEBHOOK_SECRET ? { secret: env.EXOTEL_WEBHOOK_SECRET } : {}) });
    return { url: `${env.PUBLIC_BASE_URL.replace(/^http/, "ws")}/media/exotel?${params}` };
  });

  /** Connect applet "dynamic URL": number to dial after the bot hands over (empty = no transfer). */
  app.get("/telephony/exotel/transfer-number", rl, async (req, reply) => {
    if (!exotelGuard(req, reply)) return;
    const number = takeExotelTransfer((req.query as Record<string, string>).CallSid ?? "");
    if (!number) return reply.code(404).send({ destination: { numbers: [] } });
    return { fetch_after_attempt: false, destination: { numbers: [number] }, outgoing_phone_number: env.EXOTEL_CALLER_ID, record: true };
  });

  app.post("/telephony/exotel/status", rl, async (req, reply) => {
    if (!exotelGuard(req, reply)) return;
    const q = req.query as Record<string, string>;
    const b = (req.body ?? {}) as Record<string, string>;
    const outcome = STATUS_TO_OUTCOME[(b.Status ?? "").toLowerCase()];
    if (q.callId && q.orgId && outcome) await recordUnanswered(q.orgId, q.callId, outcome, "exotel", b.CallSid ?? "");
    return { ok: true };
  });
}
