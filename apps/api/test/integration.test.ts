import { beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { resetStore } from "../src/db/store";
import { repo } from "../src/db/repo";
import { DEMO_ORG_ID, installDemoOrg } from "../src/demo/fixtures";
import { MockLlm } from "../src/providers/llm/mock";
import { MockTelephony, setTelephony } from "../src/providers/telephony";
import { SCENARIOS } from "../src/simulator/scenarios";
import { runScenario } from "../src/simulator/run";
import { buildServer } from "../src/server";
import { runLeadFollowup } from "../src/campaigns/service";

beforeEach(async () => {
  resetStore();
  await installDemoOrg(DEMO_ORG_ID);
});

describe("simulated calls (offline mock LLM)", () => {
  for (const s of SCENARIOS) {
    it(s.title, async () => {
      const res = await runScenario(s, { orgId: DEMO_ORG_ID, llm: new MockLlm(), silenceMs: 300 });
      expect(res.failures).toEqual([]);
    }, 20_000);
  }

  it("persists a full call record: transcript, summary, score, extracted fields, latency and cost", async () => {
    const s = SCENARIOS.find((x) => x.id === "test-drive-en")!;
    await runScenario(s, { orgId: DEMO_ORG_ID, llm: new MockLlm() });
    const calls = await repo(DEMO_ORG_ID).calls.list();
    const call = calls.find((c) => c.outcome === "test_drive_booked")!;
    expect(call).toBeDefined();
    expect(call.transcript.filter((t) => t.role === "caller").length).toBeGreaterThan(3);
    expect(call.summary).toBeTruthy();
    expect(call.leadScore).toBeDefined();
    expect(call.extracted.interestedModel).toBe("Creta");
    expect(call.latency.length).toBeGreaterThan(0);
    expect(call.cost.total).toBeGreaterThanOrEqual(0);
    const tds = await repo(DEMO_ORG_ID).testDrives.list();
    expect(tds.some((t) => t.model === "Creta" && t.customerName === "Rahul")).toBe(true);
  }, 20_000);
});

describe("new-lead webhook", () => {
  it("validates the signature, creates the lead and dials it", async () => {
    const tel = new MockTelephony();
    setTelephony(tel);
    const app = await buildServer();
    const body = JSON.stringify({ name: "Priya", phone: "9876500011", source: "facebook", interestedModel: "Venue" });
    const bad = await app.inject({ method: "POST", url: `/webhooks/leads/${DEMO_ORG_ID}`, payload: body, headers: { "content-type": "application/json", "x-axo-signature": "nope" } });
    expect(bad.statusCode).toBe(401);
    const sig = createHmac("sha256", "change-me").update(body).digest("hex");
    const ok = await app.inject({ method: "POST", url: `/webhooks/leads/${DEMO_ORG_ID}`, payload: body, headers: { "content-type": "application/json", "x-axo-signature": sig } });
    expect(ok.statusCode).toBe(200);
    const { leadId } = ok.json() as { leadId: string };
    const lead = await repo(DEMO_ORG_ID).leads.get(leadId);
    expect(lead?.source).toBe("facebook");
    expect(lead?.assignedTo).toBeTruthy();
    // The queued follow-up job (5 s delay) dials the lead; run it directly here.
    await repo(DEMO_ORG_ID).saveSettings({ callingHours: { start: "00:00", end: "23:59" } });
    await runLeadFollowup({ orgId: DEMO_ORG_ID, leadId, kind: "first" });
    expect(tel.placed.map((p) => p.to)).toContain("+919876500011");
    await app.close();
  });

  it("does not dial opted-out numbers", async () => {
    const tel = new MockTelephony();
    setTelephony(tel);
    const r = repo(DEMO_ORG_ID);
    await r.saveSettings({ callingHours: { start: "00:00", end: "23:59" } });
    await r.optOuts.set({ id: "+919876500022", orgId: DEMO_ORG_ID, phone: "+919876500022", reason: "test", createdAt: new Date().toISOString() });
    await r.leads.set({ id: "l1", orgId: DEMO_ORG_ID, phone: "+919876500022", stage: "new", score: "cold", scoreValue: 0, source: "website", notesLog: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), optedOut: false });
    await runLeadFollowup({ orgId: DEMO_ORG_ID, leadId: "l1", kind: "first" });
    expect(tel.placed).toHaveLength(0);
  });
});

describe("API", () => {
  it("imports a catalog CSV and serves it", async () => {
    const app = await buildServer();
    const csv = "brand,model,type,variant,fuel,transmission,ex_showroom_price\nTata,Nexon,car,Smart,petrol,manual,800000\n";
    const res = await app.inject({ method: "POST", url: "/api/catalog/import", payload: csv, headers: { "content-type": "text/csv" } });
    expect(res.json()).toMatchObject({ imported: 1, variants: 1 });
    const list = await app.inject({ method: "GET", url: "/api/catalog" });
    expect((list.json() as { model: string }[]).some((m) => m.model === "Nexon")).toBe(true);
    await app.close();
  });

  it("never returns stored secrets in plaintext", async () => {
    const app = await buildServer();
    await app.inject({ method: "PATCH", url: "/api/settings", payload: { secrets: { deepgram: "dg_secret_value_1234" } } });
    const res = await app.inject({ method: "GET", url: "/api/settings" });
    expect(JSON.stringify(res.json())).not.toContain("dg_secret_value");
    expect(res.json().secrets.deepgram).toBe("****1234");
    const stored = await repo(DEMO_ORG_ID).settings();
    expect(stored.secrets.deepgram!.startsWith("enc:")).toBe(true);
    await app.close();
  });

  it("enforces roles", async () => {
    const app = await buildServer();
    const res = await app.inject({ method: "PATCH", url: "/api/settings", payload: {}, headers: { "x-dev-role": "sales_executive" } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
