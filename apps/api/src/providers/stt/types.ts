import { EventEmitter } from "node:events";

export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
  /** Engine believes the speaker finished the utterance (endpointing) */
  speechFinal: boolean;
  language?: string;
  confidence?: number;
}

/**
 * A live STT stream. Input: PCM16 16 kHz mono.
 * Events: "transcript" (TranscriptEvent), "speechStart", "utteranceEnd", "error" (Error), "close".
 */
export abstract class SttStream extends EventEmitter {
  abstract write(pcm: Buffer): void;
  abstract close(): void;
}

export interface SttProvider {
  readonly name: string;
  open(o: { language?: string }): SttStream;
}
