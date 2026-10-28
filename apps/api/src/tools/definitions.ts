import { z } from "zod";
import { CALL_OUTCOMES, DEPARTMENTS, FUEL_TYPES, SERVICE_TYPES, VEHICLE_TYPES, type Branch, type Member } from "@axo/shared";
import { availableSlots, normalizeDate, normalizeTime } from "../bookings/slots";
import { istToDate } from "../compliance/calling-hours";
import { recordOptOut } from "../compliance/dnd";
import { newId, nowIso } from "../db/repo";
import { createCalendarEvent } from "../integrations/google-calendar";
import { lookupJobCard, lookupVehicleBookings, pushDmsEvent } from "../integrations/dms";
import { bus } from "../lib/events";
import { normalizePhone } from "../lib/mask";
import { upsertLead } from "../leads/service";
import { locationVars, modelDetailsVars } from "../messaging/content";
import { sendOrgMessage } from "../messaging/service";
import type { TemplateName } from "../providers/messaging";
import { jobQueue } from "../queue";
import { findModel, searchCatalog } from "./catalog";
import { calculateEmi } from "./emi";
import { defineTool, type ToolContext, type ToolDefinition } from "./types";

const lakhs = (n: number) => `${(n / 1_00_000).toFixed(2).replace(/\.?0+$/, "")} lakh`;

async function pickBranch(ctx: ToolContext, kind: "sales" | "service", branchId?: string, model?: string): Promise<Branch | null> {
  const branches = await ctx.repo.branches.list();
  if (branchId) return branches.find((b) => b.id === branchId || b.name.toLowerCase().includes(branchId.toLowerCase())) ?? null;
  if (kind === "service") return branches.find((b) => /service/i.test(b.name)) ?? branches[0] ?? null;
  if (model) {
    const tdv = (await ctx.repo.testDriveVehicles.list()).find((v) => v.active && v.model.toLowerCase() === model.toLowerCase());
    if (tdv) return branches.find((b) => b.id === tdv.branchId) ?? null;
  }
  return branches.find((b) => !/service/i.test(b.name)) ?? branches[0] ?? null;
}

async function notify(ctx: ToolContext, phone: string, template: TemplateName, vars: Record<string, string | undefined>) {
  const settings = await ctx.repo.settings();
  const channel = settings.messaging.channel === "sms" ? "sms" : "whatsapp";
  const base = { orgId: ctx.orgId, to: phone, template, vars, language: ctx.language, callId: ctx.callId };
  const res = await sendOrgMessage({ ...base, channel });
  if (res.ok) ctx.countMessage();
  if (settings.messaging.channel === "both") {
    const sms = await sendOrgMessage({ ...base, channel: "sms" });
    if (sms.ok) ctx.countMessage();
  }
  return res.ok;
}

/** Staff heads-up (hot lead / callback due) by SMS; logged as an internal message. */
const alertStaff = (ctx: ToolContext, to: string, vars: Record<string, string | undefined>) =>
  sendOrgMessage({ orgId: ctx.orgId, to, channel: "sms", template: "exec_hot_lead", vars, callId: ctx.callId, audience: "internal" });

// ---------------------------------------------------------------- catalog

export const searchCatalogTool = defineTool({
  name: "search_catalog",
  description: "Search the showroom catalog by need, budget and fuel. Use to recommend models. Returns ex-showroom price ranges in rupees.",
  schema: z.object({
    query: z.string().describe("What the caller wants, e.g. 'family SUV automatic' or 'mileage scooter'"),
    filters: z
      .object({
        type: z.enum(VEHICLE_TYPES).optional(),
        fuel: z.enum(FUEL_TYPES).optional(),
        max_price: z.number().optional().describe("Max ex-showroom budget in rupees"),
        min_price: z.number().optional(),
        transmission: z.string().optional(),
      })
      .optional(),
  }),
  async run(input, ctx) {
    const f = input.filters ?? {};
    const results = searchCatalog(await ctx.repo.catalog.list(), input.query, { type: f.type, fuel: f.fuel, maxPrice: f.max_price, minPrice: f.min_price, transmission: f.transmission });
    return { results, count: results.length, note: results.length ? "Recommend at most two." : "Nothing matches; offer a sales team callback." };
  },
});

