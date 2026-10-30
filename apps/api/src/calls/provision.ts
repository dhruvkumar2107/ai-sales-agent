import { env } from "../config";
import { global, platformOf, repo } from "../db/repo";
import { encryptString, hmacSha256, safeEqual } from "../lib/crypto";
import { logger } from "../lib/logger";
import { normalizePhone } from "../lib/mask";
import { connectNumbers, type ConnectResult } from "./connect";

/**
 * Per-business provisioning without visiting provider dashboards:
 * - Twilio: search and buy a number from the admin panel; it is configured and linked on purchase.
 * - Meta: a "Connect WhatsApp" link the business opens itself (Embedded Signup); the token, WhatsApp
 *   Business Account and phone number come back to us and are linked automatically.
 */

// ---------------------------------------------------------------- Twilio numbers

const twilioAuth = () => `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}`;
const twilioBase = () => `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}`;

export const twilioReady = () => Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);

export interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string;
  region: string;
  voice: boolean;
  sms: boolean;
}

/** Numbers Twilio can sell right now. type: local | mobile | tollfree; contains: digits the number should include. */
export async function searchTwilioNumbers(o: { country?: string; type?: string; contains?: string }): Promise<AvailableNumber[]> {
  if (!twilioReady()) throw new Error("Add your Twilio Account SID and Auth Token in Settings first.");
  const type = { local: "Local", mobile: "Mobile", tollfree: "TollFree" }[o.type ?? "local"] ?? "Local";
  const q = new URLSearchParams({ VoiceEnabled: "true", PageSize: "20" });
  if (o.contains?.replace(/\D/g, "")) q.set("Contains", o.contains.replace(/\D/g, ""));
  const res = await fetch(`${twilioBase()}/AvailablePhoneNumbers/${(o.country ?? "IN").toUpperCase()}/${type}.json?${q}`, { headers: { Authorization: twilioAuth() } });
  const json = (await res.json().catch(() => ({}))) as { available_phone_numbers?: Record<string, unknown>[]; message?: string };
  if (!res.ok) throw new Error(`Twilio: ${json.message ?? res.status}`);
  return (json.available_phone_numbers ?? []).map((n) => {
    const caps = (n.capabilities ?? {}) as Record<string, boolean>;
    return { phoneNumber: String(n.phone_number), friendlyName: String(n.friendly_name ?? n.phone_number), locality: String(n.locality ?? ""), region: String(n.region ?? ""), voice: Boolean(caps.voice ?? caps.Voice), sms: Boolean(caps.SMS ?? caps.sms) };
  });
}

/** Buy a number, point it at our voice webhook, and link it to the business's agent. */
export async function buyTwilioNumber(orgId: string, phoneNumber: string): Promise<ConnectResult & { bought: string }> {
  if (!twilioReady()) throw new Error("Add your Twilio Account SID and Auth Token in Settings first.");
  const number = normalizePhone(phoneNumber);
  const form = new URLSearchParams({ PhoneNumber: number, VoiceUrl: `${env.PUBLIC_BASE_URL}/telephony/twilio/voice`, VoiceMethod: "POST", FriendlyName: ((await global.orgs().get(orgId))?.name ?? orgId).slice(0, 60) });
  // India and many other countries only sell numbers against an approved regulatory bundle and address.
  if (env.TWILIO_BUNDLE_SID) form.set("BundleSid", env.TWILIO_BUNDLE_SID);
  if (env.TWILIO_ADDRESS_SID) form.set("AddressSid", env.TWILIO_ADDRESS_SID);
  const res = await fetch(`${twilioBase()}/IncomingPhoneNumbers.json`, { method: "POST", headers: { Authorization: twilioAuth(), "content-type": "application/x-www-form-urlencoded" }, body: form });
  const json = (await res.json().catch(() => ({}))) as { phone_number?: string; message?: string; code?: number };
  if (!res.ok) {
    const needsBundle = /bundle|address|regulat/i.test(json.message ?? "");
    throw new Error(needsBundle ? `Twilio needs an approved regulatory bundle for this country before it sells numbers: ${json.message}. Create it in Twilio Console > Phone Numbers > Regulatory Compliance, then paste its Bundle SID (and Address SID) in Settings.` : `Twilio: ${json.message ?? res.status}`);
  }
  logger.info({ orgId, number }, "bought Twilio number");
  return { ...(await connectNumbers(orgId, { callNumber: json.phone_number ?? number })), bought: json.phone_number ?? number };
}

/**
 * Pick and buy a number with no choosing: tries the first few Indian numbers Twilio offers (another buyer can take
 * one between search and purchase). Never throws; a failure comes back as an action_needed status with the reason.
 */
