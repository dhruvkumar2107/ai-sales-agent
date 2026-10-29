import { EventEmitter } from "node:events";
import type { AgentConfig, Call, CallOutcome, Language, Org, TranscriptEntry, TurnLatency } from "@axo/shared";
import { agentConfigSchema } from "@axo/shared";
import { AGENT_TEMPLATES } from "../../prompts/agents";
import { pcmDurationMs } from "../audio/codec";
import { CallRecorder } from "../audio/recorder";
import { Vad } from "../audio/vad";
import { env } from "../config";
import { global, newId, nowIso, repo, type Repo } from "../db/repo";
import { logger } from "../lib/logger";
import { maskPhone } from "../lib/mask";
import { createLlm, type LlmContentBlock, type LlmMessage, type LlmProvider } from "../providers/llm";
import { createStt, type SttProvider, type SttStream, type TranscriptEvent } from "../providers/stt";
import { createTts, type TtsProvider } from "../providers/tts";
import { toolRegistryFor, type ToolContext, type ToolRegistry } from "../tools";
import { SentenceChunker } from "./chunker";
import { detectLanguage, LANGUAGE_NAMES } from "./language";
import { checkPrices, collectNumbers, extractAmounts, parseAmounts } from "./price-guard";
import { phrase } from "./phrases";
import { buildGreeting, buildSystemPrompt, type CallPromptContext } from "./prompt";
import { formatForSpeech } from "./speech-format";

/** Where agent audio goes and how the call is controlled. Implemented per telephony provider / browser / text. */
export interface CallTransport {
  readonly kind: "twilio" | "exotel" | "browser" | "text";
  /** PCM16 16 kHz mono */
  sendAudio(pcm: Buffer): void;
  /** Drop any audio buffered at the far end (barge-in) */
  clearAudio(): void;
  hangup(): Promise<void>;
  transfer(number: string): Promise<boolean>;
  /** Optional side channel for live transcripts (browser console) */
  sendEvent?(event: Record<string, unknown>): void;
}

export interface CallSessionOptions {
  orgId: string;
  agentId?: string;
  callId?: string;
  direction: "inbound" | "outbound" | "web";
  callerPhone: string;
  calledNumber?: string;
  provider: string;
  providerCallId?: string;
  transport: CallTransport;
  campaign?: { id: string; type: string; script?: string; contactId?: string; data?: Record<string, string> };
  customerName?: string;
  leadId?: string;
  recordingConsent?: boolean;
  /** Text mode skips STT/VAD (simulator, console chat) */
  textMode?: boolean;
  llm?: LlmProvider;
  stt?: SttProvider;
  tts?: TtsProvider;
  tools?: ToolRegistry;
  silenceMs?: number;
  maxReprompts?: number;
  /** Force the starting language (otherwise the agent default, then auto-detected) */
  language?: Language;
}

interface SpokenSentence {
  text: string;
  startAt: number;
  endAt: number;
}

interface Turn {
  id: number;
  kind: "llm" | "scripted";
  userText: string;
  controller: AbortController;
  historyStart: number;
  speechEndAt: number;
  finalAt: number;
  firstTokenAt?: number;
  firstSentenceAt?: number;
  firstTtsByteAt?: number;
  firstAudioAt?: number;
  audioStarted: boolean;
  spoken: SpokenSentence[];
  agentText: string;
  speechChain: Promise<void>;
  done: boolean;
  /** Merged into a newer turn: its history entries were rolled back and must not be touched */
  discarded?: boolean;
}

type MessageContent = NonNullable<LlmMessage["content"]>;

const FILLERS = /^(h+m+|u+h+|u+m+|a+h+|o+k+|haan|han|ji|acha|accha|mm+|hello)[.?!\s]*$/i;

