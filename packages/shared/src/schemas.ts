import { z } from "zod";
import {
  BUSINESS_ACTIONS,
  CALL_DIRECTIONS,
  CALL_OUTCOMES,
  CAMPAIGN_TYPES,
  DEPARTMENTS,
  FUEL_TYPES,
  LANGUAGES,
  LEAD_SCORES,
  LEAD_SOURCES,
  LEAD_STAGES,
  PAYMENT_MODES,
  PLAN_IDS,
  ROLES,
  SERVICE_TYPES,
  TIMELINES,
  VEHICLE_TYPES,
} from "./constants";

const id = z.string().min(1);
const isoDate = z.string(); // ISO-8601 timestamp
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "HH:MM");
/** E.164 Indian number, e.g. +919845012345 */
export const phoneSchema = z.string().regex(/^\+?[1-9]\d{9,14}$/, "Invalid phone number");

// ---------- Organisation / tenancy ----------

export const workingHoursSchema = z.object({
  /** 0 = Sunday ... 6 = Saturday */
  days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5, 6]),
  open: hhmm.default("09:30"),
  close: hhmm.default("19:30"),
});
export type WorkingHours = z.infer<typeof workingHoursSchema>;

/** Controls the platform owner (super admin) sets per dealership. Dealers can read but not change these. */
export const orgPlatformSchema = z.object({
  features: z
    .object({
      voiceCalls: z.boolean().default(true),
      outboundCampaigns: z.boolean().default(true),
      whatsapp: z.boolean().default(true),
      /** WhatsApp thank-you + details after every answered call */
      postCallWhatsapp: z.boolean().default(true),
      /** AI replies to incoming WhatsApp messages */
      whatsappBot: z.boolean().default(true),
    })
    .default({}),
  /** 0 = unlimited */
  limits: z.object({ monthlyCalls: z.number().int().min(0).default(0), monthlyMessages: z.number().int().min(0).default(0) }).default({}),
  whatsapp: z
    .object({
      /** Meta WhatsApp Cloud API phone number id; empty = platform default number */
      phoneNumberId: z.string().default(""),
      displayNumber: z.string().default(""),
      /** Our template name -> approved Meta template name, for business-initiated messages */
      templates: z.record(z.string()).default({}),
      templateLanguage: z.string().default("en"),
    })
    .default({}),
  calling: z
    .object({
      /** Number shown to customers on outbound calls (must belong to the telephony account); empty = platform default */
      callerId: z.string().default(""),
    })
    .default({}),
  contact: z.object({ name: z.string().default(""), phone: z.string().default(""), email: z.string().default("") }).default({}),
  /** Monthly price override in INR; 0 = plan list price */
  monthlyPrice: z.number().min(0).default(0),
  notes: z.string().default(""),
});
export type OrgPlatform = z.infer<typeof orgPlatformSchema>;

/** What the agent knows and may do for a non-showroom business. Present = the org uses the any-business agent. */
export const businessProfileSchema = z.object({
  /** BUSINESS_TYPES id */
  type: z.string().default("other"),
  /** What the agent calls the business type on calls, e.g. "dental clinic" */
  typeLabel: z.string().default(""),
  /** What the firm does, in a few sentences */
  description: z.string().default(""),
  /** Services, prices, FAQs and policies: the agent's only source of facts */
  knowledge: z.string().default(""),
  actions: z.array(z.enum(BUSINESS_ACTIONS)).default(["answer_questions", "capture_enquiry", "send_whatsapp_details", "transfer_to_staff"]),
  address: z.string().default(""),
  mapLink: z.string().default(""),
  timings: z.string().default(""),
  /** Where live transfers and new-request alerts go when no team member has a phone */
  staffPhone: z.string().default(""),
});
export type BusinessProfile = z.infer<typeof businessProfileSchema>;

