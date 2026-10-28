import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),
  /** Public base URL of the API reachable by telephony providers (ngrok in dev), no trailing slash */
  PUBLIC_BASE_URL: z.string().default("http://localhost:4000"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),

  // Data / infra
  DATA_BACKEND: z.enum(["firestore", "memory"]).default("memory"),
  MEMORY_DB_FILE: z.string().default(".data/db.json"),
  QUEUE_BACKEND: z.enum(["bullmq", "memory"]).default("memory"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  AUTH_MODE: z.enum(["firebase", "dev"]).default("dev"),
  DEV_ORG_ID: z.string().default("demo-org"),
  /** Hosted demos: seed the demo dealership on first start when the database is empty */
  SEED_DEMO_ON_START: bool,
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_STORAGE_BUCKET: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  RECORDINGS_DIR: z.string().default(".data/recordings"),

  /** 32-byte key, base64. Used to encrypt recordings and stored API keys (AES-256-GCM). */
  ENCRYPTION_KEY: z.string().optional(),

  // Providers
  TELEPHONY_PROVIDER: z.enum(["twilio", "exotel", "mock"]).default("twilio"),
  STT_PROVIDER: z.enum(["deepgram", "sarvam", "mock"]).default("deepgram"),
  TTS_PROVIDER: z.enum(["elevenlabs", "sarvam", "mock"]).default("elevenlabs"),
  LLM_PROVIDER: z.enum(["anthropic", "gemini", "mock"]).default("anthropic"),
  MESSAGING_PROVIDER: z.enum(["twilio", "exotel", "log"]).default("log"),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),

  EXOTEL_SID: z.string().optional(),
  EXOTEL_API_KEY: z.string().optional(),
  EXOTEL_API_TOKEN: z.string().optional(),
  EXOTEL_SUBDOMAIN: z.string().default("api.exotel.com"),
  EXOTEL_CALLER_ID: z.string().optional(),
  /** Exotel flow (applet) URL that contains a Voicebot applet pointing at /media/exotel */
  EXOTEL_FLOW_URL: z.string().optional(),
  EXOTEL_WEBHOOK_SECRET: z.string().optional(),

  DEEPGRAM_API_KEY: z.string().optional(),
  DEEPGRAM_MODEL: z.string().default("nova-3"),
  SARVAM_API_KEY: z.string().optional(),
  SARVAM_STT_MODEL: z.string().default("saarika:v2.5"),
  SARVAM_TTS_MODEL: z.string().default("bulbul:v2"),
  SARVAM_TTS_SPEAKER: z.string().default("anushka"),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().default("21m00Tcm4TlvDq8ikWAM"),
  ELEVENLABS_MODEL: z.string().default("eleven_flash_v2_5"),

  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("claude-opus-5-5"),
  LLM_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  LLM_FALLBACKS: bool.default("true"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.6-flash"),
  /** Tried in order when the primary model is overloaded or slow */
  GEMINI_FALLBACK_MODELS: z.string().default("gemini-3.5-flash-lite,gemini-3.8-flash,gemini-flash-latest"),

  GOOGLE_CALENDAR_SA_EMAIL: z.string().optional(),
  GOOGLE_CALENDAR_SA_KEY: z.string().optional(),

  /** Secret for HMAC signature of inbound lead webhooks (fallback when org has none) */
  LEAD_WEBHOOK_SECRET: z.string().default("change-me"),
  /** Skip webhook signature validation (local dev only) */
  SKIP_SIGNATURE_VALIDATION: bool,

  // Voice tuning
  SILENCE_REPROMPT_MS: z.coerce.number().default(6000),
  MAX_REPROMPTS: z.coerce.number().default(2),
  TOOL_TIMEOUT_MS: z.coerce.number().default(4000),
  MAX_CALL_SECONDS: z.coerce.number().default(900),

  // Cost model (INR)
  COST_TELEPHONY_PER_MIN: z.coerce.number().default(0.6),
  COST_STT_PER_MIN: z.coerce.number().default(0.5),
  COST_TTS_PER_1K_CHARS: z.coerce.number().default(2.0),
  COST_LLM_INPUT_PER_MTOK: z.coerce.number().default(336), // $4 * 84
  COST_LLM_OUTPUT_PER_MTOK: z.coerce.number().default(1680), // $20 * 84
  COST_MESSAGE: z.coerce.number().default(0.35),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);

export const isProd = env.NODE_ENV === "production";