/** Buffer an async iterable so TTS synthesis of the next sentence overlaps playback of the current one. */
function prefetch(source: AsyncIterable<Buffer>): AsyncIterable<Buffer> {
  const buf: Buffer[] = [];
  let done = false;
  let error: unknown;
  let wake = null as (() => void) | null;
  void (async () => {
    try {
      for await (const c of source) {
        buf.push(c);
        wake?.();
      }
    } catch (e) {
      error = e;
    }
    done = true;
    wake?.();
  })();
  return {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (buf.length) yield buf.shift()!;
        else if (done) {
          if (error) throw error;
          return;
        } else await new Promise<void>((r) => (wake = r));
        wake = null;
      }
    },
  };
}

/**
 * One live conversation: audio in -> VAD + streaming STT -> Claude (streaming, tools) -> sentence-chunked
 * streaming TTS -> audio out. Handles barge-in, silence re-prompts, language detection, latency logging,
 * price grounding and the post-call record.
 */
export class CallSession extends EventEmitter {
  readonly callId: string;
  readonly startedAt = Date.now();
  private r: Repo;
  private org!: Org;
  private agent!: AgentConfig;
  private llm: LlmProvider;
  private sttProvider: SttProvider;
  private tts: TtsProvider;
  private tools!: ToolRegistry;
  private stt: SttStream | null = null;
  private vad = new Vad();
  private recorder = new CallRecorder();

  private system = "";
  private modelNames: string[] = [];
  private history: LlmMessage[] = [];
  private transcript: TranscriptEntry[] = [];
  private latency: TurnLatency[] = [];
  private toolLog: Call["toolCalls"] = [];
  private allowedNumbers = new Set<number>();
  private guardViolations = 0;

  language: Language;
  private languageLocked = false;
  private pendingLanguageNote: string | null = null;
  private langSwitchVotes: { lang: Language; count: number } = { lang: "en", count: 0 };

  private turn: Turn | null = null;
  private turnCounter = 0;
  private playheadEnd = 0;
  private pendingFinal = "";
  private lastFinalAt = 0;
  private lastSttLang: string | undefined;
  private interruptedNote: string | null = null;
  private bargeTimer: NodeJS.Timeout | null = null;
  private silenceTimer: NodeJS.Timeout | null = null;
  private maxTimer: NodeJS.Timeout | null = null;
  private reprompts = 0;
  private silenceMs: number;
  private maxReprompts: number;

  private actions: ToolContext["actions"] = {};
  private outcome: CallOutcome | undefined;
  private ended = false;
  private endPromise: Promise<Call | null> | null = null;
  private usage = { sttSeconds: 0, ttsChars: 0, llmInputTokens: 0, llmOutputTokens: 0, messages: 0 };
  private transferredTo: string | undefined;

  constructor(private o: CallSessionOptions) {
    super();
    this.callId = o.callId ?? newId("call_");
    this.r = repo(o.orgId);
    this.llm = o.llm ?? createLlm();
    this.sttProvider = o.stt ?? createStt();
    this.tts = o.tts ?? createTts();
    this.silenceMs = o.silenceMs ?? env.SILENCE_REPROMPT_MS;
    this.maxReprompts = o.maxReprompts ?? env.MAX_REPROMPTS;
    this.language = o.language ?? "en";
  }

  private log(msg: string, extra: Record<string, unknown> = {}) {
    logger.info({ callId: this.callId, ...extra }, msg);
  }

  // ------------------------------------------------------------------ lifecycle