export const getModelDetails = defineTool({
  name: "get_model_details",
  description: "Get variants, ex-showroom and on-road price ranges, colours, features, brochure, live offers and approved comparison talking points for one model.",
  schema: z.object({ model: z.string().describe("Model name as the caller said it") }),
  async run(input, ctx) {
    const m = findModel(await ctx.repo.catalog.list(), input.model);
    if (!m) return { found: false, note: "Model not in catalog. Do not guess; offer a sales team callback." };
    const today = new Date().toISOString().slice(0, 10);
    const offers = (await ctx.repo.offers.list()).filter((o) => o.active && o.validFrom <= today && o.validTo >= today && (!o.models.length || o.models.some((x) => x.toLowerCase() === m.model.toLowerCase())));
    return {
      found: true,
      brand: m.brand,
      model: m.model,
      type: m.type,
      variants: m.variants.map((v) => ({ name: v.name, fuel: v.fuel, transmission: v.transmission, exShowroomPrice: v.exShowroomPrice, onRoadMin: v.onRoadMin, onRoadMax: v.onRoadMax, spoken: `${lakhs(v.exShowroomPrice)} ex-showroom${v.onRoadMin && v.onRoadMax ? `, ${lakhs(v.onRoadMin)} to ${lakhs(v.onRoadMax)} on-road` : ""}`, inStock: v.inStock })),
      colors: m.colors,
      keyFeatures: m.keyFeatures,
      brochureUrl: m.brochureUrl || undefined,
      offers: offers.map((o) => ({ title: o.title, description: o.description, validTo: o.validTo })),
      talkingPoints: m.talkingPoints,
      priceNote: "Prices are indicative. Final price depends on showroom confirmation.",
    };
  },
});

export const calculateEmiTool = defineTool({
  name: "calculate_emi",
  description: "Estimate monthly EMI. Use the on-road (or ex-showroom) price from get_model_details. Down payment, tenure and rate default to the dealership's configured values.",
  schema: z.object({
    price: z.number().positive().describe("Vehicle price in rupees"),
    down_payment: z.number().nonnegative().optional().describe("Rupees"),
    tenure_months: z.number().int().min(6).max(96).optional(),
    interest_rate: z.number().min(0).max(30).optional().describe("Annual percent"),
  }),
  async run(input, ctx) {
    const d = (await ctx.repo.settings()).emi;
    const downPayment = input.down_payment ?? Math.round((input.price * d.downPaymentPercent) / 100);
    const tenureMonths = input.tenure_months ?? d.tenureMonths;
    const interestRate = input.interest_rate ?? d.interestRate;
    const r = calculateEmi({ price: input.price, downPayment, tenureMonths, annualRate: interestRate });
    return { ...r, price: input.price, downPayment, tenureMonths, interestRate, note: "Estimate only. Final EMI, rate and approval depend on the bank or NBFC." };
  },
});

// ---------------------------------------------------------------- test drives

