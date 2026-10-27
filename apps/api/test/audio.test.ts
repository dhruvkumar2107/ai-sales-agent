import { describe, expect, it } from "vitest";
import {
  bufferToSamples,
  downsample16to8,
  linearToMulaw,
  mulaw8kToPcm16k,
  mulawToLinear,
  parseWav,
  pcm16kToMulaw8k,
  pcm16kToPcm8k,
  pcm8kToPcm16k,
  resample,
  samplesToBuffer,
  upsample8to16,
  wavHeader,
} from "../src/audio/codec";
import { Vad } from "../src/audio/vad";

const sine = (n: number, rate: number, freq = 440, amp = 8000) => Int16Array.from({ length: n }, (_, i) => Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * amp));

describe("G.711 mu-law", () => {
  it("encodes silence as 0xFF and round-trips within quantisation error", () => {
    expect(linearToMulaw(0)).toBe(0xff);
    for (const s of [0, 100, -100, 1000, -1000, 8000, -8000, 32000, -32000]) {
      const back = mulawToLinear(linearToMulaw(s));
      // mu-law has ~2-3% relative error at large amplitudes, absolute error small near zero
      expect(Math.abs(back - s)).toBeLessThanOrEqual(Math.max(16, Math.abs(s) * 0.04));
    }
  });

  it("clips out-of-range input instead of wrapping", () => {
    expect(mulawToLinear(linearToMulaw(40000))).toBeGreaterThan(30000);
    expect(mulawToLinear(linearToMulaw(-40000))).toBeLessThan(-30000);
  });

  it("is monotonic", () => {
    let prev = -Infinity;
    for (let s = -32000; s <= 32000; s += 500) {
      const v = mulawToLinear(linearToMulaw(s));
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("resampling", () => {
  it("8k -> 16k doubles the sample count and preserves samples", () => {
    const input = Int16Array.from([0, 100, 200, 300]);
    const out = upsample8to16(input);
    expect(out.length).toBe(8);
    expect(Array.from(out.filter((_, i) => i % 2 === 0))).toEqual([0, 100, 200, 300]);
    expect(out[1]).toBe(50);
  });

  it("16k -> 8k halves the sample count and keeps a low tone's energy", () => {
    const tone = sine(1600, 16000, 300);
    const out = downsample16to8(tone);
    expect(out.length).toBe(800);
    const peak = Math.max(...Array.from(out).map(Math.abs));
    expect(peak).toBeGreaterThan(7000);
  });

  it("generic resample handles 24k TTS output", () => {
    expect(resample(sine(2400, 24000), 24000, 16000).length).toBe(1600);
  });
});

describe("telephony wrappers", () => {
  it("Twilio mu-law 8k <-> PCM16 16k round trip preserves length and shape", () => {
    const pcm16k = samplesToBuffer(sine(320, 16000, 400)); // 20 ms
    const mulaw = pcm16kToMulaw8k(pcm16k);
    expect(mulaw.length).toBe(160); // 20 ms of 8 kHz mu-law
    const back = mulaw8kToPcm16k(mulaw);
    expect(back.length).toBe(640);
    const a = bufferToSamples(pcm16k);
    const b = bufferToSamples(back);
    let err = 0;
    for (let i = 4; i < a.length - 4; i++) err += Math.abs(a[i]! - b[i]!);
    expect(err / a.length).toBeLessThan(800);
  });

  it("Exotel PCM 8k <-> 16k conversion sizes", () => {
    const pcm16k = samplesToBuffer(sine(320, 16000));
    expect(pcm16kToPcm8k(pcm16k).length).toBe(320);
    expect(pcm8kToPcm16k(pcm16kToPcm8k(pcm16k)).length).toBe(640);
  });
});

describe("WAV", () => {
  it("writes a header that parseWav reads back", () => {
    const data = samplesToBuffer(sine(1600, 16000));
    const wav = Buffer.concat([wavHeader(data.length, 22050), data]);
    const parsed = parseWav(wav);
    expect(parsed.sampleRate).toBe(22050);
    expect(parsed.pcm.equals(data)).toBe(true);
  });
});

describe("VAD", () => {
  it("fires speechStart on a tone after silence and speechEnd after silence", () => {
    const vad = new Vad({ startMs: 100, endMs: 200 });
    const events: string[] = [];
    vad.on("speechStart", () => events.push("start"));
    vad.on("speechEnd", () => events.push("end"));
    vad.push(Buffer.alloc(16000)); // 500 ms silence
    vad.push(samplesToBuffer(sine(8000, 16000, 300, 6000))); // 500 ms tone
    vad.push(Buffer.alloc(16000));
    expect(events).toEqual(["start", "end"]);
  });

  it("ignores short clicks", () => {
    const vad = new Vad({ startMs: 200 });
    let started = false;
    vad.on("speechStart", () => (started = true));
    vad.push(Buffer.alloc(16000));
    vad.push(samplesToBuffer(sine(1600, 16000, 300, 9000))); // 100 ms
    vad.push(Buffer.alloc(16000));
    expect(started).toBe(false);
  });
});
