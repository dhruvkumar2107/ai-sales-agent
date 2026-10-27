import { EventEmitter } from "node:events";
import { bufferToSamples, rms } from "./codec";

export interface VadOptions {
  frameMs?: number;
  /** Speech must exceed noise floor by this factor */
  ratio?: number;
  /** Absolute minimum RMS treated as speech (filters line hiss) */
  minRms?: number;
  /** Consecutive voiced ms before speechStart fires (rejects clicks / coughs) */
  startMs?: number;
  /** Consecutive unvoiced ms before speechEnd fires */
  endMs?: number;
}

/**
 * Energy-based voice activity detector with an adaptive noise floor.
 * Runs locally on every 20 ms frame, so barge-in reacts faster than cloud STT events.
 * Emits: "speechStart" (ts), "speechEnd" (ts).
 */
export class Vad extends EventEmitter {
  private frameMs: number;
  private ratio: number;
  private minRms: number;
  private startMs: number;
  private endMs: number;
  private noiseFloor = 200;
  private voicedMs = 0;
  private silentMs = 0;
  private pending: Buffer = Buffer.alloc(0);
  speaking = false;
  lastVoiceAt = 0;

  constructor(o: VadOptions = {}) {
    super();
    this.frameMs = o.frameMs ?? 20;
    this.ratio = o.ratio ?? 3;
    this.minRms = o.minRms ?? 500;
    this.startMs = o.startMs ?? 200;
    this.endMs = o.endMs ?? 600;
  }

  /** Feed PCM16 16 kHz audio of any length. */
  push(pcm: Buffer, now = Date.now()): void {
    this.pending = this.pending.length ? Buffer.concat([this.pending, pcm]) : pcm;
    const frameBytes = 16 * 2 * this.frameMs;
    while (this.pending.length >= frameBytes) {
      const frame = this.pending.subarray(0, frameBytes);
      this.pending = this.pending.subarray(frameBytes);
      this.processFrame(rms(bufferToSamples(frame)), now);
    }
  }

  private processFrame(energy: number, now: number) {
    const threshold = Math.max(this.minRms, this.noiseFloor * this.ratio);
    const voiced = energy > threshold;
    if (voiced) {
      this.voicedMs += this.frameMs;
      this.silentMs = 0;
      this.lastVoiceAt = now;
      if (!this.speaking && this.voicedMs >= this.startMs) {
        this.speaking = true;
        this.emit("speechStart", now);
      }
    } else {
      // Track the noise floor only on unvoiced frames; slow attack, faster decay.
      this.noiseFloor = energy > this.noiseFloor ? this.noiseFloor * 0.95 + energy * 0.05 : this.noiseFloor * 0.8 + energy * 0.2;
      this.silentMs += this.frameMs;
      this.voicedMs = Math.max(0, this.voicedMs - this.frameMs);
      if (this.speaking && this.silentMs >= this.endMs) {
        this.speaking = false;
        this.emit("speechEnd", now);
      }
    }
  }

  reset() {
    this.speaking = false;
    this.voicedMs = 0;
    this.silentMs = 0;
    this.pending = Buffer.alloc(0);
  }
}
