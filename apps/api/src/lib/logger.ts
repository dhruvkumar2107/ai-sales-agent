import pino from "pino";
import { env, isProd } from "../config";
import { maskText } from "./mask";

/**
 * Structured logger. Every string value passes through a phone-number mask so PII never reaches log sinks.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: ["req.headers.authorization", "*.apiKey", "*.token", "*.secret"], censor: "[redacted]" },
  hooks: {
    logMethod(args, method) {
      const masked = args.map((a) => (typeof a === "string" ? maskText(a) : maskDeep(a))) as typeof args;
      method.apply(this, masked);
    },
  },
  transport: isProd || env.LOG_LEVEL === "silent" ? undefined : { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss.l" } },
});

function maskDeep(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return value;
  if (typeof value === "string") return maskText(value);
  if (value instanceof Error) return value;
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = maskDeep(v, depth + 1);
    return out;
  }
  return value;
}
