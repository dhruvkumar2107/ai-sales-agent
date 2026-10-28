import { env } from "../../config";
import { logger } from "../../lib/logger";
import { AnthropicLlm } from "./anthropic";
import { GeminiLlm } from "./gemini";
import { MockLlm } from "./mock";
import type { LlmProvider, LlmStreamOptions } from "./types";

export * from "./types";

/**
 * Keeps a call going when the primary model is unavailable (quota, overload): a turn that fails before
 * any text was spoken is answered by the offline mock instead of "sorry, could you say that again".
 */
class FallbackLlm implements LlmProvider {
  readonly name: string;
  private backup = new MockLlm();
  /** Shared across calls: one call discovering an outage spares the others the wait. */
  private static skipUntil = 0;

  constructor(private primary: LlmProvider) {
    this.name = primary.name;
  }

  async streamTurn(o: LlmStreamOptions) {
    // After a failure, skip the primary for a while so callers don't wait on it every turn.
    if (Date.now() < FallbackLlm.skipUntil) return this.backup.streamTurn(o);
    let spoke = false;
    try {
      return await this.primary.streamTurn({ ...o, onText: (d) => ((spoke = true), o.onText(d)) });
    } catch (err) {
      if (spoke || o.signal?.aborted) throw err;
      FallbackLlm.skipUntil = Date.now() + 120_000;
      logger.warn({ err: String(err).slice(0, 200) }, `${this.primary.name} unavailable, answering offline for 2 minutes`);
      return this.backup.streamTurn(o);
    }
  }

  async completeJson<T>(o: Parameters<LlmProvider["completeJson"]>[0]) {
    try {
      return await this.primary.completeJson<T>(o);
    } catch (err) {
      logger.warn({ err: String(err).slice(0, 200) }, `${this.primary.name} unavailable for call analysis, using offline analysis`);
      return this.backup.completeJson<T>(o);
    }
  }
}

export function createLlm(kind = env.LLM_PROVIDER): LlmProvider {
  if (kind === "anthropic" && env.ANTHROPIC_API_KEY) return new AnthropicLlm();
  if (kind === "gemini" && env.GEMINI_API_KEY) return new FallbackLlm(new GeminiLlm());
  return new MockLlm();
}
