# AXO Voice Auto

A multilingual AI sales and service desk for bike and car showrooms in India. It answers and places phone calls in **English, Hindi, Kannada and Hinglish** (auto-detected): it qualifies buyers, answers model and price questions from your catalog, books test drives and service slots, follows up every enquiry within 2 minutes, runs service, insurance and PUC reminder campaigns, and hands hot leads to a sales executive live. Dealers manage everything from a web dashboard.

```
apps/api        Node 20 + TypeScript + Fastify + ws   voice pipeline, tools, REST, webhooks, jobs
apps/web        Next.js 14 + Tailwind + shadcn/ui     dashboard
packages/shared zod schemas + types shared by both
apps/api/prompts/auto.ts     the default system prompt (variables: {showroom_name} {agent_name} {brands} {catalog} {offers} {timings} {language})
apps/api/prompts/agents.ts   3 example agents: two-wheeler (hi/en), car showroom (en/kn), service center (Hinglish)
samples/                     catalog CSVs (cars, bikes)
```

---

## 10-minute quickstart

You need Node 20+ and pnpm 9 (`corepack enable`). No API keys are required to start: every provider falls back to an offline mock.

```bash
pnpm install
cp .env.example .env        # defaults: memory database, in-process jobs, dev login, mock providers when keys are blank
pnpm seed                   # demo dealership: 20 models, 3 branches, team, 3 agents, 40 leads, 30 service bookings, 50 call logs
pnpm dev                    # API on :4000, dashboard on :3000
```

Open http://localhost:3000. Dev mode signs you in as the demo dealership's owner.

**1. Try it in text, without any keys (about 1 minute).** Go to **Test console**, pick *Ananya (car showroom)*, choose **Text**, click **Start test call** and type:

> I want to book a test drive of the Creta tomorrow → My name is Rahul → 11 am please → Yes, please confirm → That's all, thank you

Then open **Call logs** to see the transcript, summary, lead score, extracted fields, per-turn latency and cost. The booking appears in **Calendar** and the lead in **Leads**.

**2. Real voice in the browser (about 3 minutes).** Add `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY` (or `SARVAM_API_KEY` with `STT_PROVIDER=sarvam`) and `ELEVENLABS_API_KEY` (or Sarvam TTS) to `.env`, restart `pnpm dev`, then use **Voice** mode in the test console. Interrupt the agent mid-sentence to see barge-in.

**3. Real phone calls with ngrok (about 5 minutes).**

```bash
ngrok http 4000                               # copy the https URL
# .env:  PUBLIC_BASE_URL=https://<id>.ngrok-free.app
#        TWILIO_ACCOUNT_SID=…  TWILIO_AUTH_TOKEN=…  TWILIO_PHONE_NUMBER=+1…
```

In the Twilio console, under your number's *Voice → A call comes in*, set Webhook `POST https://<id>.ngrok-free.app/telephony/twilio/voice`. In **Setup wizard → Agents & greeting**, add that number to an agent so inbound calls route to it. Call the number. To have the agent call you, use **Test console → Call my phone**.

Run the checks:

```bash
pnpm test                 # 59 unit + integration tests (audio, chunker, EMI, scoring, slots, retries, webhook, all simulator scenarios)
pnpm simulate             # scripted calls against the offline mock LLM
pnpm simulate --llm anthropic                 # the same scenarios against real Claude
pnpm simulate --interactive --agent agent-two-wheeler   # chat with an agent in your terminal
```

---

## Demo script (for showing a dealer)

