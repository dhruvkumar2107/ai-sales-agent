import Anthropic from "@anthropic-ai/sdk";
import { env } from "../../config";
import type { LlmContentBlock, LlmProvider, LlmStreamOptions, LlmToolUse, LlmTurnResult } from "./types";

/**
 * Claude via the official SDK: streaming text deltas (fed to the sentence chunker) plus tool calling.
 * Uses low effort by default because spoken replies are short and latency matters most.
 */
export class AnthropicLlm implements LlmProvider {
  readonly name = "anthropic";
  private client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 20_000 });

  private baseParams() {
    const model = env.LLM_MODEL;
    const params: Record<string, unknown> = {
      model,
      output_config: { effort: env.LLM_EFFORT },
    };
    // Haiku 5.5 accepts disabled thinking at high effort or below; it shaves first-token latency.
    if (model.includes("haiku")) params.thinking = { type: "disabled" };
    // Server-side refusal fallback (Opus 5.5 / Sonnet 5.5 on the Claude API).
    if (env.LLM_FALLBACKS && /opus-5|sonnet-5-5|fable/.test(model)) {
      params.betas = ["server-side-fallback-2026-07-01"];
      params.fallbacks = "default";
    }
    return params;
  }

  async streamTurn(o: LlmStreamOptions): Promise<LlmTurnResult> {
    const stream = this.client.beta.messages.stream(
      {
        ...this.baseParams(),
        max_tokens: o.maxTokens ?? 1024,
        // Stable system prompt is cached: it holds the whole catalog, so cache hits cut cost and latency.
        system: [{ type: "text", text: o.system, cache_control: { type: "ephemeral" } }],
        messages: o.messages,
        tools: o.tools.map((t) => ({ ...t, eager_input_streaming: true })),
      } as unknown as Anthropic.Beta.Messages.MessageCreateParamsStreaming,
      { signal: o.signal },
    );

    let text = "";
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        text += event.delta.text;
        o.onText(event.delta.text);
      }
    }
    const message = await stream.finalMessage();

    const toolUses: LlmToolUse[] = [];
    for (const block of message.content) {
      if (block.type === "tool_use") toolUses.push({ id: block.id, name: block.name, input: block.input });
    }
    // A refusal can cut a tool_use off mid-input: never run that turn's tools.
    const safeToolUses = message.stop_reason === "refusal" || message.stop_reason === "max_tokens" ? [] : toolUses;

    return {
      content: message.content as unknown as LlmContentBlock[],
      text,
      toolUses: safeToolUses,
      stopReason: message.stop_reason,
      usage: { inputTokens: message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0), outputTokens: message.usage.output_tokens },
    };
  }

  async completeJson<T>(o: { system: string; prompt: string; schema: Record<string, unknown>; maxTokens?: number }) {
    const message = await this.client.beta.messages.create({
      ...this.baseParams(),
      max_tokens: o.maxTokens ?? 2048,
      system: o.system,
      messages: [{ role: "user", content: o.prompt }],
      output_config: { effort: "low", format: { type: "json_schema", schema: o.schema } },
    } as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);
    if (message.stop_reason === "refusal") throw new Error("LLM declined the analysis request");
    const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return {
      data: JSON.parse(text) as T,
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
    };
  }
}
