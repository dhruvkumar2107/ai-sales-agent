import type { Language } from "@axo/shared";
import { env } from "../../config";
import { logger } from "../../lib/logger";
import { maskPhone } from "../../lib/mask";

export type Channel = "whatsapp" | "sms";

export const TEMPLATES = {
  testdrive_confirmation: {
    en: "Hi {name}, your {model} test drive at {showroom} ({branch}) is confirmed for {date} at {time}. Address: {address}. Map: {map}. Please carry your driving licence.",
    hi: "नमस्ते {name}, {showroom} ({branch}) में आपकी {model} टेस्ट ड्राइव {date} को {time} बजे कन्फ़र्म है। पता: {address}। मैप: {map}। कृपया ड्राइविंग लाइसेंस साथ लाएँ।",
  },
  testdrive_reminder: {
    en: "Reminder: your {model} test drive at {branch} is today at {time}. Map: {map}. See you soon!",
    hi: "रिमाइंडर: आपकी {model} टेस्ट ड्राइव आज {time} बजे {branch} में है। मैप: {map}।",
  },
  service_confirmation: {
    en: "Hi {name}, service for {vehicle} is booked at {branch} on {date} at {time}. {pickup}Address: {address}. Map: {map}.",
    hi: "नमस्ते {name}, {vehicle} की सर्विस {branch} में {date} को {time} बजे बुक है। {pickup}पता: {address}। मैप: {map}।",
  },
  callback_notice: {
    en: "Thanks for calling {showroom}. Our {department} team will call you back shortly.",
    hi: "{showroom} को कॉल करने के लिए धन्यवाद। हमारी {department} टीम जल्द ही आपको कॉल करेगी।",
  },
  brochure: {
    en: "Here is the {model} brochure from {showroom}: {link}",
    hi: "{showroom} की ओर से {model} का ब्रोशर: {link}",
  },
  model_details: {
    en: "{model} at {showroom}\nVariants: {variants}\nOn-road price: {price_range} (final price confirmed at the showroom)\nKey features: {features}\n{brochure}Reply here to book a test drive.",
    hi: "{showroom} में {model}\nवेरिएंट: {variants}\nऑन-रोड कीमत: {price_range} (फ़ाइनल कीमत शोरूम पर कन्फ़र्म होगी)\nखास फ़ीचर: {features}\n{brochure}टेस्ट ड्राइव बुक करने के लिए यहीं जवाब दें।",
  },
  showroom_location: {
    en: "{showroom} - {branch}\nAddress: {address}\nMap: {map}\nTimings: {timings}\nPhone: {phone}",
    hi: "{showroom} - {branch}\nपता: {address}\nमैप: {map}\nसमय: {timings}\nफ़ोन: {phone}",
  },
  post_call_followup: {
    en: "Thank you for calling {showroom}{name}! {details}You can reply here on WhatsApp anytime for prices, EMI or to book a test drive.",
    hi: "{showroom} को कॉल करने के लिए धन्यवाद{name}! {details}कीमत, EMI या टेस्ट ड्राइव के लिए कभी भी यहीं WhatsApp पर जवाब दें।",
  },
  appointment_request: {
    en: "Hi {name}, we've received your appointment request at {showroom} for {purpose} on {date} at {time}. Our team will confirm it shortly. {address}",
    hi: "नमस्ते {name}, {showroom} में {purpose} के लिए {date} को {time} बजे का आपका अपॉइंटमेंट अनुरोध मिल गया है। हमारी टीम जल्द ही कन्फ़र्म करेगी। {address}",
  },
  order_received: {
    en: "Hi {name}, thank you for your order with {showroom}: {items} ({fulfilment}). Our team will confirm the total and timing shortly.",
    hi: "नमस्ते {name}, {showroom} पर ऑर्डर के लिए धन्यवाद: {items} ({fulfilment})। हमारी टीम जल्द ही कुल राशि और समय कन्फ़र्म करेगी।",
  },
  business_details: {
    en: "{showroom}\n{details}\nReply here anytime with your questions.",
    hi: "{showroom}\n{details}\nकोई भी सवाल हो तो यहीं जवाब दें।",
  },
  business_location: {
    en: "{showroom}\nAddress: {address}\nMap: {map}\nTimings: {timings}\nPhone: {phone}",
    hi: "{showroom}\nपता: {address}\nमैप: {map}\nसमय: {timings}\nफ़ोन: {phone}",
  },
  business_followup: {
    en: "Thank you for calling {showroom}{name}! {details}You can reply here on WhatsApp anytime.",
    hi: "{showroom} को कॉल करने के लिए धन्यवाद{name}! {details}कभी भी यहीं WhatsApp पर जवाब दें।",
  },
  staff_new_request: {
    en: "NEW {kind}: {name} ({phone}). {details}",
    hi: "NEW {kind}: {name} ({phone}). {details}",
  },
  exec_hot_lead: {
    en: "HOT LEAD: {name} ({phone}) wants {model}. Reason: {reason}. Call back within 5 minutes.",
    hi: "HOT LEAD: {name} ({phone}) wants {model}. Reason: {reason}. Call back within 5 minutes.",
  },
  booking_update: {
    en: "Hi {name}, update on your {model} booking: {status}. {details}",
    hi: "नमस्ते {name}, आपकी {model} बुकिंग अपडेट: {status}। {details}",
  },
  review_request: {
    en: "Thank you for choosing {showroom}, {name}! We'd love your review: {link}",
    hi: "{showroom} चुनने के लिए धन्यवाद {name}! कृपया अपना रिव्यू दें: {link}",
  },
} as const;

