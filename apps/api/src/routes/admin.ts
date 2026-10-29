import type { FastifyInstance } from "fastify";
import { agentConfigSchema, businessProfileSchema, LANGUAGES, memberSchema, OVERAGE_PER_MINUTE, PAYMENT_FEE_PERCENT, orgPlatformSchema, orgSchema, PLAN_IDS, PLANS, SETUP_FEE, type BusinessProfile, type Language, type Org, type OrgPlatform } from "@axo/shared";
import { AGENT_TEMPLATES } from "../../prompts/agents";
import { businessAgentDefaults } from "../../prompts/business";
import { requireSuperAdmin } from "../auth/auth";
import { checkNumbers, connectNumbers } from "../calls/connect";
import { numberConflicts, syncPhoneRoutes } from "../calls/numbers";
import { env } from "../config";
import { global, newId, nowIso, platformOf, repo } from "../db/repo";
import { encryptString, redactSecret } from "../lib/crypto";
import { normalizePhone } from "../lib/mask";
import { checkKeys, describeKeys, saveKeys } from "../platform/keys";
import { getPartners, savePartners, splitProfit, type Partner } from "../platform/partners";
import { billing, monthStart, orgUsage } from "../platform/usage";

type PlatformPatch = { [K in keyof OrgPlatform]?: Partial<OrgPlatform[K]> | OrgPlatform[K] };

/** Deep-merge one level: platform.features / limits / whatsapp / contact are objects. */
function mergePlatform(cur: OrgPlatform, patch: PlatformPatch): OrgPlatform {
  const next: Record<string, unknown> = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    const existing = (cur as Record<string, unknown>)[k];
    next[k] = v && typeof v === "object" && !Array.isArray(v) && existing && typeof existing === "object" ? { ...(existing as object), ...(v as object) } : v;
  }
  return orgPlatformSchema.parse(next);
}

async function orgRow(org: Org, month?: string) {
  const usage = await orgUsage(org.id, month);
  const p = platformOf(org);
  return { org: { ...org, platform: p }, usage, billing: billing({ ...org, platform: p }, usage, month) };
}

