# AXO Voice Auto

Multilingual AI voice agent platform for bike and car showrooms in India.

## Quickstart (10 minutes)

### 1. Prerequisites

- Node.js >= 20
- pnpm >= 9.15.4
- ngrok (for webhook testing)
- API keys for telephony/STT/LLM/TTS providers

### 2. Environment Setup

Copy the example environment file:

```bash
cp .env.example .env
```

Fill in your provider credentials. Example `.env.example`:

```
# Server
PORT=4000
HOST=0.0.0.0
NODE_ENV=development

# Firebase (for auth + Firestore)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nyour-private-key\n-----END PRIVATE KEY-----
FIREBASE_STORAGE_BUCKET=your-storage-bucket

# Provider selections (env-based abstraction)
TELEPHONY_PROVIDER=mock
STT_PROVIDER=mock
TTS_PROVIDER=mock
LLM_PROVIDER=mock

# Voice tuning
SILENCE_REPROMPT_MS=6000
MAX_REPROMPTS=2
TOOL_TIMEOUT_MS=4000
MAX_CALL_SECONDS=900

# Cost model (INR)
COST_TELEPHONY_PER_MIN=0.6
COST_STT_PER_MIN=0.5
COST_TTS_PER_1K_CHARS=2.0
COST_LLM_INPUT_PER_MTOK=336
COST_LLM_OUTPUT_PER_MTOK=1680
COST_MESSAGE=0.35
```

### 3. Install Dependencies

```bash
pnpm install
```

### 4. Seed Demo Data

```bash
pnpm --filter @axo/api run seed
```

This creates:
- 20 catalog models (Honda bikes + Hyundai cars)
- 40 leads with various stages/sources
- 30 service bookings
- 10 callback tickets

### 5. Start the API Server

```bash
pnpm --filter @axo/api run dev
```

The server will start on `http://localhost:4000` and display:
```
AXO Voice Auto API on :4000 (data=firebase, queue=memory, telephony=mock, stt=mock, tts=mock, llm=mock)
```

### 6. Test the Agent

Start the text simulator:

```bash
pnpm --filter @axo/api run scripts/simulator.ts
```

Or import and run scenarios from the TypeScript REPL.

### 7. Ngrok for Webhooks

```bash
ngrok http 4000
```

Use the ngrok URL to configure webhooks in the dashboard. The API exposes these endpoints:

- `GET /api/me` - Get current user/organization
- `POST /api/auth/bootstrap` - Onboarding flow
- `GET /api/branches` - List showroom branches
- `GET /api/catalog` - List vehicle catalog
- `GET /api/agents` - List agents/configs
- `GET /api/settings` - Dealership settings
- `GET /api/team` - List team members
- `GET /api/calls` - Call log history

## Product Overview

AXO Voice Auto is a multilingual AI voice agent platform for Indian bike and car showrooms. Key capabilities:

### Sales Flow

1. **Inbound enquiry**: Greet, qualify buyer (bike/car, model, budget, fuel type: petrol/diesel/CNG/EV, new/used), answer from catalog, offer test drive
2. **Lead qualification**: Capture name, phone, interested model/variant, budget, timeline (this week/this month/3 months+), payment mode (cash/loan/exchange), exchange vehicle details. Score lead hot/warm/cold
3. **Test drive booking**: Check slot availability, confirm, send WhatsApp/SMS confirmation with address/map, reminder 2 hours before
4. **Price/EMI/offers**: Quote only configured ex-showroom and on-road price ranges, current offers, EMI estimate from config. Always state final price depends on showroom confirmation
5. **Exchange enquiry**: Collect old vehicle make/model/year/km/condition, promise callback with evaluation (never quote exchange value)
6. **Hot-lead transfer**: When lead is hot or says "I want to buy today"/"I'm visiting today", transfer live to available sales executive or schedule instant callback
7. **Outbound follow-up**: Call new leads within 2 minutes; re-engage cold leads at day 2, day 7, day 21
8. **Booking-to-delivery updates**: Booking confirmed → vehicle allotted → documents pending → delivery date → post-delivery thank-you + review request

### Service Flow

