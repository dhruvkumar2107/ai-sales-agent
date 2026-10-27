import type { FastifyInstance } from "fastify";
import { LEAD_STAGES, leadSchema, serviceBookingSchema, testDriveSchema, vehicleBookingSchema, type Lead } from "@axo/shared";
import { ALL_ROLES, MANAGERS, orgOf, requireAuth } from "../auth/auth";
import { liveCount } from "../calls/live";
import { placeOutboundCall } from "../calls/outbound";
import { newId, nowIso, repo } from "../db/repo";
import { getDecrypted } from "../lib/storage";
import { normalizePhone } from "../lib/mask";
import { upsertLead } from "../leads/service";
import { crudRoutes } from "./crud";

const inRange = (iso: string, from?: string, to?: string) => (!from || iso >= from) && (!to || iso <= to);

export async function dashboardRoutes(app: FastifyInstance) {
  const any = requireAuth(...ALL_ROLES);

  // ---------- Leads (kanban) ----------
  app.get("/api/leads", { preHandler: any }, async (req) => {
    const q = req.query as Record<string, string>;
    let leads = await repo(orgOf(req)).leads.list({ orderBy: "updatedAt", desc: true });
    // Sales executives see their own leads only.
    if (req.auth?.role === "sales_executive") leads = leads.filter((l) => l.assignedTo === req.auth!.uid);
    if (q.branchId) leads = leads.filter((l) => l.branchId === q.branchId);
    if (q.score) leads = leads.filter((l) => l.score === q.score);
    if (q.source) leads = leads.filter((l) => l.source === q.source);
    if (q.assignedTo) leads = leads.filter((l) => l.assignedTo === q.assignedTo);
    if (q.q) {
      const s = q.q.toLowerCase();
      leads = leads.filter((l) => `${l.name ?? ""} ${l.phone} ${l.interestedModel ?? ""}`.toLowerCase().includes(s));
    }
    return leads;
  });

  app.post("/api/leads", { preHandler: any }, async (req, reply) => {
    const b = req.body as Record<string, unknown>;
    if (!b.phone) return reply.code(400).send({ error: "phone is required" });
    const { lead } = await upsertLead(orgOf(req), { ...(b as object), phone: String(b.phone), source: (b.source as Lead["source"]) ?? "walk_in" });
    return lead;
  });

  app.patch("/api/leads/:id", { preHandler: any }, async (req, reply) => {
    const r = repo(orgOf(req));
    const { id } = req.params as { id: string };
    const cur = await r.leads.get(id);
    if (!cur) return reply.code(404).send({ error: "Not found" });
    const body = req.body as Partial<Lead> & { note?: string };
    if (body.stage && !LEAD_STAGES.includes(body.stage)) return reply.code(400).send({ error: "invalid stage" });
    const notesLog = body.note ? [...cur.notesLog, { at: nowIso(), by: req.auth?.email ?? "user", text: body.note }] : cur.notesLog;
    const { note: _n, ...rest } = body;
    const parsed = leadSchema.safeParse({ ...cur, ...rest, id, orgId: cur.orgId, notesLog, updatedAt: nowIso() });
    if (!parsed.success) return reply.code(400).send({ error: "Validation failed", issues: parsed.error.issues });
    await r.leads.set(parsed.data);
    return parsed.data;
  });

  app.delete("/api/leads/:id", { preHandler: requireAuth(...MANAGERS) }, async (req) => {
    await repo(orgOf(req)).leads.delete((req.params as { id: string }).id);
    return { ok: true };
  });

  // ---------- Calendars ----------
  app.get("/api/test-drives", { preHandler: any }, async (req) => {
    const q = req.query as Record<string, string>;
    const list = await repo(orgOf(req)).testDrives.list({ where: { branchId: q.branchId }, orderBy: "start" });
    return list.filter((t) => inRange(t.start, q.from, q.to));
  });
  app.get("/api/service-bookings", { preHandler: any }, async (req) => {
    const q = req.query as Record<string, string>;
    const list = await repo(orgOf(req)).serviceBookings.list({ where: { branchId: q.branchId, vehicleNo: q.vehicleNo }, orderBy: "start" });
    return list.filter((t) => inRange(t.start, q.from, q.to));
  });
  crudRoutes(app, { path: "/api/test-drives-admin", collection: "testDrives", schema: testDriveSchema, idPrefix: "td_", readRoles: ALL_ROLES, writeRoles: ALL_ROLES });
  crudRoutes(app, { path: "/api/service-bookings-admin", collection: "serviceBookings", schema: serviceBookingSchema, idPrefix: "svc_", readRoles: ALL_ROLES, writeRoles: ALL_ROLES });
  crudRoutes(app, { path: "/api/vehicle-bookings", collection: "vehicleBookings", schema: vehicleBookingSchema, idPrefix: "vb_", readRoles: ALL_ROLES, writeRoles: ALL_ROLES, orderBy: "updatedAt" });

  // ---------- Tickets & callbacks ----------
  app.get("/api/tickets", { preHandler: any }, async (req) => repo(orgOf(req)).tickets.list({ orderBy: "createdAt", desc: true }));
  app.patch("/api/tickets/:id", { preHandler: any }, async (req) => {
    const { id } = req.params as { id: string };
    return repo(orgOf(req)).tickets.update(id, req.body as object);
  });
  app.get("/api/callbacks", { preHandler: any }, async (req) => {
    const list = await repo(orgOf(req)).callbacks.list({ orderBy: "dueAt" });
    return req.auth?.role === "sales_executive" ? list.filter((c) => c.assignedTo === req.auth!.uid) : list;
  });
  app.patch("/api/callbacks/:id", { preHandler: any }, async (req) => {
    const { id } = req.params as { id: string };
    return repo(orgOf(req)).callbacks.update(id, req.body as object);
  });

  // ---------- Call logs ----------
  app.get("/api/calls", { preHandler: any }, async (req) => {
    const q = req.query as Record<string, string>;
    let calls = await repo(orgOf(req)).calls.list({ orderBy: "startedAt", desc: true });
    if (q.direction) calls = calls.filter((c) => c.direction === q.direction);
    if (q.outcome) calls = calls.filter((c) => c.outcome === q.outcome);
    if (q.leadScore) calls = calls.filter((c) => c.leadScore === q.leadScore);
    if (q.sentiment) calls = calls.filter((c) => c.sentiment === q.sentiment);
    if (q.campaignId) calls = calls.filter((c) => c.campaignId === q.campaignId);
    if (q.from || q.to) calls = calls.filter((c) => inRange(c.startedAt, q.from, q.to));
    if (q.q) {
      const s = q.q.toLowerCase();
      calls = calls.filter((c) => `${c.from} ${c.to} ${c.summary ?? ""} ${c.extracted.name ?? ""} ${c.extracted.interestedModel ?? ""}`.toLowerCase().includes(s));
    }
    const limit = Number(q.limit ?? 200);
    // List view omits the heavy transcript.
    return calls.slice(0, limit).map(({ transcript, ...c }) => ({ ...c, turns: transcript.filter((t) => t.role !== "tool").length }));
  });

  app.get("/api/calls/:id", { preHandler: any }, async (req, reply) => {
    const call = await repo(orgOf(req)).calls.get((req.params as { id: string }).id);
    return call ?? reply.code(404).send({ error: "Not found" });
  });

  /** Decrypts and streams the recording. The audio element passes the ID token as ?token=. */
  app.get("/api/calls/:id/recording", { preHandler: any }, async (req, reply) => {
    const call = await repo(orgOf(req)).calls.get((req.params as { id: string }).id);
    if (!call?.recordingPath) return reply.code(404).send({ error: "No recording" });
    const wav = await getDecrypted(call.recordingPath);
    reply.header("Cache-Control", "private, no-store").type("audio/wav").send(wav);
  });

  app.get("/api/live", { preHandler: any }, async (req) => ({ activeCalls: liveCount(orgOf(req)) }));

  // ---------- Test console: "call my phone" ----------
  app.post("/api/console/call", { preHandler: any, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const b = req.body as { phone?: string; agentId?: string; campaignType?: string };
    if (!b.phone) return reply.code(400).send({ error: "phone is required" });
    const res = await placeOutboundCall({ orgId: orgOf(req), to: normalizePhone(b.phone), agentId: b.agentId, campaignType: b.campaignType, ignoreCallingHours: true });
    return res;
  });

  // ---------- Overview ----------
  app.get("/api/overview", { preHandler: any }, async (req) => {
    const r = repo(orgOf(req));
    const today = new Date().toISOString().slice(0, 10);
    const [calls, leads, tds, svc, callbacks] = await Promise.all([r.calls.list(), r.leads.list(), r.testDrives.list(), r.serviceBookings.list(), r.callbacks.list({ where: { status: "pending" } })]);
    return {
      activeCalls: liveCount(r.orgId),
      callsToday: calls.filter((c) => c.startedAt.startsWith(today)).length,
      newLeadsToday: leads.filter((l) => l.createdAt.startsWith(today)).length,
      hotLeads: leads.filter((l) => l.score === "hot" && !["won", "lost"].includes(l.stage)).length,
      testDrivesToday: tds.filter((t) => t.start.startsWith(today) && t.status === "booked").length,
      serviceToday: svc.filter((s) => s.start.startsWith(today)).length,
      pendingCallbacks: callbacks.length,
      recentCalls: calls.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 6).map(({ transcript, ...c }) => c),
      callbacks: callbacks.slice(0, 8),
    };
  });

  // Placeholder billing: usage-based summary for the current month.
  app.get("/api/billing", { preHandler: requireAuth("owner") }, async (req) => {
    const month = new Date().toISOString().slice(0, 7);
    const calls = (await repo(orgOf(req)).calls.list()).filter((c) => c.startedAt.startsWith(month));
    const minutes = calls.reduce((n, c) => n + Math.ceil(c.durationSec / 60), 0);
    return { month, calls: calls.length, minutes, usageCostInr: Math.round(calls.reduce((n, c) => n + c.cost.total, 0)), plan: "trial", invoiceId: newId("inv_") };
  });
}
