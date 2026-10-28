import { beforeEach, describe, expect, it } from "vitest";
import { resetStore } from "../src/db/store";
import { global, platformOf, repo } from "../src/db/repo";
import { DEMO_ORG_ID, installDemoOrg } from "../src/demo/fixtures";
import { sendOrgMessage } from "../src/messaging/service";
import { MockLlm } from "../src/providers/llm/mock";
import { runScenario } from "../src/simulator/run";
import { SCENARIOS } from "../src/simulator/scenarios";
import { buildServer } from "../src/server";
import { handleIncomingWhatsapp } from "../src/whatsapp/bot";
import { sendPostCallWhatsapp } from "../src/whatsapp/post-call";

const CUSTOMER = "+919845011111";

async function setPlatform(patch: Record<string, unknown>) {
  const org = (await global.orgs().get(DEMO_ORG_ID))!;
  const p = platformOf(org);
  await global.orgs().set({ ...org, platform: { ...p, ...patch } as typeof p });
}

beforeEach(async () => {
  resetStore();
  await installDemoOrg(DEMO_ORG_ID);
});

describe("WhatsApp messaging", () => {
  it("logs every message and respects the admin's WhatsApp switch and monthly limit", async () => {
    const ok = await sendOrgMessage({ orgId: DEMO_ORG_ID, to: CUSTOMER, body: "hello" });
    expect(ok.status).toBe("logged");

    await setPlatform({ features: { ...platformOf(null).features, whatsapp: false } });
    const off = await sendOrgMessage({ orgId: DEMO_ORG_ID, to: CUSTOMER, body: "hello again" });
    expect(off).toMatchObject({ ok: false, status: "blocked" });

    await setPlatform({ features: platformOf(null).features, limits: { monthlyCalls: 0, monthlyMessages: 1 } });
    const capped = await sendOrgMessage({ orgId: DEMO_ORG_ID, to: CUSTOMER, body: "third" });
    expect(capped.status).toBe("blocked");
    expect(capped.error).toMatch(/limit/);

    const log = await repo(DEMO_ORG_ID).messages.list();
    expect(log.map((m) => m.status).sort()).toEqual(["blocked", "blocked", "logged"]);
  });

  it("the AI answers an incoming WhatsApp message from the catalog and creates a lead", async () => {
    const res = await handleIncomingWhatsapp({ orgId: DEMO_ORG_ID, phone: CUSTOMER, text: "What's the price of the Venue?", customerName: "Asha" }, { llm: new MockLlm() });
    expect(res.reply).toMatch(/lakh/);
    expect(res.replyStatus).toBe("logged");
    const r = repo(DEMO_ORG_ID);
    const conv = (await r.conversations.list())[0]!;
    expect(conv.messageCount).toBe(2);
    expect(conv.history.length).toBeGreaterThan(2);
    const lead = (await r.leads.list({ where: { phone: CUSTOMER } }))[0];
    expect(lead?.source).toBe("whatsapp");
  });

  it("stays quiet when staff take over a chat, and honours STOP", async () => {
    await handleIncomingWhatsapp({ orgId: DEMO_ORG_ID, phone: CUSTOMER, text: "hi" }, { llm: new MockLlm() });
    const r = repo(DEMO_ORG_ID);
    const conv = (await r.conversations.list())[0]!;
    await r.conversations.update(conv.id, { botEnabled: false });
    const quiet = await handleIncomingWhatsapp({ orgId: DEMO_ORG_ID, phone: CUSTOMER, text: "price of Creta?" }, { llm: new MockLlm() });
    expect(quiet.reply).toBeUndefined();
    expect(quiet.skipped).toMatch(/staff/);

    const stop = await handleIncomingWhatsapp({ orgId: DEMO_ORG_ID, phone: CUSTOMER, text: "STOP" }, { llm: new MockLlm() });
    expect(stop.skipped).toBe("opted out");
    expect((await r.optOuts.list()).some((o) => o.phone === CUSTOMER)).toBe(true);
  });

  it("the agent sends model details on WhatsApp when the caller asks during a call", async () => {
    const res = await runScenario(
      { id: "wa", title: "wa", agentId: "agent-car-showroom", steps: ["What's the price of the Creta?", "Please send me the details on WhatsApp", "That's all, thank you"], expect: { tools: ["send_whatsapp_or_sms"] } },
      { orgId: DEMO_ORG_ID, llm: new MockLlm() },
    );
    expect(res.failures).toEqual([]);
    const sent = (await repo(DEMO_ORG_ID).messages.list()).find((m) => m.template === "model_details");
    expect(sent?.body).toMatch(/Creta/);
    expect(sent?.body).toMatch(/lakh/);
  }, 20_000);

  it("sends a WhatsApp follow-up after a call, without repeating what was already sent", async () => {
    await runScenario(SCENARIOS.find((s) => s.id === "new-enquiry")!, { orgId: DEMO_ORG_ID, llm: new MockLlm() });
    const call = (await repo(DEMO_ORG_ID).calls.list())[0]!;
    expect(await sendPostCallWhatsapp(DEMO_ORG_ID, call)).toBe(true);
    const followup = (await repo(DEMO_ORG_ID).messages.list()).find((m) => m.template === "post_call_followup")!;
    expect(followup.body).toMatch(/Thank you for calling AXO Motors/);
    expect(followup.body).toMatch(/Venue/);

    // Booked test drive: confirmation already went out, so no location is repeated.
    resetStore();
    await installDemoOrg(DEMO_ORG_ID);
    await runScenario(SCENARIOS.find((s) => s.id === "test-drive-en")!, { orgId: DEMO_ORG_ID, llm: new MockLlm() });
    const booked = (await repo(DEMO_ORG_ID).calls.list()).find((c) => c.outcome === "test_drive_booked")!;
    await sendPostCallWhatsapp(DEMO_ORG_ID, booked);
    const msgs = await repo(DEMO_ORG_ID).messages.list({ where: { callId: booked.id } });
    expect(msgs.some((m) => m.template === "testdrive_confirmation")).toBe(true);
    expect(msgs.find((m) => m.template === "post_call_followup")?.body).not.toMatch(/Visit us/);
  }, 30_000);
});

