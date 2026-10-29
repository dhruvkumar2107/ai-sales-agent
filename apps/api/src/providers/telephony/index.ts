import { env } from "../../config";
import { logger } from "../../lib/logger";
import { maskPhone } from "../../lib/mask";
import { ExotelTelephony } from "./exotel";
import { TwilioTelephony } from "./twilio";
import type { OutboundCallRequest, TelephonyProvider } from "./types";

export * from "./types";

/** Logs instead of dialing. Used in dev/tests when no telephony credentials are configured. */
export class MockTelephony implements TelephonyProvider {
  readonly name = "mock" as const;
  placed: { to: string; callId: string; from?: string }[] = [];
  async placeCall(req: OutboundCallRequest) {
    this.placed.push({ to: req.to, callId: req.callId, from: req.from });
    logger.info(`[mock telephony] would dial ${maskPhone(req.to)} for ${req.callId}`);
    return `mock_${req.callId}`;
  }
  async transfer() {
    return false;
  }
  async hangup() {}
}

let instance: TelephonyProvider | null = null;

export function telephony(): TelephonyProvider {
  if (instance) return instance;
  if (env.TELEPHONY_PROVIDER === "twilio" && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) instance = new TwilioTelephony();
  else if (env.TELEPHONY_PROVIDER === "exotel" && env.EXOTEL_SID && env.EXOTEL_API_KEY) instance = new ExotelTelephony();
  else instance = new MockTelephony();
  return instance;
}

export function setTelephony(t: TelephonyProvider) {
  instance = t;
}

/** Pick the provider again from the current config (after keys change in the admin panel). */
export function resetTelephony() {
  instance = null;
}
