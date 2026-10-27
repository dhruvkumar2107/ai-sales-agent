import { env } from "./config";
import { logger } from "./lib/logger";
import { buildServer } from "./server";

async function main() {
  const app = await buildServer();
  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info(`AXO Voice Auto API on :${env.PORT} (data=${env.DATA_BACKEND}, queue=${env.QUEUE_BACKEND}, telephony=${env.TELEPHONY_PROVIDER}, stt=${env.STT_PROVIDER}, tts=${env.TTS_PROVIDER}, llm=${env.LLM_PROVIDER})`);

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "fatal startup error");
  process.exit(1);
});