export const checkTestDriveSlots = defineTool({
  name: "check_testdrive_slots",
  description: "Check free test drive slots for a model at a branch on a date (YYYY-MM-DD, 'today' or 'tomorrow'). Returns IST times.",
  schema: z.object({ model: z.string(), branch_id: z.string().optional(), date: z.string() }),
  async run(input, ctx) {
    const m = findModel(await ctx.repo.catalog.list(), input.model);
    if (!m) return { error: "unknown_model", spoken: "Say you couldn't find that model and offer a sales callback." };
    const date = normalizeDate(input.date);
    if (!date) return { error: "invalid_date", details: "Use YYYY-MM-DD" };
    const branch = await pickBranch(ctx, "sales", input.branch_id, m.model);
    if (!branch) return { error: "no_branch" };
    const vehicles = (await ctx.repo.testDriveVehicles.list({ where: { branchId: branch.id } })).filter((v) => v.active && v.model.toLowerCase() === m.model.toLowerCase());
    if (!vehicles.length) {
      const others = (await ctx.repo.testDriveVehicles.list()).filter((v) => v.active && v.model.toLowerCase() === m.model.toLowerCase()).map((v) => v.branchId);
      return { available: false, reason: `No ${m.model} demo vehicle at ${branch.name}`, otherBranchIds: [...new Set(others)] };
    }
    const booked = (await ctx.repo.testDrives.list({ where: { branchId: branch.id } })).filter((t) => t.status === "booked" && t.model.toLowerCase() === m.model.toLowerCase() && t.start.slice(0, 10) >= date);
    const slots = availableSlots({ date, workingHours: branch.workingHours, slotMinutes: branch.testDriveSlotMinutes, capacity: vehicles.length, booked, holidays: branch.holidays, leadMinutes: 60 });
    return { model: m.model, date, branchId: branch.id, branchName: branch.name, slots: slots.slice(0, 8), totalFree: slots.length, note: slots.length ? "Offer two options." : "Fully booked; suggest another day." };
  },
});

export const bookTestDrive = defineTool({
  name: "book_testdrive",
  description: "Book a test drive after the caller confirmed name, phone, model, date and time. Sends WhatsApp/SMS confirmation with address and map, and a reminder 2 hours before.",
  schema: z.object({
    model: z.string(),
    variant: z.string().optional(),
    date: z.string().describe("YYYY-MM-DD"),
    time: z.string().describe("HH:MM 24h IST"),
    customer_name: z.string(),
    phone: z.string().optional().describe("Defaults to the caller's number"),
    branch_id: z.string().optional(),
    home_test_drive: z.boolean().optional(),
  }),
  timeoutMs: 6000,
  async run(input, ctx) {
    const m = findModel(await ctx.repo.catalog.list(), input.model);
    if (!m) return { error: "unknown_model" };
    const date = normalizeDate(input.date);
    const time = normalizeTime(input.time);
    if (!date || !time) return { error: "invalid_date_or_time" };
    const branch = await pickBranch(ctx, "sales", input.branch_id, m.model);
    if (!branch) return { error: "no_branch" };
    const vehicles = (await ctx.repo.testDriveVehicles.list({ where: { branchId: branch.id } })).filter((v) => v.active && v.model.toLowerCase() === m.model.toLowerCase());
    const existing = (await ctx.repo.testDrives.list({ where: { branchId: branch.id } })).filter((t) => t.status === "booked" && t.model.toLowerCase() === m.model.toLowerCase());
    // Validate on a 15-minute grid so callers can pick any reasonable time, not only offered slots.
    const free = availableSlots({ date, workingHours: branch.workingHours, slotMinutes: 15, durationMinutes: branch.testDriveSlotMinutes, capacity: vehicles.length, booked: existing, holidays: branch.holidays, leadMinutes: 30 });
    if (!free.includes(time)) return { booked: false, reason: "slot_unavailable", alternatives: free.slice(0, 3) };

    const phone = normalizePhone(input.phone || ctx.callerPhone);
    const start = istToDate(date, time);
    const end = new Date(start.getTime() + branch.testDriveSlotMinutes * 60_000);
    const usedVehicleIds = new Set(existing.filter((t) => new Date(t.start) < end && new Date(t.end) > start).map((t) => t.vehicleId));
    const vehicle = vehicles.find((v) => !usedVehicleIds.has(v.id));
    const { lead } = await upsertLead(ctx.orgId, { phone, name: input.customer_name, interestedModel: m.model, variant: input.variant, branchId: branch.id, testDriveBooked: true, note: `Test drive booked for ${date} ${time}` });
    const td = {
      id: newId("td_"),
      orgId: ctx.orgId,
      branchId: branch.id,
      leadId: lead.id,
      customerName: input.customer_name,
      phone,
      model: m.model,
      variant: input.variant,
      start: start.toISOString(),
      end: end.toISOString(),
      vehicleId: vehicle?.id,
      status: "booked" as const,
      homeTestDrive: input.home_test_drive ?? false,
      createdAt: nowIso(),
      calendarEventId: undefined as string | undefined,
    };
    const settings = await ctx.repo.settings();
    td.calendarEventId = (await createCalendarEvent(settings.googleCalendarId, { summary: `Test drive: ${m.model} - ${input.customer_name}`, description: `Phone: ${phone}\nBooked by AI agent (call ${ctx.callId})`, start: td.start, end: td.end, location: branch.address })) ?? undefined;
    await ctx.repo.testDrives.set(td);

    const vars = { name: input.customer_name, model: m.model, showroom: ctx.org.showroomName, branch: branch.name, date, time, address: branch.address, map: branch.mapLink };
    const confirmationSent = await notify(ctx, phone, "testdrive_confirmation", vars);
    const reminderAt = start.getTime() - 2 * 3600_000;
    if (reminderAt > Date.now()) {
      await jobQueue().add("send-message", { orgId: ctx.orgId, to: phone, template: "testdrive_reminder", vars, language: ctx.language }, { delayMs: reminderAt - Date.now(), jobId: `td-reminder:${td.id}` });
    }
    bus.emitEvent("testdrive.booked", { orgId: ctx.orgId, testDriveId: td.id });
    void pushDmsEvent(ctx.orgId, "testdrive.booked", td);
    return { booked: true, id: td.id, model: m.model, date, time, branchName: branch.name, address: branch.address, confirmationSent, reminder: "2 hours before" };
  },
});