  async start(): Promise<void> {
    const org = await global.orgs().get(this.o.orgId);
    if (!org) throw new Error(`Unknown org ${this.o.orgId}`);
    this.org = org;
    this.tools = this.o.tools ?? toolRegistryFor(org);
    const agents = await this.r.agents.list({ where: { active: true } });
    this.agent = (this.o.agentId && agents.find((a) => a.id === this.o.agentId)) || agents[0] || agentConfigSchema.parse({ ...AGENT_TEMPLATES[1], orgId: org.id });
    if (!this.o.language) this.language = this.agent.defaultLanguage;

    const ctx: CallPromptContext = {
      direction: this.o.direction,
      callerPhone: this.o.callerPhone,
      campaignType: this.o.campaign?.type,
      campaignScript: this.o.campaign?.script,
      customerName: this.o.customerName,
      contactData: this.o.campaign?.data,
    };
    const built = await buildSystemPrompt(this.r, org, this.agent, ctx);
    this.system = built.system;
    this.modelNames = built.modelNames;
    collectNumbers(built.catalog, this.allowedNumbers);
    for (const a of parseAmounts(built.knowledge)) this.allowedNumbers.add(a);
    collectNumbers((await this.r.offers.list()).map((x) => x.description), this.allowedNumbers);
    const settings = await this.r.settings();
    collectNumbers(settings.emi, this.allowedNumbers);

    await this.r.calls.set({
      id: this.callId,
      orgId: org.id,
      agentId: this.agent.id,
      direction: this.o.direction,
      provider: this.o.provider,
      providerCallId: this.o.providerCallId,
      from: this.o.direction === "outbound" ? (this.o.calledNumber ?? "") : this.o.callerPhone,
      to: this.o.direction === "outbound" ? this.o.callerPhone : (this.o.calledNumber ?? ""),
      campaignId: this.o.campaign?.id,
      leadId: this.o.leadId,
      startedAt: new Date(this.startedAt).toISOString(),
      durationSec: 0,
      status: "in_progress",
      recordingConsent: this.o.recordingConsent ?? settings.recordCalls,
      transcript: [],
      extracted: {},
      latency: [],
      toolCalls: [],
      cost: { telephony: 0, stt: 0, tts: 0, llm: 0, messaging: 0, total: 0, currency: "INR" },
      usage: this.usage,
    });

    if (!this.o.textMode) {
      this.stt = this.sttProvider.open({ language: this.agent.languages.length === 1 ? this.agent.languages[0] : "auto" });
      this.stt.on("transcript", (ev: TranscriptEvent) => this.onTranscript(ev));
      this.stt.on("utteranceEnd", () => this.commitUtterance());
      this.stt.on("error", (err: Error) => logger.warn({ callId: this.callId, err: err.message }, "stt error"));
      this.vad.on("speechStart", () => this.onVadSpeechStart());
    }

    this.maxTimer = setTimeout(() => void this.speakScripted(phrase("silenceGoodbye", this.language), "other"), env.MAX_CALL_SECONDS * 1000);

    // Conversation starts with a synthetic user turn so the greeting can sit in history as an assistant turn.
    const greeting = buildGreeting(org, this.agent, this.language, ctx);
    this.history.push({ role: "user", content: `[Call connected. Direction: ${this.o.direction}.]` });
    this.history.push({ role: "assistant", content: greeting });
    this.log(`call started ${this.o.direction} ${maskPhone(this.o.callerPhone)} agent=${this.agent.name} llm=${this.llm.name} stt=${this.sttProvider.name} tts=${this.tts.name}`);
    await this.speakScripted(greeting);
  }

  /** Caller audio, PCM16 16 kHz mono. */
  pushAudio(pcm: Buffer): void {
    if (this.ended) return;
    const now = Date.now();
    this.recorder.add(pcm, now);
    this.usage.sttSeconds += pcmDurationMs(pcm) / 1000;
    this.vad.push(pcm, now);
    this.stt?.write(pcm);
  }

  /** Text input (simulator / console chat): treated as one final utterance. */
  pushText(text: string): void {
    if (this.ended) return;
    const now = Date.now();
    void this.handleUtterance(text, { speechEndAt: now, finalAt: now });
  }

  /** Resolves when no turn is running (used by the simulator). */
  async idle(): Promise<void> {
    while (this.turn && !this.turn.done) await this.turn.speechChain.then(() => new Promise((r) => setTimeout(r, 5)));
  }

