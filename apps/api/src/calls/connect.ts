import { env } from "../config";
import { global, platformOf, repo } from "../db/repo";
import { logger } from "../lib/logger";
import { normalizePhone } from "../lib/mask";
import { numberConflicts, syncPhoneRoutes } from "./numbers";

/**
 * "Enter the number and it's ready": links a business's calling and WhatsApp numbers and, where the platform
 * account allows it, configures the provider too (Twilio voice webhook, Meta phone number id lookup).
 */

export interface ChannelStatus {
  /** ready = works now; action_needed = linked here, but a step outside this app is missing */
  status: "ready" | "action_needed";
  number: string;
  detail: string;
}

export interface ConnectResult {
  calls?: ChannelStatus;
  whatsapp?: ChannelStatus;
}

const validNumber = (n: string) => /^\+\d{8,15}$/.test(n);
const isLocalUrl = (u: string) => /localhost|127\.0\.0\.1/.test(u);

/** Checks that would make connecting fail; run before creating a business so nothing half-made is left behind. */
export async function checkNumbers(orgId: string, o: { callNumber?: string; whatsappNumber?: string }): Promise<string | null> {
  for (const raw of [o.callNumber, o.whatsappNumber]) {
    if (raw && !validNumber(normalizePhone(raw))) return `"${raw}" is not a valid phone number`;
  }
  if (o.callNumber) {
    const conflicts = await numberConflicts(orgId, [normalizePhone(o.callNumber)]);
    if (conflicts.length) return `${o.callNumber} is already linked to ${conflicts[0]!.orgName}`;
  }
  return null;
}

export async function connectNumbers(orgId: string, o: { callNumber?: string; whatsappNumber?: string }): Promise<ConnectResult> {
  const out: ConnectResult = {};
  if (o.callNumber) out.calls = await connectCallNumber(orgId, normalizePhone(o.callNumber));
  if (o.whatsappNumber) out.whatsapp = await connectWhatsappNumber(orgId, normalizePhone(o.whatsappNumber));
  return out;
}

async function connectCallNumber(orgId: string, number: string): Promise<ChannelStatus> {
  const r = repo(orgId);
  const agents = await r.agents.list();
  const agent = agents.find((a) => a.active) ?? agents[0];
  if (!agent) return { status: "action_needed", number, detail: "This business has no AI agent yet." };
  // One number answers with one agent: move it here if another agent of this business had it.
  for (const a of agents) {
    const has = a.phoneNumbers.map(normalizePhone).includes(number);
    if (a.id === agent.id && !has) await r.agents.set({ ...a, phoneNumbers: [...a.phoneNumbers, number] });
    if (a.id !== agent.id && has) await r.agents.set({ ...a, phoneNumbers: a.phoneNumbers.filter((n) => normalizePhone(n) !== number) });
  }
  await syncPhoneRoutes(orgId);

  // Outbound calls go out from the business's own number unless one was already chosen.
  const org = (await global.orgs().get(orgId))!;
  const p = platformOf(org);
  if (!p.calling.callerId) await global.orgs().set({ ...org, platform: { ...p, calling: { ...p.calling, callerId: number } } });

  if (!p.features.voiceCalls) return { status: "action_needed", number, detail: `Linked to ${agent.name}, but AI phone calls are turned off for this business.` };
  return { ...(await configureTelephony(number)), number };
}