// ---------------------------------------------------------------- service

export const checkServiceSlots = defineTool({
  name: "check_service_slots",
  description: "Check free service appointment slots at a service branch on a date (YYYY-MM-DD, 'today' or 'tomorrow').",
  schema: z.object({ branch_id: z.string().optional(), date: z.string(), service_type: z.enum(SERVICE_TYPES).optional() }),
  async run(input, ctx) {
    const date = normalizeDate(input.date);
    if (!date) return { error: "invalid_date" };
    const branch = await pickBranch(ctx, "service", input.branch_id);
    if (!branch) return { error: "no_branch" };
    const booked = (await ctx.repo.serviceBookings.list({ where: { branchId: branch.id } })).filter((b) => !["cancelled", "delivered"].includes(b.status) && b.start.slice(0, 10) >= date);
    const slots = availableSlots({ date, workingHours: branch.workingHours, slotMinutes: branch.serviceSlotMinutes, capacity: branch.serviceBays, booked, holidays: branch.holidays, leadMinutes: 90 });
    return { date, branchId: branch.id, branchName: branch.name, slots: slots.slice(0, 8), totalFree: slots.length };
  },
});

export const bookService = defineTool({
  name: "book_service",
  description: "Book a service appointment after confirming vehicle number, model, kilometres, service type, pickup/drop, date and time. Sends a confirmation.",
  schema: z.object({
    vehicle_no: z.string(),
    model: z.string(),
    kilometres: z.number().int().nonnegative().optional(),
    service_type: z.enum(SERVICE_TYPES),
    pickup_drop: z.boolean().optional(),
    date: z.string(),
    time: z.string(),
    customer_name: z.string(),
    phone: z.string().optional(),
    branch_id: z.string().optional(),
  }),
  timeoutMs: 6000,
  async run(input, ctx) {
    const date = normalizeDate(input.date);
    const time = normalizeTime(input.time);
    if (!date || !time) return { error: "invalid_date_or_time" };
    const branch = await pickBranch(ctx, "service", input.branch_id);
    if (!branch) return { error: "no_branch" };
    const booked = (await ctx.repo.serviceBookings.list({ where: { branchId: branch.id } })).filter((b) => !["cancelled", "delivered"].includes(b.status));
    const free = availableSlots({ date, workingHours: branch.workingHours, slotMinutes: 15, durationMinutes: branch.serviceSlotMinutes, capacity: branch.serviceBays, booked, holidays: branch.holidays, leadMinutes: 30 });
    if (!free.includes(time)) return { booked: false, reason: "slot_unavailable", alternatives: free.slice(0, 3) };
    const phone = normalizePhone(input.phone || ctx.callerPhone);
    const start = istToDate(date, time);
    const vehicleNo = input.vehicle_no.toUpperCase().replace(/[\s-]/g, "");
    const settings = await ctx.repo.settings();
    const duration = settings.serviceTypes.find((s) => s.type === input.service_type)?.durationMinutes ?? branch.serviceSlotMinutes;
    const booking = {
      id: newId("svc_"),
      orgId: ctx.orgId,
      branchId: branch.id,
      customerName: input.customer_name,
      phone,
      vehicleNo,
      model: findModel(await ctx.repo.catalog.list(), input.model)?.model ?? input.model,
      kilometres: input.kilometres,
      serviceType: input.service_type,
      pickupDrop: input.pickup_drop ?? false,
      start: start.toISOString(),
      end: new Date(start.getTime() + duration * 60_000).toISOString(),
      status: "booked" as const,
      createdAt: nowIso(),
    };
    await ctx.repo.serviceBookings.set(booking);
    const vehicles = await ctx.repo.customerVehicles.list({ where: { vehicleNo } });
    if (!vehicles.length) await ctx.repo.customerVehicles.set({ id: newId("cv_"), orgId: ctx.orgId, customerName: input.customer_name, phone, vehicleNo, model: booking.model, branchId: branch.id, lastServiceKm: input.kilometres });
    await createCalendarEvent(settings.googleCalendarId, { summary: `Service: ${vehicleNo} (${input.service_type})`, start: booking.start, end: booking.end, location: branch.address });
    const confirmationSent = await notify(ctx, phone, "service_confirmation", { name: input.customer_name, vehicle: vehicleNo, branch: branch.name, date, time, address: branch.address, map: branch.mapLink, pickup: booking.pickupDrop ? "Pickup and drop requested. " : "" });
    void pushDmsEvent(ctx.orgId, "service.booked", booking);
    return { booked: true, id: booking.id, date, time, branchName: branch.name, pickupDrop: booking.pickupDrop, confirmationSent };
  },
});

