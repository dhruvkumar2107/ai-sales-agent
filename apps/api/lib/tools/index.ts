// Tool implementations for AXO Voice Auto voice pipeline
// These are validated with zod schemas and can be called by the LLM

import { z } from "zod";

// ---------- search_catalog ----------
export const searchCatalogSchema = z.object({
  query: z.string().optional(),
  filters: z.object({
    type: z.enum(["bike", "scooter", "car"]).optional(),
    fuel: z.enum(["petrol", "diesel", "cng", "ev", "hybrid"]).optional(),
  }).default({}),
});

export type SearchCatalogResult = z.infer<typeof searchCatalogSchema>;

export async function searchCatalog(query: string, filters?: { type?: string; fuel?: string }) {
  // In production, this would query Firestore
  // For now, return empty - the agent should use catalog data from context
  return { models: [], errors: [] };
}

// ---------- get_model_details ----------
export const getModelDetailsSchema = z.object({
  model: z.string().min(1),
});

export type GetModelDetailsResult = z.infer<typeof getModelDetailsSchema>;

export async function getModelDetails(model: string) {
  // Return configured catalog data
  return {
    brand: "Hyundai",
    model: "Creta",
    type: "car",
    variants: ["E 1.5 Petrol MT", "SX 1.5 Diesel AT"],
    exShowroomPrice: 1100000,
    onRoadMin: 1290000,
    onRoadMax: 1330000,
    colors: ["Abyss Black", "Atlas White", "Titan Grey"],
    keyFeatures: ["Panoramic sunroof", "6 airbags standard", "Level 2 ADAS on top variants", "10.25 inch touchscreen"],
    brochureUrl: "https://example.com/brochures/creta.pdf",
  };
}

export function calculateEMI(
  price: number,
  downPayment: number,
  tenureMonths: number,
  interestRate: number
): {emi: number, totalInterest: number, totalAmount: number};

export function calculateEMI(params: { price: number; downPayment: number; tenureMonths: number; interestRate: number }): {emi: number, totalInterest: number, totalAmount: number};

export function calculateEMI(
  arg1: number | { price: number; downPayment: number; tenureMonths: number; interestRate: number },
  downPayment?: number,
  tenureMonths?: number,
  interestRate?: number
): {emi: number, totalInterest: number, totalAmount: number} {
  const { price, downPayment: dp, tenureMonths: tm, interestRate: ir } = 
    typeof arg1 === "object" ? arg1 : { price: arg1, downPayment: downPayment!, tenureMonths: tenureMonths!, interestRate: interestRate! };

  const principal = price - dp;
  if (principal <= 0) return { emi: 0, totalInterest: 0, totalAmount: price };
  const monthlyRate = ir / 12 / 100;
  const n = tm;
  const emi = principal * (monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1);
  const totalAmount = emi * n;
  const totalInterest = totalAmount - principal;
  return { emi: Math.round(emi), totalInterest: Math.round(totalInterest), totalAmount: Math.round(totalAmount) };
}

// ---------- save_lead ----------
export const saveLeadSchema = z.object({
  name: z.string().optional(),
  phone: z.string().regex(/^\+?[1-9]\d{9,14}$/, "Invalid phone"),
  source: z.enum(["inbound_call", "facebook", "instagram", "website", "walk_in", "campaign", "referral", "other"]).default("other"),
  interestedModel: z.string().optional(),
  variant: z.string().optional(),
  fuel: z.enum(["petrol", "diesel", "cng", "ev", "hybrid"]).optional(),
  budget: z.number().int().optional(),
  newOrUsed: z.enum(["new", "used"]).optional(),
  timeline: z.enum(["this_week", "this_month", "three_months_plus", "unknown"]).optional(),
  paymentMode: z.enum(["cash", "loan", "exchange"]).optional(),
  hasExchange: z.boolean().optional(),
  exchangeVehicle: z.object({
    make: z.string().optional(),
    model: z.string().optional(),
    year: z.number().int().optional(),
    kilometres: z.number().int().optional(),
    condition: z.string().optional(),
  }).optional(),
  buyingIntent: z.enum(["buy_today", "visiting_today", "researching", "unknown"]).optional(),
  notes: z.string().optional(),
  language: z.enum(["en", "hi", "kn", "hinglish"]).optional(),
});

