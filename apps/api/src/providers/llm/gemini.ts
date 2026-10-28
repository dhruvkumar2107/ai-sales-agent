import { randomUUID } from "node:crypto";
import { env } from "../../config";
import type { LlmContentBlock, LlmMessage, LlmProvider, LlmStreamOptions, LlmToolDef, LlmToolUse, LlmTurnResult } from "./types";

/**
 * Google Gemini via the REST API (streamGenerateContent over SSE) with function calling.
 * History stays in the canonical Anthropic block format; it is translated to Gemini `contents` per turn,
 * and Gemini's reply is translated back so the session, tools and post-call analysis are unchanged.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
}
interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}
interface GeminiChunk {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  error?: { message?: string };
}

/** Schema keywords Gemini's OpenAPI subset accepts; anything else is rejected with a 400. */
const SCHEMA_KEYS = new Set(["type", "format", "title", "description", "nullable", "enum", "items", "minItems", "maxItems", "properties", "required", "minProperties", "maxProperties", "minLength", "maxLength", "pattern", "minimum", "maximum", "anyOf", "propertyOrdering"]);

function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === "properties" && v && typeof v === "object") {
      out.properties = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([name, s]) => [name, toGeminiSchema(s)]));
      continue;
    }
    if (k === "exclusiveMinimum" && typeof v === "number") {
      out.minimum = v;
      continue;
    }
    if (k === "exclusiveMaximum" && typeof v === "number") {
      out.maximum = v;
      continue;
    }
    if (!SCHEMA_KEYS.has(k)) continue;
    if (k === "type" && Array.isArray(v)) {
      // ["string","null"] -> "string" + nullable
      const types = v.filter((t) => t !== "null");
      out.type = types[0];
      if (types.length < v.length) out.nullable = true;
      continue;
    }
    if (k === "anyOf" && Array.isArray(v)) {
      const nonNull = v.filter((s) => !(s && typeof s === "object" && (s as { type?: string }).type === "null"));
      if (nonNull.length === 1) {
        Object.assign(out, toGeminiSchema(nonNull[0]) as object, nonNull.length < v.length ? { nullable: true } : {});
        continue;
      }
      out.anyOf = nonNull.map(toGeminiSchema);
      continue;
    }
    out[k] = typeof v === "object" ? toGeminiSchema(v) : v;
  }
  return out;
}

function toolsToGemini(tools: LlmToolDef[]) {
  if (!tools.length) return undefined;
  return [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.input_schema) })) }];
}

function resultToObject(content: unknown): Record<string, unknown> {
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : "")).join("") : "";
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { result: parsed };
  } catch {
    return { result: text };
  }
}

/** Anthropic-format history -> Gemini contents. Tool results are matched back to their tool name by id. */
function messagesToGemini(messages: LlmMessage[]): GeminiContent[] {
  const toolNames = new Map<string, string>();
  const out: GeminiContent[] = [];
  for (const m of messages) {
    const role = m.role === "assistant" ? "model" : "user";
    const parts: GeminiPart[] = [];
    if (typeof m.content === "string") {
      if (m.content) parts.push({ text: m.content });
    } else {
      for (const b of m.content ?? []) {
        const block = b as unknown as Record<string, unknown>;
        if (block.type === "text" && block.text) parts.push({ text: String(block.text) });
        else if (block.type === "tool_use") {
          toolNames.set(String(block.id), String(block.name));
          const part: GeminiPart = { functionCall: { name: String(block.name), args: (block.input as Record<string, unknown>) ?? {} } };
          // Gemini 2.5+/3 require the thought signature of a function call to be echoed back.
          const sig = (block as { _geminiThoughtSignature?: string })._geminiThoughtSignature;
          if (sig) part.thoughtSignature = sig;
          parts.push(part);
        } else if (block.type === "tool_result") {
          const id = String(block.tool_use_id);
          parts.push({ functionResponse: { name: toolNames.get(id) ?? "tool", response: resultToObject(block.content) } });
        }
      }
    }
    if (!parts.length) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.parts.push(...parts);
    else out.push({ role, parts });
  }
  if (out[0]?.role === "model") out.unshift({ role: "user", parts: [{ text: "(call connected)" }] });
  return out;
}

async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<GeminiChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line.startsWith("data:")) yield JSON.parse(line.slice(5).trim()) as GeminiChunk;
    }
  }
  const tail = buf.trim();
  if (tail.startsWith("data:")) yield JSON.parse(tail.slice(5).trim()) as GeminiChunk;
}

export class GeminiLlm implements LlmProvider {
  readonly name = "gemini";
  /** Primary model, then fallbacks tried in order when one is overloaded (503/429) or too slow. */
  private models = [env.GEMINI_MODEL, ...env.GEMINI_FALLBACK_MODELS.split(",").map((m) => m.trim())].filter((m, i, all) => m && all.indexOf(m) === i);

