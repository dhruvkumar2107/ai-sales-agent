import { env } from "./config";
import { logger } from "./lib/logger";

/** Standalone background worker process (BullMQ). Started separately in docker-compose. */
async function main() {
  logger.info(`worker starting (queue=${env.QUEUE_BACKEND})`);
}

main().catch((err) => {
  logger.error({ err }, "worker crashed");
  process.exit(1);
});