export async function adminRoutes(app: FastifyInstance) {
  const admin = requireSuperAdmin();

  app.get("/admin/me", { preHandler: admin }, async (req) => ({
    superAdmin: true,
    email: req.auth?.email,
    messagingProvider: env.MESSAGING_PROVIDER,
    telephonyProvider: env.TELEPHONY_PROVIDER,
    plans: PLANS,
    pricing: { overagePerMinute: OVERAGE_PER_MINUTE, setupFee: SETUP_FEE, paymentFeePercent: PAYMENT_FEE_PERCENT },
    // What to paste into the Meta app (WhatsApp > Configuration) and the telephony provider's number settings.
    setup: {
      whatsappWebhookUrl: `${env.PUBLIC_BASE_URL}/webhooks/whatsapp`,
      whatsappVerifyToken: env.META_WA_VERIFY_TOKEN,
      twilioVoiceUrl: `${env.PUBLIC_BASE_URL}/telephony/twilio/voice`,
    },
    // What "Connect" can do on its own with the server's provider settings.
    automation: {
      calls: env.TELEPHONY_PROVIDER === "twilio" && Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN),
      whatsapp: Boolean(env.META_WA_TOKEN && env.META_WABA_ID),
    },
  }));

  /** All dealerships with this month's usage, billing estimate and totals. ?month=YYYY-MM */
  app.get("/admin/overview", { preHandler: admin }, async (req) => {
    const month = (req.query as { month?: string }).month;
    const orgs = await global.orgs().list({ orderBy: "createdAt" });
    const [rows, partners] = await Promise.all([Promise.all(orgs.map((o) => orgRow(o, month))), getPartners()]);
    const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + f(r), 0);
    const profit = Math.round(sum((r) => r.billing.profit));
    return {
      month: month ?? new Date(Date.parse(monthStart()) + 5.5 * 3600_000).toISOString().slice(0, 7),
      totals: {
        dealers: rows.length,
        active: rows.filter((r) => r.org.status !== "suspended").length,
        calls: sum((r) => r.usage.calls),
        minutes: Math.round(sum((r) => r.usage.minutes)),
        messages: sum((r) => r.usage.messages),
        whatsappChats: sum((r) => r.usage.whatsappChats),
        leads: sum((r) => r.usage.leads),
        testDrives: sum((r) => r.usage.testDrives),
        cost: Math.round(sum((r) => r.billing.cost)),
        revenue: sum((r) => r.billing.revenue),
        monthlyRevenue: sum((r) => r.billing.basePrice + r.billing.overage),
        setupFees: sum((r) => r.billing.setupFee),
        setupFeesDue: sum((r) => r.billing.setupFeeDue),
        profit,
      },
      partners: splitProfit(profit, partners),
      dealers: rows,
    };
  });

  /** Provider keys (Settings page): values for settings, last 4 characters for secrets, and where each comes from. */
  app.get("/admin/keys", { preHandler: admin }, async () => ({ fields: await describeKeys(), partners: await getPartners() }));

  /** Save keys: { values: { TWILIO_AUTH_TOKEN: "...", ... } }. "" clears a saved value; they apply immediately. */
  app.put("/admin/keys", { preHandler: admin }, async (req, reply) => {
    const values = ((req.body ?? {}) as { values?: Record<string, string> }).values ?? {};
    const error = await saveKeys(values);
    if (error) return reply.code(400).send({ error });
    return { fields: await describeKeys() };
  });

  /** Try every configured provider with a read-only request. */
  app.post("/admin/keys/check", { preHandler: admin }, async () => ({ checks: await checkKeys() }));

  /** Partners and their profit shares: { partners: [{ name, share }] }, shares add up to 100. */
  app.put("/admin/partners", { preHandler: admin }, async (req, reply) => {
    const partners = ((req.body ?? {}) as { partners?: Partner[] }).partners ?? [];
    const error = await savePartners(partners);
    if (error) return reply.code(400).send({ error });
    return { partners: await getPartners() };
  });

  /** One dealership: usage, daily calls this month, team, recent calls and messages. */
  app.get("/admin/orgs/:id", { preHandler: admin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const month = (req.query as { month?: string }).month;
    const org = await global.orgs().get(id);
    if (!org) return reply.code(404).send({ error: "Not found" });
    const r = repo(id);
    const [row, calls, messages, members, agents, settings] = await Promise.all([orgRow(org, month), r.calls.list({ orderBy: "startedAt", desc: true }), r.messages.list({ orderBy: "createdAt", desc: true }), r.members.list(), r.agents.list(), r.settings()]);
    const from = monthStart(month);
    const daily: Record<string, { calls: number; messages: number }> = {};
    for (const c of calls.filter((c) => c.startedAt >= from)) {
      const d = new Date(Date.parse(c.startedAt) + 5.5 * 3600_000).toISOString().slice(0, 10);
      (daily[d] ??= { calls: 0, messages: 0 }).calls++;
    }
    for (const m of messages.filter((m) => m.createdAt >= from && m.direction === "out")) {
      const d = new Date(Date.parse(m.createdAt) + 5.5 * 3600_000).toISOString().slice(0, 10);
      (daily[d] ??= { calls: 0, messages: 0 }).messages++;
    }
    return {
      ...row,
      daily: Object.entries(daily)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, v]) => ({ date, ...v })),
      recentCalls: calls.slice(0, 15).map(({ transcript: _t, latency: _l, ...c }) => c),
      recentMessages: messages.slice(0, 30),
      team: members.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role, invited: m.id.startsWith("invite:") })),
      agents: agents.map((a) => ({ id: a.id, name: a.name, kind: a.kind, active: a.active, phoneNumbers: a.phoneNumbers })),
      whatsappToken: redactSecret(settings.secrets.metaWaToken),
    };
  });

  /**
   * Onboard a new customer: org, default settings, an agent, and an owner invite by email.
   * With `business`, it is any kind of business (clinic, salon, shop...) and gets an agent built from that profile;
   * `callNumber` / `whatsappNumber` are then linked straight away, so the agent is ready on both channels.
   */
  app.post("/admin/orgs", { preHandler: admin }, async (req, reply) => {
    const b = (req.body ?? {}) as {
      name?: string;
      showroomName?: string;
      plan?: string;
      ownerEmail?: string;
      ownerName?: string;
      ownerPhone?: string;
      agentTemplate?: string;
      business?: Partial<BusinessProfile>;
      agent?: { name?: string; languages?: string[]; defaultLanguage?: string; voice?: "female" | "male" };
      callNumber?: string;
      whatsappNumber?: string;
    };
    if (!b.name?.trim()) return reply.code(400).send({ error: "Business name is required" });
    if (b.plan && !PLAN_IDS.includes(b.plan as (typeof PLAN_IDS)[number])) return reply.code(400).send({ error: "Unknown plan" });
    const business = b.business ? businessProfileSchema.safeParse(b.business) : undefined;
    if (business && !business.success) return reply.code(400).send({ error: "Validation failed", issues: business.error.issues });
    const orgId = newId("org_");
    const numbers = { callNumber: b.callNumber?.trim() || undefined, whatsappNumber: b.whatsappNumber?.trim() || undefined };
    const numberError = await checkNumbers(orgId, numbers);
    if (numberError) return reply.code(400).send({ error: numberError });

    const org = orgSchema.parse({
      id: orgId,
      name: b.name.trim(),
      showroomName: b.showroomName?.trim() || b.name.trim(),
      createdAt: nowIso(),
      plan: b.plan ?? "trial",
      platform: { contact: { name: b.ownerName ?? "", phone: b.ownerPhone ?? "", email: b.ownerEmail ?? "" } },
      business: business?.data,
    });
    await global.orgs().set(org);
    const r = repo(orgId);
    await r.saveSettings({});
    if (business) {
      const picked = (b.agent?.languages ?? []).filter((l): l is Language => (LANGUAGES as readonly string[]).includes(l));
      const languages: Language[] = picked.length ? picked : ["en", "hi"];
      const wanted = b.agent?.defaultLanguage as Language;
      const name = b.agent?.name?.trim() || "Asha";
      await r.agents.set(agentConfigSchema.parse({ id: newId("ag_"), orgId, name, kind: "combined", languages, defaultLanguage: languages.includes(wanted) ? wanted : languages[0], ...businessAgentDefaults(name, languages, b.agent?.voice ?? "female") }));
    } else {
      const template = AGENT_TEMPLATES.find((t) => t.id === b.agentTemplate) ?? AGENT_TEMPLATES[1]!;
      await r.agents.set(agentConfigSchema.parse({ ...template, id: newId("ag_"), orgId }));
    }
    if (b.ownerEmail) {
      const email = b.ownerEmail.trim().toLowerCase();
      const invite = memberSchema.parse({ id: `invite:${email}`, orgId, email, name: b.ownerName || email, role: "owner", phone: b.ownerPhone || undefined, createdAt: nowIso() });
      await global.users().set(invite);
      await r.members.set(invite);
    }
    const setup = numbers.callNumber || numbers.whatsappNumber ? await connectNumbers(orgId, numbers) : {};
    return { ...((await global.orgs().get(orgId)) ?? org), setup };
  });

  /** Link a calling and/or WhatsApp number and configure the providers where possible; reports what is ready. */
  app.post("/admin/orgs/:id/connect", { preHandler: admin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await global.orgs().get(id))) return reply.code(404).send({ error: "Not found" });
    const b = (req.body ?? {}) as { callNumber?: string; whatsappNumber?: string };
    const numbers = { callNumber: b.callNumber?.trim() || undefined, whatsappNumber: b.whatsappNumber?.trim() || undefined };
    if (!numbers.callNumber && !numbers.whatsappNumber) return reply.code(400).send({ error: "Enter a calling or WhatsApp number" });
    const error = await checkNumbers(id, numbers);
    if (error) return reply.code(400).send({ error });
    return connectNumbers(id, numbers);
  });

  /** Plan, status, platform switches / limits / WhatsApp number, profile. */
  app.patch("/admin/orgs/:id", { preHandler: admin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const org = await global.orgs().get(id);
    if (!org) return reply.code(404).send({ error: "Not found" });
    const b = (req.body ?? {}) as { name?: string; showroomName?: string; plan?: string; status?: string; platform?: PlatformPatch; whatsappToken?: string; business?: Partial<BusinessProfile> };
    const cur = platformOf(org);
    const platform = b.platform ? mergePlatform(cur, b.platform) : cur;
    const business = b.business ? { business: { ...org.business, ...b.business } } : {};
    const parsed = orgSchema.safeParse({ ...org, ...(b.name ? { name: b.name } : {}), ...(b.showroomName ? { showroomName: b.showroomName } : {}), ...(b.plan ? { plan: b.plan } : {}), ...(b.status ? { status: b.status } : {}), platform, ...business });
    if (!parsed.success) return reply.code(400).send({ error: "Validation failed", issues: parsed.error.issues });
    await global.orgs().set(parsed.data);

    // Route incoming WhatsApp messages for the dealership's own number.
    if (cur.whatsapp.phoneNumberId && cur.whatsapp.phoneNumberId !== platform.whatsapp.phoneNumberId) await global.waRoutes().delete(cur.whatsapp.phoneNumberId);
    if (platform.whatsapp.phoneNumberId) await global.waRoutes().set({ id: platform.whatsapp.phoneNumberId, orgId: id });

    if (b.whatsappToken !== undefined && !b.whatsappToken.startsWith("****")) {
      const r = repo(id);
      const s = await r.settings();
      const secrets = { ...s.secrets };
      if (b.whatsappToken) secrets.metaWaToken = encryptString(b.whatsappToken);
      else delete secrets.metaWaToken;
      await r.saveSettings({ secrets });
    }
    return orgRow(parsed.data);
  });

  /** Link calling numbers to the dealership's agents: { agents: { [agentId]: ["+9180…"] } }. Incoming calls to a number reach that agent. */
  app.put("/admin/orgs/:id/numbers", { preHandler: admin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await global.orgs().get(id))) return reply.code(404).send({ error: "Not found" });
    const wanted = ((req.body ?? {}) as { agents?: Record<string, string[]> }).agents ?? {};
    const r = repo(id);
    const agents = await r.agents.list();
    const seen = new Set<string>();
    for (const [agentId, numbers] of Object.entries(wanted)) {
      if (!agents.some((a) => a.id === agentId)) return reply.code(400).send({ error: `Unknown agent ${agentId}` });
      for (const n of numbers) {
        const norm = normalizePhone(n);
        if (!/^\+\d{8,15}$/.test(norm)) return reply.code(400).send({ error: `"${n}" is not a valid phone number` });
        if (seen.has(norm)) return reply.code(400).send({ error: `${n} is linked to two agents; give each number to one agent` });
        seen.add(norm);
      }
    }
    const conflicts = await numberConflicts(id, [...seen]);
    if (conflicts.length) return reply.code(409).send({ error: conflicts.map((c) => `${c.number} is already linked to ${c.orgName}`).join("; ") });
    for (const a of agents) {
      if (!(a.id in wanted)) continue;
      await r.agents.set({ ...a, phoneNumbers: [...new Set(wanted[a.id]!.map(normalizePhone))] });
    }
    await syncPhoneRoutes(id);
    return { ok: true, agents: (await r.agents.list()).map((a) => ({ id: a.id, phoneNumbers: a.phoneNumbers })) };
  });
}
