// Twilio telephony provider
// Uses Twilio Voice for webhook handling and media stream WebSocket
import { env } from "../config";
import twilio from "twilio";
import { VoiceHandler } from "../voice/handler";
import { logger } from "../lib/logger";

let twilioClient: any = null;

// Initialize Twilio client with free trial credentials
export function initTwilioProvider() {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;

  if (accountSid && authToken) {
    twilioClient = twilio(accountSid, authToken);
    logger.info({ accountSid: accountSid.substring(0, 5) + "..." }, "Twilio client initialized");
  } else {
    logger.warn({ message: "Twilio credentials not configured, using mock" });
  }
}

// Handle incoming voice call webhook from Twilio
export async function handleTwilioVoiceWebhook(
  req: any,
  res: any
): Promise<void> {
  if (!twilioClient) {
    return res.status(503).send({ error: "Twilio not initialized" });
  }

  const { Body, From, To, CallSid } = req.body;

  // Create a WebSocket connection for bidirectional media stream
  // Twilio needs to upgrade to WebSocket for bidirectional streaming
  const response = new twilio.twiml.VoiceResponse();

  // Gather user input or start streaming
  const gather = response.gather({
    input: "speech",
    action: "/api/twilio/gather",
    method: "POST",
    speechTimeout: "auto",
  });

  gather.say({
    voice: "polly.Joanna",
    language: "en-IN",
  }, "Namaste! This is AXO Voice Auto. How can I help you today?");

  response.redirect("/api/twilio/voice");

  res.type("text/xml").send(response.toString());
}

// Handle Twilio speech gathering result
export async function handleTwilioGather(
  req: any,
  res: any
): Promise<void> {
  const { SpeechResult, SpeechChannel, CallSid } = req.body;

  logger.info({ callSid: CallSid, speech: SpeechResult }, "Twilio speech received");

  // Pass the audio/text to our voice handler
  // In production, this would connect to the VoiceHandler via WebSocket

  const response = new twilio.twiml.VoiceResponse();
  response.say({
    voice: "polly.Joanna",
    language: "en-IN",
  }, `Thank you. We'll process your request. Is there anything else?`);

  response.redirect("/api/twilio/voice");

  res.type("text/xml").send(response.toString());
}

// Make an outbound call
export async function makeOutboundCall(
  toPhone: string,
  fromPhone: string,
  url: string
): Promise<string> {
  if (!twilioClient) {
    throw new Error("Twilio not initialized");
  }

  const call = await twilioClient.calls.create({
    to: toPhone,
    from: fromPhone,
    url, // Webhook URL for the call
  });

  return call.sid;
}

// Get call status
export async function getCallStatus(callSid: string): Promise<string> {
  if (!twilioClient) {
    return "unknown";
  }

  const call = await twilioClient.calls(callSid).fetch();
  return call.status;
}