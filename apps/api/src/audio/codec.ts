/**
 * Audio conversion helpers. The internal pipeline format is PCM signed 16-bit little-endian, mono, 16 kHz.
 * Telephony uses G.711 mu-law at 8 kHz (Twilio) or 16-bit linear PCM at 8 kHz (Exotel).
 */

export const PIPELINE_RATE = 16000;
export const BYTES_PER_MS_16K = (PIPELINE_RATE * 2) / 1000; // 32 bytes per ms

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

/** Encode one 16-bit linear sample to 8-bit mu-law (ITU-T G.711). */
export function linearToMulaw(sample: number): number {
  let s = Math.max(-32768, Math.min(32767, Math.round(sample)));
  const sign = s < 0 ? 0x80 : 0;
  if (sign) s = -s;
  if (s > MULAW_CLIP) s = MULAW_CLIP;
  s += MULAW_BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** Decode one 8-bit mu-law byte to a 16-bit linear sample. */
export function mulawToLinear(byte: number): number {
  const u = ~byte & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  const magnitude = (((mantissa << 3) + MULAW_BIAS) << exponent) - MULAW_BIAS;
  return sign ? -magnitude : magnitude;
}

const DECODE_TABLE = Int16Array.from({ length: 256 }, (_, i) => mulawToLinear(i));

export function mulawDecode(buf: Buffer): Int16Array {
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = DECODE_TABLE[buf[i]!]!;
  return out;
}

export function mulawEncode(samples: Int16Array): Buffer {
  const out = Buffer.alloc(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = linearToMulaw(samples[i]!);
  return out;
}

/** View a little-endian PCM16 Buffer as samples (copies to guarantee alignment). */
export function bufferToSamples(buf: Buffer): Int16Array {
  const out = new Int16Array(Math.floor(buf.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2);
  return out;
}

export function samplesToBuffer(samples: Int16Array): Buffer {
  const out = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) out.writeInt16LE(samples[i]!, i * 2);
  return out;
}

/** 8 kHz -> 16 kHz by linear interpolation. */
export function upsample8to16(input: Int16Array): Int16Array {
  const out = new Int16Array(input.length * 2);
  for (let i = 0; i < input.length; i++) {
    const cur = input[i]!;
    const next = i + 1 < input.length ? input[i + 1]! : cur;
    out[i * 2] = cur;
    out[i * 2 + 1] = (cur + next) >> 1;
  }
  return out;
}

/**
 * 16 kHz -> 8 kHz. A 3-tap low-pass (0.25, 0.5, 0.25) before decimation suppresses
 * aliasing of energy above 4 kHz, which otherwise sounds harsh on phone lines.
 */
export function downsample16to8(input: Int16Array): Int16Array {
  const out = new Int16Array(Math.floor(input.length / 2));
  for (let i = 0; i < out.length; i++) {
    const c = i * 2;
    const prev = c > 0 ? input[c - 1]! : input[c]!;
    const next = c + 1 < input.length ? input[c + 1]! : input[c]!;
    out[i] = Math.round(prev * 0.25 + input[c]! * 0.5 + next * 0.25);
  }
  return out;
}

/** Generic linear resampler for TTS outputs at other rates (e.g. 22.05k, 24k). */
export function resample(input: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] ?? 0;
    const b = input[idx + 1] ?? a;
    out[i] = Math.round(a + (b - a) * frac);
  }
  return out;
}

// ---- Telephony convenience wrappers ----

/** Twilio inbound: base64 mu-law 8k -> PCM16 16k Buffer */
export function mulaw8kToPcm16k(mulaw: Buffer): Buffer {
  return samplesToBuffer(upsample8to16(mulawDecode(mulaw)));
}

/** Twilio outbound: PCM16 16k Buffer -> mu-law 8k */
export function pcm16kToMulaw8k(pcm: Buffer): Buffer {
  return mulawEncode(downsample16to8(bufferToSamples(pcm)));
}

/** Exotel inbound: PCM16 8k -> PCM16 16k */
export function pcm8kToPcm16k(pcm8: Buffer): Buffer {
  return samplesToBuffer(upsample8to16(bufferToSamples(pcm8)));
}

/** Exotel outbound: PCM16 16k -> PCM16 8k */
export function pcm16kToPcm8k(pcm16: Buffer): Buffer {
  return samplesToBuffer(downsample16to8(bufferToSamples(pcm16)));
}

// ---- WAV helpers ----

export function wavHeader(dataBytes: number, sampleRate = PIPELINE_RATE, channels = 1): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

/** Parse a WAV file and return PCM16 data plus its sample rate. Walks chunks, so extra chunks (LIST) are fine. */
export function parseWav(buf: Buffer): { pcm: Buffer; sampleRate: number; channels: number } {
  if (buf.toString("ascii", 0, 4) !== "RIFF") return { pcm: buf, sampleRate: PIPELINE_RATE, channels: 1 };
  let offset = 12;
  let sampleRate = PIPELINE_RATE;
  let channels = 1;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      channels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
    } else if (id === "data") {
      return { pcm: buf.subarray(offset + 8, Math.min(buf.length, offset + 8 + size)), sampleRate, channels };
    }
    offset += 8 + size + (size % 2);
  }
  return { pcm: Buffer.alloc(0), sampleRate, channels };
}

/** Convert any mono WAV/PCM to pipeline PCM16 16k. */
export function toPipelinePcm(buf: Buffer, sampleRate?: number): Buffer {
  const parsed = sampleRate ? { pcm: buf, sampleRate, channels: 1 } : parseWav(buf);
  let samples = bufferToSamples(parsed.pcm);
  if (parsed.channels === 2) samples = samples.filter((_, i) => i % 2 === 0);
  return samplesToBuffer(resample(samples, parsed.sampleRate, PIPELINE_RATE));
}

export function pcmDurationMs(pcm16k: Buffer): number {
  return pcm16k.length / BYTES_PER_MS_16K;
}

/** Root-mean-square energy of a PCM16 frame (0..32767). */
export function rms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / samples.length);
}
