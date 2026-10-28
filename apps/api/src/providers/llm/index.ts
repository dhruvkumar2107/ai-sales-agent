import { env } from "../../config";
import { AnthropicLlm } from "./anthropic";
import { GeminiLlm } from "./gemini";
import { MockLlm } from "./mock";
import type { LlmProvider } from "./types";

export * from "./types";

export function createLlm(kind = env.LLM_PROVIDER): LlmProvider {
  if (kind === "anthropic" && env.ANTHROPIC_API_KEY) return new AnthropicLlm();
  if (kind === "gemini" && env.GEMINI_API_KEY) return new GeminiLlm();
  return new MockLlm();
}
