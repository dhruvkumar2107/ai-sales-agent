import { env } from "./config";
import { logger } from "./lib/logger";
import { jobQueue } from "./queue";
import { startJobs } from "./queue/handlers";

/**
 * Background worker (BullMQ): campaign dialling, lead follow-ups, reminders, scheduled messages and
 * retention purges. Live calls themselves are handled by the API process (media WebSockets).
 */
async function main() {
  if (env.QUEUE_BACKEND !== "bullmq") {
    logger.warn("QUEUE_BACKEND is not bullmq; jobs already run inside the API process. Exiting worker.");
    return;
  }
  await startJobs();
  logger.info("worker running");
  const stop = async () => {
    await jobQueue().close();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}

main().catch((err) => {
  logger.error({ err }, "worker crashed");
  process.exit(1);
});
