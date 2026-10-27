import { createHmac } from "node:crypto";
import { env } from "../../config";
import { safeEqual } from "../../lib/crypto";
import type { OutboundCallRequest, TelephonyProvider } from "./types";

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const wsBase = () => env.PUBLIC_BASE_URL.replace(/^http/, "ws");

/** TwiML that bridges the call into our bidirectional media stream. */
export function streamTwiml(params: Record<string, string | undefined>): string {
  const p = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `<Parameter name="${xml(k)}" value="${xml(v!)}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${xml(`${wsBase()}/media/twilio`)}">${p}</Stream></Connect></Response>`;
}

export function dialTwiml(number: string, callerId?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial${callerId ? ` callerId="${xml(callerId)}"` : ""} timeout="25">${xml(number)}</Dial></Response>`;
}

/**
 * Validate X-Twilio-Signature: base64(HMAC-SHA1(authToken, fullUrl + concatenated sorted POST params)).
 * https://www.twilio.com/docs/usage/security#validating-requests
 */
export function validateTwilioSignature(url: string, params: Record<string, string>, signature: string | undefined): boolean {
  if (!env.TWILIO_AUTH_TOKEN || !signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", env.TWILIO_AUTH_TOKEN).update(data).digest("base64");
  return safeEqual(expected, signature);
}

export class TwilioTelephony implements TelephonyProvider {
  readonly name = "twilio" as const;

  private async api(path: string, form: Record<string, string>) {
    const sid = env.TWILIO_ACCOUNT_SID;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(form),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(`Twilio ${path} ${res.status}: ${body.message ?? ""}`);
    return body;
  }

  async placeCall(req: OutboundCallRequest): Promise<string> {
    const res = await this.api("Calls.json", {
      To: req.to,
      From: req.from ?? env.TWILIO_PHONE_NUMBER ?? "",
      Twiml: streamTwiml({ callId: req.callId, orgId: req.orgId, direction: "outbound" }),
      StatusCallback: `${env.PUBLIC_BASE_URL}/telephony/twilio/status?callId=${encodeURIComponent(req.callId)}&orgId=${encodeURIComponent(req.orgId)}`,
      StatusCallbackEvent: "completed",
      Timeout: "30",
      MachineDetection: "Enable",
    });
    return String(res.sid);
  }

  async transfer(callSid: string, number: string): Promise<boolean> {
    try {
      // Replacing the call's TwiML ends the <Connect><Stream> and dials the executive.
      await this.api(`Calls/${callSid}.json`, { Twiml: dialTwiml(number, env.TWILIO_PHONE_NUMBER) });
      return true;
    } catch {
      return false;
    }
  }

  async hangup(callSid: string): Promise<void> {
    await this.api(`Calls/${callSid}.json`, { Status: "completed" }).catch(() => undefined);
  }
}