1. **Setup wizard → Catalog**: upload `samples/catalog-cars.csv`, then show the parsed models, variants and on-road ranges.
2. **Test console (Voice, Ananya)**: "What's the on-road price of the Creta?" The agent answers in lakhs, adds that the final price depends on showroom confirmation, and offers a test drive.
3. "What would the EMI be?" The agent calls `calculate_emi` with the dealership's rate, tenure and down payment, then says the figure is an estimate.
4. Switch to Hindi: "मुझे कल टेस्ट ड्राइव चाहिए". The agent replies in Hindi and completes the booking. Show the WhatsApp confirmation in the API log and the calendar entry.
5. "I want to buy it today, I'm coming to the showroom." The lead is saved as **hot** and handed off (on a phone call, a live transfer to the assigned executive with an SMS heads-up; in the browser, an instant callback task).
6. **Call logs**: open the call to show the recording (on phone calls), transcript, summary, sentiment, extracted fields, latency per turn and cost.
7. **Campaigns**: create a *Festive offer* campaign, upload a CSV, start it. Show calling-hours enforcement, retries and DND skips. Click **Run reminder scan** to generate service, insurance and PUC campaigns from the seeded customer vehicles.
8. **Analytics**: enquiries handled, lead response time, enquiry→test drive and test drive→sale conversion, missed calls recovered, cost per call, executive leaderboard.
9. **New-lead webhook** (shows the 2-minute follow-up):

```bash
BODY='{"name":"Asha","phone":"9845012345","source":"facebook","interestedModel":"Venue"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac change-me | sed 's/.* //')
curl -X POST localhost:4000/webhooks/leads/demo-org -H "content-type: application/json" -H "x-axo-signature: $SIG" -d "$BODY"
```

---

## Voice pipeline

```
Twilio / Exotel ──media WS──► transport (mu-law 8k / PCM 8k  ⇄  PCM16 16k)
                               │
                               ├─► VAD (local, 20 ms frames, adaptive noise floor) ──► barge-in, silence timer
                               └─► streaming STT (Deepgram nova-3 multi / Sarvam saarika)
                                        │ final transcript + endpoint
                                        ▼
                               language detection (script + Hinglish lexicon + STT hint)
                                        ▼
                               Claude (streaming, tool calls) ──► tools (zod-validated, timeouts, spoken fallbacks)
                                        │ text deltas
                                        ▼
                               sentence chunker ──► price guard ──► speech formatter (lakhs, digits, reg. nos, dates)
                                        ▼
                               streaming TTS (ElevenLabs Flash PCM 16k / Sarvam bulbul), next sentence prefetched
                                        ▼
                               transport ──► caller          (+ recorder, latency log, cost meter)
```

- **Latency.** Every turn logs STT, LLM-first-token, TTS-first-byte and **end-of-speech → first agent audio**, which is stored per call and shown in the dashboard; turns over 1200 ms are logged as warnings. Latency savers: a local VAD, short STT endpointing (300 ms), a cached system prompt, low reasoning effort, the first audio chunk cut at a comma, raw PCM TTS output (no decode step), and the next sentence synthesised while the current one plays. The greeting and re-prompts are fixed lines, so they need no LLM round-trip.
- **Barge-in.** When the caller speaks over the agent (local VAD for 300 ms or more, or an interim STT word), the session aborts the LLM stream and TTS, sends Twilio `clear` (or the Exotel/browser equivalent), records what the caller actually heard, and tells the model it was interrupted. Backchannels ("haan", "hmm") are ignored.
- **Silence.** After 6 s of silence the agent re-prompts; after 2 re-prompts it says goodbye and ends the call with outcome `silence`. Dropped calls are finalised as `dropped`. Inbound calls that drop before the caller speaks are called back after 2 minutes (counted as *missed calls recovered*).
- **Audio.** G.711 mu-law encode/decode, 8k→16k linear interpolation, 16k→8k with a low-pass before decimation, WAV parsing and resampling for 22.05k/24k TTS output. Unit-tested.
- **Language.** Detected on the first utterance (Devanagari → Hindi, Kannada script → Kannada, romanised Hindi vocabulary → Hinglish). The agent switches if the caller clearly switches. The TTS voice follows the language.
- **Pronunciation.** The prompt asks for spoken forms, and `speech-format.ts` is a safety net: ₹12,90,000 → "12 lakh 90 thousand rupees" (or "12 लाख 90 हज़ार रुपये"), phone numbers as two groups of five digits, KA01AB1234 → "K A, zero one, A B, one two three four", ISO dates and times → "28 October, 2:30 PM" or "सुबह 11 बजे".
- **No invented prices.** On top of the prompt rules, a **price guard** checks every sentence before it is spoken. Any rupee amount not within 2% of the catalog, an offer, a tool result or something the caller said is replaced with "Let me have our sales team confirm the exact figure for you."