async function configureTelephony(number: string): Promise<Omit<ChannelStatus, "number">> {
  if (env.TELEPHONY_PROVIDER === "exotel") return { status: "action_needed", detail: "Linked. In Exotel, attach this number to your AXO call flow (Voicebot applet) once." };
  if (env.TELEPHONY_PROVIDER !== "twilio" || !env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN)
    return { status: "action_needed", detail: "Linked, but no telephony account is configured on the server (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN). Try the agent from the Test console meanwhile." };
  if (isLocalUrl(env.PUBLIC_BASE_URL)) return { status: "action_needed", detail: `Linked, but PUBLIC_BASE_URL is ${env.PUBLIC_BASE_URL}, which Twilio cannot reach. Set it to your public https URL and connect again.` };

  const sid = env.TWILIO_ACCOUNT_SID;
  const auth = `Basic ${Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}`;
  const base = `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers`;
  try {
    const found = await fetch(`${base}.json?PhoneNumber=${encodeURIComponent(number)}`, { headers: { Authorization: auth } });
    const list = (await found.json().catch(() => ({}))) as { incoming_phone_numbers?: { sid: string }[]; message?: string };
    if (!found.ok) return { status: "action_needed", detail: `Linked, but Twilio refused the lookup: ${list.message ?? found.status}.` };
    const num = list.incoming_phone_numbers?.[0];
    if (!num) return { status: "action_needed", detail: "Linked, but this number is not in your Twilio account. Buy it in Twilio (or forward the business's calls to a Twilio number), then connect again." };
    const voiceUrl = `${env.PUBLIC_BASE_URL}/telephony/twilio/voice`;
    const upd = await fetch(`${base}/${num.sid}.json`, {
      method: "POST",
      headers: { Authorization: auth, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ VoiceUrl: voiceUrl, VoiceMethod: "POST" }),
    });
    if (!upd.ok) return { status: "action_needed", detail: `Linked, but Twilio did not accept the webhook (${upd.status}). Set "A call comes in" to ${voiceUrl} by hand.` };
    return { status: "ready", detail: "Ready: calls to this number are answered by the AI (Twilio webhook set automatically)." };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "twilio number setup failed");
    return { status: "action_needed", detail: "Linked, but Twilio could not be reached. Connect again in a minute." };
  }
}

async function connectWhatsappNumber(orgId: string, number: string): Promise<ChannelStatus> {
  const org = (await global.orgs().get(orgId))!;
  const p = platformOf(org);
  const save = async (whatsapp: Partial<typeof p.whatsapp>) => {
    const cur = platformOf((await global.orgs().get(orgId))!);
    await global.orgs().set({ ...org, platform: { ...cur, whatsapp: { ...cur.whatsapp, ...whatsapp } } });
  };
  await save({ displayNumber: number });

  if (!env.META_WA_TOKEN || !env.META_WABA_ID)
    return { status: "action_needed", number, detail: "Saved. To link it automatically, set META_WA_TOKEN and META_WABA_ID on the server; or paste its Meta phone number ID in the WhatsApp card." };

  let phoneNumberId: string | undefined;
  try {
    const res = await fetch(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${env.META_WABA_ID}/phone_numbers?fields=id,display_phone_number,verified_name&limit=200`, { headers: { Authorization: `Bearer ${env.META_WA_TOKEN}` } });
    const json = (await res.json().catch(() => ({}))) as { data?: { id: string; display_phone_number: string }[]; error?: { message?: string } };
    if (!res.ok) return { status: "action_needed", number, detail: `Saved, but Meta refused the lookup: ${json.error?.message ?? res.status}.` };
    const digits = number.replace(/\D/g, "");
    phoneNumberId = json.data?.find((d) => d.display_phone_number.replace(/\D/g, "") === digits)?.id;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "meta number lookup failed");
    return { status: "action_needed", number, detail: "Saved, but Meta could not be reached. Connect again in a minute." };
  }
  if (!phoneNumberId)
    return { status: "action_needed", number, detail: "Saved, but this number is not in your WhatsApp Business account yet. In Meta WhatsApp Manager, add the number and verify it by OTP, then connect again." };

  const route = await global.waRoutes().get(phoneNumberId);
  if (route && route.orgId !== orgId) return { status: "action_needed", number, detail: `This WhatsApp number is already linked to ${(await global.orgs().get(route.orgId))?.name ?? route.orgId}.` };
  if (p.whatsapp.phoneNumberId && p.whatsapp.phoneNumberId !== phoneNumberId) await global.waRoutes().delete(p.whatsapp.phoneNumberId);
  await global.waRoutes().set({ id: phoneNumberId, orgId });
  await save({ phoneNumberId });

  if (!p.features.whatsapp) return { status: "action_needed", number, detail: "Linked, but WhatsApp is turned off for this business." };
  if (env.MESSAGING_PROVIDER !== "meta") return { status: "action_needed", number, detail: "Linked, but MESSAGING_PROVIDER is not meta, so messages are only logged. Set MESSAGING_PROVIDER=meta to send for real." };
  return { status: "ready", number, detail: "Ready: the AI replies to WhatsApp messages on this number and sends messages from it." };
}