export const orgSchema = z.object({
  id,
  name: z.string().min(1),
  /** Display name the agent uses on calls */
  showroomName: z.string().min(1),
  brands: z.array(z.string()).default([]),
  timezone: z.string().default("Asia/Kolkata"),
  createdAt: isoDate,
  plan: z.enum(PLAN_IDS).default("trial"),
  status: z.enum(["active", "suspended"]).default("active"),
  platform: orgPlatformSchema.default({}),
  business: businessProfileSchema.optional(),
});
export type Org = z.infer<typeof orgSchema>;

export const memberSchema = z.object({
  id, // Firebase uid
  orgId: id,
  email: z.string().email(),
  name: z.string(),
  role: z.enum(ROLES),
  phone: z.string().optional(),
  branchIds: z.array(z.string()).default([]),
  departments: z.array(z.enum(DEPARTMENTS)).default(["sales"]),
  /** Brands/models this executive specialises in, used for auto-assign */
  modelFocus: z.array(z.string()).default([]),
  available: z.boolean().default(true),
  createdAt: isoDate,
});
export type Member = z.infer<typeof memberSchema>;

export const branchSchema = z.object({
  id,
  orgId: id,
  name: z.string().min(1),
  address: z.string().default(""),
  city: z.string().default(""),
  mapLink: z.string().default(""),
  phone: z.string().default(""),
  workingHours: workingHoursSchema.default({}),
  testDriveSlotMinutes: z.number().int().min(15).max(180).default(30),
  serviceSlotMinutes: z.number().int().min(15).max(240).default(60),
  /** Max concurrent service jobs per slot */
  serviceBays: z.number().int().min(1).default(4),
  transferNumbers: z
    .object({
      sales: z.string().default(""),
      service: z.string().default(""),
      manager: z.string().default(""),
      insurance: z.string().default(""),
    })
    .default({}),
  holidays: z.array(z.string()).default([]), // YYYY-MM-DD
});
export type Branch = z.infer<typeof branchSchema>;

// ---------- Catalog ----------

export const variantSchema = z.object({
  name: z.string(),
  fuel: z.enum(FUEL_TYPES),
  transmission: z.enum(["manual", "automatic", "amt", "cvt", "dct", "na"]).default("manual"),
  exShowroomPrice: z.number().nonnegative(),
  onRoadMin: z.number().nonnegative().optional(),
  onRoadMax: z.number().nonnegative().optional(),
  inStock: z.boolean().optional(),
});
export type Variant = z.infer<typeof variantSchema>;

export const catalogModelSchema = z.object({
  id,
  orgId: id,
  brand: z.string(),
  model: z.string(),
  type: z.enum(VEHICLE_TYPES),
  variants: z.array(variantSchema).min(1),
  colors: z.array(z.string()).default([]),
  keyFeatures: z.array(z.string()).default([]),
  brochureUrl: z.string().default(""),
  /** Approved comparison talking points (never badmouth competitors) */
  talkingPoints: z.array(z.string()).default([]),
  active: z.boolean().default(true),
  /** Search keywords incl. transliterations (e.g. "क्रेटा", "kreta") */
  aliases: z.array(z.string()).default([]),
});
export type CatalogModel = z.infer<typeof catalogModelSchema>;

export const offerSchema = z.object({
  id,
  orgId: id,
  title: z.string(),
  description: z.string(),
  models: z.array(z.string()).default([]), // empty = all models
  validFrom: z.string(),
  validTo: z.string(),
  active: z.boolean().default(true),
});
export type Offer = z.infer<typeof offerSchema>;

export const testDriveVehicleSchema = z.object({
  id,
  orgId: id,
  branchId: id,
  model: z.string(),
  variant: z.string().default(""),
  registrationNo: z.string().default(""),
  active: z.boolean().default(true),
});
export type TestDriveVehicle = z.infer<typeof testDriveVehicleSchema>;

export const serviceTypeConfigSchema = z.object({
  type: z.enum(SERVICE_TYPES),
  label: z.string(),
  durationMinutes: z.number().int().default(60),
  description: z.string().default(""),
});

// ---------- Settings ----------

