import type { FastifyInstance, FastifyRequest } from "fastify";
import { ALL_ROLES, MANAGERS, orgOf, requireAuth } from "../auth/auth";
import { env } from "../config";
import { global, platformOf, repo } from "../db/repo";
import { hmacSha256, safeEqual } from "../lib/crypto";
import { logger } from "../lib/logger";
import { normalizePhone } from "../lib/mask";
import { conversationIdFor, sendOrgMessage } from "../messaging/service";
import { handleIncomingWhatsapp } from "../whatsapp/bot";

interface MetaWebhook {
  entry?: {
    changes?: {
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: { id: string; from: string; type: string; text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } } }[];
        statuses?: { id: string; status: string; errors?: { title?: string }[] }[];
      };
    }[];
  }[];
}

/** Meta signs the raw body with the app secret: X-Hub-Signature-256: sha256=<hex>. */
function verifyMeta(req: FastifyRequest): boolean {
  if (env.SKIP_SIGNATURE_VALIDATION || !env.META_APP_SECRET) return env.SKIP_SIGNATURE_VALIDATION || env.NODE_ENV !== "production";
  const sig = String(req.headers["x-hub-signature-256"] ?? "").replace(/^sha256=/, "");
  const raw = (req as FastifyRequest & { rawBody?: string }).rawBody ?? "";
  return Boolean(sig) && safeEqual(hmacSha256(env.META_APP_SECRET, raw), sig);
}

async function orgForNumber(phoneNumberId?: string): Promise<string | null> {
  if (phoneNumberId) {
    const route = await global.waRoutes().get(phoneNumberId);
    if (route) return route.orgId;
  }
  return env.WHATSAPP_DEFAULT_ORG_ID ?? env.DEV_ORG_ID ?? null;
}

export async function whatsappRoutes(app: FastifyInstance) {
  const rl = { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } };

  // ---------- Meta WhatsApp Cloud API webhook ----------
  /** Subscription check from the Meta app dashboard. */
  app.get("/webhooks/whatsapp", rl, async (req, reply) => {
    const q = req.query as Record<string, string>;
    if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === env.META_WA_VERIFY_TOKEN) return reply.type("text/plain").send(q["hub.challenge"] ?? "");
    return reply.code(403).send({ error: "verification failed" });
  });

  app.post("/webhooks/whatsapp", rl, async (req, reply) => {
    if (!verifyMeta(req)) return reply.code(401).send({ error: "invalid signature" });
    // Acknowledge at once (Meta retries slow webhooks), then process.
    reply.send({ ok: true });
    const body = req.body as MetaWebhook;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const v = change.value ?? {};
        const orgId = await orgForNumber(v.metadata?.phone_number_id);
        if (!orgId) continue;
        for (const s of v.statuses ?? []) {
          if (s.status !== "failed") continue;
          const msg = (await repo(orgId).messages.list({ where: { providerId: s.id } }))[0];
          if (msg) await repo(orgId).messages.update(msg.id, { status: "failed", error: s.errors?.[0]?.title ?? "delivery failed" });
        }
        for (const m of v.messages ?? []) {
          const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title;
          const name = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name;
          const input = text ?? `[${m.type} message]`;
          void handleIncomingWhatsapp({ orgId, phone: `+${m.from}`, text: input, customerName: name, providerId: m.id }).catch((err) =>
            logger.error({ orgId, err: (err as Error).message }, "incoming WhatsApp failed"),
          );
        }
      }
    }
  });

  // ---------- Dealer dashboard ----------
  const any = requireAuth(...ALL_ROLES);

  /** What the platform owner has enabled for this dealership (the dashboard shows switches read-only). */
  app.get("/api/whatsapp/status", { preHandler: any }, async (req) => {
    const org = await global.orgs().get(orgOf(req));
    const p = platformOf(org);
    const ownNumber = Boolean(p.whatsapp.phoneNumberId && (await repo(orgOf(req)).settings()).secrets.metaWaToken);
    return {
      features: p.features,
      displayNumber: p.whatsapp.displayNumber,
      provider: ownNumber ? "meta" : env.MESSAGING_PROVIDER,
      live: ownNumber || env.MESSAGING_PROVIDER !== "log",
      limits: p.limits,
    };
  });

  app.get("/api/whatsapp/conversations", { preHandler: any }, async (req) => {
    const list = await repo(orgOf(req)).conversations.list({ orderBy: "lastMessageAt", desc: true });
    return list.map(({ history: _h, ...c }) => c);
  });

  app.get("/api/whatsapp/conversations/:id", { preHandler: any }, async (req, reply) => {
    const r = repo(orgOf(req));
    const { id } = req.params as { id: string };
    const conv = await r.conversations.get(id);
    if (!conv) return reply.code(404).send({ error: "Not found" });
    if (conv.unread) await r.conversations.update(id, { unread: 0 });
    const messages = (await r.messages.list({ where: { conversationId: id }, orderBy: "createdAt" })).filter((m) => m.audience === "customer");
    const { history: _h, ...rest } = conv;
    return { conversation: { ...rest, unread: 0 }, messages };
  });

  /** Staff reply typed in the dashboard. */
  app.post("/api/whatsapp/conversations/:id/reply", { preHandler: any }, async (req, reply) => {
    const r = repo(orgOf(req));
    const { id } = req.params as { id: string };
    const conv = await r.conversations.get(id);
    if (!conv) return reply.code(404).send({ error: "Not found" });
    const text = String((req.body as { text?: string })?.text ?? "").trim();
    if (!text) return reply.code(400).send({ error: "text is required" });
    return sendOrgMessage({ orgId: orgOf(req), to: conv.phone, body: text, author: "staff" });
  });

  /** Switch the AI off for one chat (staff take over) or back on. */
  app.patch("/api/whatsapp/conversations/:id", { preHandler: any }, async (req, reply) => {
    const r = repo(orgOf(req));
    const { id } = req.params as { id: string };
    if (!(await r.conversations.get(id))) return reply.code(404).send({ error: "Not found" });
    const b = req.body as { botEnabled?: boolean };
    return r.conversations.update(id, { ...(typeof b.botEnabled === "boolean" ? { botEnabled: b.botEnabled } : {}) });
  });

  /** Every WhatsApp/SMS sent or received, newest first. */
  app.get("/api/messages", { preHandler: requireAuth(...MANAGERS) }, async (req) => {
    const q = req.query as Record<string, string>;
    let list = await repo(orgOf(req)).messages.list({ orderBy: "createdAt", desc: true });
    if (q.status) list = list.filter((m) => m.status === q.status);
    if (q.direction) list = list.filter((m) => m.direction === q.direction);
    return list.slice(0, Number(q.limit ?? 300));
  });

  /** Demo / testing: act as a customer sending a WhatsApp message; returns the AI's reply. */
  app.post("/api/whatsapp/simulate", { preHandler: any, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const b = req.body as { phone?: string; text?: string; name?: string };
    if (!b.phone || !b.text?.trim()) return reply.code(400).send({ error: "phone and text are required" });
    const phone = normalizePhone(b.phone);
    const res = await handleIncomingWhatsapp({ orgId: orgOf(req), phone, text: b.text.trim(), customerName: b.name });
    return { ...res, conversationId: conversationIdFor(phone) };
  });
}
