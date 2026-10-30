import type { FastifyInstance } from "fastify";
import { requireSuperAdmin } from "../auth/auth";
import { buyTwilioNumber, completeWhatsappSignup, embeddedSignupReady, orgFromConnectToken, searchTwilioNumbers, twilioReady, whatsappConnectLink } from "../calls/provision";
import { env } from "../config";
import { global, platformOf } from "../db/repo";

/** Buying numbers (admin) and the public "Connect WhatsApp" page a business opens itself. */
export async function provisionRoutes(app: FastifyInstance) {
  const admin = requireSuperAdmin();

  /** Numbers Twilio can sell: ?country=IN&type=local|mobile|tollfree&contains=80 */
  app.get("/admin/twilio/available", { preHandler: admin }, async (req, reply) => {
    const q = req.query as { country?: string; type?: string; contains?: string };
    try {
      return { numbers: await searchTwilioNumbers(q) };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  /** Buy a number for a business: configured and linked to its agent on purchase. */
  app.post("/admin/orgs/:id/buy-number", { preHandler: admin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await global.orgs().get(id))) return reply.code(404).send({ error: "Not found" });
    const { phoneNumber } = (req.body ?? {}) as { phoneNumber?: string };
    if (!phoneNumber) return reply.code(400).send({ error: "Pick a number" });
    try {
      return await buyTwilioNumber(id, phoneNumber);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  /** The link to send a business so it connects its own WhatsApp number. */
  app.get("/admin/orgs/:id/whatsapp-link", { preHandler: admin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await global.orgs().get(id))) return reply.code(404).send({ error: "Not found" });
    return whatsappConnectLink(id);
  });

  app.get("/admin/provisioning", { preHandler: admin }, async () => ({ twilio: twilioReady(), whatsappSelfConnect: embeddedSignupReady() }));

  // ---------- public: opened by the business, authorised by the signed link ----------

  app.get("/public/whatsapp-connect/:token", async (req, reply) => {
    const orgId = orgFromConnectToken((req.params as { token: string }).token);
    const org = orgId ? await global.orgs().get(orgId) : null;
    if (!org) return reply.code(404).send({ error: "This link has expired. Ask for a new one." });
    const p = platformOf(org);
    return { businessName: org.name, connected: Boolean(p.whatsapp.phoneNumberId), displayNumber: p.whatsapp.displayNumber, ready: embeddedSignupReady(), appId: env.META_APP_ID ?? "", configId: env.META_ES_CONFIG_ID ?? "", graphVersion: env.META_GRAPH_VERSION };
  });

  app.post("/public/whatsapp-connect/:token", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const orgId = orgFromConnectToken((req.params as { token: string }).token);
    if (!orgId || !(await global.orgs().get(orgId))) return reply.code(404).send({ error: "This link has expired. Ask for a new one." });
    const b = (req.body ?? {}) as { code?: string; phoneNumberId?: string; wabaId?: string };
    if (!b.code || !b.phoneNumberId || !b.wabaId) return reply.code(400).send({ error: "WhatsApp setup was not finished. Please try again." });
    try {
      return { ok: true, ...(await completeWhatsappSignup(orgId, { code: b.code, phoneNumberId: b.phoneNumberId, wabaId: b.wabaId })) };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
