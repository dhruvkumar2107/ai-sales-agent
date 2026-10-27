import { bufferToSamples, wavHeader } from "./codec";

/**
 * Mixes caller and agent audio onto one 16 kHz mono timeline, placing each chunk at the
 * wall-clock time it was heard (agent audio at its estimated playback time).
 */
export class CallRecorder {
  private samples = new Int16Array(16000 * 60);
  private length = 0;
  private readonly startedAt: number;
  private readonly maxSamples: number;

  constructor(startedAt = Date.now(), maxSeconds = 1800) {
    this.startedAt = startedAt;
    this.maxSamples = 16000 * maxSeconds;
  }

  add(pcm16k: Buffer, atMs: number) {
    const offset = Math.max(0, Math.round(((atMs - this.startedAt) * 16000) / 1000));
    const src = bufferToSamples(pcm16k);
    const end = Math.min(offset + src.length, this.maxSamples);
    if (end <= offset) return;
    this.ensure(end);
    for (let i = offset; i < end; i++) {
      const mixed = this.samples[i]! + src[i - offset]!;
      this.samples[i] = Math.max(-32768, Math.min(32767, mixed));
    }
    this.length = Math.max(this.length, end);
  }

  private ensure(size: number) {
    if (size <= this.samples.length) return;
    let next = this.samples.length;
    while (next < size) next *= 2;
    const grown = new Int16Array(Math.min(next, this.maxSamples));
    grown.set(this.samples.subarray(0, this.length));
    this.samples = grown;
  }

  toWav(): Buffer {
    const data = Buffer.alloc(this.length * 2);
    for (let i = 0; i < this.length; i++) data.writeInt16LE(this.samples[i]!, i * 2);
    return Buffer.concat([wavHeader(data.length), data]);
  }

  get durationSec() {
    return this.length / 16000;
  }
}