// ---------------------------------------------------------------- leads & lookups

export const saveLead = defineTool({
  name: "save_lead",
  description: "Create or update the caller's lead with qualification details. Call once you know their name and interest, and again when details change. Score: hot (buying this week / wants to buy now), warm, cold.",
  schema: z.object({
    fields: z.object({
      name: z.string().optional(),
      phone: z.string().optional(),
      city: z.string().optional(),
      vehicleType: z.enum(VEHICLE_TYPES).optional(),
      interestedModel: z.string().optional(),
      variant: z.string().optional(),
      fuel: z.enum(FUEL_TYPES).optional(),
      budget: z.number().optional().describe("Rupees"),
      newOrUsed: z.enum(["new", "used"]).optional(),
      timeline: z.enum(["this_week", "this_month", "three_months_plus", "unknown"]).optional(),
      paymentMode: z.enum(["cash", "loan", "exchange", "unknown"]).optional(),
      hasExchange: z.boolean().optional(),
      exchangeVehicle: z.object({ make: z.string().optional(), model: z.string().optional(), year: z.number().int().optional(), kilometres: z.number().int().optional(), condition: z.string().optional() }).optional(),
      buyingIntent: z.enum(["buy_today", "visiting_today", "researching", "unknown"]).optional(),
      notes: z.string().optional(),
    }),
    score: z.enum(["hot", "warm", "cold"]).optional(),
  }),
  async run(input, ctx) {
    const { lead, created } = await upsertLead(ctx.orgId, { ...input.fields, phone: input.fields.phone || ctx.callerPhone, score: input.score, source: ctx.agent ? "inbound_call" : "other", note: input.fields.notes });
    if (input.fields.hasExchange || input.fields.exchangeVehicle) {
      await ctx.repo.callbacks.set({ id: newId("cb_"), orgId: ctx.orgId, phone: lead.phone, customerName: lead.name, department: "sales", reason: `Exchange evaluation: ${JSON.stringify(input.fields.exchangeVehicle ?? {})}`, priority: "normal", assignedTo: lead.assignedTo, dueAt: new Date(Date.now() + 4 * 3600_000).toISOString(), status: "pending", callId: ctx.callId, createdAt: nowIso() });
    }
    return { saved: true, created, leadId: lead.id, score: lead.score, note: input.fields.hasExchange ? "Exchange evaluation callback created. Never quote a value." : undefined };
  },
});