  private async post(path: string, body: (model: string) => unknown, signal?: AbortSignal, timeoutMs = 9_000) {
    let lastError: unknown;
    const deadline = Date.now() + timeoutMs * 1.5;
    for (const model of this.models) {
      const remaining = deadline - Date.now();
      if (remaining < 1_000) break;
      const timeout = AbortSignal.timeout(Math.min(timeoutMs, remaining));
      try {
        const res = await fetch(`${BASE}/${model}:${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY! },
          body: JSON.stringify(body(model)),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (res.ok) return res;
        lastError = new Error(`Gemini ${model} ${res.status}: ${(await res.text()).slice(0, 300)}`);
        if (![429, 500, 503, 504].includes(res.status)) throw lastError;
      } catch (err) {
        if (signal?.aborted) throw err;
        lastError = err;
        if (!timeout.aborted && !String(err).includes(" 429") && !/ 50[034]:/.test(String(err))) throw err;
      }
    }
    throw lastError ?? new Error("Gemini: no model answered in time");
  }

  /** Spoken replies need speed: keep thinking to a minimum on models that support it. */
  private generationConfig(model: string, maxTokens: number) {
    const config: Record<string, unknown> = { maxOutputTokens: maxTokens, temperature: 0.4 };
    if (/gemini-2\.5-flash/.test(model)) config.thinkingConfig = { thinkingBudget: 0 };
    else if (/gemini-[3-9]/.test(model)) config.thinkingConfig = { thinkingLevel: "low" };
    return config;
  }

  async streamTurn(o: LlmStreamOptions): Promise<LlmTurnResult> {
    const contents = messagesToGemini(o.messages);
    const tools = toolsToGemini(o.tools);
    const res = await this.post(
      "streamGenerateContent?alt=sse",
      (model) => ({
        systemInstruction: { parts: [{ text: o.system }] },
        contents,
        tools,
        generationConfig: this.generationConfig(model, o.maxTokens ?? 1024),
      }),
      o.signal,
    );

    let text = "";
    let finishReason: string | null = null;
    const calls: { name: string; args: Record<string, unknown>; sig?: string }[] = [];
    let usage = { inputTokens: 0, outputTokens: 0 };
    for await (const chunk of readSse(res.body!)) {
      if (chunk.error) throw new Error(`Gemini: ${chunk.error.message}`);
      const cand = chunk.candidates?.[0];
      for (const part of cand?.content?.parts ?? []) {
        if (part.thought) continue;
        if (part.text) {
          text += part.text;
          o.onText(part.text);
        }
        if (part.functionCall) calls.push({ name: part.functionCall.name, args: part.functionCall.args ?? {}, sig: part.thoughtSignature });
      }
      if (cand?.finishReason) finishReason = cand.finishReason;
      if (chunk.usageMetadata) {
        usage = {
          inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
          outputTokens: (chunk.usageMetadata.candidatesTokenCount ?? 0) + (chunk.usageMetadata.thoughtsTokenCount ?? 0),
        };
      }
    }

    const toolUses: LlmToolUse[] = calls.map((c) => ({ id: `toolu_${randomUUID().replace(/-/g, "").slice(0, 24)}`, name: c.name, input: c.args }));
    const content: LlmContentBlock[] = [];
    if (text) content.push({ type: "text", text });
    toolUses.forEach((t, i) => content.push({ type: "tool_use", id: t.id, name: t.name, input: t.input, ...(calls[i]!.sig ? { _geminiThoughtSignature: calls[i]!.sig } : {}) } as unknown as LlmContentBlock));

    const stopReason = toolUses.length ? "tool_use" : finishReason === "MAX_TOKENS" ? "max_tokens" : finishReason === "SAFETY" ? "refusal" : "end_turn";
    return { content, text, toolUses: stopReason === "max_tokens" ? [] : toolUses, stopReason, usage };
  }

  async completeJson<T>(o: { system: string; prompt: string; schema: Record<string, unknown>; maxTokens?: number }) {
    const res = await this.post(
      "generateContent",
      (model) => ({
        systemInstruction: { parts: [{ text: o.system }] },
        contents: [{ role: "user", parts: [{ text: o.prompt }] }],
        generationConfig: { ...this.generationConfig(model, o.maxTokens ?? 2048), responseMimeType: "application/json", responseSchema: toGeminiSchema(o.schema) },
      }),
      undefined,
      45_000,
    );
    const body = (await res.json()) as GeminiChunk;
    const cand = body.candidates?.[0];
    if (cand?.finishReason === "SAFETY") throw new Error("LLM declined the analysis request");
    const text = (cand?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
    return {
      data: JSON.parse(text) as T,
      usage: { inputTokens: body.usageMetadata?.promptTokenCount ?? 0, outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0 },
    };
  }
}
