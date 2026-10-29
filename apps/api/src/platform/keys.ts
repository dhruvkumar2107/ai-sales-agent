import { env, type Env } from "../config";
import { getStore } from "../db/store";
import { decryptString, encryptString, redactSecret } from "../lib/crypto";
import { logger } from "../lib/logger";
import { resetTelephony } from "../providers/telephony";

/**
 * Provider keys the platform owner pastes into the admin panel (Settings) instead of editing env files.
 * A value saved here overrides the env file; clearing it falls back to the env file again. Secrets are stored
 * encrypted and never sent back in plaintext. Every business uses these keys unless it has its own number/token.
 */

export interface KeyField {
  key: keyof Env;
  group: "Server" | "Phone calls" | "WhatsApp" | "AI model" | "Speech";
  label: string;
  hint?: string;
  secret?: boolean;
  options?: string[];
}

export const KEY_FIELDS: KeyField[] = [
  { key: "PUBLIC_BASE_URL", group: "Server", label: "Public server URL", hint: "https address of this API, e.g. https://axo-api.onrender.com. Twilio and Meta send calls and messages here." },

  { key: "TELEPHONY_PROVIDER", group: "Phone calls", label: "Calling provider", options: ["twilio", "exotel", "mock"] },
  { key: "TWILIO_ACCOUNT_SID", group: "Phone calls", label: "Twilio Account SID", hint: "Twilio Console > Account info" },
  { key: "TWILIO_AUTH_TOKEN", group: "Phone calls", label: "Twilio Auth Token", secret: true },
  { key: "TWILIO_PHONE_NUMBER", group: "Phone calls", label: "Default Twilio number", hint: "Used for outbound calls and SMS when a business has no number of its own" },
  { key: "TWILIO_BUNDLE_SID", group: "Phone calls", label: "Twilio regulatory Bundle SID", hint: "Twilio Console > Phone Numbers > Regulatory Compliance > Bundles (BU…). Needed to buy Indian numbers from the admin panel." },
  { key: "TWILIO_ADDRESS_SID", group: "Phone calls", label: "Twilio Address SID", hint: "Twilio Console > Phone Numbers > Regulatory Compliance > Addresses (AD…)" },
  { key: "EXOTEL_SID", group: "Phone calls", label: "Exotel SID" },
  { key: "EXOTEL_API_KEY", group: "Phone calls", label: "Exotel API key", secret: true },
  { key: "EXOTEL_API_TOKEN", group: "Phone calls", label: "Exotel API token", secret: true },
  { key: "EXOTEL_CALLER_ID", group: "Phone calls", label: "Exotel caller ID (ExoPhone)" },
  { key: "EXOTEL_FLOW_URL", group: "Phone calls", label: "Exotel flow URL" },

  { key: "MESSAGING_PROVIDER", group: "WhatsApp", label: "WhatsApp provider", hint: "meta = send for real through the WhatsApp Cloud API; log = demo, messages are only recorded", options: ["meta", "twilio", "exotel", "log"] },
  { key: "META_WA_TOKEN", group: "WhatsApp", label: "Meta permanent access token", hint: "Meta Business Settings > System users > Generate token (whatsapp_business_messaging, whatsapp_business_management)", secret: true },
  { key: "META_WABA_ID", group: "WhatsApp", label: "WhatsApp Business Account ID", hint: "WhatsApp Manager > Account tools. Lets 'Connect numbers' find each business's number automatically." },
  { key: "META_WA_PHONE_NUMBER_ID", group: "WhatsApp", label: "Default phone number ID", hint: "Your own WhatsApp number, used for businesses without one" },
  { key: "META_WA_VERIFY_TOKEN", group: "WhatsApp", label: "Webhook verify token", hint: "Any word; paste the same in Meta > WhatsApp > Configuration" },
  { key: "META_APP_SECRET", group: "WhatsApp", label: "Meta app secret", hint: "Meta app > Settings > Basic. Used to check that webhooks really come from Meta.", secret: true },

  { key: "META_APP_ID", group: "WhatsApp", label: "Meta app ID", hint: "developers.facebook.com > your app > Settings > Basic. With the next field, businesses connect their own WhatsApp from a link." },
  { key: "META_ES_CONFIG_ID", group: "WhatsApp", label: "Embedded Signup configuration ID", hint: "Your app > Facebook Login for Business > Configurations > create one for WhatsApp Embedded Signup" },
  { key: "LLM_PROVIDER", group: "AI model", label: "AI model provider", options: ["gemini", "anthropic", "mock"] },
  { key: "GEMINI_API_KEY", group: "AI model", label: "Gemini API key", hint: "aistudio.google.com > Get API key", secret: true },
  { key: "GEMINI_MODEL", group: "AI model", label: "Gemini model" },
  { key: "ANTHROPIC_API_KEY", group: "AI model", label: "Anthropic API key", hint: "console.anthropic.com > API keys", secret: true },
  { key: "LLM_MODEL", group: "AI model", label: "Claude model" },

  { key: "STT_PROVIDER", group: "Speech", label: "Speech-to-text", options: ["deepgram", "sarvam", "mock"] },
  { key: "TTS_PROVIDER", group: "Speech", label: "Text-to-speech", options: ["elevenlabs", "sarvam", "mock"] },
  { key: "DEEPGRAM_API_KEY", group: "Speech", label: "Deepgram API key", secret: true },
  { key: "SARVAM_API_KEY", group: "Speech", label: "Sarvam API key", hint: "Indian languages, speech-to-text and voices", secret: true },
  { key: "ELEVENLABS_API_KEY", group: "Speech", label: "ElevenLabs API key", secret: true },
  { key: "ELEVENLABS_VOICE_ID", group: "Speech", label: "ElevenLabs voice ID" },
];