export type SaveLeadResult = z.infer<typeof saveLeadSchema>;

export async function saveLead(fields: z.infer<typeof saveLeadSchema>) {
  const parsed = saveLeadSchema.safeParse(fields);
  if (!parsed.success) throw new Error(`Lead validation failed: ${parsed.error.message}`);

  // In production, this would save to Firestore
  // For now, just return the parsed data
  return { ...parsed.data, id: `lead_${Date.now()}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

// ---------- lookup_booking ----------
export const lookupBookingSchema = z.object({
  phone: z.string().regex(/^\+?[1-9]\d{9,14}$/, "Invalid phone"),
});

export type LookupBookingResult = z.infer<typeof lookupBookingSchema>;

export async function lookupBooking(phone: string) {
  // In production, lookup by phone in Firestore
  // For now, return mock data
  return {
    id: "booking_001",
    customerName: "Rahul Sharma",
    phone,
    vehicleNo: "MH01 AB 1234",
    model: "Hyundai Creta",
    serviceType: "paid_service",
    status: "ready",
    estimatedReadyAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  };
}

// ---------- lookup_job_card ----------
export const lookupJobCardSchema = z.object({
  vehicleNo: z.string().regex(/^\+?[1-9]\d{9,14}$|^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4,7}$/, "Invalid vehicle number"),
});

export type LookupJobCardResult = z.infer<typeof lookupJobCardSchema>;

export async function lookupJobCard(vehicleNo: string) {
  // In production, lookup in Firestore
  return {
    jobCardNo: "JC-2024-001",
    vehicleNo,
    model: "Hyundai Creta",
    serviceType: "paid_service",
    status: "ready",
    estimatedReadyAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    notes: "Service completed, vehicle ready for delivery",
  };
}

// ---------- send_whatsapp_or_sms ----------
export const sendWhatsAppOrSmsSchema = z.object({
  template: z.string().min(1),
  phone: z.string().regex(/^\+?[1-9]\d{9,14}$/, "Invalid phone"),
});

export type SendWhatsAppOrSmsResult = z.infer<typeof sendWhatsAppOrSmsSchema>;

export async function sendWhatsAppOrSms(template: string, phone: string) {
  // In production, send via Twilio/WATCOMS
  console.log(`[SMS/WA] Sent "${template}" to ${phone}`);
  return { success: true, messageId: `msg_${Date.now()}`, sentAt: new Date().toISOString() };
}

// ---------- transfer_to_human ----------
export const transferToHumanSchema = z.object({
  reason: z.string().min(1),
  department: z.enum(["sales", "service", "insurance", "manager"]),
  priority: z.enum(["instant", "high", "normal"]),
});

export type TransferToHumanResult = z.infer<typeof transferToHumanSchema>;

export async function transferToHuman(reason: string, department: string, priority: "instant" | "high" | "normal") {
  // In production, this would trigger a callback or live transfer
  console.log(`[TRANSFER] Reason: ${reason} | Department: ${department} | Priority: ${priority}`);
  return { success: true, transferId: `transfer_${Date.now()}`, department, priority };
}

// ---------- create_ticket ----------
export const createTicketSchema = z.object({
  category: z.enum(["service_quality", "delay", "billing", "staff_behaviour", "safety", "sales", "other"]),
  description: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]),
  phone: z.string().regex(/^\+?[1-9]\d{9,14}$/, "Invalid phone").optional(),
});

export type CreateTicketResult = z.infer<typeof createTicketSchema>;

export async function createTicket(category: string, description: string, severity: "low" | "medium" | "high" | "critical", phone?: string) {
  // In production, create ticket in Firestore
  console.log(`[TICKET] Created: ${category} - ${severity} - ${description}`);
  return { id: `ticket_${Date.now()}`, category, severity, status: "open", createdAt: new Date().toISOString() };
}

// ---------- end_call ----------
export const endCallSchema = z.enum(["completed", "failed", "no_answer", "busy", "opted_out"]);

export type EndCallResult = z.infer<typeof endCallSchema>;

export function endCall(outcome: "completed" | "failed" | "no_answer" | "busy" | "opted-out") {
  // In production, this would finalize the call record
  console.log(`[CALL] Ended with outcome: ${outcome}`);
  return { outcome, endedAt: new Date().toISOString() };
}