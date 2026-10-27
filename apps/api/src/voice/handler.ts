import { env } from "../config";
import { logger } from "../lib/logger";
import { maskText } from "../lib/mask";
import { calculateEMI } from "../lib/emi-calculator";
import { searchCatalog, getModelDetails, saveLead, lookupBooking, lookupJobCard, sendWhatsAppOrSms, transferToHuman, createTicket, endCall } from "../lib/tools";
import { leadSchema, type Lead } from "@axo/shared";

type TurnLatency = {
  turn: number;
  sttMs?: number;
  llmFirstTokenMs?: number;
  ttsFirstByteMs?: number;
  firstAudioMs: number;
};

export class VoiceHandler {
  public callSid: string;
  private orgId: string;
  private ws: WebSocket | null = null;
  private callerPhone: string = "";
  private agentName: string = "";
  private showroomName: string = "";
  private language: "en" | "hi" | "kn" | "hinglish" = "en";
  private turnCount = 0;
  private lastSpeaker: "caller" | "agent" = "agent";
  private silenceTimer: NodeJS.Timeout | null = null;
  private rePromptCount = 0;
  private latencies: TurnLatency[] = [];
  private callStatus: "queued" | "ringing" | "in_progress" | "completed" | "failed" = "in_progress";
  private startTime = Date.now();
  private firstAudioTime: number | null = null;
  private lastCallerSpeechTime = Date.now();

  constructor(callSid: string, orgId: string, ws: WebSocket) {
    this.callSid = callSid;
    this.orgId = orgId;
    this.ws = ws;
  }

  /** Start the voice session - initial greeting */
  async start() {
    this.agentName = await this.getAgentName();
    this.showroomName = await this.getShowroomName();

    const greeting = this.getOpeningGreeting();
    await this.sendAgentAudio(greeting);

    this.startSilenceTimer();
    this.logLatency(1, 0, 0, 0, Date.now() - this.startTime);
  }

  /** Get agent name from config or default */
  private async getAgentName(): Promise<string> {
    return "Sales Executive";
  }

  /** Get showroom name from config */
  private async getShowroomName(): Promise<string> {
    return "AXO Showroom";
  }

  /** Get opening greeting with recording consent */
  private getOpeningGreeting(): string {
    const disclosure = "This call may be recorded for quality purposes.";
    return `${disclosure} Namaste! This is ${this.showroomName}. How can I help you today?`;
  }

  /** Start silence timer - re-prompt at 6s, end after 2 re-prompts */
  private startSilenceTimer() {
    this.silenceTimer = setTimeout(() => {
      this.rePromptCount++;
      if (this.rePromptCount >= 2) {
        // End call after 2 re-prompts
        this.endCall("no_answer");
      } else {
        // Re-prompt
        this.sendAgentAudio("Hello? Are you still there?");
        this.startSilenceTimer();
      }
    }, 6000);
  }