export const emiDefaultsSchema = z.object({
  interestRate: z.number().min(0).max(40).default(9.5),
  tenureMonths: z.number().int().min(6).max(96).default(60),
  downPaymentPercent: z.number().min(0).max(100).default(20),
});
export type EmiDefaults = z.infer<typeof emiDefaultsSchema>;

export const agentConfigSchema = z.object({
  id,
  orgId: id,
  name: z.string(), // e.g. "Priya"
  kind: z.enum(["sales", "service", "combined"]).default("combined"),
  languages: z.array(z.enum(LANGUAGES)).default(["en", "hi"]),
  defaultLanguage: z.enum(LANGUAGES).default("en"),
  greeting: z.record(z.string()).default({}), // per-language greeting override
  recordingDisclosure: z
    .record(z.string())
    .default({ en: "This call may be recorded for quality purposes." }),
  extraInstructions: z.string().default(""),
  voices: z.record(z.string()).default({}), // language -> provider voice id
  phoneNumbers: z.array(z.string()).default([]),
  active: z.boolean().default(true),
});
export type AgentConfig = z.infer<typeof agentConfigSchema>;

export const orgSettingsSchema = z.object({
  orgId: id,
  emi: emiDefaultsSchema.default({}),
  callingHours: z
    .object({ start: hhmm.default("09:00"), end: hhmm.default("20:00") })
    .default({}),
  maxCallAttempts: z.number().int().min(1).max(6).default(3),
  recordCalls: z.boolean().default(true),
  /** DPDP: days to retain recordings and transcripts, 0 = do not keep */
  retentionDays: z.object({ recordings: z.number().int().default(90), transcripts: z.number().int().default(365) }).default({}),
  serviceTypes: z.array(serviceTypeConfigSchema).default([]),
  /** Encrypted provider keys (AES-GCM, base64). Never returned in plaintext. */
  secrets: z.record(z.string()).default({}),
  webhooks: z
    .object({
      dmsBaseUrl: z.string().default(""),
      dmsAuthHeader: z.string().default(""), // encrypted
      leadIntakeSecret: z.string().default(""), // HMAC secret for inbound lead webhooks
      outboundEventsUrl: z.string().default(""),
    })
    .default({}),
  googleCalendarId: z.string().default(""),
  messaging: z.object({ channel: z.enum(["whatsapp", "sms", "both"]).default("whatsapp") }).default({}),
});
export type OrgSettings = z.infer<typeof orgSettingsSchema>;

// ---------- Leads ----------

export const exchangeVehicleSchema = z.object({
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.number().int().optional(),
  kilometres: z.number().int().optional(),
  condition: z.string().optional(),
});

export const leadFieldsSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  city: z.string().optional(),
  vehicleType: z.enum(VEHICLE_TYPES).optional(),
  interestedModel: z.string().optional(),
  variant: z.string().optional(),
  fuel: z.enum(FUEL_TYPES).optional(),
  budget: z.number().optional(), // rupees
  newOrUsed: z.enum(["new", "used"]).optional(),
  timeline: z.enum(TIMELINES).optional(),
  paymentMode: z.enum(PAYMENT_MODES).optional(),
  hasExchange: z.boolean().optional(),
  exchangeVehicle: exchangeVehicleSchema.optional(),
  buyingIntent: z.enum(["buy_today", "visiting_today", "researching", "unknown"]).optional(),
  notes: z.string().optional(),
});
export type LeadFields = z.infer<typeof leadFieldsSchema>;

export const leadSchema = leadFieldsSchema.extend({
  id,
  orgId: id,
  phone: z.string(),
  branchId: z.string().optional(),
  stage: z.enum(LEAD_STAGES).default("new"),
  score: z.enum(LEAD_SCORES).default("cold"),
  scoreValue: z.number().default(0),
  source: z.enum(LEAD_SOURCES).default("other"),
  assignedTo: z.string().optional(),
  language: z.enum(LANGUAGES).optional(),
  notesLog: z.array(z.object({ at: isoDate, by: z.string(), text: z.string() })).default([]),
  createdAt: isoDate,
  updatedAt: isoDate,
  firstContactedAt: z.string().optional(),
  lastCallId: z.string().optional(),
  optedOut: z.boolean().default(false),
  revenue: z.number().optional(), // filled when won
});
export type Lead = z.infer<typeof leadSchema>;

