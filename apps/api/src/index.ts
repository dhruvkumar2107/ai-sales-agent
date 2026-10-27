import { env } from "./config";
import { liveSessions } from "./calls/live";
import { global } from "./db/repo";
import { getStore } from "./db/store";
import { logger } from "./lib/logger";
import { startEventWiring, startJobs } from "./queue/handlers";
import { jobQueue } from "./queue";
import { buildServer } from "./server";

async function main() {
  if (env.SEED_DEMO_ON_START && !(await global.orgs().get(env.DEV_ORG_ID))) {
    const { seedDemo } = await import("./demo/seed-demo");
    await seedDemo(env.DEV_ORG_ID);
    logger.info(`seeded demo dealership "${env.DEV_ORG_ID}"`);
  }
  const app = await buildServer();
  startEventWiring();
  // With the in-memory queue, jobs run inside the API process; with BullMQ a separate worker runs them.
  if (env.QUEUE_BACKEND === "memory") await startJobs();
  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info(`AXO Voice Auto API on :${env.PORT} (data=${env.DATA_BACKEND}, queue=${env.QUEUE_BACKEND}, telephony=${env.TELEPHONY_PROVIDER}, stt=${env.STT_PROVIDER}, tts=${env.TTS_PROVIDER}, llm=${env.LLM_PROVIDER})`);

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down (${liveSessions.size} live calls)`);
    // End live calls cleanly so transcripts and costs are saved.
    await Promise.allSettled([...liveSessions.values()].map((s) => s.session.end("dropped")));
    await app.close();
    await jobQueue().close();
    getStore().flush?.();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "fatal startup error");
  process.exit(1);
});