9. **Service booking**: Collect vehicle number, model, kilometres, service type (free/paid/service/repair/accident/warranty), pickup/drop need; book slot; send confirmation
10. **Service reminders**: Due-date and kilometre-based reminders, with booking by voice
11. **Insurance/PUC reminders**: Expiry reminders with human callback offer
12. **Service status inquiry**: "Is my vehicle ready?" Look up job card via webhook adapter
13. **Complaint handling**: Record complaint, apologise once, create ticket, transfer to service manager if angry or safety-related
14. **Feedback calls**: Post-service rating out of 5; route under 3 stars to manager

### Multilingual Support

- Languages: English (en), Hindi (hi), Kannada (kn), Hinglish
- Auto-detect language on first utterance
- Reply in the same language
- Pronounce prices in lakhs, EMI amounts, registration numbers, phone digits and dates naturally

## Voice Pipeline

The core voice pipeline processes calls through these stages:

1. **Telephony webhook** opens bidirectional media stream WebSocket
2. **Audio → VAD → streaming STT → LLM (streaming, tool calls) → sentence-chunked streaming TTS**
3. **Barge-in**: Stop TTS and flush audio instantly when caller speaks
4. **Target**: Under 1.2s from end of caller speech to first agent audio; log per-turn latency
5. **Silence handling**: Re-prompt at 6s, end after 2 re-prompts
6. **Noise/dropped call handling**: Correct mulaw 8kHz ⇄ PCM 16kHz conversion
7. **Auto-language detection** and same-language response

## Provider Abstraction Layers

Telephony providers (select by `TELEPHONY_PROVIDER` env var):
- `twilio` - Full Twilio Voice + Messaging
- `exotel` - Exotel Voice integration
- `mock` - Mock provider for development

STT providers (select by `STT_PROVIDER`):
- `deepgram` - Deepgram streaming STT
- `sarvam` - Sarvam AI STT (Indian languages)
- `mock` - Mock STT for development

TTS providers (select by `TTS_PROVIDER`):
- `elevenlabs` - ElevenLabs streaming TTS
- `sarvam` - Sarvam AI TTS
- `mock` - Mock TTS for development

LLM providers (select by `LLM_PROVIDER`):
- `anthropic` - Anthropic Claude streaming + tool calling
- `mock` - Mock LLM for development

## Dashboard

The Next.js 14 web dashboard (Phase 5-7) includes:

1. **Auth**: Firebase, multi-tenant per dealership
2. **Setup wizard**: Branches, brands, catalog, test drive vehicles, service types/slots, EMI defaults, working hours, transfer numbers, greeting
3. **Leads board**: Kanban (new/contacted/test drive booked/negotiation/won/lost) with score, source, assigned executive
4. **Test drives/service calendar**: By branch
5. **Call logs**: Filters, audio player, transcript, summary, sentiment, latency, cost
6. **Campaigns**: New-lead follow-up, cold re-engagement, service due, insurance expiry, festive offers; CSV upload; DND/opt-out; live progress
7. **Analytics**: Conversion rates, cost per call, per-executive performance
8. **Test console**: Talk to agent via browser mic or call phone
9. **Settings**: API keys, numbers, webhooks, team, billing placeholder

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start all apps in parallel |
| `pnpm build` | Build all packages |
| `pnpm test` | Run API unit tests |
| `pnpm typecheck` | Run TypeScript type check |
| `pnpm seed` | Seed demo dealership data |
| `pnpm simulate` | Run text-based call simulator |
| `pnpm worker` | Start BullMQ worker (Docker) |
| `pnpm simulate` | Scripted call scenarios |

## Development Phases

| Phase | Description |
|-------|-------------|
| 1 | Monorepo, Firebase, auth, data models, catalog import ✅ |
| 2 | Voice pipeline + text simulator ✅ |
| 3 | Telephony, inbound/outbound, barge-in |
| 4 | Tools (catalog, EMI, test drive, service, lead scoring, transfer, WhatsApp/SMS) |
| 5 | Dashboard (setup wizard, leads board, calendars, call logs, test console) |
| 6 | Campaigns, reminders, analytics, cost tracking |
| 7 | Compliance, tests, docs, Docker |

## Docker

```bash
docker-compose up --build
```

This starts the API, web dashboard, Redis, and BullMQ worker. Fill `.env` first.

## Compliance (India)

- Recording consent flag per call; DPDP Act-aware retention settings
- Respect DND/NDNC and calling hours (9am-8pm IST); instant opt-out
- Validate webhook signatures, rate-limit endpoints, encrypt secrets
- Encryption: AES-256-GCM for recordings and API keys