const FIELD = new Map(KEY_FIELDS.map((f) => [f.key, f]));

/** Values from the env file at startup, so a cleared panel value falls back to them. */
const fromEnvFile: Partial<Record<keyof Env, unknown>> = Object.fromEntries(KEY_FIELDS.map((f) => [f.key, env[f.key]]));

interface StoredKeys {
  id: string;
  /** Secrets encrypted ("enc:...") */
  values: Record<string, string>;
  updatedAt: string;
}

const doc = () => getStore().collection<StoredKeys>("platformConfig");

async function stored(): Promise<Record<string, string>> {
  return (await doc().get("keys"))?.values ?? {};
}

/** Load saved keys into the running config. Called at startup and after every save. */
export async function applyStoredKeys(): Promise<void> {
  const values = await stored();
  const e = env as unknown as Record<string, unknown>;
  for (const f of KEY_FIELDS) {
    const raw = values[f.key];
    let v: string | undefined;
    try {
      v = raw ? (f.secret ? decryptString(raw) : raw) : undefined;
    } catch {
      logger.warn(`could not decrypt saved ${f.key}; was ENCRYPTION_KEY changed?`);
    }
    e[f.key] = v ?? fromEnvFile[f.key];
  }
  resetTelephony();
}

/** What the Settings page shows: plain values for settings, the last 4 characters for secrets. */
export async function describeKeys() {
  const values = await stored();
  return KEY_FIELDS.map((f) => {
    const savedHere = Boolean(values[f.key]);
    const current = env[f.key];
    const set = current !== undefined && current !== "";
    return {
      ...f,
      value: f.secret ? (savedHere ? redactSecret(values[f.key]) : set ? "****" : "") : String(current ?? ""),
      source: savedHere ? "panel" : set ? "env file" : "not set",
    };
  });
}

/**
 * Save keys: "" clears a value saved here, a masked "****…" value means unchanged.
 * Returns an error message for an invalid value instead of saving anything.
 */
export async function saveKeys(patch: Record<string, string>): Promise<string | null> {
  const values = { ...(await stored()) };
  for (const [k, raw] of Object.entries(patch)) {
    const f = FIELD.get(k as keyof Env);
    if (!f) return `Unknown setting ${k}`;
    const v = String(raw ?? "").trim();
    if (f.secret && v.startsWith("****")) continue;
    if (!v) {
      delete values[k];
      continue;
    }
    if (f.options && !f.options.includes(v)) return `${f.label} must be one of ${f.options.join(", ")}`;
    if (k === "PUBLIC_BASE_URL" && !/^https?:\/\/[^\s/]+/.test(v)) return "Public server URL must start with https://";
    values[k] = f.secret ? encryptString(v) : k === "PUBLIC_BASE_URL" ? v.replace(/\/+$/, "") : v;
  }
  await doc().set({ id: "keys", values, updatedAt: new Date().toISOString() });
  await applyStoredKeys();
  return null;
}

export interface KeyCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/** Try each configured provider with a harmless read-only request, so a wrong key shows up before a customer call. */
export async function checkKeys(): Promise<KeyCheck[]> {
  const out: KeyCheck[] = [];
  const tryFetch = async (name: string, url: string, init: RequestInit, okDetail: (j: Record<string, unknown>) => string) => {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const err = (j.error as { message?: string } | undefined)?.message ?? (j.message as string | undefined);
      out.push(res.ok ? { name, ok: true, detail: okDetail(j) } : { name, ok: false, detail: `Rejected (${res.status})${err ? `: ${err}` : ""}` });
    } catch (e) {
      out.push({ name, ok: false, detail: `Could not reach: ${(e as Error).message}` });
    }
  };

  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN)
    await tryFetch("Twilio", `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}.json`, { headers: { Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}` } }, (j) => `Account "${j.friendly_name ?? env.TWILIO_ACCOUNT_SID}" is ${j.status ?? "active"}`);
  if (env.META_WA_TOKEN && env.META_WABA_ID)
    await tryFetch("WhatsApp (Meta)", `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${env.META_WABA_ID}/phone_numbers?fields=display_phone_number`, { headers: { Authorization: `Bearer ${env.META_WA_TOKEN}` } }, (j) => {
      const nums = ((j.data as { display_phone_number: string }[] | undefined) ?? []).map((d) => d.display_phone_number);
      return nums.length ? `${nums.length} number(s) in the account: ${nums.slice(0, 5).join(", ")}` : "Token works, but no numbers are added to this WhatsApp Business account yet";
    });
  if (env.GEMINI_API_KEY) await tryFetch("Gemini", `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(env.GEMINI_API_KEY)}`, {}, () => "Key works");
  if (env.ANTHROPIC_API_KEY) await tryFetch("Anthropic", "https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" } }, () => "Key works");
  if (env.DEEPGRAM_API_KEY) await tryFetch("Deepgram", "https://api.deepgram.com/v1/projects", { headers: { Authorization: `Token ${env.DEEPGRAM_API_KEY}` } }, () => "Key works");
  if (env.ELEVENLABS_API_KEY) await tryFetch("ElevenLabs", "https://api.elevenlabs.io/v1/user", { headers: { "xi-api-key": env.ELEVENLABS_API_KEY } }, () => "Key works");
  if (/localhost|127\.0\.0\.1/.test(env.PUBLIC_BASE_URL)) out.push({ name: "Public server URL", ok: false, detail: `${env.PUBLIC_BASE_URL} cannot be reached by Twilio or Meta. Set your https server address.` });
  if (!out.length) out.push({ name: "Keys", ok: false, detail: "No provider keys are set yet." });
  return out;
}
