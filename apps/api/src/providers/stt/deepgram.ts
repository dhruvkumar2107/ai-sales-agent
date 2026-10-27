import WebSocket from "ws";
import { env } from "../../config";
import { logger } from "../../lib/logger";
import { SttStream, type SttProvider } from "./types";

/**
 * Deepgram live streaming (nova-3, language=multi for English/Hindi code-switching).
 * Kannada is not covered by nova-3 multi; use STT_PROVIDER=sarvam for Kannada-heavy deployments.
 */
class DeepgramStream extends SttStream {
  private ws: WebSocket;
  private queue: Buffer[] = [];
  private keepAlive: NodeJS.Timeout;
  private closed = false;

  constructor(language: string) {
    super();
    const params = new URLSearchParams({
      model: env.DEEPGRAM_MODEL,
      language,
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      interim_results: "true",
      endpointing: "300",
      utterance_end_ms: "1000",
      vad_events: "true",
      smart_format: "true",
      punctuate: "true",
    });
    this.ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, { headers: { Authorization: `Token ${env.DEEPGRAM_API_KEY}` } });
    this.ws.on("open", () => {
      for (const b of this.queue) this.ws.send(b);
      this.queue = [];
    });
    this.ws.on("message", (raw) => this.onMessage(raw.toString()));
    this.ws.on("error", (err) => this.emit("error", err));
    this.ws.on("close", () => {
      clearInterval(this.keepAlive);
      this.emit("close");
    });
    this.keepAlive = setInterval(() => {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "KeepAlive" }));
    }, 8000);
  }

  private onMessage(raw: string) {
    let msg: Record<string, any>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === "SpeechStarted") return void this.emit("speechStart");
    if (msg.type === "UtteranceEnd") return void this.emit("utteranceEnd");
    if (msg.type !== "Results") return;
    const alt = msg.channel?.alternatives?.[0];
    if (!alt) return;
    this.emit("transcript", {
      text: alt.transcript ?? "",
      isFinal: Boolean(msg.is_final),
      speechFinal: Boolean(msg.speech_final),
      language: alt.languages?.[0] ?? msg.channel?.detected_language,
      confidence: alt.confidence,
    });
  }

  write(pcm: Buffer) {
    if (this.closed) return;
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(pcm);
    else if (this.ws.readyState === WebSocket.CONNECTING) this.queue.push(pcm);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.keepAlive);
    try {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "CloseStream" }));
      setTimeout(() => this.ws.terminate(), 500);
    } catch (err) {
      logger.debug({ err }, "deepgram close");
    }
  }
}

export class DeepgramStt implements SttProvider {
  readonly name = "deepgram";
  open(o: { language?: string }) {
    // "multi" handles en/hi code-switching (Hinglish). A fixed language can be forced per agent.
    const lang = !o.language || o.language === "hinglish" || o.language === "auto" ? "multi" : o.language === "hi" ? "hi" : o.language === "en" ? "en-IN" : "multi";
    return new DeepgramStream(lang);
  }
}