// ---------- Bookings ----------

export const testDriveSchema = z.object({
  id,
  orgId: id,
  branchId: id,
  leadId: z.string().optional(),
  customerName: z.string(),
  phone: z.string(),
  model: z.string(),
  variant: z.string().optional(),
  start: isoDate,
  end: isoDate,
  vehicleId: z.string().optional(),
  status: z.enum(["booked", "completed", "no_show", "cancelled"]).default("booked"),
  homeTestDrive: z.boolean().default(false),
  createdAt: isoDate,
  calendarEventId: z.string().optional(),
});
export type TestDrive = z.infer<typeof testDriveSchema>;

export const serviceBookingSchema = z.object({
  id,
  orgId: id,
  branchId: id,
  customerName: z.string(),
  phone: z.string(),
  vehicleNo: z.string(),
  model: z.string(),
  kilometres: z.number().int().optional(),
  serviceType: z.enum(SERVICE_TYPES),
  pickupDrop: z.boolean().default(false),
  start: isoDate,
  end: isoDate,
  status: z.enum(["booked", "in_progress", "ready", "delivered", "cancelled", "no_show"]).default("booked"),
  jobCardNo: z.string().optional(),
  estimatedReadyAt: z.string().optional(),
  createdAt: isoDate,
  revenue: z.number().optional(),
});
export type ServiceBooking = z.infer<typeof serviceBookingSchema>;

