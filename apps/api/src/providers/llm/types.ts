import type Anthropic from "@anthropic-ai/sdk";

/** Conversation format: Anthropic beta message params are the canonical history format. */
export type LlmMessage = Anthropic.Beta.BetaMessageParam;
export type LlmContentBlock = Anthropic.Beta.BetaContentBlockParam;

export interface LlmToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LlmToolUse {
  id: string;
  name: string;
  input: unknown;
}

export interface LlmTurnResult {
  /** Assistant content blocks, to be appended to history unchanged */
  content: LlmContentBlock[];
  text: string;
  toolUses: LlmToolUse[];
  stopReason: string | null;
  usage: { inputTokens: number; outputTokens: number };
}

export interface LlmStreamOptions {
  system: string;
  messages: LlmMessage[];
  tools: LlmToolDef[];
  signal?: AbortSignal;
  onText: (delta: string) => void;
  /** Non-LLM context for the offline mock (catalog names etc.). Ignored by real providers. */
  hints?: Record<string, unknown>;
  maxTokens?: number;
}

export interface LlmProvider {
  readonly name: string;
  streamTurn(o: LlmStreamOptions): Promise<LlmTurnResult>;
  /** Single non-streaming completion returning JSON matching `schema` (post-call analysis). */
  completeJson<T>(o: { system: string; prompt: string; schema: Record<string, unknown>; maxTokens?: number }): Promise<{ data: T; usage: LlmTurnResult["usage"] }>;
}
