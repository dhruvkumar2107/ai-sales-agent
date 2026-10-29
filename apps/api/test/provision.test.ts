import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config";
import { global, platformOf, repo } from "../src/db/repo";
import { resetStore } from "../src/db/store";
import { buildServer } from "../src/server";

beforeEach(() => resetStore());

async function newBusiness(app: Awaited<ReturnType<typeof buildServer>>) {
  return (await app.inject({ method: "POST", url: "/admin/orgs", payload: { name: "Glow Salon", business: { type: "salon_spa" } } })).json() as { id: string };
}

function withEnv(patch: Partial<typeof env>) {
  const saved = { ...env };
  Object.assign(env, patch);
  return () => Object.assign(env, saved);
}

describe("provisioning", () => {
  it("searches and buys a Twilio number, configured and linked on purchase", async () => {
    const restore = withEnv({ TELEPHONY_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", TWILIO_BUNDLE_SID: "BU1", PUBLIC_BASE_URL: "https://axo.example.com" });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/AvailablePhoneNumbers/IN/Local.json")) return new Response(JSON.stringify({ available_phone_numbers: [{ phone_number: "+918040009999", friendly_name: "080-4000-9999", locality: "Bengaluru", region: "KA", capabilities: { voice: true, SMS: false } }] }));
      if (url.endsWith("/IncomingPhoneNumbers.json") && init?.method === "POST") return new Response(JSON.stringify({ phone_number: "+918040009999", sid: "PN9" }), { status: 201 });
      if (url.includes("IncomingPhoneNumbers.json?PhoneNumber=")) return new Response(JSON.stringify({ incoming_phone_numbers: [{ sid: "PN9" }] }));
      return new Response("{}");
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const app = await buildServer();
      const { id } = await newBusiness(app);
      const list = (await app.inject({ method: "GET", url: "/admin/twilio/available?type=local&contains=80" })).json() as { numbers: { phoneNumber: string; locality: string }[] };
      expect(list.numbers[0]).toMatchObject({ phoneNumber: "+918040009999", locality: "Bengaluru" });
      const bought = await app.inject({ method: "POST", url: `/admin/orgs/${id}/buy-number`, payload: { phoneNumber: "+918040009999" } });
      expect(bought.json()).toMatchObject({ bought: "+918040009999", calls: { status: "ready" } });
      const buy = fetchMock.mock.calls.find(([u, i]) => String(u).endsWith("/IncomingPhoneNumbers.json") && i?.method === "POST")!;
      expect(String(buy[1]!.body)).toContain("BundleSid=BU1");
      expect(await global.phoneRoutes().get("+918040009999")).toMatchObject({ orgId: id });
    } finally {
      vi.unstubAllGlobals();
      restore();
    }
  });

  it("the business connects its own WhatsApp from a signed link", async () => {
    const restore = withEnv({ META_APP_ID: "app1", META_APP_SECRET: "sec", META_ES_CONFIG_ID: "cfg1", WEB_ORIGIN: "https://app.example.com" });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("oauth/access_token")) return new Response(JSON.stringify({ access_token: "EAAB-business" }));
      if (url.includes("PNID-7?fields")) return new Response(JSON.stringify({ display_phone_number: "+91 98450 77777" }));
      return new Response(JSON.stringify({ success: true }));
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const app = await buildServer();
      const { id } = await newBusiness(app);
      const link = (await app.inject({ method: "GET", url: `/admin/orgs/${id}/whatsapp-link` })).json() as { url: string; ready: boolean };
      expect(link.ready).toBe(true);
      expect(link.url).toMatch(/^https:\/\/app\.example\.com\/connect\/whatsapp\//);
      const token = link.url.split("/").pop()!;

      expect((await app.inject({ method: "GET", url: `/public/whatsapp-connect/${token}x` })).statusCode).toBe(404);
      const info = (await app.inject({ method: "GET", url: `/public/whatsapp-connect/${token}` })).json() as { businessName: string; appId: string };
      expect(info).toMatchObject({ businessName: "Glow Salon", appId: "app1" });

      const done = await app.inject({ method: "POST", url: `/public/whatsapp-connect/${token}`, payload: { code: "c0de", phoneNumberId: "PNID-7", wabaId: "WABA-7" } });
      expect(done.json()).toMatchObject({ ok: true, displayNumber: "+919845077777" });
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes("WABA-7/subscribed_apps"))).toBe(true);
      expect(await global.waRoutes().get("PNID-7")).toMatchObject({ orgId: id });
      expect(platformOf(await global.orgs().get(id)).whatsapp.phoneNumberId).toBe("PNID-7");
      expect((await repo(id).settings()).secrets.metaWaToken).toMatch(/^enc:/);
    } finally {
      vi.unstubAllGlobals();
      restore();
    }
  });
});
