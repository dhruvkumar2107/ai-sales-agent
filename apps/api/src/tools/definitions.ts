import { z } from "zod";
import { CALL_OUTCOMES } from "@axo/shared";
import { defineTool, type ToolDefinition } from "./types";

export const endCall = defineTool({
  name: "end_call",
  description: "End the call after you have said goodbye. Use when the conversation is complete, it is a wrong number, or the caller wants to hang up.",
  schema: z.object({ outcome: z.enum(CALL_OUTCOMES).describe("Overall outcome of the call") }),
  async run(input, ctx) {
    ctx.actions.endCall = { outcome: input.outcome };
    return { ok: true };
  },
});

export const ALL_TOOLS: ToolDefinition[] = [endCall];