  get isEnded() {
    return this.ended;
  }

  // ------------------------------------------------------------------ input handling

  private onVadSpeechStart() {
    this.clearSilenceTimer();
    if (!this.isAgentSpeaking()) return;
    // Confirm barge-in if speech persists; STT interim words confirm it sooner.
    if (this.bargeTimer) clearTimeout(this.bargeTimer);
    this.bargeTimer = setTimeout(() => {
      this.bargeTimer = null;
      if (this.vad.speaking && this.isAgentSpeaking()) this.interrupt("vad");
    }, 300);
  }

  private onTranscript(ev: TranscriptEvent) {
    const text = ev.text.trim();
    if (!text) return;
    if (ev.confidence !== undefined && ev.confidence < 0.35) return; // likely noise
    this.clearSilenceTimer();
    if (!ev.isFinal) {
      if (this.isAgentSpeaking() && !FILLERS.test(text)) this.interrupt("stt-interim");
      return;
    }
    this.pendingFinal = `${this.pendingFinal} ${text}`.trim();
    this.lastFinalAt = Date.now();
    this.lastSttLang = ev.language ?? this.lastSttLang;
    if (ev.speechFinal) this.commitUtterance();
  }

  private commitUtterance() {
    const text = this.pendingFinal.trim();
    if (!text) return;
    this.pendingFinal = "";
    // Backchannels while the agent talks ("hmm", "haan") are not turns.
    if (this.isAgentSpeaking() && FILLERS.test(text)) return;
    const speechEndAt = this.vad.lastVoiceAt && this.vad.lastVoiceAt <= this.lastFinalAt ? this.vad.lastVoiceAt : this.lastFinalAt;
    void this.handleUtterance(text, { speechEndAt, finalAt: this.lastFinalAt || Date.now(), sttLang: this.lastSttLang });
  }

  private detectAndNoteLanguage(text: string, sttLang?: string) {
    const guess = detectLanguage(text, sttLang);
    const allowed = this.agent.languages;
    const pick = (l: Language): Language => (allowed.includes(l) ? l : l === "hinglish" && allowed.includes("hi") ? "hi" : l === "hi" && allowed.includes("hinglish") ? "hinglish" : l);
    const lang = pick(guess.language);
    if (!this.languageLocked) {
      this.languageLocked = true;
      this.language = lang;
      this.pendingLanguageNote = `(Detected caller language: ${LANGUAGE_NAMES[lang]}. Reply in ${LANGUAGE_NAMES[lang]}.)`;
      this.log(`language detected: ${lang} (${guess.confidence.toFixed(2)})`);
      return;
    }
    if (lang === this.language) {
      this.langSwitchVotes = { lang, count: 0 };
      return;
    }
    // Short or ambiguous utterances ("10", "ok") don't vote.
    if (guess.confidence < 0.7) return;
    // Switch on a confident script change immediately, or on two consecutive utterances.
    this.langSwitchVotes = this.langSwitchVotes.lang === lang ? { lang, count: this.langSwitchVotes.count + 1 } : { lang, count: 1 };
    if (guess.confidence >= 0.9 || this.langSwitchVotes.count >= 2) {
      this.language = lang;
      this.pendingLanguageNote = `(Caller switched to ${LANGUAGE_NAMES[lang]}. Reply in ${LANGUAGE_NAMES[lang]}.)`;
      this.log(`language switched: ${lang}`);
    }
  }