export const vehicleBookingSchema = z.object({
  id,
  orgId: id,
  leadId: z.string().optional(),
  customerName: z.string(),
  phone: z.string(),
  model: z.string(),
  variant: z.string().optional(),
  color: z.string().optional(),
  status: z.enum(["booked", "allotted", "documents_pending", "delivery_scheduled", "delivered", "cancelled"]),
  deliveryDate: z.string().optional(),
  pendingDocuments: z.array(z.string()).default([]),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type VehicleBooking = z.infer<typeof vehicleBookingSchema>;

/** Customer vehicles for service / insurance / PUC reminders */
export const customerVehicleSchema = z.object({
  id,
  orgId: id,
  customerName: z.string(),
  phone: z.string(),
  vehicleNo: z.string(),
  model: z.string(),
  branchId: z.string().optional(),
  lastServiceDate: z.string().optional(),
  lastServiceKm: z.number().optional(),
  avgKmPerMonth: z.number().optional(),
  nextServiceDue: z.string().optional(),
  insuranceExpiry: z.string().optional(),
  pucExpiry: z.string().optional(),
});
export type CustomerVehicle = z.infer<typeof customerVehicleSchema>;

export const ticketSchema = z.object({
  id,
  orgId: id,
  callId: z.string().optional(),
  phone: z.string(),
  customerName: z.string().optional(),
  vehicleNo: z.string().optional(),
  category: z.enum(["service_quality", "delay", "billing", "staff_behaviour", "safety", "sales", "other"]),
  description: z.string(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  status: z.enum(["open", "in_progress", "resolved"]).default("open"),
  assignedTo: z.string().optional(),
  createdAt: isoDate,
});
export type Ticket = z.infer<typeof ticketSchema>;

export const callbackTaskSchema = z.object({
  id,
  orgId: id,
  phone: z.string(),
  customerName: z.string().optional(),
  department: z.enum(DEPARTMENTS),
  reason: z.string(),
  priority: z.enum(["instant", "high", "normal"]),
  assignedTo: z.string().optional(),
  dueAt: isoDate,
  status: z.enum(["pending", "done"]).default("pending"),
  callId: z.string().optional(),
  createdAt: isoDate,
});
export type CallbackTask = z.infer<typeof callbackTaskSchema>;

// ---------- Calls ----------

export const turnLatencySchema = z.object({
  turn: z.number().int(),
  /** end of caller speech -> final transcript */
  sttMs: z.number().optional(),
  /** final transcript -> first LLM token */
  llmFirstTokenMs: z.number().optional(),
  /** first sentence ready -> first TTS audio byte */
  ttsFirstByteMs: z.number().optional(),
  /** end of caller speech -> first agent audio sent */
  firstAudioMs: z.number(),
});
export type TurnLatency = z.infer<typeof turnLatencySchema>;

export const transcriptEntrySchema = z.object({
  role: z.enum(["agent", "caller", "tool", "system"]),
  text: z.string(),
  at: isoDate,
  language: z.string().optional(),
  interrupted: z.boolean().optional(),
  tool: z.string().optional(),
});
export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>;

export const callCostSchema = z.object({
  telephony: z.number().default(0),
  stt: z.number().default(0),
  tts: z.number().default(0),
  llm: z.number().default(0),
  messaging: z.number().default(0),
  total: z.number().default(0),
  currency: z.literal("INR").default("INR"),
});
export type CallCost = z.infer<typeof callCostSchema>;

export const callSchema = z.object({
  id,
  orgId: id,
  agentId: z.string().optional(),
  direction: z.enum(CALL_DIRECTIONS),
  provider: z.string(),
  providerCallId: z.string().optional(),
  from: z.string(), // stored masked in logs, full in DB (needed for callbacks)
  to: z.string(),
  campaignId: z.string().optional(),
  leadId: z.string().optional(),
  startedAt: isoDate,
  endedAt: z.string().optional(),
  durationSec: z.number().default(0),
  status: z.enum(["queued", "ringing", "in_progress", "completed", "failed", "no_answer", "busy"]).default("in_progress"),
  outcome: z.enum(CALL_OUTCOMES).optional(),
  language: z.enum(LANGUAGES).optional(),
  recordingConsent: z.boolean().default(true),
  recordingPath: z.string().optional(), // encrypted object path
  transcript: z.array(transcriptEntrySchema).default([]),
  summary: z.string().optional(),
  sentiment: z.enum(["positive", "neutral", "negative", "angry"]).optional(),
  extracted: leadFieldsSchema.default({}),
  leadScore: z.enum(LEAD_SCORES).optional(),
  latency: z.array(turnLatencySchema).default([]),
  avgFirstAudioMs: z.number().optional(),
  toolCalls: z.array(z.object({ name: z.string(), ok: z.boolean(), ms: z.number(), at: isoDate })).default([]),
  cost: callCostSchema.default({}),
  usage: z
    .object({
      sttSeconds: z.number().default(0),
      ttsChars: z.number().default(0),
      llmInputTokens: z.number().default(0),
      llmOutputTokens: z.number().default(0),
      messages: z.number().default(0),
    })
    .default({}),
  transferredTo: z.string().optional(),
  missedCallRecovered: z.boolean().optional(),
});
export type Call = z.infer<typeof callSchema>;

// ---------- Campaigns ----------

export const campaignSchema = z.object({
  id,
  orgId: id,
  name: z.string(),
  type: z.enum(CAMPAIGN_TYPES),
  agentId: z.string().optional(),
  status: z.enum(["draft", "running", "paused", "completed"]).default("draft"),
  /** Extra context for the agent, e.g. festive offer details */
  script: z.string().default(""),
  maxAttempts: z.number().int().min(1).max(6).default(3),
  retryMinutes: z.array(z.number().int()).default([30, 120, 1440]),
  concurrency: z.number().int().min(1).max(50).default(3),
  createdAt: isoDate,
  stats: z
    .object({
      total: z.number().default(0),
      queued: z.number().default(0),
      completed: z.number().default(0),
      connected: z.number().default(0),
      failed: z.number().default(0),
      optedOut: z.number().default(0),
      skippedDnd: z.number().default(0),
    })
    .default({}),
});
export type Campaign = z.infer<typeof campaignSchema>;

export const campaignContactSchema = z.object({
  id,
  orgId: id,
  campaignId: id,
  phone: z.string(),
  name: z.string().optional(),
  data: z.record(z.string()).default({}),
  status: z.enum(["pending", "queued", "calling", "completed", "failed", "skipped_dnd", "opted_out"]).default("pending"),
  attempts: z.number().int().default(0),
  lastAttemptAt: z.string().optional(),
  nextAttemptAt: z.string().optional(),
  lastOutcome: z.string().optional(),
  callIds: z.array(z.string()).default([]),
});
export type CampaignContact = z.infer<typeof campaignContactSchema>;

export const optOutSchema = z.object({
  id, // normalised phone
  orgId: id,
  phone: z.string(),
  reason: z.string().default("caller_request"),
  createdAt: isoDate,
});
export type OptOut = z.infer<typeof optOutSchema>;

// ---------- API payloads ----------

export const newLeadWebhookSchema = z.object({
  name: z.string().optional(),
  phone: z.string().min(10),
  source: z.enum(LEAD_SOURCES).default("website"),
  interestedModel: z.string().optional(),
  city: z.string().optional(),
  branchId: z.string().optional(),
  notes: z.string().optional(),
});
export type NewLeadWebhook = z.infer<typeof newLeadWebhookSchema>;

// ---------------------------------------------------------------- WhatsApp / SMS

export const messageSchema = z.object({
  id,
  orgId: id,
  channel: z.enum(["whatsapp", "sms"]),
  direction: z.enum(["out", "in"]),
  /** Customer (or staff) number */
  phone: z.string(),
  body: z.string(),
  template: z.string().optional(),
  status: z.enum(["sent", "logged", "failed", "blocked", "received"]),
  error: z.string().optional(),
  providerId: z.string().optional(),
  callId: z.string().optional(),
  conversationId: z.string().optional(),
  /** customer = to/from a customer; internal = staff alert (hot lead etc.) */
  audience: z.enum(["customer", "internal"]).default("customer"),
  /** Who wrote it: the AI agent, a staff member from the dashboard, the system (templates), or the customer */
  author: z.enum(["ai", "staff", "system", "customer"]).default("system"),
  createdAt: isoDate,
});
export type Message = z.infer<typeof messageSchema>;

export const conversationSchema = z.object({
  id, // wa_<digits>
  orgId: id,
  phone: z.string(),
  customerName: z.string().optional(),
  agentId: z.string().optional(),
  leadId: z.string().optional(),
  /** LLM history (canonical message blocks), trimmed */
  history: z.array(z.any()).default([]),
  /** AI answers incoming messages; staff can switch it off to take over */
  botEnabled: z.boolean().default(true),
  lastMessageAt: isoDate,
  /** Last customer message: Meta allows free-form replies within 24 h of it */
  lastInboundAt: z.string().optional(),
  lastPreview: z.string().default(""),
  messageCount: z.number().int().default(0),
  unread: z.number().int().default(0),
  /** Summary of the latest phone call, so the chat continues where the call left off */
  callContext: z.string().optional(),
  createdAt: isoDate,
});
export type Conversation = z.infer<typeof conversationSchema>;

export const catalogCsvRowSchema = z.object({
  brand: z.string().min(1),
  model: z.string().min(1),
  type: z.enum(VEHICLE_TYPES),
  variant: z.string().min(1),
  fuel: z.enum(FUEL_TYPES),
  transmission: z.enum(["manual", "automatic", "amt", "cvt", "dct", "na"]).default("manual"),
  ex_showroom_price: z.coerce.number().nonnegative(),
  on_road_min: z.coerce.number().nonnegative().optional(),
  on_road_max: z.coerce.number().nonnegative().optional(),
  colors: z.string().optional(),
  key_features: z.string().optional(),
  brochure_url: z.string().optional(),
  aliases: z.string().optional(),
  talking_points: z.string().optional(),
});
export type CatalogCsvRow = z.infer<typeof catalogCsvRowSchema>;