export const lookupBooking = defineTool({
  name: "lookup_booking",
  description: "Look up the caller's vehicle booking (allotment, documents, delivery date). Only works for the caller's own registered number.",
  schema: z.object({ phone: z.string().optional().describe("Registered phone; defaults to the caller's number") }),
  async run(input, ctx) {
    const phone = normalizePhone(input.phone || ctx.callerPhone);
    if (phone !== normalizePhone(ctx.callerPhone)) return { verified: false, note: "Can only share bookings for the number the caller is calling from. Offer a callback on the registered number." };
    const bookings = await lookupVehicleBookings(ctx.orgId, phone);
    if (!bookings.length) return { verified: true, found: false };
    return { verified: true, found: true, bookings: bookings.slice(0, 3) };
  },
});

export const lookupJobCardTool = defineTool({
  name: "lookup_job_card",
  description: "Service status for a vehicle ('is my vehicle ready?'). Shares details only if the caller's number, or the registered_phone they state, matches the vehicle's record.",
  schema: z.object({ vehicle_no: z.string(), registered_phone: z.string().optional() }),
  async run(input, ctx) {
    const vehicleNo = input.vehicle_no.toUpperCase().replace(/[\s-]/g, "");
    const card = await lookupJobCard(ctx.orgId, vehicleNo);
    if (!card) return { found: false, note: "No open job card. Offer to connect the service advisor." };
    const owner = card.customerPhone ? normalizePhone(card.customerPhone) : "";
    const verified = !owner || owner === normalizePhone(ctx.callerPhone) || (input.registered_phone ? owner === normalizePhone(input.registered_phone) : false);
    if (!verified) return { found: true, verified: false, note: "Ask for the registered mobile number before sharing anything." };
    return { found: true, verified: true, vehicleNo, model: card.model, status: card.status, jobCardNo: card.jobCardNo, estimatedReadyAt: card.estimatedReadyAt };
  },
});

export const sendWhatsappOrSms = defineTool({
  name: "send_whatsapp_or_sms",
  description:
    "Send the caller a WhatsApp message. Use it whenever the caller asks you to send something on WhatsApp, or agrees when you offer: model_details (variants, on-road price range, features, brochure link) or brochure need variables.model; showroom_location sends address, map link and timings (variables.branch optional). Only say it's sent after this returns sent: true.",
  schema: z.object({
    template: z.enum(["model_details", "brochure", "showroom_location", "callback_notice", "testdrive_confirmation", "service_confirmation"]),
    phone: z.string().optional(),
    variables: z.record(z.string()).optional().describe("e.g. { model: 'Creta' } or { branch: 'Indiranagar' }"),
  }),
  async run(input, ctx) {
    const phone = normalizePhone(input.phone || ctx.callerPhone);
    let vars: Record<string, string | undefined> = { showroom: ctx.org.showroomName, ...input.variables };
    if (input.template === "brochure" || input.template === "model_details") {
      const m = findModel(await ctx.repo.catalog.list(), input.variables?.model ?? "");
      if (!m) return { sent: false, note: "Which model? Ask the caller, then try again." };
      if (input.template === "brochure" && !m.brochureUrl) return { sent: false, note: "No brochure configured for that model; offer model_details instead." };
      vars = { ...vars, ...modelDetailsVars(m, ctx.org.showroomName) };
    }
    if (input.template === "showroom_location") {
      const branch = await pickBranch(ctx, ctx.agent.kind === "service" ? "service" : "sales", input.variables?.branch, input.variables?.model);
      if (!branch) return { sent: false, note: "No branch configured." };
      vars = { ...vars, ...locationVars(branch, ctx.org.showroomName) };
    }
    const sent = await notify(ctx, phone, input.template, vars);
    return sent ? { sent, note: "Tell the caller it has been sent on WhatsApp." } : { sent, note: "Sending failed. Apologise and say the team will share it." };
  },
});

