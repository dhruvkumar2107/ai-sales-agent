import type { Org, OrgPlatform } from "@axo/shared";
import { adminSession } from "@/lib/api";

export interface Usage {
  calls: number;
  answeredCalls: number;
  inbound: number;
  outbound: number;
  web: number;
  minutes: number;
  cost: number;
  messages: number;
  whatsappChats: number;
  leads: number;
  hotLeads: number;
  testDrives: number;
  serviceBookings: number;
  lastCallAt?: string;
}

export interface Billing {
  planLabel: string;
  includedMinutes: number;
  basePrice: number;
  overageMinutes: number;
  overage: number;
  setupFee: number;
  setupFeeDue: number;
  revenue: number;
  paymentFees: number;
  cost: number;
  profit: number;
}

export interface DealerRow {
  org: Org & { platform: OrgPlatform };
  usage: Usage;
  billing: Billing;
}

/** Open a dealership's own dashboard with full owner access. */
export function openDealerDashboard(orgId: string) {
  adminSession.setActAs(orgId);
  window.location.href = "/dashboard";
}

export const FEATURE_LABELS: Record<keyof OrgPlatform["features"], { label: string; hint: string }> = {
  voiceCalls: { label: "AI phone calls", hint: "Answer and place calls. Off = calls are not answered by the AI." },
  outboundCampaigns: { label: "Outbound campaigns", hint: "Reminder, follow-up and offer campaigns." },
  whatsapp: { label: "WhatsApp", hint: "Master switch for every WhatsApp message." },
  postCallWhatsapp: { label: "WhatsApp after every call", hint: "Thank-you with price range, brochure or location." },
  whatsappBot: { label: "AI WhatsApp replies", hint: "The AI answers customers who message on WhatsApp." },
};