  private async handleUtterance(text: string, meta: { speechEndAt: number; finalAt: number; sttLang?: string }) {
    if (this.ended || this.actions.endCall || this.actions.transfer) return;
    this.clearSilenceTimer();
    this.reprompts = 0;

    // Caller kept talking before we produced audio: merge into one turn and restart.
    if (this.turn && !this.turn.done) {
      if (!this.turn.audioStarted && this.turn.kind === "llm") {
        const prev = this.turn;
        prev.controller.abort();
        prev.done = true;
        prev.discarded = true;
        this.history.length = prev.historyStart;
        this.transcript = this.transcript.filter((t) => !(t.role === "caller" && t.text === prev.userText && t.at >= new Date(prev.finalAt - 60000).toISOString()));
        text = `${prev.userText} ${text}`;
        meta.speechEndAt = Math.max(meta.speechEndAt, prev.speechEndAt);
      } else {
        this.interrupt("new-utterance");
      }
    }

    this.detectAndNoteLanguage(text, meta.sttLang);
    for (const a of extractAmounts(text)) this.allowedNumbers.add(a);
    this.addTranscript({ role: "caller", text, at: nowIso(), language: this.language });

    const turn = this.newTurn("llm", text, meta.speechEndAt, meta.finalAt);
    const notes: string[] = [];
    if (this.pendingLanguageNote) notes.push(this.pendingLanguageNote);
    if (this.interruptedNote) notes.push(this.interruptedNote);
    this.pendingLanguageNote = null;
    this.interruptedNote = null;
    this.appendUserContent([{ type: "text", text: notes.length ? `${notes.join(" ")}\n${text}` : text }]);

    try {
      await this.runLlmTurn(turn);
    } catch (err) {
      if ((err as Error).name === "AbortError" || turn.controller.signal.aborted) return;
      logger.error({ callId: this.callId, err }, "turn failed");
      this.enqueueSpeech(turn, phrase("llmError", this.language));
    }
    await turn.speechChain;
    await this.finishTurn(turn);
  }

  /** Append user content, merging with a trailing user message (e.g. pending tool results) to keep roles alternating. */
  private appendUserContent(blocks: LlmContentBlock[]) {
    const last = this.history[this.history.length - 1];
    if (last?.role === "user") {
      const existing: LlmContentBlock[] = typeof last.content === "string" ? [{ type: "text", text: last.content }] : (last.content as LlmContentBlock[]);
      last.content = [...existing, ...blocks] as MessageContent;
    } else {
      this.history.push({ role: "user", content: blocks as MessageContent });
    }
  }

  // ------------------------------------------------------------------ LLM turn

  private newTurn(kind: Turn["kind"], userText: string, speechEndAt: number, finalAt: number): Turn {
    const turn: Turn = {
      id: ++this.turnCounter,
      kind,
      userText,
      controller: new AbortController(),
      historyStart: this.history.length,
      speechEndAt,
      finalAt,
      audioStarted: false,
      spoken: [],
      agentText: "",
      speechChain: Promise.resolve(),
      done: false,
    };
    this.turn = turn;
    return turn;
  }

  private toolContext(): ToolContext {
    return {
      orgId: this.org.id,
      repo: this.r,
      org: this.org,
      agent: this.agent,
      callId: this.callId,
      callerPhone: this.o.callerPhone,
      language: this.language,
      actions: this.actions,
      // Browsers can't be bridged to a phone; the simulator's text transport fakes a successful transfer.
      canTransfer: this.o.transport.kind !== "browser",
      countMessage: () => void this.usage.messages++,
      log: (msg, extra) => this.log(msg, extra),
    };
  }

