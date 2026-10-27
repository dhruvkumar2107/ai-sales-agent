import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import rateLimit from "@fastify/rate-limit";
import { env } from "./config";
import { logger } from "./lib/logger";
import { campaignRoutes } from "./routes/campaigns";
import { dashboardRoutes } from "./routes/dashboard";
import { attachMediaServer } from "./routes/media";
import { setupRoutes } from "./routes/setup";
import { telephonyRoutes } from "./routes/telephony";

export async function buildServer() {
  const app: FastifyInstance = Fastify({ logger: logger as unknown as FastifyBaseLogger, trustProxy: true, bodyLimit: 10 * 1024 * 1024 });

  await app.register(cors, { origin: env.WEB_ORIGIN.split(","), credentials: true });
  await app.register(formbody);
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  // Keep the raw body for webhook signature checks and accept CSV uploads as text.
  app.addContentTypeParser(["text/csv", "text/plain"], { parseAs: "string" }, (_req, body, done) => done(null, body));

  app.get("/health", async () => ({ ok: true, time: new Date().toISOString() }));

  await setupRoutes(app);
  await telephonyRoutes(app);
  await dashboardRoutes(app);
  await campaignRoutes(app);
  attachMediaServer(app);

  app.setErrorHandler((err, req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, "request failed");
    reply.code(status).send({ error: status >= 500 ? "Internal server error" : err.message });
  });

  return app;
}