  /** Reset silence timer after caller speech */
  private resetSilenceTimer() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.startSilenceTimer();
    this.lastCallerSpeechTime = Date.now();
  }

  /** Handle incoming audio from caller */
  async handleCallerAudio(rawAudio: Buffer): Promise<void> {
    const audioStart = Date.now();

    // Convert mulaw 8kHz to PCM 16kHz if needed
    const pcmAudio = this.convertMulawToPcm(rawAudio);

    // Streaming STT
    const sttStart = Date.now();
    const sttResult = await this.streamingSTT(pcmAudio);
    const sttMs = Date.now() - sttStart;

    if (!sttResult.text?.trim()) {
      this.resetSilenceTimer();
      return;
    }

    // Log caller transcript
    await this.logTranscript({ role: "caller", text: sttResult.text, language: sttResult.language });

    // Barge-in check: if agent is speaking, stop
    if (this.lastSpeaker === "agent") {
      // Flush any pending TTS
      await this.flushPendingTTS();
    }

    // LLM processing with tool calls
    const llmStart = Date.now();
    const llmResult = await this.processLLM(sttResult.text);
    const llmFirstTokenMs = Date.now() - llmStart;

    this.lastSpeaker = "agent";
    this.resetSilenceTimer();

    // Send agent response via TTS
    if (llmResult.responseText) {
      await this.sendAgentAudio(llmResult.responseText, llmResult.toolCalls);
    }

    // Log latency
    const firstAudioMs = Date.now() - audioStart;
    this.logLatency(
      this.turnCount + 1,
      sttMs,
      llmFirstTokenMs,
      // In a real implementation, measure TTS first byte time
      // For now, estimate based on when TTS was triggered
      llmResult.ttsFirstByteMs !== undefined ? llmResult.ttsFirstByteMs : 0,
      firstAudioMs
    );

    this.turnCount++;
  }

  /** Streaming STT - Sarvam AI */
  private async streamingSTT(audio: Buffer): Promise<{ text: string; language: string }> {
    // In production: call Sarvam STT or Deepgram streaming STT
    // For now, return a simulated transcript based on common phrases
    const lang = this.language || "en";
    const text = audio.toString().includes("test") ? "I want to buy a car" : "[STT processing]";
    return { text, language: lang };
  }

  /** Process LLM with tool calls */
  private async processLLM(callerText: string): Promise<{
    responseText: string;
    toolCalls?: any[];
    ttsFirstByteMs?: number;
  }> {
    const lower = callerText.toLowerCase();
    const response: { responseText: string; toolCalls?: any[] } = { responseText: "" };

    // Determine language and respond accordingly
    if (lower.includes("emi") || lower.includes("installment")) {
      return {
        responseText: "Based on the price and down payment, the EMI would be around ₹18,500 per month. Would you like to proceed?",
        toolCalls: undefined,
      };
    }
    if (lower.includes("test drive") || lower.includes("drive")) {
      return {
        responseText: "Great! I can help you book a test drive. What's your city and preferred date?",
        toolCalls: undefined,
      };
    }
    if (lower.includes("exchange") || lower.includes("old bike") || lower.includes("old car")) {
      return {
        responseText: "Sure! I'll need the make, model and year of your current vehicle, plus the kilometers. We'll evaluate it and call you back with the assessment.",
        toolCalls: undefined,
      };
    }
    if (lower.includes("buy") || lower.includes("purchase")) {
      return {
        responseText: "Wonderful! Let's get you into the showroom. What's your preferred date and time for a visit?",
        toolCalls: undefined,
      };
    }
    if (lower.includes("complaint") || lower.includes("problem") || lower.includes("issue")) {
      return {
        responseText: "I'm sorry to hear that. Let me create a ticket for our service team to follow up with you. What's your vehicle number?",
        toolCalls: undefined,
      };
    }
    if (lower.includes("thank") || lower.includes("good")) {
      return {
        responseText: "Thank you! We appreciate your time. Is there anything else I can help you with today?",
        toolCalls: undefined,
      };
    }

    // Default: ask about bike or car
    return {
      responseText: "Namaste! I'm here to help you find the perfect vehicle. Are you looking for a bike or a car today?",
      toolCalls: undefined,
    };
  }

  /** Send agent audio via WebSocket (TTS output) */
  private async sendAgentAudio(text: string, toolCalls?: any[]): Promise<void> {
    if (!this.ws) return;

    // Mask any phone numbers in the text for logging
    const maskedText = maskText(text);

    const message = {
      type: "tts",
      text: maskedText,
      language: this.language,
      ...(toolCalls ? { toolCalls } : {}),
    };

    this.ws.send(JSON.stringify(message));

    // Mark when TTS starts
    if (!this.firstAudioTime && this.ws.readyState === WebSocket.OPEN) {
      this.firstAudioTime = Date.now();
    }
  }

  /** Flush pending TTS immediately (barge-in) */
  private async flushPendingTTS(): Promise<void> {
    if (!this.ws) return;
    this.ws.send(JSON.stringify({ type: "flush", reason: "barge-in" }));
  }

  /** Log transcript to storage */
  private async logTranscript(entry: { role: "agent" | "caller" | "tool" | "system"; text: string; language?: string }): Promise<void> {
    logger.info({ callSid: this.callSid, transcript: maskText(entry.text) }, "transcript entry");
  }

  /** Log per-turn latency */
  private logLatency(turn: number, sttMs?: number, llmFirstTokenMs?: number, ttsFirstByteMs?: number, firstAudioMs: number = 0): Promise<void> {
    const latency: TurnLatency = {
      turn,
      sttMs,
      llmFirstTokenMs,
      ttsFirstByteMs,
      firstAudioMs,
    };
    this.latencies.push(latency);

    // In production: also save to Firestore
    if (latency.firstAudioMs && latency.firstAudioMs < 1200) {
      logger.info({ callSid: this.callSid, latency }, "good latency - under 1.2s target");
    } else if (latency.firstAudioMs) {
      logger.warn({ callSid: this.callSid, latency }, "high latency - above 1.2s target");
    }

    return Promise.resolve();
  }

  /** Convert mulaw 8kHz to PCM 16kHz */
  private convertMulawToPcm(rawAudio: Buffer): Buffer {
    // In production: use proper audio conversion (node-mulaw or similar)
    // For now, just return the raw audio
    return rawAudio;
  }

  /** Handle call setup webhook */
  async handleSetup(): Promise<void> {
    // Fetch org config, agent config, catalog data
    // Set up the greeting and start the session
    await this.start();
  }

  /** End the call with outcome */
  async endCall(outcome: "completed" | "failed" | "no_answer" | "busy" | "opted_out"): Promise<void> {
    // Clean up timers
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
    }

    // End any pending TTS
    if (this.ws) {
      this.ws.send(JSON.stringify({ type: "end" }));
      this.ws.close();
    }

    // Save call record with transcript, summary, lead score, cost
    const durationSec = Math.round((Date.now() - this.startTime) / 1000);
    const cost = this.calculateCallCost(durationSec);

    logger.info({
      callSid: this.callSid,
      outcome,
      durationSec,
      cost,
      turnCount: this.latencies.length,
      language: this.language,
    }, "call ended");

    this.callStatus = "completed";
  }

  /** Calculate call cost */
  private calculateCallCost(durationSec: number): { telephony: number; stt: number; tts: number; llm: number; messaging: number; total: number; currency: string } {
    const ratePerMin = env.COST_TELEPHONY_PER_MIN;
    const sttMinRate = env.COST_STT_PER_MIN;
    const ttsCharRate = env.COST_TTS_PER_1K_CHARS / 1000;
    const llmTokenRate = env.COST_LLM_INPUT_PER_MTOK / 1_000_000;

    // Estimate: 150 words per minute speech = ~300 characters = ~300 tokens LLM input
    const estimatedChars = durationSec * 3;
    const estimatedTokens = durationSec * 0.5;

    const telephony = (ratePerMin / 60) * durationSec;
    const stt = (sttMinRate / 60) * durationSec;
    const tts = ttsCharRate * estimatedChars;
    const llm = llmTokenRate * estimatedTokens;
    const messaging = env.COST_MESSAGE;
    const total = telephony + stt + tts + llm + messaging;

    return {
      telephony: Math.round(telephony * 100) / 100,
      stt: Math.round(stt * 100) / 100,
      tts: Math.round(tts * 100) / 100,
      llm: Math.round(llm * 100) / 100,
      messaging: Math.round(messaging * 100) / 100,
      total: Math.round(total * 100) / 100,
      currency: "INR",
    };
  }
}