  private async runLlmTurn(turn: Turn) {
    const signal = turn.controller.signal;
    for (let round = 0; round < 5; round++) {
      const chunker = new SentenceChunker();
      const res = await this.llm.streamTurn({
        system: this.system,
        messages: this.history,
        tools: this.tools.defs(),
        signal,
        hints: { models: this.modelNames, agentKind: this.agent.kind, callerPhone: this.o.callerPhone, business: this.org.business },
        onText: (delta) => {
          if (signal.aborted) return;
          turn.firstTokenAt ??= Date.now();
          for (const s of chunker.push(delta)) this.enqueueSpeech(turn, s);
        },
      });
      if (signal.aborted) return;
      const rest = chunker.flush();
      if (rest) this.enqueueSpeech(turn, rest);
      this.usage.llmInputTokens += res.usage.inputTokens;
      this.usage.llmOutputTokens += res.usage.outputTokens;
      this.history.push({ role: "assistant", content: res.content.length ? (res.content as MessageContent) : [{ type: "text", text: "..." }] });

      if (res.stopReason === "refusal" && !res.text.trim()) this.enqueueSpeech(turn, phrase("llmError", this.language));
      if (!res.toolUses.length) return;

      const ctx = this.toolContext();
      const results = await Promise.all(
        res.toolUses.map(async (tu) => {
          const exec = await this.tools.execute(tu.name, tu.input, ctx);
          this.toolLog.push({ name: tu.name, ok: exec.ok, ms: exec.ms, at: nowIso() });
          collectNumbers(exec.result, this.allowedNumbers);
          this.addTranscript({ role: "tool", tool: tu.name, text: JSON.stringify({ input: tu.input, result: exec.result }).slice(0, 2000), at: nowIso() });
          this.log(`tool ${tu.name} ${exec.ok ? "ok" : "failed"} in ${exec.ms}ms`);
          return { type: "tool_result" as const, tool_use_id: tu.id, content: JSON.stringify(exec.result), is_error: !exec.ok };
        }),
      );
      // Aborted: interrupt() already answered the dangling tool_use, or the turn was rolled back.
      if (signal.aborted) return;
      this.history.push({ role: "user", content: results });
      // A terminal action (transfer / end call) ends the turn once the current reply is spoken,
      // unless nothing was said yet — then let the model voice the handover.
      if ((this.actions.endCall || this.actions.transfer) && turn.agentText.trim()) return;
      if ((this.actions.endCall || this.actions.transfer) && round >= 1) return;
    }
  }

  // ------------------------------------------------------------------ speech output

  private groundSentence(sentence: string): string {
    const check = checkPrices(sentence, this.allowedNumbers);
    if (check.ok) return sentence;
    this.guardViolations++;
    logger.warn({ callId: this.callId, ungrounded: check.ungrounded, sentence }, "price guard blocked ungrounded amount");
    return phrase("priceFallback", this.language);
  }

  private enqueueSpeech(turn: Turn, raw: string) {
    if (turn.controller.signal.aborted) return;
    const grounded = this.groundSentence(raw);
    turn.agentText = `${turn.agentText} ${grounded}`.trim();
    turn.firstSentenceAt ??= Date.now();
    const spoken = formatForSpeech(grounded, this.language);
    this.usage.ttsChars += spoken.length;
    const voice = this.agent.voices[this.language];
    const stream = prefetch(this.tts.synthesize({ text: spoken, language: this.language, voice, signal: turn.controller.signal }));
    this.o.transport.sendEvent?.({ type: "agent_text", text: grounded, turn: turn.id });
    turn.speechChain = turn.speechChain.then(() => this.play(turn, grounded, stream));
  }

  private async play(turn: Turn, text: string, stream: AsyncIterable<Buffer>) {
    if (turn.controller.signal.aborted) return;
    const sentence: SpokenSentence = { text, startAt: Math.max(Date.now(), this.playheadEnd), endAt: 0 };
    turn.spoken.push(sentence);
    try {
      for await (const chunk of stream) {
        if (turn.controller.signal.aborted) return;
        const now = Date.now();
        turn.firstTtsByteAt ??= now;
        if (!turn.audioStarted) {
          turn.audioStarted = true;
          turn.firstAudioAt = now;
          if (turn.kind === "llm") this.recordLatency(turn);
        }
        const startAt = Math.max(now, this.playheadEnd);
        this.recorder.add(chunk, startAt);
        this.playheadEnd = startAt + pcmDurationMs(chunk);
        this.o.transport.sendAudio(chunk);
      }
    } catch (err) {
      if (turn.controller.signal.aborted) return;
      logger.warn({ callId: this.callId, err: (err as Error).message }, "tts failed for sentence");
    }
    sentence.endAt = this.playheadEnd;
  }

