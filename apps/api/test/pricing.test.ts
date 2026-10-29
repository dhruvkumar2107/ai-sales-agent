import { beforeEach, describe, expect, it } from "vitest";
import { orgSchema } from "@axo/shared";
import { env } from "../src/config";
import { resetStore } from "../src/db/store";
import { buildServer } from "../src/server";
import { billing, monthStart, type OrgUsage } from "../src/platform/usage";

beforeEach(() => resetStore());

const usage = (minutes: number, cost = 0): OrgUsage => ({ calls: 0, answeredCalls: 0, inbound: 0, outbound: 0, web: 0, minutes, cost, messages: 0, whatsappChats: 0, leads: 0, hotLeads: 0, testDrives: 0, serviceBookings: 0 });
const org = (plan: string, platform: Record<string, unknown> = {}) => orgSchema.parse({ id: "o1", name: "Firm", showroomName: "Firm", createdAt: new Date().toISOString(), plan, platform });

describe("pricing", () => {
  it("bills included minutes, extra minutes and the setup fee in the month it was paid", () => {
    const b = billing(org("growth"), usage(320.4, 2600));
    expect(b.basePrice).toBe(6999);
    expect(b.overageMinutes).toBe(21);
    expect(b.overage).toBe(420);
    expect(b.setupFee).toBe(0);
    expect(b.setupFeeDue).toBe(30000);
    expect(b.paymentFees).toBe(Math.round(7419 * 0.02));
    expect(b.profit).toBe(7419 - Math.round(2600 + 148));

    const paid = billing(org("starter", { setupFeePaidAt: new Date().toISOString() }), usage(10, 80));
    expect(paid.setupFee).toBe(30000);
    expect(paid.revenue).toBe(32999);
    expect(paid.setupFeeDue).toBe(0);
    const lastMonth = new Date(Date.parse(monthStart()) - 86400_000).toISOString().slice(0, 7);
    expect(billing(org("starter", { setupFeePaidAt: new Date().toISOString() }), usage(0), lastMonth).setupFee).toBe(0);
  });

  it("every paid plan stays profitable at full use with the default cost of about ₹8 a minute", async () => {
    const { PLANS, PLAN_IDS } = await import("@axo/shared");
    for (const id of PLAN_IDS.filter((p) => p !== "trial")) {
      const p = PLANS[id];
      const b = billing(org(id), usage(p.minutes, p.minutes * 8 + p.messages * env.COST_MESSAGE));
      expect(b.profit / b.revenue).toBeGreaterThan(0.5);
    }
  });

  it("splits the monthly profit between the partners", async () => {
    const app = await buildServer();
    expect((await app.inject({ method: "PUT", url: "/admin/partners", payload: { partners: [{ name: "Ridhi", share: 50 }, { name: "Dhruv", share: 40 }] } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/admin/partners", payload: { partners: [{ name: "Ridhi", share: 50 }, { name: "Dhruv", share: 50 }] } })).statusCode).toBe(200);
    await app.inject({ method: "POST", url: "/admin/orgs", payload: { name: "Firm A", plan: "growth", business: { type: "salon" } } });
    const o = (await app.inject({ method: "GET", url: "/admin/overview" })).json() as { totals: { profit: number; setupFeesDue: number }; partners: { name: string; amount: number }[] };
    expect(o.totals.setupFeesDue).toBe(30000);
    expect(o.partners.map((p) => p.name)).toEqual(["Ridhi", "Dhruv"]);
    expect(o.partners[0]!.amount).toBe(Math.round(o.totals.profit / 2));
  });
});

describe("provider keys from the admin panel", () => {
  it("saves keys encrypted, applies them at once, masks secrets and falls back to the env file when cleared", async () => {
    const before = { sid: env.TWILIO_ACCOUNT_SID, token: env.TWILIO_AUTH_TOKEN, llm: env.LLM_PROVIDER };
    const app = await buildServer();
    try {
      const bad = await app.inject({ method: "PUT", url: "/admin/keys", payload: { values: { LLM_PROVIDER: "openai" } } });
      expect(bad.statusCode).toBe(400);

      const res = await app.inject({ method: "PUT", url: "/admin/keys", payload: { values: { TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "secret-token-9876", LLM_PROVIDER: "gemini" } } });
      expect(res.statusCode).toBe(200);
      expect(env.TWILIO_AUTH_TOKEN).toBe("secret-token-9876");
      expect(env.LLM_PROVIDER).toBe("gemini");

      const { getStore } = await import("../src/db/store");
      const raw = (await getStore().collection<{ id: string; values: Record<string, string> }>("platformConfig").get("keys"))!.values;
      expect(raw.TWILIO_AUTH_TOKEN).toMatch(/^enc:/);

      const listed = (await app.inject({ method: "GET", url: "/admin/keys" })).json() as { fields: { key: string; value: string; source: string }[] };
      const token = listed.fields.find((f) => f.key === "TWILIO_AUTH_TOKEN")!;
      expect(token).toMatchObject({ value: "****9876", source: "panel" });

      // A masked value sent back means "unchanged"; "" clears it.
      await app.inject({ method: "PUT", url: "/admin/keys", payload: { values: { TWILIO_AUTH_TOKEN: "****9876" } } });
      expect(env.TWILIO_AUTH_TOKEN).toBe("secret-token-9876");
      await app.inject({ method: "PUT", url: "/admin/keys", payload: { values: { TWILIO_AUTH_TOKEN: "", TWILIO_ACCOUNT_SID: "", LLM_PROVIDER: "" } } });
      expect(env.TWILIO_AUTH_TOKEN).toBe(before.token);
      expect(env.LLM_PROVIDER).toBe(before.llm);
    } finally {
      Object.assign(env, { TWILIO_ACCOUNT_SID: before.sid, TWILIO_AUTH_TOKEN: before.token, LLM_PROVIDER: before.llm });
    }
  });
});
