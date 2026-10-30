---
name: onboard-client
description: Onboard a new client business end to end - create the business and its AI agent, buy and link a calling number, send the WhatsApp connect link, test it, and record the setup fee. Use when the user says a new client/firm/business has come, or runs /onboard-client.
---

# Onboard a new client

Run this every time a new business signs up. The user answers questions; you do every step through the admin API.
Confirm before anything that costs money (buying a number) or messages the client.

## 0. Connection (once per session)

Needs two values. Check the shell first: `echo $AXO_API_URL; [ -n "$AXO_ADMIN_KEY" ] && echo key set`.
- `AXO_API_URL`: the API's public address, e.g. `https://axo-voice-api.onrender.com` (no trailing slash).
- `AXO_ADMIN_KEY`: the server's `ADMIN_KEY`.

If either is missing, ask the user and tell them they can save it for next time by adding
`export AXO_API_URL=...` and `export AXO_ADMIN_KEY=...` to `~/.bashrc`. Never write the admin key into
the repo, memory or any file. Check access with:

```bash
curl -sf -H "x-admin-key: $AXO_ADMIN_KEY" "$AXO_API_URL/admin/me" | head -c 300
curl -sf -H "x-admin-key: $AXO_ADMIN_KEY" "$AXO_API_URL/admin/provisioning"
```

`/admin/provisioning` says whether buying Twilio numbers (`twilio`) and the WhatsApp self-connect link
(`whatsappSelfConnect`) are ready. If not, the missing one-time keys go in the admin panel at `/admin/settings`
(the checklist there lists them); continue with the steps that work.

## 1. Collect the client's details

Ask in one message, and accept rough answers; fill gaps with sensible defaults and say what you assumed:
1. Business name, and type (one of the `BUSINESS_TYPES` ids in `packages/shared/src/constants.ts`: clinic,
   dental, hospital, diagnostic_lab, salon_spa, gym_fitness, restaurant_cafe, hotel_homestay, real_estate,
   coaching, school_college, retail_shop, electronics, pharmacy, travel, insurance_finance, professional,
   home_services, events, other + a label).
2. What they do (2-3 sentences).
3. Business knowledge: services and prices, offers, FAQs, rules. This is the only thing the agent will quote,
   so push for real prices. If the client has a website or menu/price list, offer to read it and draft this.
