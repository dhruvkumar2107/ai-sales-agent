export const LANGUAGES = ["en", "hi", "kn", "hinglish"] as const;
export type Language = (typeof LANGUAGES)[number];

export const ROLES = ["owner", "sales_manager", "sales_executive", "service_advisor"] as const;
export type Role = (typeof ROLES)[number];

export const LEAD_STAGES = ["new", "contacted", "test_drive_booked", "negotiation", "won", "lost"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_SOURCES = ["inbound_call", "whatsapp", "facebook", "instagram", "website", "walk_in", "campaign", "referral", "other"] as const;

/**
 * Plans sold to businesses (INR / month, GST extra). Billed on call minutes, the thing that actually costs money
 * (phone line + AI + voice ≈ ₹8 a minute at the default cost rates). At full use every plan keeps 55-70% of its
 * price after costs, and extra minutes keep 60%; light users keep far more.
 */
export const PLAN_IDS = ["trial", "starter", "growth", "enterprise"] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export const PLANS: Record<PlanId, { label: string; price: number; minutes: number; messages: number; pitch: string }> = {
  trial: { label: "Trial", price: 0, minutes: 30, messages: 100, pitch: "Free 30 minutes to try it" },
  starter: { label: "Starter", price: 2999, minutes: 100, messages: 300, pitch: "Small shop or clinic: ~40 calls a month" },
  growth: { label: "Growth", price: 6999, minutes: 300, messages: 1000, pitch: "Busy business: ~120 calls a month" },
  enterprise: { label: "Pro", price: 14999, minutes: 700, messages: 2500, pitch: "Multi-branch or high volume: ~280 calls a month" },
};
/** Charged per call minute above the plan's included minutes */
export const OVERAGE_PER_MINUTE = 20;
/** One-time setup fee per business (configuring the agent, numbers and WhatsApp); can be changed per business */
export const SETUP_FEE = 30000;
/** Payment gateway fee (Razorpay/Cashfree ≈ 2%), counted as a cost so partner profit is what actually reaches the bank */
export const PAYMENT_FEE_PERCENT = 2;
/** Profit split between the platform's partners, by default two equal partners */
export const DEFAULT_PARTNERS = [
  { name: "Partner 1", share: 50 },
  { name: "Partner 2", share: 50 },
];
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
  "appointment_booked",
  "order_taken",
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

// ---------- Any-business agents ----------

/** What the AI agent may do for a business. The admin ticks these when adding a firm; each one unlocks its tools. */
export const BUSINESS_ACTIONS = ["answer_questions", "capture_enquiry", "book_appointment", "take_order", "send_whatsapp_details", "transfer_to_staff", "complaints", "feedback"] as const;
export type BusinessAction = (typeof BUSINESS_ACTIONS)[number];

export const BUSINESS_ACTION_INFO: Record<BusinessAction, { label: string; hint: string }> = {
  answer_questions: { label: "Answer questions", hint: "Services, prices, timings and policies, only from what you write in Business knowledge" },
  capture_enquiry: { label: "Capture enquiries", hint: "Saves the customer's name, number and what they need as a lead" },
  book_appointment: { label: "Book appointments / visits", hint: "Takes the date, time and purpose; the team gets a task to confirm" },
  take_order: { label: "Take orders", hint: "Notes items, quantity and pickup or delivery for the team" },
  send_whatsapp_details: { label: "Send details on WhatsApp", hint: "Sends business details or the address and map link" },
  transfer_to_staff: { label: "Connect to a person", hint: "Transfers the call to staff, or books a callback when nobody is free" },
  complaints: { label: "Handle complaints", hint: "Logs a ticket and escalates angry customers" },
  feedback: { label: "Collect feedback", hint: "Asks for a rating out of 5" },
};

const CORE: BusinessAction[] = ["answer_questions", "capture_enquiry", "send_whatsapp_details", "transfer_to_staff"];

/** Business types offered in the admin panel, with the actions ticked by default and a starting point for Business knowledge. */
export const BUSINESS_TYPES: { id: string; label: string; actions: BusinessAction[]; example: string }[] = [
  { id: "clinic", label: "Clinic / doctor", actions: [...CORE, "book_appointment"], example: "Doctors: Dr. Mehta (General physician, Mon-Sat 10am-1pm)\nConsultation fee: ₹500\nWe don't give medical advice on the phone; emergencies should call 108." },
  { id: "dental", label: "Dental clinic", actions: [...CORE, "book_appointment"], example: "Services: check-up ₹300, cleaning ₹1,200, root canal from ₹4,500\nTimings: Mon-Sat 10am-8pm" },
  { id: "hospital", label: "Hospital / nursing home", actions: [...CORE, "book_appointment", "complaints"], example: "Departments: general medicine, orthopaedics, paediatrics\nOPD timings: 9am-5pm\nEmergency: 24x7" },
  { id: "diagnostic_lab", label: "Diagnostic lab", actions: [...CORE, "book_appointment"], example: "Tests: CBC ₹350, thyroid profile ₹600, full body check-up ₹1,999\nHome sample collection available" },
  { id: "salon_spa", label: "Salon / spa", actions: [...CORE, "book_appointment"], example: "Haircut: men ₹250, women ₹500\nFacial from ₹1,200\nOpen all days 10am-9pm" },
  { id: "gym_fitness", label: "Gym / fitness studio", actions: [...CORE, "book_appointment"], example: "Membership: monthly ₹1,500, quarterly ₹4,000, yearly ₹12,000\nFree trial class available\nTimings: 5am-10pm" },
  { id: "restaurant_cafe", label: "Restaurant / cafe", actions: [...CORE, "take_order", "book_appointment", "feedback"], example: "Cuisine: North Indian and Chinese\nTable booking for 2-20 people\nHome delivery within 5 km, minimum order ₹300\nOpen 11am-11pm" },
  { id: "hotel_homestay", label: "Hotel / homestay", actions: [...CORE, "book_appointment"], example: "Rooms: deluxe ₹3,500/night, suite ₹6,000/night (breakfast included)\nCheck-in 12pm, check-out 11am" },
  { id: "real_estate", label: "Real estate / builder", actions: [...CORE, "book_appointment"], example: "Project: Green Meadows, 2 and 3 BHK flats\n2 BHK from ₹65 lakh, 3 BHK from ₹92 lakh\nSite visits daily 10am-6pm" },
  { id: "coaching", label: "Coaching / tuition", actions: [...CORE, "book_appointment"], example: "Courses: JEE, NEET, class 9-12 tuition\nFees: JEE 2-year ₹1,20,000\nFree demo class every Saturday" },
  { id: "school_college", label: "School / college", actions: [...CORE, "book_appointment", "complaints"], example: "Admissions open for 2027\nClasses: nursery to 12 (CBSE)\nCampus visits Mon-Sat 9am-2pm" },
  { id: "retail_shop", label: "Shop / retail store", actions: [...CORE, "take_order"], example: "We sell: groceries, household items\nHome delivery within 3 km\nOpen 8am-10pm" },
  { id: "electronics", label: "Electronics / appliances", actions: [...CORE, "take_order", "complaints"], example: "Brands: Samsung, LG, Sony\nEMI available on cards\nRepairs and installation booked by the service team" },
  { id: "pharmacy", label: "Pharmacy / medical store", actions: [...CORE, "take_order"], example: "Home delivery of medicines within 5 km\nPrescription needed for prescription medicines\nOpen 24x7" },
  { id: "travel", label: "Travel agency", actions: [...CORE, "book_appointment"], example: "Packages: Goa 4 nights from ₹18,000 per person, Kashmir 6 nights from ₹32,000\nFlights, hotels and visas" },
  { id: "insurance_finance", label: "Insurance / loans", actions: [...CORE, "book_appointment"], example: "Products: health, life, motor insurance; home and personal loans\nNever quote a premium or rate; the advisor calls back" },
  { id: "professional", label: "CA / lawyer / consultant", actions: [...CORE, "book_appointment"], example: "Services: GST filing, income tax returns, company registration\nConsultation by appointment" },
  { id: "home_services", label: "Repairs / home services", actions: [...CORE, "book_appointment", "complaints"], example: "Services: AC repair, plumbing, electrician\nVisit charge ₹299 (adjusted in the bill)\nSame-day visits for bookings before 2pm" },
  { id: "events", label: "Events / weddings", actions: [...CORE, "book_appointment"], example: "Banquet hall for 100-800 guests\nCatering packages from ₹650 per plate\nVenue visits by appointment" },
  { id: "other", label: "Other business", actions: CORE, example: "" },
];
