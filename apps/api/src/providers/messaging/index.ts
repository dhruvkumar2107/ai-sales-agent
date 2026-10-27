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
  return text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "").replace(/\s{2,}/g, " ").trim();
}

export interface MessageResult {
  ok: boolean;
  id?: string;
  error?: string;
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

/**
 * Send a WhatsApp or SMS message. In India, SMS needs DLT-registered templates and WhatsApp needs
 * approved templates for business-initiated messages; register the TEMPLATES above with your provider.
 */
export async function sendMessage(to: string, body: string, channel: Channel = "whatsapp"): Promise<MessageResult> {
  try {
    if (env.MESSAGING_PROVIDER === "twilio" && env.TWILIO_ACCOUNT_SID) return await sendTwilio(to, body, channel);
    if (env.MESSAGING_PROVIDER === "exotel" && env.EXOTEL_SID) return await sendExotelSms(to, body);
    logger.info(`[messaging:${channel}] to ${maskPhone(to)}: ${body}`);
    return { ok: true, id: `log_${Date.now()}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
