import { z } from "zod";
import type { BusinessAction, Org } from "@axo/shared";
import { normalizeDate, normalizeTime } from "../bookings/slots";
import { istToDate } from "../compliance/calling-hours";
import { newId, nowIso } from "../db/repo";
import { createCalendarEvent } from "../integrations/google-calendar";
import { normalizePhone } from "../lib/mask";
import { upsertLead } from "../leads/service";
import { checkPrices, collectNumbers, parseAmounts } from "../voice/price-guard";
import { alertStaff, createTicket, endCall, notify, recordFeedback, recordOptOutTool, transferToHuman } from "./definitions";
import { defineTool, type ToolContext, type ToolDefinition } from "./types";

/** Who hears about new requests: the business's staff number, else the owner's contact number. */
const staffNumber = (org: Org) => org.business?.staffPhone || org.platform?.contact?.phone || "";

/** A task on the team's callbacks list plus an SMS heads-up, so nothing the agent takes is left unseen. */
async function teamTask(ctx: ToolContext, o: { phone: string; name?: string; kind: string; reason: string; priority: "instant" | "high" | "normal"; dueMinutes: number }) {
  await ctx.repo.callbacks.set({
    id: newId("cb_"),
    orgId: ctx.orgId,
    phone: o.phone,
    customerName: o.name,
    department: "sales",
    reason: o.reason,
    priority: o.priority,
    dueAt: new Date(Date.now() + o.dueMinutes * 60_000).toISOString(),
    status: "pending",
    callId: ctx.callId,
    createdAt: nowIso(),
  });
  const to = staffNumber(ctx.org);
  if (to) await alertStaff(ctx, to, { name: o.name ?? "Customer", phone: o.phone, model: o.kind, reason: o.reason });
}

export const saveEnquiry = defineTool({
  name: "save_enquiry",
  description: "Create or update the caller's enquiry (lead). Call once you know their name and what they need, and again when details change. Score: hot (wants to buy or book now), warm, cold.",
  schema: z.object({
    name: z.string().optional(),
    phone: z.string().optional().describe("Defaults to the caller's number"),
    need: z.string().describe("What they want, in a few words, e.g. 'root canal' or '2 BHK flat'"),
    details: z.string().optional().describe("Budget, quantity, preferred time, location or anything else useful"),
    city: z.string().optional(),
    budget: z.number().optional().describe("Rupees"),
    score: z.enum(["hot", "warm", "cold"]).optional(),
  }),
  async run(input, ctx) {
    const { lead, created } = await upsertLead(ctx.orgId, { phone: input.phone || ctx.callerPhone, name: input.name, interestedModel: input.need, city: input.city, budget: input.budget, score: input.score, source: "inbound_call", note: input.details });
    if (input.score === "hot" && created) await teamTask(ctx, { phone: lead.phone, name: lead.name, kind: input.need, reason: `Hot enquiry: ${input.need}${input.details ? ` (${input.details})` : ""}`, priority: "instant", dueMinutes: 10 });
    return { saved: true, created, leadId: lead.id, score: lead.score };
  },
});

export const bookAppointment = defineTool({
  name: "book_appointment",
  description: "Request an appointment or visit after the caller confirmed name, purpose, date and time. Saves it for the team to confirm and sends the customer a WhatsApp acknowledgement.",
  schema: z.object({
    purpose: z.string().describe("What the appointment is for, e.g. 'dental check-up' or 'site visit'"),
    date: z.string().describe("YYYY-MM-DD, 'today' or 'tomorrow'"),
    time: z.string().describe("HH:MM 24h IST"),
    customer_name: z.string(),
    phone: z.string().optional().describe("Defaults to the caller's number"),
    notes: z.string().optional(),
  }),
  timeoutMs: 6000,
  async run(input, ctx) {
    const date = normalizeDate(input.date);
    const time = normalizeTime(input.time);
    if (!date || !time) return { error: "invalid_date_or_time", details: "Ask the caller for a clear date and time." };
    const start = istToDate(date, time);
    if (start.getTime() < Date.now()) return { booked: false, reason: "time_in_past", note: "That time has passed; ask for a later time." };
    const phone = normalizePhone(input.phone || ctx.callerPhone);
    const when = `${date} ${time}`;
    await upsertLead(ctx.orgId, { phone, name: input.customer_name, interestedModel: input.purpose, source: "inbound_call", score: "warm", note: `Appointment requested: ${input.purpose} on ${when}${input.notes ? ` (${input.notes})` : ""}` });
    await teamTask(ctx, { phone, name: input.customer_name, kind: "appointment", reason: `Confirm appointment: ${input.purpose} on ${when} IST${input.notes ? `. ${input.notes}` : ""}`, priority: "high", dueMinutes: 30 });
    const settings = await ctx.repo.settings();
    await createCalendarEvent(settings.googleCalendarId, { summary: `${input.purpose} - ${input.customer_name}`, description: `Phone: ${phone}\nBooked by AI agent (call ${ctx.callId})`, start: start.toISOString(), end: new Date(start.getTime() + 30 * 60_000).toISOString(), location: ctx.org.business?.address });
    const confirmationSent = await notify(ctx, phone, "appointment_request", { name: input.customer_name, showroom: ctx.org.showroomName, purpose: input.purpose, date, time, address: ctx.org.business?.address ? `Address: ${ctx.org.business.address}` : "" });
    return { booked: true, date, time, confirmationSent, note: "Tell the caller the request is noted and the team will confirm the exact time shortly." };
  },
});