## Tools

`search_catalog`, `get_model_details`, `calculate_emi`, `check_testdrive_slots`, `book_testdrive`, `check_service_slots`, `book_service`, `save_lead`, `lookup_booking`, `lookup_job_card`, `send_whatsapp_or_sms`, `transfer_to_human`, `create_ticket`, `end_call`, plus `record_opt_out` (instant DND compliance) and `record_feedback` (post-service rating; anything under 3 stars goes to a manager). Each tool has a zod schema (converted to JSON Schema for Claude), a timeout (4 s by default, 6 s for bookings) and a spoken fallback on failure.

**Integrations.** Google Calendar (service-account JWT; booking events), a generic REST **DMS/CRM adapter** (`GET /job-cards`, `GET /bookings`, `POST /events` signed with HMAC; falls back to AXO's own records), CSV catalog import, and WhatsApp/SMS via Twilio or Exotel (`MESSAGING_PROVIDER=log` prints messages instead).

## Call flows → where they live

| Flow | Implementation |
|---|---|
| Inbound enquiry, qualification, scoring | prompt + `save_lead` + `leads/scoring.ts` (points model, buy-now intent is always hot) |
| Test drive booking + confirmation + 2 h reminder | `book_testdrive` → WhatsApp/SMS + delayed `send-message` job + Google Calendar |
| Price, EMI, offers | `get_model_details`, `calculate_emi`, price guard |
| Exchange enquiry | `save_lead` with `exchangeVehicle` → evaluation callback task (no valuation ever quoted) |
| Hot-lead transfer | `transfer_to_human`: assigned executive → round robin → branch desk; callback task + SMS if nobody is free |
| New-lead follow-up within 2 min; re-engagement on day 2/7/21 | `POST /webhooks/leads/:orgId` → `lead-followup` jobs |
| Booking-to-delivery updates, thank-you + review | `POST /api/vehicle-bookings/:id/status` or `/webhooks/booking-status/:orgId` |
| Service booking, status, complaints, feedback | `book_service`, `lookup_job_card` (verified), `create_ticket` + escalation, `record_feedback` |
| Service / insurance / PUC reminders | daily `reminder-scan` (10:00 IST): due date, km estimate, expiry windows |

## Compliance (India)

- Every call opens with the AI disclosure and a configurable recording notice. A recording consent flag is stored per call.
- **DPDP Act**: per-dealership retention for recordings and transcripts, enforced by a nightly purge that keeps call metadata for analytics. Recordings and stored API keys are encrypted with AES-256-GCM (`ENCRYPTION_KEY`). Phone numbers are masked in all logs.
- **DND/NDNC**: outbound calls only inside the calling window (default 09:00–20:00 IST). An opt-out request on a call applies instantly (opt-out list, leads, pending campaign contacts), and you can import an operator DND scrub list. Promotional campaigns skip DND numbers; service and transactional campaigns honour explicit opt-outs.
- Twilio webhooks are validated with `X-Twilio-Signature`, Exotel with a shared secret, and lead/booking webhooks with HMAC-SHA256 (`X-AXO-Signature`). Endpoints are rate-limited. Roles are enforced server-side, and sales executives see only their own leads.

## Providers

Pick providers with env vars. A provider that has no credentials falls back to its mock.

| Layer | Options | Notes |
|---|---|---|
| Telephony | `twilio`, `exotel` | Twilio: `<Connect><Stream>` bidirectional mu-law. Exotel: Voicebot applet (PCM 8k). Flow: Voicebot (dynamic URL `GET /telephony/exotel/voicebot-url`) → Connect (dynamic URL `GET /telephony/exotel/transfer-number`) → Hangup |
| STT | `deepgram`, `sarvam` | Deepgram nova-3 `multi` covers English, Hindi and Hinglish. **Use Sarvam for Kannada.** |
| TTS | `elevenlabs`, `sarvam` | ElevenLabs Flash v2.5 (lowest latency). Sarvam bulbul has natural hi/kn voices. Per-language voice IDs are set per agent. |
| LLM | `anthropic` | Claude with streaming and tool calling. Default `claude-opus-5-5` at `LLM_EFFORT=low`, with server-side refusal fallback. For the lowest latency and cost, set `LLM_MODEL=claude-haiku-5-5`. |

## Deployment

- **Docker:** `docker compose up --build` runs the API, worker, dashboard and Redis. The default `.env` runs the demo stack (in-memory data, jobs inside the API). For production, set `DATA_BACKEND=firestore`, `QUEUE_BACKEND=bullmq`, `AUTH_MODE=firebase`, `NEXT_PUBLIC_AUTH_MODE=firebase`, Firebase credentials and `ENCRYPTION_KEY`. Seed the demo inside Docker with `docker compose run --rm seed`.
- **Vercel (dashboard only):** import the repo, set **Root Directory = `apps/web`** (`apps/web/vercel.json` holds the build settings), and set `NEXT_PUBLIC_API_URL` to your API's public URL plus the `NEXT_PUBLIC_FIREBASE_*` variables. The **API must run on a long-lived host** (Docker on Railway, Render, Fly.io, Cloud Run with session affinity, or a VM): it holds live call sessions, telephony media WebSockets and in-memory call state for the length of each call. Add the dashboard's URL to the API's `WEB_ORIGIN`.
- **Firebase:** enable Auth (email/password + Google), Firestore and Storage, and deploy `firestore.rules` / `storage.rules`. Both deny all client access, because every read and write goes through the API.

## Decisions I made (and why)

- **Repository layer with Firestore and in-memory backends.** You can demo, test and use the simulator without a cloud project; production uses Firestore with tenant-scoped paths (`orgs/{orgId}/…`).
- **Queue abstraction: BullMQ in production, in-process timers in dev.** Same job code either way. Live calls always run in the API process; the worker handles dialling, follow-ups, reminders, scheduled messages and retention.
- **Raw `ws` on Fastify's HTTP server** (as specified) for `/media/twilio`, `/media/exotel` and `/ws/console`. Each provider has its own small adapter around one shared `CallSession`.
- **The greeting and re-prompts are fixed lines** rather than LLM output. This guarantees the disclosure wording and removes a round-trip from the first second of the call.
- **Offline mock LLM.** A deterministic rule-based stand-in drives every tool, so CI, the simulator and the dashboard work with no keys. It is not a conversation model; real calls use Claude.
- **Conversation history is append-only.** Interruptions are added as notes rather than by editing earlier turns, which keeps prompt caching and Claude's thinking blocks valid.
- **Indian phone handling**: numbers are normalised to E.164 (+91) everywhere; slots and calling hours use fixed IST (no DST).
- **Prices are stored in rupees as integers** and rendered as lakhs only at the edges (prompt, speech, UI).
- **Lead score**: transparent points (timeline, test drive, model, budget, payment, exchange, contact) with an override to hot for explicit buy-now or visiting-today intent; it never downgrades an existing score automatically.
- **Exotel transfer** uses the flow's Connect applet with a dynamic number (Exotel can't redirect a live Voicebot stream over its REST API).
- **Compliance-first outbound**: every dial path (`placeOutboundCall`) checks opt-outs, DND and calling hours. Deferred calls are re-queued for the next window instead of being dropped.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | API (watch) + dashboard |
| `pnpm test` | Vitest suite |
| `pnpm simulate [--scenario id] [--llm anthropic] [--interactive]` | text call simulator |
| `pnpm seed` | demo dealership data |
| `pnpm worker` | BullMQ worker (when `QUEUE_BACKEND=bullmq`) |
| `pnpm build` | build shared, API bundle (tsup) and dashboard |
| `node apps/api/scripts/smoke-console.mjs ws://localhost:4000` | end-to-end test call through the console WebSocket |
| `node apps/api/scripts/smoke-twilio.mjs ws://localhost:4000` | emulates Twilio Media Streams against `/media/twilio` |
