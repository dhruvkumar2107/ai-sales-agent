import type { Call, CallCost } from "@axo/shared";
import { env } from "../config";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Per-call cost in INR from metered usage. Rates are configurable via COST_* env vars. */
export function computeCost(durationSec: number, usage: Call["usage"], billTelephony = true): CallCost {
  const minutes = Math.ceil(durationSec / 60);
  const telephony = billTelephony ? minutes * env.COST_TELEPHONY_PER_MIN : 0;
  const stt = (usage.sttSeconds / 60) * env.COST_STT_PER_MIN;
  const tts = (usage.ttsChars / 1000) * env.COST_TTS_PER_1K_CHARS;
  const llm = (usage.llmInputTokens / 1e6) * env.COST_LLM_INPUT_PER_MTOK + (usage.llmOutputTokens / 1e6) * env.COST_LLM_OUTPUT_PER_MTOK;
  const messaging = usage.messages * env.COST_MESSAGE;
  const total = telephony + stt + tts + llm + messaging;
  return { telephony: round2(telephony), stt: round2(stt), tts: round2(tts), llm: round2(llm), messaging: round2(messaging), total: round2(total), currency: "INR" };
}
