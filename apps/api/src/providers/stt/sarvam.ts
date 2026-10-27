import WebSocket from "ws";
import { env } from "../../config";
import { wavHeader } from "../../audio/codec";
import { SttStream, type SttProvider } from "./types";

/**
 * Sarvam AI streaming STT (saarika). Strong on Indian languages incl. Kannada and Hindi,
 * with automatic language identification (language-code=unknown).
 * Protocol: JSON frames carrying base64 audio; responses carry transcripts and VAD signals.
 */
class SarvamStream extends SttStream {
  private ws: WebSocket;
  private queue: string[] = [];
  private buffer: Buffer[] = [];
  private bufferedBytes = 0;
  private closed = false;

  constructor(language: string) {
    super();
    const params = new URLSearchParams({
      "language-code": language,
      model: env.SARVAM_STT_MODEL,
      vad_signals: "true",
      high_vad_sensitivity: "true",
    });
    this.ws = new WebSocket(`wss://api.sarvam.ai/speech-to-text/ws?${params}`, { headers: { "api-subscription-key": env.SARVAM_API_KEY ?? "" } });
    this.ws.on("open", () => {
      for (const m of this.queue) this.ws.send(m);
      this.queue = [];
    });
    this.ws.on("message", (raw) => this.onMessage(raw.toString()));
    this.ws.on("error", (err) => this.emit("error", err));
    this.ws.on("close", () => this.emit("close"));
  }

  private onMessage(raw: string) {
    let msg: Record<string, any>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === "events") {
      const signal = msg.data?.signal_type;
      if (signal === "START_SPEECH") this.emit("speechStart");
      if (signal === "END_SPEECH") this.emit("utteranceEnd");
      return;
    }
    if (msg.type === "data" && msg.data?.transcript !== undefined) {
      // Sarvam returns one transcript per detected utterance, which is final.
      this.emit("transcript", { text: msg.data.transcript, isFinal: true, speechFinal: true, language: msg.data.language_code });
    }
    if (msg.type === "error") this.emit("error", new Error(msg.data?.message ?? "sarvam error"));
  }

  write(pcm: Buffer) {
    if (this.closed) return;
    // Batch ~100 ms per frame to keep message overhead low.
    this.buffer.push(pcm);
    this.bufferedBytes += pcm.length;
    if (this.bufferedBytes < 3200) return;
    const chunk = Buffer.concat(this.buffer);
    this.buffer = [];
    this.bufferedBytes = 0;
    const frame = JSON.stringify({ audio: { data: Buffer.concat([wavHeader(chunk.length), chunk]).toString("base64"), sample_rate: 16000, encoding: "audio/wav" } });
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(frame);
    else if (this.ws.readyState === WebSocket.CONNECTING) this.queue.push(frame);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "flush" }));
      setTimeout(() => this.ws.terminate(), 500);
    } catch {
      /* ignore */
    }
  }
}

export class SarvamStt implements SttProvider {
  readonly name = "sarvam";
  open(o: { language?: string }) {
    const code = o.language === "kn" ? "kn-IN" : o.language === "hi" ? "hi-IN" : o.language === "en" ? "en-IN" : "unknown";
    return new SarvamStream(code);
  }
}