export type TemplateName = keyof typeof TEMPLATES;

export function renderTemplate(name: TemplateName, vars: Record<string, string | undefined>, lang: Language = "en"): string {
  const t = TEMPLATES[name];
  const text = lang === "hi" || lang === "hinglish" ? t.hi : t.en;
  return text
    .replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Variable names in order of appearance: the body parameters ({{1}}, {{2}}, ...) of the matching Meta template. */
export function templateParams(name: TemplateName): string[] {
  return [...new Set([...TEMPLATES[name].en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))];
}

export interface MessageResult {
  ok: boolean;
  id?: string;
  error?: string;
  /** true when no provider is configured and the message was only logged (demo mode) */
  logged?: boolean;
}

/** Per-send options: dealership WhatsApp number and, outside the 24 h window, an approved template. */
export interface SendOptions {
  meta?: { phoneNumberId?: string; token?: string; template?: { name: string; language: string; params: string[] } };
}

async function sendTwilio(to: string, body: string, channel: Channel): Promise<MessageResult> {
  const sid = env.TWILIO_ACCOUNT_SID;
  const from = channel === "whatsapp" ? `whatsapp:${env.TWILIO_WHATSAPP_FROM}` : env.TWILIO_PHONE_NUMBER;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: channel === "whatsapp" ? `whatsapp:${to}` : to, From: from ?? "", Body: body }),
  });
  const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
  return res.ok ? { ok: true, id: json.sid } : { ok: false, error: json.message ?? String(res.status) };
}

async function sendExotelSms(to: string, body: string): Promise<MessageResult> {
  const res = await fetch(`https://${env.EXOTEL_SUBDOMAIN}/v1/Accounts/${env.EXOTEL_SID}/Sms/send.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${env.EXOTEL_API_KEY}:${env.EXOTEL_API_TOKEN}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: env.EXOTEL_CALLER_ID ?? "", To: to, Body: body }),
  });
  const json = (await res.json().catch(() => ({}))) as { SMSMessage?: { Sid?: string } };
  return res.ok ? { ok: true, id: json.SMSMessage?.Sid } : { ok: false, error: String(res.status) };
}

/** Meta WhatsApp Cloud API: free-form text inside the 24 h customer window, approved template outside it. */
async function sendMeta(to: string, body: string, o: NonNullable<SendOptions["meta"]>): Promise<MessageResult> {
  const phoneNumberId = o.phoneNumberId || env.META_WA_PHONE_NUMBER_ID;
  const token = o.token || env.META_WA_TOKEN;
  if (!phoneNumberId || !token) return { ok: false, error: "WhatsApp number not configured" };
  const payload = o.template
    ? {
        messaging_product: "whatsapp",
        to: to.replace(/^\+/, ""),
        type: "template",
        template: { name: o.template.name, language: { code: o.template.language }, components: o.template.params.length ? [{ type: "body", parameters: o.template.params.map((text) => ({ type: "text", text: text || "-" })) }] : [] },
      }
    : { messaging_product: "whatsapp", to: to.replace(/^\+/, ""), type: "text", text: { body, preview_url: true } };
  const res = await fetch(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
  return res.ok ? { ok: true, id: json.messages?.[0]?.id } : { ok: false, error: json.error?.message ?? String(res.status) };
}

/**
 * Low-level send through the configured provider. Prefer `sendOrgMessage` (messaging/service.ts), which applies
 * the dealership's switches and limits and keeps the message log. In India, SMS needs DLT-registered templates and
 * WhatsApp needs approved templates for business-initiated messages.
 */
export async function sendMessage(to: string, body: string, channel: Channel = "whatsapp", opts: SendOptions = {}): Promise<MessageResult> {
  try {
    // A dealership with its own linked Meta number always sends for real, whatever the platform default is.
    const ownNumber = Boolean(opts.meta?.phoneNumberId && opts.meta.token);
    if (channel === "whatsapp" && (env.MESSAGING_PROVIDER === "meta" || ownNumber)) return await sendMeta(to, body, opts.meta ?? {});
    if (env.MESSAGING_PROVIDER === "twilio" && env.TWILIO_ACCOUNT_SID) return await sendTwilio(to, body, channel);
    if (env.MESSAGING_PROVIDER === "exotel" && env.EXOTEL_SID) return await sendExotelSms(to, body);
    if (channel === "sms" && env.MESSAGING_PROVIDER === "meta" && env.TWILIO_ACCOUNT_SID) return await sendTwilio(to, body, channel);
    logger.info(`[messaging:${channel}] to ${maskPhone(to)}: ${body}`);
    return { ok: true, id: `log_${Date.now()}`, logged: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