// ---------------------------------------------------------------- handover

const rrIndex = new Map<string, number>();

function withinHours(branch: Branch | undefined, now = new Date()): boolean {
  if (!branch) return true;
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  const hhmm = ist.toISOString().slice(11, 16);
  return branch.workingHours.days.includes(ist.getUTCDay()) && hhmm >= branch.workingHours.open && hhmm < branch.workingHours.close;
}

export const transferToHuman = defineTool({
  name: "transfer_to_human",
  description: "Transfer the live call to a human: sales executive for hot leads, service manager for angry or safety complaints. If nobody is free, schedules an instant callback. Say a short handover line first.",
  schema: z.object({
    reason: z.string(),
    department: z.enum(DEPARTMENTS),
    priority: z.enum(["instant", "high", "normal"]).default("instant"),
  }),
  async run(input, ctx) {
    const [members, branches, leads] = await Promise.all([ctx.repo.members.list(), ctx.repo.branches.list(), ctx.repo.leads.list({ where: { phone: normalizePhone(ctx.callerPhone) } })]);
    const lead = leads[0];
    const branch = branches.find((b) => b.id === lead?.branchId) ?? (input.department === "service" || input.department === "manager" ? branches.find((b) => /service/i.test(b.name)) : undefined) ?? branches[0];
    const roleOk = (m: Member) => m.departments.includes(input.department) || (input.department === "manager" && ["owner", "sales_manager"].includes(m.role));
    const candidates = members.filter((m) => m.available && m.phone && roleOk(m));
    const preferred = lead?.assignedTo ? candidates.find((m) => m.id === lead.assignedTo) : undefined;
    let target: { name: string; number: string } | null = null;
    if (withinHours(branch)) {
      if (preferred) target = { name: preferred.name, number: preferred.phone! };
      else if (candidates.length) {
        const i = (rrIndex.get(input.department) ?? 0) % candidates.length;
        rrIndex.set(input.department, i + 1);
        target = { name: candidates[i]!.name, number: candidates[i]!.phone! };
      } else if (branch?.transferNumbers[input.department]) {
        target = { name: `${input.department} desk`, number: branch.transferNumbers[input.department] };
      }
    }

    const callerName = lead?.name ?? "Caller";
    if (target && ctx.canTransfer) {
      ctx.actions.transfer = { number: target.number, to: target.name, department: input.department };
      // Heads-up message so the executive has context when they pick up.
      await alertStaff(ctx, target.number, { name: callerName, phone: ctx.callerPhone, model: lead?.interestedModel ?? "-", reason: input.reason });
      return { transferred: true, to: target.name, note: "Tell the caller you're connecting them now." };
    }

    const assignee = preferred ?? candidates[0];
    const dueAt = new Date(Date.now() + (input.priority === "instant" ? 5 : input.priority === "high" ? 30 : 240) * 60_000).toISOString();
    await ctx.repo.callbacks.set({ id: newId("cb_"), orgId: ctx.orgId, phone: normalizePhone(ctx.callerPhone), customerName: lead?.name, department: input.department, reason: input.reason, priority: input.priority, assignedTo: assignee?.id, dueAt, status: "pending", callId: ctx.callId, createdAt: nowIso() });
    if (assignee?.phone) await alertStaff(ctx, assignee.phone, { name: callerName, phone: ctx.callerPhone, model: lead?.interestedModel ?? "-", reason: `${input.reason} (callback due)` });
    await notify(ctx, ctx.callerPhone, "callback_notice", { showroom: ctx.org.showroomName, department: input.department });
    return { transferred: false, callbackScheduled: true, withinMinutes: input.priority === "instant" ? 5 : input.priority === "high" ? 30 : 240, note: "Tell the caller warmly that a person will call back shortly." };
  },
});

