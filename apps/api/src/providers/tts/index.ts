import { env } from "../../config";
import { toPipelinePcm } from "../../audio/codec";
import { LOCALE } from "../../voice/language";
import type { Language } from "@axo/shared";

export interface TtsRequest {
  text: string;
  language: Language;
  voice?: string;
  signal?: AbortSignal;
}

/** Streams PCM16 16 kHz mono chunks. */
export interface TtsProvider {
  readonly name: string;
  synthesize(req: TtsRequest): AsyncIterable<Buffer>;
}

/** Ensure chunks contain whole 16-bit samples when a network chunk splits one. */
async function* alignSamples(source: AsyncIterable<Uint8Array>): AsyncIterable<Buffer> {
  let carry: Buffer | null = null;
  for await (const part of source) {
    let buf = Buffer.from(part);
    if (carry) {
      buf = Buffer.concat([carry, buf]);
      carry = null;
    }
    if (buf.length % 2) {
      carry = buf.subarray(buf.length - 1);
      buf = buf.subarray(0, buf.length - 1);
    }
    if (buf.length) yield buf;
  }
}

/** ElevenLabs HTTP streaming with raw PCM 16 kHz output (no decode step, lowest latency). */
export class ElevenLabsTts implements TtsProvider {
  readonly name = "elevenlabs";
  async *synthesize(req: TtsRequest): AsyncIterable<Buffer> {
    // Agent voices are Sarvam speaker names by default; only a real ElevenLabs voice id (20 characters) is used here.
    const voice = req.voice && /^[A-Za-z0-9]{20}$/.test(req.voice) ? req.voice : env.ELEVENLABS_VOICE_ID;
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=pcm_16000&optimize_streaming_latency=3`, {
      method: "POST",
      signal: req.signal,
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY ?? "", "content-type": "application/json" },
      body: JSON.stringify({
        text: req.text,
        model_id: env.ELEVENLABS_MODEL,
        // Flash v2.5 supports language enforcement; Hinglish is spoken best with Hindi.
        language_code: req.language === "en" ? "en" : req.language === "kn" ? undefined : "hi",
        voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1.0 },
      }),
    });
    if (!res.ok || !res.body) throw new Error(`ElevenLabs TTS ${res.status}: ${await res.text().catch(() => "")}`);
    yield* alignSamples(res.body as unknown as AsyncIterable<Uint8Array>);
  }
}

/** Sarvam bulbul speakers: all native Indian voices (Indian English, Hindi, Kannada and more). */
export const SARVAM_SPEAKERS = { female: ["anushka", "manisha", "vidya", "arya"], male: ["abhilash", "karun", "hitesh"] } as const;
const SARVAM_ALL: readonly string[] = [...SARVAM_SPEAKERS.female, ...SARVAM_SPEAKERS.male];

/** Sarvam bulbul: natural Indian voices for Hindi, Kannada and Indian English. Returns WAV per request. */
export class SarvamTts implements TtsProvider {
  readonly name = "sarvam";
  async *synthesize(req: TtsRequest): AsyncIterable<Buffer> {
    const res = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      signal: req.signal,
      headers: { "api-subscription-key": env.SARVAM_API_KEY ?? "", "content-type": "application/json" },
      body: JSON.stringify({
        text: req.text,
        target_language_code: LOCALE[req.language],
        // An ElevenLabs id saved on an agent would be rejected by Sarvam; fall back to the default Indian speaker.
        speaker: req.voice && SARVAM_ALL.includes(req.voice) ? req.voice : env.SARVAM_TTS_SPEAKER,
        model: env.SARVAM_TTS_MODEL,
        speech_sample_rate: 16000,
        enable_preprocessing: true,
      }),
    });
    if (!res.ok) throw new Error(`Sarvam TTS ${res.status}: ${await res.text().catch(() => "")}`);
    const json = (await res.json()) as { audios?: string[] };
    for (const b64 of json.audios ?? []) {
      const pcm = toPipelinePcm(Buffer.from(b64, "base64"));
      for (let i = 0; i < pcm.length; i += 6400) yield pcm.subarray(i, i + 6400);
    }
  }
}

/** Offline TTS: a quiet 220 Hz tone, 5 ms per character, so audio paths and latency logging still run. */
export class MockTts implements TtsProvider {
  readonly name = "mock";
  constructor(private msPerChar = 5) {}
  async *synthesize(req: TtsRequest): AsyncIterable<Buffer> {
    await new Promise((r) => setTimeout(r, 5));
    const samples = Math.min(16000 * 4, Math.max(1600, req.text.length * this.msPerChar * 16));
    const buf = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / 16000) * 1500), i * 2);
    for (let i = 0; i < buf.length; i += 6400) {
      if (req.signal?.aborted) return;
      yield buf.subarray(i, i + 6400);
    }
  }
}

/**
 * The chosen provider when its key is set, otherwise whichever key is present (Sarvam first: Indian accent),
 * so pasting one speech key in Settings is enough. "mock" stays silent on purpose.
 */
export function createTts(kind = env.TTS_PROVIDER): TtsProvider {
  if (kind === "mock") return new MockTts();
  if (kind === "elevenlabs" && env.ELEVENLABS_API_KEY) return new ElevenLabsTts();
  if (env.SARVAM_API_KEY) return new SarvamTts();
  if (env.ELEVENLABS_API_KEY) return new ElevenLabsTts();
  return new MockTts();
}