describe("admin panel", () => {
  it("lists every dealership with usage and billing, and controls one", async () => {
    const app = await buildServer();
    const created = await app.inject({ method: "POST", url: "/admin/orgs", payload: { name: "Sri Ganesh Honda", plan: "starter", ownerEmail: "Owner@Ganesh.in" } });
    expect(created.statusCode).toBe(200);
    const newOrg = created.json() as { id: string };
    expect(await global.users().get("invite:owner@ganesh.in")).toBeTruthy();

    const overview = await app.inject({ method: "GET", url: "/admin/overview" });
    const o = overview.json() as { totals: { dealers: number; revenue: number }; dealers: { org: { id: string }; billing: { basePrice: number } }[] };
    expect(o.totals.dealers).toBe(2);
    expect(o.dealers.find((d) => d.org.id === newOrg.id)?.billing.basePrice).toBe(9999);

    const patched = await app.inject({ method: "PATCH", url: `/admin/orgs/${newOrg.id}`, payload: { plan: "growth", platform: { features: { whatsappBot: false }, whatsapp: { phoneNumberId: "1234567890" } }, whatsappToken: "EAAG-secret-token" } });
    expect(patched.statusCode).toBe(200);
    const org = (await global.orgs().get(newOrg.id))!;
    expect(org.plan).toBe("growth");
    expect(platformOf(org).features.whatsappBot).toBe(false);
    expect(platformOf(org).features.whatsapp).toBe(true);
    expect((await global.waRoutes().get("1234567890"))?.orgId).toBe(newOrg.id);
    const detail = (await app.inject({ method: "GET", url: `/admin/orgs/${newOrg.id}` })).json() as { whatsappToken: string };
    expect(detail.whatsappToken).toBe("****oken");

    // The admin can open any dealership's dashboard.
    const asDealer = await app.inject({ method: "GET", url: "/api/me", headers: { "x-act-as-org": newOrg.id } });
    expect(asDealer.json()).toMatchObject({ orgId: newOrg.id, actingAs: newOrg.id, superAdmin: true });
  });

  it("dealers cannot change their own plan or platform controls", async () => {
    const app = await buildServer();
    await app.inject({ method: "PATCH", url: "/api/org", payload: { name: "Renamed", plan: "enterprise", status: "active", platform: { limits: { monthlyCalls: 0 } } } });
    const org = (await global.orgs().get(DEMO_ORG_ID))!;
    expect(org.name).toBe("Renamed");
    expect(org.plan).toBe("growth");
  });

  it("a suspended dealership is locked out and cannot place calls", async () => {
    const app = await buildServer();
    await app.inject({ method: "PATCH", url: `/admin/orgs/${DEMO_ORG_ID}`, payload: { status: "suspended" } });
    const { checkCallAllowed } = await import("../src/platform/usage");
    expect(await checkCallAllowed(DEMO_ORG_ID, "outbound")).toEqual({ ok: false, reason: "account suspended" });
    const msg = await sendOrgMessage({ orgId: DEMO_ORG_ID, to: CUSTOMER, body: "hi" });
    expect(msg.status).toBe("blocked");
  });
});