export const takeOrder = defineTool({
  name: "take_order",
  description: "Place an order after the caller confirmed the items, pickup or delivery, and name. Saves it for the team, who confirm the total and timing, and sends a WhatsApp acknowledgement.",
  schema: z.object({
    items: z.string().describe("Items and quantities, e.g. '2 paneer tikka, 1 dal makhani'"),
    fulfilment: z.enum(["pickup", "delivery"]),
    address: z.string().optional().describe("Required for delivery"),
    customer_name: z.string(),
    phone: z.string().optional().describe("Defaults to the caller's number"),
    notes: z.string().optional(),
  }),
  timeoutMs: 6000,
  async run(input, ctx) {
    if (input.fulfilment === "delivery" && !input.address) return { placed: false, note: "Ask for the delivery address first." };
    const phone = normalizePhone(input.phone || ctx.callerPhone);
    const where = input.fulfilment === "delivery" ? `delivery to ${input.address}` : "pickup";
    await upsertLead(ctx.orgId, { phone, name: input.customer_name, interestedModel: input.items.slice(0, 80), source: "inbound_call", score: "hot", note: `Order: ${input.items} (${where})${input.notes ? `. ${input.notes}` : ""}` });
    await teamTask(ctx, { phone, name: input.customer_name, kind: "order", reason: `Order: ${input.items} (${where})${input.notes ? `. ${input.notes}` : ""}`, priority: "instant", dueMinutes: 10 });
    const confirmationSent = await notify(ctx, phone, "order_received", { name: input.customer_name, showroom: ctx.org.showroomName, items: input.items, fulfilment: where });
    return { placed: true, confirmationSent, note: "Tell the caller the order is noted and the team will confirm the total and timing shortly." };
  },
});

export const sendWhatsappDetails = defineTool({
  name: "send_whatsapp_details",
  description:
    "Send the caller a WhatsApp message: topic location sends the address, map link and timings; topic details sends `summary`, a short message you write using only facts from the business knowledge. Only say it's sent after this returns sent: true.",
  schema: z.object({
    topic: z.enum(["details", "location"]),
    summary: z.string().optional().describe("For topic details: 2-6 short lines, facts from the business knowledge only"),
    phone: z.string().optional(),
  }),
  async run(input, ctx) {
    const b = ctx.org.business;
    const phone = normalizePhone(input.phone || ctx.callerPhone);
    if (input.topic === "location") {
      if (!b?.address && !b?.mapLink) return { sent: false, note: "No address configured. Say the team will share it." };
      const sent = await notify(ctx, phone, "business_location", { showroom: ctx.org.showroomName, address: b.address || "-", map: b.mapLink || "-", timings: b.timings || "-", phone: staffNumber(ctx.org) || "-" });
      return sent ? { sent, note: "Tell the caller the location has been sent on WhatsApp." } : { sent, note: "Sending failed. Say the team will share it." };
    }
    const summary = input.summary?.trim();
    if (!summary) return { sent: false, note: "Write the summary to send, then call again." };
    // Same rule as speech: no amount the business didn't write.
    const allowed = new Set(parseAmounts(`${b?.knowledge ?? ""}\n${b?.description ?? ""}`));
    collectNumbers(ctx.callerPhone, allowed);
    if (!checkPrices(summary, allowed).ok) return { sent: false, note: "The summary has an amount that is not in the business knowledge. Remove it or use the exact figure, then try again." };
    const sent = await notify(ctx, phone, "business_details", { showroom: ctx.org.showroomName, details: summary });
    return sent ? { sent, note: "Tell the caller it has been sent on WhatsApp." } : { sent, note: "Sending failed. Apologise and say the team will share it." };
  },
});

export const requestCallback = defineTool({
  name: "request_callback",
  description: "Schedule a callback from the team when you can't answer something or the caller wants to speak to a person.",
  schema: z.object({ reason: z.string(), urgent: z.boolean().optional() }),
  async run(input, ctx) {
    const phone = normalizePhone(ctx.callerPhone);
    const lead = (await ctx.repo.leads.list({ where: { phone } }))[0];
    await teamTask(ctx, { phone, name: lead?.name, kind: "callback", reason: input.reason, priority: input.urgent ? "instant" : "high", dueMinutes: input.urgent ? 10 : 60 });
    await notify(ctx, phone, "callback_notice", { showroom: ctx.org.showroomName, department: "" });
    return { callbackScheduled: true, note: "Tell the caller warmly that the team will call back shortly." };
  },
});

const transferToStaff = {
  ...transferToHuman,
  description: "Transfer the live call to a person at the business (department sales) when the caller asks for one, is ready to buy or book now, or needs something you can't answer. If nobody is free, schedules a callback. Say a short handover line first.",
} as ToolDefinition;

const logComplaint = {
  ...createTicket,
  description: "Log a complaint ticket. Severity high when the caller is angry, critical for safety or health issues. Category: use other unless one clearly fits.",
} as ToolDefinition;

const BY_ACTION: Partial<Record<BusinessAction, ToolDefinition[]>> = {
  capture_enquiry: [saveEnquiry as ToolDefinition],
  book_appointment: [bookAppointment as ToolDefinition],
  take_order: [takeOrder as ToolDefinition],
  send_whatsapp_details: [sendWhatsappDetails as ToolDefinition],
  transfer_to_staff: [transferToStaff],
  complaints: [logComplaint],
  feedback: [recordFeedback as ToolDefinition],
};

/** Tools an any-business agent gets: the ones its ticked actions unlock, plus callback, opt-out and end-call. */
export function businessTools(actions: BusinessAction[]): ToolDefinition[] {
  const picked = actions.flatMap((a) => BY_ACTION[a] ?? []);
  if (!actions.includes("transfer_to_staff")) picked.push(requestCallback as ToolDefinition);
  return [...new Set(picked), recordOptOutTool as ToolDefinition, endCall as ToolDefinition];
}
