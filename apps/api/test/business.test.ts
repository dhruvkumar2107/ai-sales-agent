import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config";
import { global, platformOf, repo } from "../src/db/repo";
import { resetStore } from "../src/db/store";
import { MockLlm } from "../src/providers/llm/mock";
import { buildServer } from "../src/server";
import { runScenario } from "../src/simulator/run";
import { handleIncomingWhatsapp } from "../src/whatsapp/bot";

const CLINIC = {
  name: "Smile Dental Care",
  plan: "starter",
  ownerName: "Dr. Rao",
  ownerPhone: "+919845000099",
  business: {
    type: "dental",
    description: "A family dental clinic in Jayanagar, Bengaluru.",
    knowledge: "Check-up: ₹300\nTeeth cleaning: ₹1,200\nRoot canal treatment: from ₹4,500",
    actions: ["answer_questions", "capture_enquiry", "book_appointment", "send_whatsapp_details", "transfer_to_staff"],
    address: "12, 9th Main, Jayanagar, Bengaluru",
    mapLink: "https://maps.app.goo.gl/smile",
    timings: "Mon-Sat 10am-8pm",
  },
  agent: { name: "Meera", languages: ["en", "hi"], voice: "female" },
  callNumber: "080 4000 1111",
  whatsappNumber: "+91 98450 22222",
};

async function addClinic(payload: Record<string, unknown> = CLINIC) {
  const app = await buildServer();
  const res = await app.inject({ method: "POST", url: "/admin/orgs", payload });
  return { app, res, body: res.json() as { id: string; setup: { calls?: { status: string; detail: string }; whatsapp?: { status: string; detail: string } } } };
}

beforeEach(() => resetStore());

describe("any-business agents", () => {
  it("adding a business from the admin panel creates its agent and links both numbers", async () => {
    const { res, body } = await addClinic();
    expect(res.statusCode).toBe(200);
    const org = (await global.orgs().get(body.id))!;
    expect(org.business?.type).toBe("dental");
    const [agent] = await repo(body.id).agents.list();
    expect(agent?.name).toBe("Meera");
    expect(agent?.greeting.en).toMatch(/Meera/);
    expect(agent?.phoneNumbers).toEqual(["+918040001111"]);
    expect(await global.phoneRoutes().get("+918040001111")).toMatchObject({ orgId: body.id, agentId: agent!.id });
    expect(platformOf(org).calling.callerId).toBe("+918040001111");
    expect(platformOf(org).whatsapp.displayNumber).toBe("+919845022222");
    // No telephony or Meta account in tests: linked here, with the missing outside step spelled out.
    expect(body.setup.calls?.status).toBe("action_needed");
    expect(body.setup.whatsapp?.detail).toMatch(/META_WABA_ID/);

    const { res: dup } = await addClinic({ ...CLINIC, name: "Copy Clinic" });
    expect(dup.statusCode).toBe(400);
    expect(dup.json().error).toMatch(/already linked to Smile Dental Care/);
  });

  it("the agent answers from the business knowledge and books an appointment on a call", async () => {
    const { body } = await addClinic();
    const agent = (await repo(body.id).agents.list())[0]!;
    const res = await runScenario(
      {
        id: "clinic",
        title: "clinic",
        agentId: agent.id,
        steps: ["How much is teeth cleaning?", "I want to book a cleaning appointment", "My name is Rahul", "Tomorrow at 11 am", "Yes, please confirm", "That's all, thank you"],
        expect: { tools: ["book_appointment"], outcome: ["appointment_booked"], agentSays: [/1,200/], notTools: ["book_testdrive", "search_catalog"] },
      },
      { orgId: body.id, llm: new MockLlm() },
    );
    expect(res.failures).toEqual([]);
    expect(res.guardViolations).toBe(0);
    const r = repo(body.id);
    expect((await r.callbacks.list()).some((c) => /Confirm appointment: Teeth cleaning/i.test(c.reason))).toBe(true);
    const messages = await r.messages.list();
    expect(messages.find((m) => m.template === "appointment_request")?.body).toMatch(/Smile Dental Care/);
    expect((await r.leads.list())[0]?.name).toBe("Rahul");
  }, 20_000);

  it("only gets the tools for the actions that were ticked", async () => {
    const { toolRegistryFor } = await import("../src/tools");
    const { body } = await addClinic({ ...CLINIC, callNumber: undefined, whatsappNumber: undefined, business: { ...CLINIC.business, actions: ["answer_questions"] } });
    const names = toolRegistryFor((await global.orgs().get(body.id))!).defs().map((d) => d.name);
    expect(names.sort()).toEqual(["end_call", "record_opt_out", "request_callback"]);
  });

  it("replies on WhatsApp and sends the location from the business profile", async () => {
    const { body } = await addClinic();
    const res = await handleIncomingWhatsapp({ orgId: body.id, phone: "+919845011111", text: "Please send me the location" }, { llm: new MockLlm() });
    expect(res.reply).toMatch(/WhatsApp/);
    const loc = (await repo(body.id).messages.list()).find((m) => m.template === "business_location");
    expect(loc?.body).toMatch(/Jayanagar/);
    expect(loc?.body).toMatch(/maps\.app\.goo\.gl/);
  });

  it("connects a number automatically when Twilio and Meta accounts are configured", async () => {
    const saved = { ...env };
    Object.assign(env, { TELEPHONY_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", PUBLIC_BASE_URL: "https://axo.example.com", META_WA_TOKEN: "EAAG-platform", META_WABA_ID: "waba1", MESSAGING_PROVIDER: "meta" });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("graph.facebook.com")) return new Response(JSON.stringify({ data: [{ id: "PNID-1", display_phone_number: "+91 98450 22222" }] }), { status: 200 });
      if (init?.method === "POST") return new Response("{}", { status: 200 });
      return new Response(JSON.stringify({ incoming_phone_numbers: [{ sid: "PN123" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { body } = await addClinic();
      expect(body.setup.calls).toMatchObject({ status: "ready" });
      expect(body.setup.whatsapp).toMatchObject({ status: "ready" });
      expect(await global.waRoutes().get("PNID-1")).toMatchObject({ orgId: body.id });
      expect(platformOf(await global.orgs().get(body.id)).whatsapp.phoneNumberId).toBe("PNID-1");
      const update = fetchMock.mock.calls.find(([u, i]) => String(u).endsWith("/IncomingPhoneNumbers/PN123.json") && i?.method === "POST");
      expect(String(update?.[1]?.body)).toContain(encodeURIComponent("https://axo.example.com/telephony/twilio/voice"));
    } finally {
      vi.unstubAllGlobals();
      Object.assign(env, saved);
    }
  });
});