  private recordLatency(turn: Turn) {
    const entry: TurnLatency = {
      turn: turn.id,
      sttMs: Math.max(0, turn.finalAt - turn.speechEndAt),
      llmFirstTokenMs: turn.firstTokenAt ? turn.firstTokenAt - turn.finalAt : undefined,
      ttsFirstByteMs: turn.firstTtsByteAt && turn.firstSentenceAt ? turn.firstTtsByteAt - turn.firstSentenceAt : undefined,
      firstAudioMs: (turn.firstAudioAt ?? Date.now()) - turn.speechEndAt,
    };
    this.latency.push(entry);
    const level = entry.firstAudioMs > 1200 ? "warn" : "info";
    logger[level]({ callId: this.callId, ...entry }, `turn ${turn.id} first audio in ${entry.firstAudioMs}ms`);
    this.emit("latency", entry);
    this.o.transport.sendEvent?.({ type: "latency", ...entry });
  }

  private isAgentSpeaking(): boolean {
    return Date.now() < this.playheadEnd - 50 || Boolean(this.turn && !this.turn.done && this.turn.audioStarted);
  }

  /** Barge-in: stop generation and synthesis, flush far-end audio, remember what the caller actually heard. */
  private interrupt(reason: string) {
    const turn = this.turn;
    if (this.bargeTimer) clearTimeout(this.bargeTimer);
    this.bargeTimer = null;
    this.o.transport.clearAudio();
    const now = Date.now();
    this.playheadEnd = now;
    if (!turn || turn.done) return;
    turn.controller.abort();
    const heard = turn.spoken.filter((s) => s.startAt < now).map((s) => s.text).join(" ");
    if (turn.agentText) {
      this.addTranscript({ role: "agent", text: heard || "(interrupted before speaking)", at: nowIso(), language: this.language, interrupted: true });
      turn.agentText = "";
      this.interruptedNote = heard ? `(The caller interrupted you; they only heard: "${heard.slice(-200)}")` : "(The caller interrupted you before you spoke.)";
    }
    // Interrupted after tool calls: make sure the dangling tool_use gets a result.
    const last = this.history[this.history.length - 1];
    if (last?.role === "assistant" && typeof last.content !== "string") {
      const pending = (last.content as LlmContentBlock[]).filter((b) => b.type === "tool_use") as { id: string }[];
      if (pending.length) this.history.push({ role: "user", content: pending.map((p) => ({ type: "tool_result" as const, tool_use_id: p.id, content: "Cancelled: caller interrupted", is_error: true })) });
    }
    turn.done = true;
    this.log(`barge-in (${reason}) on turn ${turn.id}`);
    this.o.transport.sendEvent?.({ type: "barge_in", turn: turn.id });
  }

  private async speakScripted(text: string, endOutcome?: CallOutcome) {
    if (this.ended) return;
    if (this.turn && !this.turn.done) this.interrupt("scripted");
    const now = Date.now();
    const turn = this.newTurn("scripted", "", now, now);
    this.enqueueSpeech(turn, text);
    await turn.speechChain;
    if (endOutcome) this.actions.endCall = { outcome: endOutcome };
    await this.finishTurn(turn);
  }

  private async finishTurn(turn: Turn) {
    if (turn.done && turn.controller.signal.aborted) return;
    turn.done = true;
    if (turn.agentText) this.addTranscript({ role: "agent", text: turn.agentText, at: nowIso(), language: this.language });
    this.emit("turnComplete", turn.id);

    if (this.actions.transfer) {
      const t = this.actions.transfer;
      await this.waitForPlayback();
      this.transferredTo = t.to;
      this.outcome = "transferred";
      const ok = await this.o.transport.transfer(t.number).catch(() => false);
      this.log(`transfer to ${t.department} ${ok ? "succeeded" : "failed"}`);
      if (!ok) this.outcome = "callback_scheduled";
      await this.end(this.outcome);
      return;
    }
    if (this.actions.endCall) {
      await this.waitForPlayback();
      await this.end(this.actions.endCall.outcome as CallOutcome);
      return;
    }
    this.scheduleSilenceTimer();
  }

