import { env } from "../../config";
import type { OutboundCallRequest, TelephonyProvider } from "./types";

/**
 * Exotel (India). Calls run through an Exotel flow (App Bazaar):
 *   [Voicebot applet -> wss://<host>/media/exotel]  ->  [Connect applet, dynamic URL /telephony/exotel/transfer-number]  ->  [Hangup]
 * The Voicebot applet streams 16-bit 8 kHz linear PCM. To transfer, we remember the target number and
 * close the stream; the flow continues to the Connect applet, which fetches that number from us.
 */
const pendingTransfers = new Map<string, { number: string; at: number }>();

export function takeExotelTransfer(callSid: string): string | null {
  const t = pendingTransfers.get(callSid);
  if (!t) return null;
  pendingTransfers.delete(callSid);
  return Date.now() - t.at < 5 * 60_000 ? t.number : null;
}

export class ExotelTelephony implements TelephonyProvider {
  readonly name = "exotel" as const;

  private base() {
    return `https://${env.EXOTEL_SUBDOMAIN}/v1/Accounts/${env.EXOTEL_SID}`;
  }

  private auth() {
    return `Basic ${Buffer.from(`${env.EXOTEL_API_KEY}:${env.EXOTEL_API_TOKEN}`).toString("base64")}`;
  }

  async placeCall(req: OutboundCallRequest): Promise<string> {
    if (!env.EXOTEL_FLOW_URL) throw new Error("EXOTEL_FLOW_URL is required for outbound calls");
    const res = await fetch(`${this.base()}/Calls/connect.json`, {
      method: "POST",
      headers: { Authorization: this.auth(), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        From: req.to,
        CallerId: req.from ?? env.EXOTEL_CALLER_ID ?? "",
        Url: env.EXOTEL_FLOW_URL,
        CustomField: JSON.stringify({ callId: req.callId, orgId: req.orgId }),
        StatusCallback: `${env.PUBLIC_BASE_URL}/telephony/exotel/status?callId=${encodeURIComponent(req.callId)}&orgId=${encodeURIComponent(req.orgId)}&secret=${encodeURIComponent(env.EXOTEL_WEBHOOK_SECRET ?? "")}`,
        TimeLimit: String(env.MAX_CALL_SECONDS),
        TimeOut: "30",
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { Call?: { Sid?: string }; RestException?: { Message?: string } };
    if (!res.ok || !body.Call?.Sid) throw new Error(`Exotel call failed ${res.status}: ${body.RestException?.Message ?? ""}`);
    return body.Call.Sid;
  }

  async transfer(callSid: string, number: string): Promise<boolean> {
    pendingTransfers.set(callSid, { number, at: Date.now() });
    return true; // the media bridge closes the stream so the flow proceeds to the Connect applet
  }

  async hangup(): Promise<void> {
    // Closing the Voicebot stream with no pending transfer lets the flow reach its Hangup applet.
  }
}
