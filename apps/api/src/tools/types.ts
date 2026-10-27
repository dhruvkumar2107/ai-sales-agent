import type { AgentConfig, Language, Org } from "@axo/shared";
import type { z } from "zod";
import type { Repo } from "../db/repo";

/** Per-call context available to every tool. */
export interface ToolContext {
  orgId: string;
  repo: Repo;
  org: Org;
  agent: AgentConfig;
  callId: string;
  callerPhone: string;
  branchId?: string;
  language: Language;
  /** Side effects the session must act on after the current reply is spoken */
  actions: {
    endCall?: { outcome: string };
    transfer?: { number: string; to: string; department: string };
  };
  /** Telephony-aware transfer, injected by the session */
  canTransfer: boolean;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface ToolDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema: S;
  /** Hard timeout; on expiry the model receives an error and a spoken fallback */
  timeoutMs?: number;
  run(input: z.infer<S>, ctx: ToolContext): Promise<Record<string, unknown>>;
}

export const defineTool = <S extends z.ZodTypeAny>(t: ToolDefinition<S>) => t;