4. Address, Google Maps link, timings.
5. What the agent should do (default: the type's preset actions): answer_questions, capture_enquiry,
   book_appointment, take_order, send_whatsapp_details, transfer_to_staff, complaints, feedback.
6. Agent name, voice (female/male), languages (en, hi, hinglish, kn) and the starting language.
7. Owner name, owner/staff phone (gets transfers and booking alerts), owner login email (optional).
8. Plan: starter (₹2,999, 100 min), growth (₹6,999, 300 min) or enterprise "Pro" (₹14,999, 700 min);
   setup fee ₹30,000 unless the user says otherwise.
9. Numbers: buy a new calling number (step 3) or use one they already have on our Twilio account; and whether
   the WhatsApp number is new or the same as the calling number.

Show a short summary and get a yes before creating.

## 2. Create the business and agent

Write the JSON with the Write tool to `client.json` in your scratchpad directory (keeps quotes and ₹ safe), then
post it, using that file's full path:

```bash
curl -s -X POST -H "x-admin-key: $AXO_ADMIN_KEY" -H "content-type: application/json" \
  --data-binary @"<scratchpad>/client.json" "$AXO_API_URL/admin/orgs"
```

Body shape:
```json
{
  "name": "Smile Dental Care", "plan": "growth",
  "ownerName": "Dr. Rao", "ownerPhone": "+919845000099", "ownerEmail": "rao@example.com",
  "business": { "type": "dental", "typeLabel": "", "description": "...", "knowledge": "Check-up: ₹300\n...",
    "actions": ["answer_questions", "capture_enquiry", "book_appointment", "send_whatsapp_details", "transfer_to_staff"],
    "address": "...", "mapLink": "...", "timings": "Mon-Sat 10am-8pm", "staffPhone": "+919845000099" },
  "agent": { "name": "Meera", "voice": "female", "languages": ["en", "hi"], "defaultLanguage": "en" },
  "callNumber": "", "whatsappNumber": ""
}
```
Fill `callNumber` / `whatsappNumber` only for numbers that already exist on our accounts. Save the returned `id`
as the business id; report any `setup` statuses.

One-shot option (what the admin panel's "Add business" does by default): add `"buyNumber": {"type": "local"}`
(or `mobile` / `tollfree`) to buy and link the first available Indian number during creation, and
`"whatsappSelfConnect": true` to get the WhatsApp connect link back as `whatsappLink.url`. Only add `buyNumber` after
the user has confirmed the Twilio monthly charge; then skip step 3 and use `whatsappLink` in step 4.

Voices: agents speak with Sarvam's native Indian voices (Anushka female, Abhilash male) once `SARVAM_API_KEY` is set
in Settings. The admin Settings page has "Hear the voice" to check the accent.

If the user set a different setup fee: `PATCH /admin/orgs/<id>` with `{"platform": {"setupFee": 25000}}` (0 waives it).

## 3. Calling number

Search (type `local`, `mobile` or `tollfree`; `contains` = digits like an area code, optional):
```bash
curl -s -H "x-admin-key: $AXO_ADMIN_KEY" "$AXO_API_URL/admin/twilio/available?country=IN&type=local&contains=80"
```
Show 5 options. After the user picks one AND confirms the Twilio monthly charge:
```bash
curl -s -X POST -H "x-admin-key: $AXO_ADMIN_KEY" -H "content-type: application/json" \
  -d '{"phoneNumber":"+918040009999"}' "$AXO_API_URL/admin/orgs/<id>/buy-number"
```
`calls.status: "ready"` means customers can call it now. An error about a regulatory bundle means the one-time
India documents are not approved yet (Settings checklist step 4); tell the user and continue.

For an existing number on our Twilio account instead: `POST /admin/orgs/<id>/connect` with `{"callNumber": "..."}`.

## 4. WhatsApp

Preferred, when `whatsappSelfConnect` is ready: get the client's link
```bash
curl -s -H "x-admin-key: $AXO_ADMIN_KEY" "$AXO_API_URL/admin/orgs/<id>/whatsapp-link"
```
Give the user the `url` and this ready-to-send message (and a `https://wa.me/<owner digits>?text=<urlencoded>` link):
"Hi! Please open this link to connect your WhatsApp number to your AI assistant (takes 2 minutes): <url>".
Remind them: the number must not be active on the normal WhatsApp / WhatsApp Business app.

Otherwise, once the number is added and verified in our Meta WhatsApp Manager:
`POST /admin/orgs/<id>/connect` with `{"whatsappNumber": "+91..."}`, and report the status detail.

## 5. Test

Tell the user to open `<web>/admin/dealers/<id>` and use *Open their dashboard → Test console* to try a call in
text mode with a question from the business knowledge, and to call the new number from their phone.
Check `GET /admin/orgs/<id>` (agents' `phoneNumbers`, `org.platform.whatsapp.phoneNumberId`) and report
what is live.

## 6. Setup fee received

When the user says the client paid:
```bash
curl -s -X PATCH -H "x-admin-key: $AXO_ADMIN_KEY" -H "content-type: application/json" \
  -d "{\"platform\":{\"setupFeePaidAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}}" "$AXO_API_URL/admin/orgs/<id>"
```
It then counts in this month's revenue and the partners' 50/50 split.

## 7. Finish

End with a short checklist: business id and admin page link, agent name, calling number (ready / pending
why), WhatsApp (connected / link sent / pending why), plan and setup fee status, and anything the user still
has to do.
