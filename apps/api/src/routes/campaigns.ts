import type { FastifyInstance, FastifyRequest } from "fastify";
import { campaignSchema, newLeadWebhookSchema, vehicleBookingSchema } from "@axo/shared";
import { analyticsFor } from "../analytics/compute";
import { MANAGERS, orgOf, requireAuth } from "../auth/auth";
import { addContacts, campaignTick, onBookingStatusChange, parseContactsCsv, refreshStats, reminderScan, scheduleLeadFollowups } from "../campaigns/service";
import { importDndList } from "../compliance/dnd";
import { env } from "../config";
import { global, newId, nowIso, repo } from "../db/repo";
import { decryptString, hmacSha256, safeEqual } from "../lib/crypto";
import { logger } from "../lib/logger";
import { upsertLead } from "../leads/service";

const CAMPAIGN_ROLES = ["owner", "sales_manager", "service_advisor"] as const;

/** HMAC-SHA256 over the raw JSON body, hex, in X-AXO-Signature. Secret: org setting, else LEAD_WEBHOOK_SECRET. */
async function verifyWebhook(req: FastifyRequest, orgId: string): Promise<boolean> {
  if (env.SKIP_SIGNATURE_VALIDATION) return true;
  const settings = await repo(orgId).settings();
  const secret = settings.webhooks.leadIntakeSecret ? decryptString(settings.webhooks.leadIntakeSecret) : env.LEAD_WEBHOOK_SECRET;
  const sig = String(req.headers["x-axo-signature"] ?? "");
  const raw = (req as FastifyRequest & { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
  return Boolean(sig) && safeEqual(hmacSha256(secret, raw), sig);
}

export async function campaignRoutes(app: FastifyInstance) {
  // Keep the exact bytes of JSON bodies for webhook signature checks.
  app.addHook("preParsing", async (req, _reply, payload) => {
    if (!req.url.startsWith("/webhooks/")) return payload;
    const chunks: Buffer[] = [];
    for await (const c of payload) chunks.push(Buffer.from(c as Buffer));
    const raw = Buffer.concat(chunks);
    (req as FastifyRequest & { rawBody?: string }).rawBody = raw.toString("utf8");
    const { Readable } = await import("node:stream");
    return Readable.from(raw);
  });

  const roles = requireAuth(...CAMPAIGN_ROLES);

  // ---------- Campaigns ----------
  app.get("/api/campaigns", { preHandler: roles }, async (req) => repo(orgOf(req)).campaigns.list({ orderBy: "createdAt", desc: true }));

  app.get("/api/campaigns/:id", { preHandler: roles }, async (req, reply) => {
    const r = repo(orgOf(req));
    const { id } = req.params as { id: string };
    const campaign = await r.campaigns.get(id);
    if (!campaign) return reply.code(404).send({ error: "Not found" });
    const contacts = await r.campaignContacts.list({ where: { campaignId: id } });
    return { campaign, contacts };
  });

  app.post("/api/campaigns", { preHandler: roles }, async (req, reply) => {
    const orgId = orgOf(req);
    const parsed = campaignSchema.safeParse({ ...(req.body as object), id: newId("cmp_"), orgId, status: "draft", createdAt: nowIso() });
    if (!parsed.success) return reply.code(400).send({ error: "Validation failed", issues: parsed.error.issues });
    await repo(orgId).campaigns.set(parsed.data);
    return parsed.data;
  });

  app.patch("/api/campaigns/:id", { preHandler: roles }, async (req, reply) => {
    const r = repo(orgOf(req));
    const { id } = req.params as { id: string };
    const cur = await r.campaigns.get(id);
    if (!cur) return reply.code(404).send({ error: "Not found" });
    const parsed = campaignSchema.safeParse({ ...cur, ...(req.body as object), id, orgId: cur.orgId });
    if (!parsed.success) return reply.code(400).send({ error: "Validation failed", issues: parsed.error.issues });
    await r.campaigns.set(parsed.data);
    return parsed.data;
  });

  app.delete("/api/campaigns/:id", { preHandler: requireAuth(...MANAGERS) }, async (req) => {
    const r = repo(orgOf(req));
    const { id } = req.params as { id: string };
    for (const c of await r.campaignContacts.list({ where: { campaignId: id } })) await r.campaignContacts.delete(c.id);
    await r.campaigns.delete(id);
    return { ok: true };
  });

  /** Upload contacts as CSV text (phone,name,...extra columns become agent context). */
  app.post("/api/campaigns/:id/contacts", { preHandler: roles }, async (req, reply) => {
    const orgId = orgOf(req);
    const { id } = req.params as { id: string };
    if (!(await repo(orgId).campaigns.get(id))) return reply.code(404).send({ error: "Not found" });
    const csv = typeof req.body === "string" ? req.body : ((req.body as { csv?: string }).csv ?? "");
    const contacts = parseContactsCsv(csv);
    const added = await addContacts(orgId, id, contacts);
    return { parsed: contacts.length, added };
  });

  app.post("/api/campaigns/:id/start", { preHandler: roles }, async (req) => {
    const orgId = orgOf(req);
    const { id } = req.params as { id: string };
    await repo(orgId).campaigns.update(id, { status: "running" });
    await campaignTick(orgId);
    await refreshStats(orgId, id);
    return repo(orgId).campaigns.get(id);
  });

  app.post("/api/campaigns/:id/pause", { preHandler: roles }, async (req) => {
    const orgId = orgOf(req);
    const { id } = req.params as { id: string };
    return repo(orgId).campaigns.update(id, { status: "paused" });
  });

  /** Run the reminder scan now (normally daily at 10:00 IST). */
  app.post("/api/campaigns/run-reminders", { preHandler: roles }, async (req) => {
    await reminderScan(orgOf(req));
    return { ok: true };
  });

  // ---------- Booking-to-delivery updates ----------
  app.post("/api/vehicle-bookings/:id/status", { preHandler: requireAuth() }, async (req, reply) => {
    const orgId = orgOf(req);
    const r = repo(orgId);
    const { id } = req.params as { id: string };
    const cur = await r.vehicleBookings.get(id);
    if (!cur) return reply.code(404).send({ error: "Not found" });
    const parsed = vehicleBookingSchema.safeParse({ ...cur, ...(req.body as object), id, orgId, updatedAt: nowIso() });
    if (!parsed.success) return reply.code(400).send({ error: "Validation failed", issues: parsed.error.issues });
    await r.vehicleBookings.set(parsed.data);
    await onBookingStatusChange(orgId, id);
    return parsed.data;
  });

  // ---------- Public webhooks (signed) ----------
  /** New lead from Facebook/Instagram lead ads, website forms or walk-in apps: call within 2 minutes. */
  app.post("/webhooks/leads/:orgId", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    if (!(await global.orgs().get(orgId))) return reply.code(404).send({ error: "Unknown organisation" });
    if (!(await verifyWebhook(req, orgId))) return reply.code(401).send({ error: "Invalid signature" });
    const parsed = newLeadWebhookSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Validation failed", issues: parsed.error.issues });
    const { lead, created } = await upsertLead(orgId, { ...parsed.data, note: parsed.data.notes });
    if (created) await scheduleLeadFollowups(orgId, lead.id);
    logger.info({ leadId: lead.id, source: lead.source, created }, "lead webhook received");
    return { ok: true, leadId: lead.id, created, followUp: created ? "calling within 2 minutes (inside calling hours)" : "existing lead updated" };
  });

  /** DMS pushes booking status changes here to trigger update calls and messages. */
  app.post("/webhooks/booking-status/:orgId", async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    if (!(await verifyWebhook(req, orgId))) return reply.code(401).send({ error: "Invalid signature" });
    const b = req.body as Record<string, unknown>;
    const r = repo(orgId);
    const id = String(b.id ?? newId("vb_"));
    const cur = await r.vehicleBookings.get(id);
    const parsed = vehicleBookingSchema.safeParse({ createdAt: nowIso(), pendingDocuments: [], ...(cur ?? {}), ...b, id, orgId, updatedAt: nowIso() });
    if (!parsed.success) return reply.code(400).send({ error: "Validation failed", issues: parsed.error.issues });
    await r.vehicleBookings.set(parsed.data);
    await onBookingStatusChange(orgId, id);
    return { ok: true };
  });

  // ---------- Analytics ----------
  app.get("/api/analytics", { preHandler: requireAuth(...MANAGERS) }, async (req) => {
    const q = req.query as { from?: string; to?: string };
    const to = q.to ?? new Date().toISOString();
    const from = q.from ?? new Date(Date.now() - 30 * 86400_000).toISOString();
    return analyticsFor(orgOf(req), from, to);
  });

  // ---------- Compliance ----------
  app.post("/api/compliance/dnd", { preHandler: requireAuth(...MANAGERS) }, async (req) => {
    const numbers = ((req.body as { numbers?: string[] }).numbers ?? []).slice(0, 100_000);
    await importDndList(numbers);
    return { imported: numbers.length };
  });

  app.get("/api/compliance/opt-outs", { preHandler: requireAuth(...MANAGERS) }, async (req) => repo(orgOf(req)).optOuts.list({ orderBy: "createdAt", desc: true }));
}
