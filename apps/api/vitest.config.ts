import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    env: { DATA_BACKEND: "memory", QUEUE_BACKEND: "memory", AUTH_MODE: "dev", LLM_PROVIDER: "mock", STT_PROVIDER: "mock", TTS_PROVIDER: "mock", TELEPHONY_PROVIDER: "mock", LOG_LEVEL: "silent" },
  },
});
