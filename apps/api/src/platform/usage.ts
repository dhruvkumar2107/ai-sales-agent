import { OVERAGE_PER_MINUTE, PAYMENT_FEE_PERCENT, PLANS, type Org } from "@axo/shared";
import { global, platformOf, repo } from "../db/repo";

/** First instant of the IST calendar month containing `at` (or of "YYYY-MM"), as an ISO string. */
export function monthStart(month?: string, at = new Date()): string {
  const [y, m] = month ? month.split("-").map(Number) : [new Date(at.getTime() + 5.5 * 3600_000).getUTCFullYear(), new Date(at.getTime() + 5.5 * 3600_000).getUTCMonth() + 1];
  return new Date(Date.UTC(y!, m! - 1, 1) - 5.5 * 3600_000).toISOString();
}

export function monthEnd(month?: string): string {
  const start = new Date(monthStart(month));
  const ist = new Date(start.getTime() + 5.5 * 3600_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 1) - 5.5 * 3600_000).toISOString();
}

export interface OrgUsage {
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

/** One dealership's usage for a month ("YYYY-MM", default current IST month). */
export async function orgUsage(orgId: string, month?: string): Promise<OrgUsage> {
  const from = monthStart(month);
  const to = monthEnd(month);
  const r = repo(orgId);
  const inMonth = (iso?: string) => Boolean(iso && iso >= from && iso < to);
  const [calls, messages, leads, tds, svc, convs] = await Promise.all([r.calls.list(), r.messages.list(), r.leads.list(), r.testDrives.list(), r.serviceBookings.list(), r.conversations.list()]);
  const monthCalls = calls.filter((c) => inMonth(c.startedAt));
  const monthLeads = leads.filter((l) => inMonth(l.createdAt));
  return {
    calls: monthCalls.length,
    answeredCalls: monthCalls.filter((c) => c.durationSec > 0 && !["no_answer", "busy", "failed"].includes(c.outcome ?? "")).length,
    inbound: monthCalls.filter((c) => c.direction === "inbound").length,
    outbound: monthCalls.filter((c) => c.direction === "outbound").length,
    web: monthCalls.filter((c) => c.direction === "web").length,
    minutes: Math.round(monthCalls.reduce((n, c) => n + c.durationSec, 0) / 6) / 10,
    cost: Math.round(monthCalls.reduce((n, c) => n + (c.cost?.total ?? 0), 0) + messages.filter((m) => inMonth(m.createdAt) && !m.callId && m.direction === "out" && (m.status === "sent" || m.status === "logged")).length * 0.35),
    messages: messages.filter((m) => inMonth(m.createdAt) && m.direction === "out" && (m.status === "sent" || m.status === "logged")).length,
    whatsappChats: convs.filter((c) => inMonth(c.lastMessageAt)).length,
    leads: monthLeads.length,
    hotLeads: monthLeads.filter((l) => l.score === "hot").length,
    testDrives: tds.filter((t) => inMonth(t.createdAt)).length,
    serviceBookings: svc.filter((s) => inMonth(s.createdAt)).length,
    lastCallAt: calls.map((c) => c.startedAt).sort().pop(),
  };
}

/**
 * What the business owes for the month and what is left for the partners: plan price (or override), extra
 * minutes, and the one-time setup fee in the month it was received; costs are usage plus payment gateway fees.
 */
export function billing(org: Org, usage: OrgUsage, month?: string) {
  const plan = PLANS[org.plan] ?? PLANS.trial;
  const p = platformOf(org);
  const active = org.status !== "suspended";
  const base = active ? p.monthlyPrice || plan.price : 0;
  const overageMinutes = active ? Math.max(0, Math.ceil(usage.minutes - plan.minutes)) : 0;
  const overage = overageMinutes * OVERAGE_PER_MINUTE;
  const paidAt = p.setupFeePaidAt;
  const setupFee = paidAt && paidAt >= monthStart(month) && paidAt < monthEnd(month) ? p.setupFee : 0;
  const revenue = base + overage + setupFee;
  const paymentFees = Math.round((revenue * PAYMENT_FEE_PERCENT) / 100);
  const cost = Math.round(usage.cost + paymentFees);
  return {
    planLabel: plan.label,
    includedMinutes: plan.minutes,
    basePrice: base,
    overageMinutes,
    overage,
    setupFee,
    /** Setup fee not received yet */
    setupFeeDue: p.setupFee > 0 && !paidAt ? p.setupFee : 0,
    revenue,
    paymentFees,
    cost,
    profit: revenue - cost,
  };
}

export type LimitCheck = { ok: true } | { ok: false; reason: string };

/**
 * Hard limits set by the platform owner: suspension, feature switches, monthly cap on outbound calls.
 * Inbound customer calls are never cut off by the cap (they count as overage); only suspension or
 * switching voice off stops them.
 */
export async function checkCallAllowed(orgId: string, kind: "inbound" | "outbound" | "campaign" | "web"): Promise<LimitCheck> {
  const org = await global.orgs().get(orgId);
  if (!org) return { ok: false, reason: "unknown dealership" };
  if (org.status === "suspended") return { ok: false, reason: "account suspended" };
  const p = platformOf(org);
  if (kind !== "web" && !p.features.voiceCalls) return { ok: false, reason: "voice calls disabled by admin" };
  if (kind === "campaign" && !p.features.outboundCampaigns) return { ok: false, reason: "outbound campaigns disabled by admin" };
  if (p.limits.monthlyCalls > 0 && (kind === "outbound" || kind === "campaign")) {
    const from = monthStart();
    const used = (await repo(orgId).calls.list()).filter((c) => c.startedAt >= from && c.direction !== "web").length;
    if (used >= p.limits.monthlyCalls) return { ok: false, reason: `monthly call limit of ${p.limits.monthlyCalls} reached` };
  }
  return { ok: true };
}
