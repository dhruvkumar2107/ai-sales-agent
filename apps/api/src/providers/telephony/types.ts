export interface OutboundCallRequest {
  to: string;
  from?: string;
  /** Our call id; echoed back on the media stream so the session finds its context */
  callId: string;
  orgId: string;
}

export interface TelephonyProvider {
  readonly name: "twilio" | "exotel" | "mock";
  /** Start an outbound call that connects to our media stream when answered. Returns the provider call id. */
  placeCall(req: OutboundCallRequest): Promise<string>;
  /** Redirect a live call to a human. Returns false if not possible. */
  transfer(providerCallId: string, number: string): Promise<boolean>;
  hangup(providerCallId: string): Promise<void>;
}

/** Context stored when we originate a call, read back when the media stream starts. */
export interface PendingCall {
  id: string; // callId
  orgId: string;
  agentId?: string;
  to: string;
  campaignId?: string;
  campaignType?: string;
  campaignScript?: string;
  contactId?: string;
  contactData?: Record<string, string>;
  customerName?: string;
  leadId?: string;
  createdAt: string;
}
