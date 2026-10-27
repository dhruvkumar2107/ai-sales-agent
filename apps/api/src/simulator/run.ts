import type { TranscriptEntry } from "@axo/shared";
import type { LlmProvider } from "../providers/llm";
import { MockTts } from "../providers/tts";
import { CallSession, type CallTransport } from "../voice/session";
import type { Scenario } from "./scenarios";

/** In-memory transport for text simulations: audio is counted, never played. */
export class TextTransport implements CallTransport {
  readonly kind = "text" as const;
  audioBytes = 0;
  cleared = 0;
  hungUp = false;
  transferredTo: string | null = null;
  constructor(private onEvent?: (e: Record<string, unknown>) => void) {}
  sendAudio(pcm: Buffer) {
    this.audioBytes += pcm.length;
  }
  clearAudio() {
    this.cleared++;
  }
  async hangup() {
    this.hungUp = true;
  }
  async transfer(number: string) {
    this.transferredTo = number;
    return true;
  }
  sendEvent(e: Record<string, unknown>) {
    this.onEvent?.(e);
  }
}

export interface ScenarioResult {
  scenario: Scenario;
  passed: boolean;
  failures: string[];
  transcript: TranscriptEntry[];
  tools: string[];
  outcome?: string;
  language: string;
  avgFirstAudioMs?: number;
  guardViolations: number;
}

export async function runScenario(s: Scenario, o: { orgId: string; llm?: LlmProvider; silenceMs?: number; onEntry?: (e: TranscriptEntry) => void }): Promise<ScenarioResult> {
  const transport = new TextTransport();
  const session = new CallSession({
    orgId: o.orgId,
    agentId: s.agentId,
    direction: s.direction ?? "inbound",
    callerPhone: s.callerPhone ?? "+919876543210",
    calledNumber: "+918041234567",
    provider: "simulator",
    transport,
    textMode: true,
    llm: o.llm,
    tts: new MockTts(0.1),
    silenceMs: o.silenceMs ?? 400,
    maxReprompts: 2,
    campaign: s.campaignType ? { id: "sim-campaign", type: s.campaignType } : undefined,
  });
  if (o.onEntry) session.on("transcript", o.onEntry);
  const ended = new Promise<void>((resolve) => session.once("ended", () => resolve()));
  await session.start();

  for (const step of s.steps) {
    if (session.isEnded) break;
    if (typeof step === "string") {
      session.pushText(step);
      await new Promise((r) => setTimeout(r, 10));
      await session.idle();
    } else {
      await Promise.race([new Promise((r) => setTimeout(r, step.wait)), ended]);
    }
  }
  if (!session.isEnded) await session.end("other", { hangup: false });
  await ended;

  const snap = session.inspect();
  const tools = snap.toolCalls.map((t) => t.name);
  const agentText = snap.transcript.filter((t) => t.role === "agent").map((t) => t.text).join(" \n ");
  const failures: string[] = [];
  for (const t of s.expect.tools ?? []) if (!tools.includes(t)) failures.push(`expected tool ${t} (called: ${tools.join(", ") || "none"})`);
  for (const t of s.expect.notTools ?? []) if (tools.includes(t)) failures.push(`unexpected tool ${t}`);
  if (s.expect.outcome && !s.expect.outcome.includes(snap.outcome as never)) failures.push(`outcome ${snap.outcome}, expected ${s.expect.outcome.join("|")}`);
  if (s.expect.language && snap.language !== s.expect.language) failures.push(`language ${snap.language}, expected ${s.expect.language}`);
  for (const re of s.expect.agentSays ?? []) if (!re.test(agentText)) failures.push(`agent never said ${re}`);
  for (const re of s.expect.agentNeverSays ?? []) if (re.test(agentText)) failures.push(`agent said forbidden ${re}`);
  if (snap.guardViolations > 0) failures.push(`price guard blocked ${snap.guardViolations} ungrounded amount(s)`);

  const avg = snap.latency.length ? Math.round(snap.latency.reduce((n, l) => n + l.firstAudioMs, 0) / snap.latency.length) : undefined;
  return { scenario: s, passed: failures.length === 0, failures, transcript: snap.transcript, tools, outcome: snap.outcome, language: snap.language, avgFirstAudioMs: avg, guardViolations: snap.guardViolations };
}
