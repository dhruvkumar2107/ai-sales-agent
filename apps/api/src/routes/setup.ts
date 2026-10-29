import type { FastifyInstance } from "fastify";
import {
  agentConfigSchema,
  branchSchema,
  catalogModelSchema,
  customerVehicleSchema,
  memberSchema,
  offerSchema,
  orgSchema,
  orgSettingsSchema,
  testDriveVehicleSchema,
} from "@axo/shared";
import { AGENT_TEMPLATES } from "../../prompts/agents";
import { authenticate, HttpError, MANAGERS, orgOf, requireAuth } from "../auth/auth";
import { global, newId, nowIso, repo } from "../db/repo";
import { parseCatalogCsv } from "../integrations/csv-import";
import { encryptString, redactSecret } from "../lib/crypto";
import { syncPhoneRoutes } from "../calls/numbers";
import { crudRoutes } from "./crud";

const slug = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

export async function setupRoutes(app: FastifyInstance) {
  // ---------- Auth / onboarding ----------
  app.get("/api/me", async (req, reply) => {
    try {
      const auth = await authenticate(req);
      const org = auth.orgId ? await global.orgs().get(auth.orgId) : null;
      return { ...auth, org };
    } catch (e) {
      return reply.code((e as HttpError).statusCode ?? 401).send({ error: (e as Error).message });
    }
  });

  /** First login: create a dealership group with the caller as owner, or accept a pending invite. */
  app.post("/api/auth/bootstrap", async (req, reply) => {
    const auth = await authenticate(req).catch((e) => {
      reply.code(401).send({ error: (e as Error).message });
      return null;
    });
    if (!auth) return;
    if (auth.orgId) return { orgId: auth.orgId, role: auth.role };

    const invite = await global.users().get(`invite:${auth.email.toLowerCase()}`);
    if (invite) {
      const member = { ...invite, id: auth.uid, createdAt: nowIso() };
      await global.users().set(member);
      await repo(invite.orgId).members.set(member);
      await global.users().delete(invite.id);
      return { orgId: invite.orgId, role: invite.role };
    }

    const body = (req.body ?? {}) as { dealershipName?: string; showroomName?: string; name?: string };
    const orgId = newId("org_");
    await global.orgs().set(
      orgSchema.parse({
        id: orgId,
        name: body.dealershipName ?? "My Dealership",
        showroomName: body.showroomName ?? body.dealershipName ?? "My Showroom",
        createdAt: nowIso(),
      }),
    );
    const member = memberSchema.parse({ id: auth.uid, orgId, email: auth.email, name: body.name ?? auth.email, role: "owner", createdAt: nowIso() });
    await global.users().set(member);
    await repo(orgId).members.set(member);
    await repo(orgId).saveSettings({});
    return { orgId, role: "owner" };
  });

  app.patch("/api/org", { preHandler: requireAuth("owner") }, async (req) => {
    const orgId = orgOf(req);
    const cur = await global.orgs().get(orgId);
    // Only profile fields: plan, status and platform controls belong to the admin panel.
    const { name, showroomName, brands } = (req.body ?? {}) as { name?: string; showroomName?: string; brands?: string[] };
    const next = { ...cur!, ...(name ? { name } : {}), ...(showroomName ? { showroomName } : {}), ...(brands ? { brands } : {}), id: orgId };
    await global.orgs().set(next);
    return next;
  });

  // ---------- Setup wizard collections ----------
  crudRoutes(app, { path: "/api/branches", collection: "branches", schema: branchSchema, idPrefix: "br_" });
  crudRoutes(app, { path: "/api/catalog", collection: "catalog", schema: catalogModelSchema, idFrom: (b) => `${slug(b.brand)}-${slug(b.model)}`, orderBy: "model" });
  crudRoutes(app, { path: "/api/offers", collection: "offers", schema: offerSchema, idPrefix: "of_" });
  crudRoutes(app, { path: "/api/test-drive-vehicles", collection: "testDriveVehicles", schema: testDriveVehicleSchema, idPrefix: "tdv_" });
  crudRoutes(app, { path: "/api/agents", collection: "agents", schema: agentConfigSchema, idPrefix: "ag_", writeRoles: ["owner"], adminOnly: ["phoneNumbers"] });
  crudRoutes(app, { path: "/api/customer-vehicles", collection: "customerVehicles", schema: customerVehicleSchema, idPrefix: "cv_" });

  app.get("/api/agent-templates", { preHandler: requireAuth() }, async (req) => AGENT_TEMPLATES.map((t) => ({ ...t, orgId: orgOf(req) })));

  // When agents change (numbers are linked by the platform owner), keep the inbound routing table in sync.
  app.addHook("onResponse", async (req, reply) => {
    if (!req.url.startsWith("/api/agents") || req.method === "GET" || reply.statusCode >= 300 || !req.auth?.orgId) return;
    await syncPhoneRoutes(req.auth.orgId);
  });

  /** CSV catalog import. Body: raw CSV text (text/csv) or { csv } JSON. ?replace=true removes models not in the file. */
  app.post("/api/catalog/import", { preHandler: requireAuth(...MANAGERS) }, async (req) => {
    const orgId = orgOf(req);
    const csv = typeof req.body === "string" ? req.body : ((req.body as { csv?: string })?.csv ?? "");
    const { models, errors } = parseCatalogCsv(orgId, csv);
    const r = repo(orgId);
    if ((req.query as { replace?: string }).replace === "true") {
      const keep = new Set(models.map((m) => m.id));
      for (const m of await r.catalog.list()) if (!keep.has(m.id)) await r.catalog.delete(m.id);
    }
    for (const m of models) await r.catalog.set(m);
    const org = await global.orgs().get(orgId);
    if (org) {
      const brands = [...new Set([...org.brands, ...models.map((m) => m.brand)])];
      await global.orgs().set({ ...org, brands });
    }
    return { imported: models.length, variants: models.reduce((n, m) => n + m.variants.length, 0), errors };
  });

  // ---------- Settings ----------
  app.get("/api/settings", { preHandler: requireAuth(...MANAGERS) }, async (req) => {
    const s = await repo(orgOf(req)).settings();
    return {
      ...s,
      secrets: Object.fromEntries(Object.entries(s.secrets).map(([k, v]) => [k, redactSecret(v)])),
      webhooks: { ...s.webhooks, dmsAuthHeader: redactSecret(s.webhooks.dmsAuthHeader), leadIntakeSecret: redactSecret(s.webhooks.leadIntakeSecret) },
    };
  });

  app.patch("/api/settings", { preHandler: requireAuth("owner") }, async (req, reply) => {
    const r = repo(orgOf(req));
    const cur = await r.settings();
    const body = (req.body ?? {}) as Record<string, unknown> & { secrets?: Record<string, string>; webhooks?: Record<string, string> };
    // Secrets are write-only: encrypt new values, keep existing when the redacted placeholder is sent back.
    const secrets = { ...cur.secrets };
    for (const [k, v] of Object.entries(body.secrets ?? {})) {
      if (!v) delete secrets[k];
      else if (!v.startsWith("****")) secrets[k] = encryptString(v);
    }
    const webhooks = { ...cur.webhooks, ...(body.webhooks ?? {}) };
    for (const k of ["dmsAuthHeader", "leadIntakeSecret"] as const) {
      const v = body.webhooks?.[k];
      webhooks[k] = v === undefined || v.startsWith("****") ? cur.webhooks[k] : v ? encryptString(v) : "";
    }
    const parsed = orgSettingsSchema.safeParse({ ...cur, ...body, secrets, webhooks, orgId: cur.orgId });
    if (!parsed.success) return reply.code(400).send({ error: "Validation failed", issues: parsed.error.issues });
    await r.saveSettings(parsed.data);
    return { ok: true };
  });

  // ---------- Team ----------
  app.get("/api/team", { preHandler: requireAuth() }, async (req) => repo(orgOf(req)).members.list({ orderBy: "name" }));

  /** Invite a member by email; they join on first login. Also creates a placeholder member for assignment. */
  app.post("/api/team", { preHandler: requireAuth("owner", "sales_manager") }, async (req, reply) => {
    const orgId = orgOf(req);
    const body = req.body as Record<string, unknown>;
    const parsed = memberSchema.safeParse({ ...body, id: `invite:${String(body.email ?? "").toLowerCase()}`, orgId, createdAt: nowIso() });
    if (!parsed.success) return reply.code(400).send({ error: "Validation failed", issues: parsed.error.issues });
    if (parsed.data.role === "owner" && req.auth?.role !== "owner") return reply.code(403).send({ error: "Only owners can add owners" });
    await global.users().set(parsed.data);
    await repo(orgId).members.set(parsed.data);
    return parsed.data;
  });

  app.patch("/api/team/:id", { preHandler: requireAuth(...MANAGERS) }, async (req, reply) => {
    const orgId = orgOf(req);
    const { id } = req.params as { id: string };
    const r = repo(orgId);
    const cur = await r.members.get(id);
    if (!cur) return reply.code(404).send({ error: "Not found" });
    const next = memberSchema.parse({ ...cur, ...(req.body as object), id, orgId });
    await r.members.set(next);
    await global.users().set(next);
    return next;
  });

  app.delete("/api/team/:id", { preHandler: requireAuth("owner") }, async (req) => {
    const { id } = req.params as { id: string };
    await repo(orgOf(req)).members.delete(id);
    await global.users().delete(id);
    return { ok: true };
  });
}