export async function autoBuyNumber(orgId: string, o: { type?: string; contains?: string } = {}): Promise<ConnectResult & { bought?: string }> {
  const fail = (detail: string): ConnectResult => ({ calls: { status: "action_needed", number: "", detail } });
  if (!twilioReady()) return fail("No number bought: add your Twilio Account SID and Auth Token in Settings, then use Get numbers on this business's page.");
  let candidates: AvailableNumber[];
  try {
    candidates = await searchTwilioNumbers({ country: "IN", type: o.type, contains: o.contains });
    // Fewer digits filter is the usual reason for an empty list; retry without it once.
    if (!candidates.length && o.contains) candidates = await searchTwilioNumbers({ country: "IN", type: o.type });
  } catch (err) {
    return fail(`No number bought: ${(err as Error).message}`);
  }
  if (!candidates.length) return fail("Twilio has no Indian numbers of this type right now. Try another type from this business's page.");
  let last = "";
  for (const n of candidates.slice(0, 3)) {
    try {
      return await buyTwilioNumber(orgId, n.phoneNumber);
    } catch (err) {
      last = (err as Error).message;
      // Missing documents or a card problem fails every number the same way; stop at the first.
      if (!/not available|no longer|already/i.test(last)) break;
    }
  }
  return fail(`No number bought: ${last}`);
}

// ---------------------------------------------------------------- WhatsApp self-connect link

const LINK_DAYS = 14;
const linkSecret = () => hmacSha256(env.ENCRYPTION_KEY ?? "axo-dev-only-key", "whatsapp-connect-link");

/** A link the business opens to connect its own WhatsApp number; valid for 14 days. */
export function whatsappConnectToken(orgId: string, now = Date.now()): string {
  const payload = Buffer.from(`${orgId}.${now + LINK_DAYS * 86400_000}`).toString("base64url");
  return `${payload}.${hmacSha256(linkSecret(), payload).slice(0, 32)}`;
}

export function orgFromConnectToken(token: string): string | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !safeEqual(hmacSha256(linkSecret(), payload).slice(0, 32), sig)) return null;
  const [orgId, exp] = Buffer.from(payload, "base64url").toString().split(".");
  return orgId && Number(exp) > Date.now() ? orgId : null;
}

/** The page a business opens to connect its WhatsApp; ready = false while the Meta app settings are missing. */
export function whatsappConnectLink(orgId: string) {
  const web = env.WEB_ORIGIN.split(",")[0]!.replace(/\/$/, "");
  return { url: `${web}/connect/whatsapp/${whatsappConnectToken(orgId)}`, ready: embeddedSignupReady(), validDays: LINK_DAYS };
}

export const embeddedSignupReady = () => Boolean(env.META_APP_ID && env.META_APP_SECRET && env.META_ES_CONFIG_ID);

const graph = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${path}`, init);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Meta: ${json.error?.message ?? res.status}`);
  return json;
};

/**
 * Finish Embedded Signup: swap the one-time code for the business's token, subscribe our app to its WhatsApp
 * Business Account (so incoming messages reach our webhook), register the number for the Cloud API, and link it.
 */
export async function completeWhatsappSignup(orgId: string, o: { code: string; phoneNumberId: string; wabaId: string }): Promise<{ displayNumber: string }> {
  if (!embeddedSignupReady()) throw new Error("WhatsApp self-connect is not set up on the server yet.");
  const tokenRes = await graph(`oauth/access_token?${new URLSearchParams({ client_id: env.META_APP_ID!, client_secret: env.META_APP_SECRET!, code: o.code })}`);
  const token = String(tokenRes.access_token ?? "");
  if (!token) throw new Error("Meta did not return an access token");
  const auth = { Authorization: `Bearer ${token}` };

  await graph(`${o.wabaId}/subscribed_apps`, { method: "POST", headers: auth });
  // Registering an already registered number fails harmlessly; the number keeps working.
  await graph(`${o.phoneNumberId}/register`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", pin: String(100000 + Math.floor(Math.random() * 900000)) }) }).catch((err) => logger.info({ orgId, err: (err as Error).message }, "WhatsApp number register skipped"));
  const info = await graph(`${o.phoneNumberId}?fields=display_phone_number,verified_name`, { headers: auth });
  const displayNumber = normalizePhone(String(info.display_phone_number ?? ""));

  const route = await global.waRoutes().get(o.phoneNumberId);
  if (route && route.orgId !== orgId) throw new Error("This WhatsApp number is already connected to another business.");
  const org = (await global.orgs().get(orgId))!;
  const p = platformOf(org);
  if (p.whatsapp.phoneNumberId && p.whatsapp.phoneNumberId !== o.phoneNumberId) await global.waRoutes().delete(p.whatsapp.phoneNumberId);
  await global.orgs().set({ ...org, platform: { ...p, whatsapp: { ...p.whatsapp, phoneNumberId: o.phoneNumberId, displayNumber } } });
  await global.waRoutes().set({ id: o.phoneNumberId, orgId });
  const r = repo(orgId);
  const s = await r.settings();
  // Its own token: this number sends for real even while the platform default is the log provider.
  await r.saveSettings({ secrets: { ...s.secrets, metaWaToken: encryptString(token) } });
  logger.info({ orgId, phoneNumberId: o.phoneNumberId }, "WhatsApp connected via Embedded Signup");
  return { displayNumber };
}
