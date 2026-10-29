import type { Org } from "@axo/shared";
import { zodToJsonSchema } from "zod-to-json-schema";
import { env } from "../config";
import type { LlmToolDef } from "../providers/llm/types";
import type { ToolContext, ToolDefinition } from "./types";
import { businessTools } from "./business";
import { ALL_TOOLS } from "./definitions";

export * from "./types";

export interface ToolExecution {
  ok: boolean;
  result: Record<string, unknown>;
  ms: number;
}

export interface ToolRegistry {
  defs(): LlmToolDef[];
  execute(name: string, input: unknown, ctx: ToolContext): Promise<ToolExecution>;
}

class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(`timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Validates tool input with zod, enforces a timeout, and converts failures into a structured error
 * plus a natural spoken fallback the model can say, so the call never stalls on a broken integration.
 */
export function createToolRegistry(tools: ToolDefinition[] = ALL_TOOLS): ToolRegistry {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const defs = tools.map((t) => {
    const schema = zodToJsonSchema(t.schema, { target: "openApi3", $refStrategy: "none" }) as Record<string, unknown>;
    delete schema.$schema;
    return { name: t.name, description: t.description, input_schema: { type: "object", ...schema } };
  });

  return {
    defs: () => defs,
    async execute(name, input, ctx) {
      const started = Date.now();
      const tool = byName.get(name);
      if (!tool) return { ok: false, ms: 0, result: { error: `Unknown tool ${name}` } };
      const parsed = tool.schema.safeParse(input ?? {});
      if (!parsed.success) {
        return {
          ok: false,
          ms: Date.now() - started,
          result: { error: "invalid_input", details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
        };
      }
      try {
        const result = await withTimeout(tool.run(parsed.data, ctx), tool.timeoutMs ?? env.TOOL_TIMEOUT_MS);
        return { ok: !("error" in result), result, ms: Date.now() - started };
      } catch (err) {
        ctx.log(`tool ${name} failed`, { err: (err as Error).message });
        return {
          ok: false,
          ms: Date.now() - started,
          result: {
            error: err instanceof TimeoutError ? "timeout" : "tool_failed",
            spoken: "Say sorry, you couldn't check that right now, and offer a callback from the team with the details.",
          },
        };
      }
    },
  };
}

const registries = new Map<string, ToolRegistry>();

/** The tool set for an org: the showroom tools, or for any other business the tools its ticked actions unlock. */
export function toolRegistryFor(org: Org): ToolRegistry {
  const key = org.business ? [...org.business.actions].sort().join(",") : "showroom";
  let reg = registries.get(key);
  if (!reg) registries.set(key, (reg = createToolRegistry(org.business ? businessTools(org.business.actions) : ALL_TOOLS)));
  return reg;
}
