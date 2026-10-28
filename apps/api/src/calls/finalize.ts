import { leadFieldsSchema, type Call, type CallOutcome, type Language, type LeadFields, type TranscriptEntry, type TurnLatency } from "@axo/shared";
import type { CallRecorder } from "../audio/recorder";
import { nowIso, repo } from "../db/repo";
import { bus } from "../lib/events";
import { logger } from "../lib/logger";
import { putEncrypted } from "../lib/storage";
import { scoreLead } from "../leads/scoring";
import type { LlmProvider } from "../providers/llm";
import { computeCost } from "./cost";

export interface FinalizeInput {
  orgId: string;
  callId: string;
  llm: LlmProvider;
  startedAt: number;
  outcome: CallOutcome;
  transcript: TranscriptEntry[];
  latency: TurnLatency[];
  toolCalls: Call["toolCalls"];
  usage: Call["usage"];
  language: Language;
  recording: CallRecorder;
  transferredTo?: string;
  callerPhone: string;
  guardViolations: number;
}

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "sentiment", "extracted"],
  properties: {
    summary: { type: "string", description: "2-3 sentence English summary for the sales/service team" },
    sentiment: { type: "string", enum: ["positive", "neutral", "negative", "angry"] },
    extracted: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        city: { type: "string" },
        vehicleType: { type: "string", enum: ["bike", "scooter", "car"] },
        interestedModel: { type: "string" },
        variant: { type: "string" },
        fuel: { type: "string", enum: ["petrol", "diesel", "cng", "ev", "hybrid"] },
        budget: { type: "number", description: "rupees" },
        newOrUsed: { type: "string", enum: ["new", "used"] },
        timeline: { type: "string", enum: ["this_week", "this_month", "three_months_plus", "unknown"] },
        paymentMode: { type: "string", enum: ["cash", "loan", "exchange", "unknown"] },
        hasExchange: { type: "boolean" },
        buyingIntent: { type: "string", enum: ["buy_today", "visiting_today", "researching", "unknown"] },
        notes: { type: "string" },
      },
    },
  },
};

/** Merge structured fields captured by tool calls (save_lead, bookings) during the call. */
function fieldsFromTools(transcript: TranscriptEntry[]): LeadFields {
  const merged: LeadFields = {};
  for (const t of transcript) {
    if (t.role !== "tool") continue;
    try {
      const { input } = JSON.parse(t.text) as { input?: Record<string, unknown> & { fields?: LeadFields } };
      if (!input) continue;
      if (t.tool === "save_lead") Object.assign(merged, input.fields ?? {});
      if (t.tool === "book_testdrive" || t.tool === "get_model_details") merged.interestedModel ??= input.model as string | undefined;
      if (t.tool === "book_testdrive" || t.tool === "book_service") merged.name ??= input.customer_name as string | undefined;
      if (t.tool === "book_testdrive" && input.variant) merged.variant ??= input.variant as string;
    } catch {
      /* truncated entry */
    }
  }
  return merged;
}

/** Post-call: summary, sentiment, extracted fields, lead score, cost, encrypted recording. */
export async function finalizeCall(i: FinalizeInput): Promise<Call | null> {
  const r = repo(i.orgId);
  const existing = await r.calls.get(i.callId);
  if (!existing) return null;

  const endedAt = Date.now();
  const durationSec = Math.round((endedAt - i.startedAt) / 1000);
  const dialogue = i.transcript.filter((t) => t.role === "agent" || t.role === "caller");
  const conversation = dialogue.map((t) => `${t.role}: ${t.text}`).join("\n");

  let summary = "No conversation.";
  let sentiment: Call["sentiment"] = "neutral";
  let extracted: LeadFields = fieldsFromTools(i.transcript);
  if (dialogue.some((t) => t.role === "caller")) {
    try {
      const res = await i.llm.completeJson<{ summary: string; sentiment: Call["sentiment"]; extracted: LeadFields }>({
        system: "You analyse phone calls between a vehicle showroom's AI assistant and a customer. Extract only facts the customer actually stated. Omit unknown fields.",
        prompt: `Call outcome: ${i.outcome}\nTranscript:\n${conversation}`,
        schema: ANALYSIS_SCHEMA,
      });
      summary = res.data.summary;
      sentiment = res.data.sentiment;
      const parsed = leadFieldsSchema.safeParse(res.data.extracted ?? {});
      if (parsed.success) extracted = { ...parsed.data, ...extracted };
      i.usage.llmInputTokens += res.usage.inputTokens;
      i.usage.llmOutputTokens += res.usage.outputTokens;
    } catch (err) {
      logger.warn({ callId: i.callId, err: (err as Error).message }, "call analysis failed");
      summary = dialogue.slice(-4).map((t) => `${t.role}: ${t.text}`).join(" ").slice(0, 300);
    }
  }

  const testDriveBooked = i.toolCalls.some((t) => t.name === "book_testdrive" && t.ok);
  const { score } = scoreLead({ ...extracted, phone: i.callerPhone, testDriveBooked, utterances: dialogue.filter((t) => t.role === "caller").map((t) => t.text) });

  let recordingPath: string | undefined;
  if (existing.recordingConsent && i.recording.durationSec > 0.5) {
    try {
      recordingPath = await putEncrypted(`orgs/${i.orgId}/recordings/${i.callId}.wav.enc`, i.recording.toWav());
    } catch (err) {
      logger.warn({ callId: i.callId, err: (err as Error).message }, "recording upload failed");
    }
  }

  const cost = computeCost(durationSec, i.usage, existing.direction !== "web");
  const avg = i.latency.length ? Math.round(i.latency.reduce((n, l) => n + l.firstAudioMs, 0) / i.latency.length) : undefined;
  const call: Call = {
    ...existing,
    endedAt: new Date(endedAt).toISOString(),
    durationSec,
    status: "completed",
    outcome: i.outcome,
    language: i.language,
    transcript: i.transcript,
    summary,
    sentiment,
    extracted,
    leadScore: dialogue.some((t) => t.role === "caller") ? score : undefined,
    latency: i.latency,
    avgFirstAudioMs: avg,
    toolCalls: i.toolCalls,
    usage: i.usage,
    cost,
    recordingPath,
    transferredTo: i.transferredTo,
  };
  await r.calls.set(call);

  // Keep the lead record in sync with what this call learned.
  const leads = await r.leads.list({ where: { phone: i.callerPhone } });
  const lead = leads[0];
  if (lead) {
    const order = { cold: 0, warm: 1, hot: 2 } as const;
    await r.leads.update(lead.id, {
      ...Object.fromEntries(Object.entries(extracted).filter(([, v]) => v !== undefined && v !== "")),
      score: call.leadScore && order[call.leadScore] > order[lead.score] ? call.leadScore : lead.score,
      lastCallId: call.id,
      firstContactedAt: lead.firstContactedAt ?? call.startedAt,
      stage: lead.stage === "new" && i.outcome !== "no_answer" ? "contacted" : lead.stage,
      language: i.language,
      updatedAt: nowIso(),
    });
    if (!call.leadId) await r.calls.update(call.id, { leadId: lead.id });
  }

  logger.info({ callId: i.callId, outcome: i.outcome, durationSec, avgFirstAudioMs: avg, costInr: cost.total, guardViolations: i.guardViolations }, "call finalized");
  bus.emitEvent("call.finished", { orgId: i.orgId, call });
  return call;
}
