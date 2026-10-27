import { defineConfig } from "tsup";

export default defineConfig({
  // Named entries give flat outputs: dist/index.js, dist/worker.js, dist/simulate.js, dist/seed.js
  entry: { index: "src/index.ts", worker: "src/worker.ts", simulate: "src/simulator/cli.ts", seed: "scripts/seed.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Bundle the workspace package (it ships TypeScript source); keep real npm deps external.
  noExternal: ["@axo/shared"],
});