export const createTicket = defineTool({
  name: "create_ticket",
  description: "Log a complaint ticket. Severity critical for safety issues (brakes, steering, fire, airbags, accident), high when the caller is angry.",
  schema: z.object({
    category: z.enum(["service_quality", "delay", "billing", "staff_behaviour", "safety", "sales", "other"]),
    description: z.string(),
    severity: z.enum(["low", "medium", "high", "critical"]),
    vehicle_no: z.string().optional(),
    customer_name: z.string().optional(),
  }),
  async run(input, ctx) {
    const managers = (await ctx.repo.members.list()).filter((m) => m.departments.includes("manager") || m.role === "sales_manager");
    const ticket = {
      id: `TKT-${Date.now().toString().slice(-6)}`,
      orgId: ctx.orgId,
      callId: ctx.callId,
      phone: normalizePhone(ctx.callerPhone),
      customerName: input.customer_name,
      vehicleNo: input.vehicle_no?.toUpperCase().replace(/[\s-]/g, ""),
      category: input.category,
      description: input.description,
      severity: input.severity,
      status: "open" as const,
      assignedTo: managers[0]?.id,
      createdAt: nowIso(),
    };
    await ctx.repo.tickets.set(ticket);
    void pushDmsEvent(ctx.orgId, "ticket.created", ticket);
    const escalate = input.severity === "critical" || input.severity === "high" || input.category === "safety";
    return { ticketId: ticket.id, escalate, note: escalate ? "Apologise once and transfer to the service manager (department manager, priority instant)." : "Share the ticket number and promise a call from the service team." };
  },
});

export const recordFeedback = defineTool({
  name: "record_feedback",
  description: "Record a post-service rating (1-5) and comment. Ratings below 3 are routed to a manager automatically.",
  schema: z.object({ rating: z.number().int().min(1).max(5), comment: z.string().optional() }),
  async run(input, ctx) {
    const routed = input.rating < 3;
    if (routed) {
      await ctx.repo.tickets.set({ id: `FB-${Date.now().toString().slice(-6)}`, orgId: ctx.orgId, callId: ctx.callId, phone: normalizePhone(ctx.callerPhone), category: "service_quality", description: `Feedback ${input.rating}/5: ${input.comment ?? ""}`, severity: "medium", status: "open", createdAt: nowIso() });
      await ctx.repo.callbacks.set({ id: newId("cb_"), orgId: ctx.orgId, phone: normalizePhone(ctx.callerPhone), department: "manager", reason: `Low feedback rating ${input.rating}/5`, priority: "high", dueAt: new Date(Date.now() + 2 * 3600_000).toISOString(), status: "pending", callId: ctx.callId, createdAt: nowIso() });
    }
    await ctx.repo.calls.update(ctx.callId, { extracted: { notes: `Feedback rating ${input.rating}/5. ${input.comment ?? ""}`.trim() } });
    return { recorded: true, rating: input.rating, routedToManager: routed };
  },
});

export const recordOptOutTool = defineTool({
  name: "record_opt_out",
  description: "The caller asked not to be called again. Records the opt-out immediately (DND compliance).",
  schema: z.object({ reason: z.string().optional() }),
  async run(input, ctx) {
    await recordOptOut(ctx.orgId, ctx.callerPhone, input.reason ?? "caller_request");
    return { optedOut: true, note: "Apologise briefly, confirm they won't be called, and end_call with outcome opted_out." };
  },
});

export const endCall = defineTool({
  name: "end_call",
  description: "End the call after you have said goodbye. Use when the conversation is complete, it is a wrong number, or the caller wants to hang up.",
  schema: z.object({ outcome: z.enum(CALL_OUTCOMES).describe("Overall outcome of the call") }),
  async run(input, ctx) {
    ctx.actions.endCall = { outcome: input.outcome };
    return { ok: true };
  },
});

export const ALL_TOOLS: ToolDefinition[] = [
  searchCatalogTool,
  getModelDetails,
  calculateEmiTool,
  checkTestDriveSlots,
  bookTestDrive,
  checkServiceSlots,
  bookService,
  saveLead,
  lookupBooking,
  lookupJobCardTool,
  sendWhatsappOrSms,
  transferToHuman,
  createTicket,
  recordFeedback,
  recordOptOutTool,
  endCall,
] as ToolDefinition[];
