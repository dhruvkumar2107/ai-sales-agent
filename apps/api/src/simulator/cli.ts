/**
 * Text-based call simulator.
 *
 *   pnpm simulate                      # all scenarios, offline mock LLM
 *   pnpm simulate --scenario emi       # one scenario
 *   pnpm simulate --llm anthropic      # real Claude (needs ANTHROPIC_API_KEY)
 *   pnpm simulate --llm gemini         # Google Gemini (needs GEMINI_API_KEY)
 *   pnpm simulate --interactive        # chat with the agent yourself
 *
 * Always runs against a sandboxed in-memory copy of the demo dealership.
 */
process.env.DATA_BACKEND = "memory";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "warn";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? "true") : undefined;
};

const c = { dim: "\x1b[2m", green: "\x1b[32m", red: "\x1b[31m", cyan: "\x1b[36m", yellow: "\x1b[33m", bold: "\x1b[1m", reset: "\x1b[0m" };

async function main() {
  const { resetStore } = await import("../db/store");
  const { installDemoOrg, DEMO_ORG_ID } = await import("../demo/fixtures");
  const { createLlm } = await import("../providers/llm");
  const { SCENARIOS } = await import("./scenarios");
  const { runScenario, TextTransport } = await import("./run");

  resetStore();
  await installDemoOrg(DEMO_ORG_ID);
  const llm = createLlm((flag("llm") as "anthropic" | "gemini" | "mock") ?? "mock");
  console.log(`${c.bold}AXO Voice Auto simulator${c.reset} ${c.dim}(llm=${llm.name})${c.reset}\n`);

  if (flag("interactive")) {
    const { CallSession } = await import("../voice/session");
    const { MockTts } = await import("../providers/tts");
    const readline = await import("node:readline/promises");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const session = new CallSession({
      orgId: DEMO_ORG_ID,
      agentId: flag("agent") ?? "agent-car-showroom",
      direction: "inbound",
      callerPhone: "+919876543210",
      provider: "simulator",
      transport: new TextTransport(),
      textMode: true,
      llm,
      tts: new MockTts(0.1),
      silenceMs: 600_000,
    });
    session.on("transcript", (e) => {
      if (e.role === "agent") console.log(`${c.cyan}agent>${c.reset} ${e.text}`);
      if (e.role === "tool") console.log(`${c.dim}  [tool ${e.tool}] ${e.text.slice(0, 160)}${c.reset}`);
    });
    session.on("ended", () => {
      console.log(`${c.dim}(call ended: ${session.inspect().outcome})${c.reset}`);
      process.exit(0);
    });
    await session.start();
    for (;;) {
      const line = await rl.question(`${c.yellow}you>${c.reset} `);
      if (line === "/quit") break;
      session.pushText(line);
      await new Promise((r) => setTimeout(r, 20));
      await session.idle();
    }
    await session.end("other", { hangup: false });
    return;
  }

  const only = flag("scenario");
  const list = only ? SCENARIOS.filter((s) => s.id === only) : SCENARIOS;
  if (!list.length) throw new Error(`No scenario "${only}". Available: ${SCENARIOS.map((s) => s.id).join(", ")}`);

  let passed = 0;
  for (const s of list) {
    console.log(`${c.bold}▶ ${s.title}${c.reset} ${c.dim}[${s.id}]${c.reset}`);
    const res = await runScenario(s, {
      orgId: DEMO_ORG_ID,
      llm,
      silenceMs: llm.name === "mock" ? 400 : 3000,
      onEntry: (e) => {
        if (e.role === "caller") console.log(`  ${c.yellow}caller:${c.reset} ${e.text}`);
        else if (e.role === "agent") console.log(`  ${c.cyan}agent:${c.reset}  ${e.text}${e.interrupted ? c.dim + " (interrupted)" + c.reset : ""}`);
        else if (e.role === "tool" && args.includes("--verbose")) console.log(`  ${c.dim}tool ${e.tool}: ${e.text.slice(0, 200)}${c.reset}`);
      },
    });
    const meta = `${c.dim}tools=[${res.tools.join(", ")}] outcome=${res.outcome} lang=${res.language} avgFirstAudio=${res.avgFirstAudioMs ?? "-"}ms${c.reset}`;
    if (res.passed) {
      passed++;
      console.log(`  ${c.green}✔ PASS${c.reset} ${meta}\n`);
    } else {
      console.log(`  ${c.red}✘ FAIL${c.reset} ${meta}`);
      for (const f of res.failures) console.log(`    ${c.red}- ${f}${c.reset}`);
      console.log();
    }
  }
  console.log(`${c.bold}${passed}/${list.length} scenarios passed${c.reset}`);
  process.exit(passed === list.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