  private async waitForPlayback() {
    const remaining = this.playheadEnd - Date.now();
    if (remaining > 0 && this.o.transport.kind !== "text") await new Promise((r) => setTimeout(r, remaining + 300));
  }

  // ------------------------------------------------------------------ silence

  private clearSilenceTimer() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }

  private scheduleSilenceTimer() {
    this.clearSilenceTimer();
    if (this.ended) return;
    const playback = this.o.transport.kind === "text" ? 0 : Math.max(0, this.playheadEnd - Date.now());
    this.silenceTimer = setTimeout(() => void this.onSilence(), playback + this.silenceMs);
  }

  private async onSilence() {
    if (this.ended || this.vad.speaking || (this.turn && !this.turn.done) || this.pendingFinal) return;
    this.reprompts++;
    if (this.reprompts > this.maxReprompts) {
      this.log("ending call after repeated silence");
      await this.speakScripted(phrase("silenceGoodbye", this.language), "silence");
      return;
    }
    const line = phrase("reprompt", this.language, this.reprompts - 1);
    this.history.push({ role: "user", content: "(The caller has been silent.)" });
    this.history.push({ role: "assistant", content: line });
    await this.speakScripted(line);
  }

  // ------------------------------------------------------------------ transcript & end

  private addTranscript(entry: TranscriptEntry) {
    this.transcript.push(entry);
    this.emit("transcript", entry);
    if (entry.role !== "tool") this.o.transport.sendEvent?.({ type: "transcript", ...entry });
  }

  /** End the call (idempotent). `outcome` defaults to "dropped" when the far end disconnects. */
  end(outcome: CallOutcome = "dropped", opts: { hangup?: boolean } = { hangup: true }): Promise<Call | null> {
    if (this.endPromise) return this.endPromise;
    this.ended = true;
    this.outcome = this.outcome ?? outcome;
    if (outcome !== "dropped" && outcome !== "transferred") this.outcome = outcome;
    this.endPromise = (async () => {
      this.clearSilenceTimer();
      if (this.maxTimer) clearTimeout(this.maxTimer);
      if (this.bargeTimer) clearTimeout(this.bargeTimer);
      if (this.turn && !this.turn.done) this.turn.controller.abort();
      this.stt?.close();
      if (opts.hangup !== false && outcome !== "transferred" && this.outcome !== "transferred") await this.o.transport.hangup().catch(() => undefined);
      const { finalizeCall } = await import("../calls/finalize");
      const call = await finalizeCall({
        orgId: this.org?.id ?? this.o.orgId,
        callId: this.callId,
        llm: this.llm,
        startedAt: this.startedAt,
        outcome: this.outcome ?? "other",
        transcript: this.transcript,
        latency: this.latency,
        toolCalls: this.toolLog,
        usage: this.usage,
        language: this.language,
        recording: this.recorder,
        transferredTo: this.transferredTo,
        callerPhone: this.o.callerPhone,
        guardViolations: this.guardViolations,
      }).catch((err) => {
        logger.error({ callId: this.callId, err }, "finalize failed");
        return null;
      });
      this.log(`call ended: ${this.outcome}`);
      this.emit("ended", call);
      return call;
    })();
    return this.endPromise;
  }

  /** Snapshot for the simulator and tests. */
  inspect() {
    return {
      transcript: this.transcript,
      latency: this.latency,
      toolCalls: this.toolLog,
      outcome: this.outcome,
      language: this.language,
      guardViolations: this.guardViolations,
      history: this.history,
      ended: this.ended,
    };
  }
}
