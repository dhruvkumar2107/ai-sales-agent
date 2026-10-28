export const LANGUAGES = ["en", "hi", "kn", "hinglish"] as const;
export type Language = (typeof LANGUAGES)[number];

export const ROLES = ["owner", "sales_manager", "sales_executive", "service_advisor"] as const;
export type Role = (typeof ROLES)[number];

export const LEAD_STAGES = ["new", "contacted", "test_drive_booked", "negotiation", "won", "lost"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_SOURCES = ["inbound_call", "whatsapp", "facebook", "instagram", "website", "walk_in", "campaign", "referral", "other"] as const;

/** Subscription plans sold to dealerships (INR / month). `calls` = included calls per month. */
export const PLAN_IDS = ["trial", "starter", "growth", "enterprise"] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export const PLANS: Record<PlanId, { label: string; price: number; calls: number; messages: number }> = {
  trial: { label: "Trial", price: 0, calls: 100, messages: 300 },
  starter: { label: "Starter", price: 9999, calls: 1000, messages: 3000 },
  growth: { label: "Growth", price: 19999, calls: 3000, messages: 9000 },
  enterprise: { label: "Pro", price: 34999, calls: 6000, messages: 18000 },
};
/** Charged per call above the plan's included calls */
export const OVERAGE_PER_CALL = 6;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_SCORES = ["hot", "warm", "cold"] as const;
export type LeadScore = (typeof LEAD_SCORES)[number];

export const VEHICLE_TYPES = ["bike", "scooter", "car"] as const;
export const FUEL_TYPES = ["petrol", "diesel", "cng", "ev", "hybrid"] as const;
export const TIMELINES = ["this_week", "this_month", "three_months_plus", "unknown"] as const;
export const PAYMENT_MODES = ["cash", "loan", "exchange", "unknown"] as const;

export const SERVICE_TYPES = ["free_service", "paid_service", "repair", "accident", "warranty"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const CALL_DIRECTIONS = ["inbound", "outbound", "web"] as const;

export const CALL_OUTCOMES = [
  "test_drive_booked",
  "service_booked",
  "lead_captured",
  "transferred",
  "callback_scheduled",
  "info_provided",
  "complaint_logged",
  "feedback_recorded",
  "opted_out",
  "wrong_number",
  "no_answer",
  "busy",
  "silence",
  "dropped",
  "failed",
  "other",
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const CAMPAIGN_TYPES = [
  "new_lead_followup",
  "cold_reengagement",
  "service_due",
  "insurance_expiry",
  "puc_expiry",
  "festive_offer",
  "booking_update",
  "feedback",
] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];

export const DEPARTMENTS = ["sales", "service", "insurance", "manager"] as const;
export type Department = (typeof DEPARTMENTS)[number];

/** Calling window for outbound calls (IST). TRAI guidance for promotional calls is 9am-9pm; we default stricter. */
export const DEFAULT_CALLING_HOURS = { start: "09:00", end: "20:00", timezone: "Asia/Kolkata" } as const;

export const COLD_REENGAGE_DAYS = [2, 7, 21] as const;
