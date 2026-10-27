/**
 * Demo dealership data: 20 catalog models, branches, team, 3 agents, offers, 40 leads,
 * 30 service bookings, 50 call logs, test drives, customer vehicles (for reminders) and bookings.
 * Used by `pnpm seed` and by SEED_DEMO_ON_START for hosted demos.
 */
import type { Call, CallOutcome, Lead, LeadSource, LeadStage, ServiceBooking, ServiceType, TestDrive } from "@axo/shared";
import { computeCost } from "../calls/cost";
import { nowIso, repo } from "../db/repo";
import { getStore } from "../db/store";
import { DEMO_MEMBERS, DEMO_ORG_ID, installDemoOrg } from "./fixtures";
import { scoreLead } from "../leads/scoring";

// Deterministic PRNG so the demo looks the same every time.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
const int = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
const daysAgo = (d: number, h = int(9, 19), m = pick([0, 15, 30, 45])) => {
  const t = new Date(Date.now() - d * 86400_000);
  const ist = new Date(t.getTime() + 5.5 * 3600_000);
  return new Date(`${ist.toISOString().slice(0, 10)}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+05:30`);
};

const FIRST = ["Rahul", "Priya", "Arjun", "Sneha", "Vikram", "Ananya", "Rohit", "Kavya", "Suresh", "Deepa", "Manoj", "Pooja", "Karthik", "Lakshmi", "Imran", "Fatima", "Harish", "Meera", "Naveen", "Divya"];
const LAST = ["Sharma", "Reddy", "Gowda", "Iyer", "Kumar", "Patel", "Nair", "Rao", "Singh", "Khan", "Shetty", "Joshi"];
const CAR_MODELS = ["Creta", "Venue", "i20", "Exter", "Verna", "Alcazar", "Ioniq 5", "Creta Electric"];
const BIKE_MODELS = ["Shine 125", "SP 125", "Activa 6G", "Dio 125", "Unicorn", "Hornet 2.0", "CB350", "Activa e"];
const PRICE: Record<string, number> = { Creta: 1290000, Venue: 980000, i20: 940000, Exter: 960000, Verna: 1680000, Alcazar: 2380000, "Ioniq 5": 4800000, "Creta Electric": 1900000, "Shine 125": 94000, "SP 125": 106000, "Activa 6G": 92000, "Dio 125": 105000, Unicorn: 130000, "Hornet 2.0": 165000, CB350: 245000, "Activa e": 120000 };
const SOURCES: LeadSource[] = ["inbound_call", "facebook", "instagram", "website", "walk_in", "campaign"];
const STAGES: LeadStage[] = ["new", "new", "contacted", "contacted", "test_drive_booked", "negotiation", "won", "lost"];
const phoneFor = (i: number) => `+9198${String(45000000 + i * 7919).padStart(8, "0").slice(0, 8)}`;
const name = () => `${pick(FIRST)} ${pick(LAST)}`;
const execs = DEMO_MEMBERS.filter((m) => m.role === "sales_executive");

export async function seedDemo(ORG: string = DEMO_ORG_ID) {
  const { models } = await installDemoOrg(ORG);
  const r = repo(ORG);

  // ---------- 40 leads ----------
  const leads: Lead[] = [];
  for (let i = 0; i < 40; i++) {
    const isCar = rand() < 0.6;
    const model = pick(isCar ? CAR_MODELS : BIKE_MODELS);
    const created = daysAgo(int(0, 29));
    const stage = pick(STAGES);
    const timeline = pick(["this_week", "this_month", "three_months_plus", "unknown"] as const);
    const fields = { name: name(), interestedModel: model, budget: Math.round(PRICE[model]! / 10000) * 10000, timeline, paymentMode: pick(["cash", "loan", "loan", "exchange"] as const), hasExchange: rand() < 0.3, vehicleType: isCar ? ("car" as const) : ("bike" as const), city: "Bengaluru" };
    const { score, value } = scoreLead({ ...fields, phone: "x", testDriveBooked: ["test_drive_booked", "negotiation", "won"].includes(stage) });
    const exec = isCar ? pick(execs.filter((e) => e.branchIds.includes("br-indiranagar"))) : execs.find((e) => e.branchIds.includes("br-koramangala"))!;
    const lead: Lead = {
      ...fields,
      id: `lead-demo-${i + 1}`,
      orgId: ORG,
      phone: phoneFor(i),
      branchId: isCar ? "br-indiranagar" : "br-koramangala",
      stage,
      score,
      scoreValue: value,
      source: pick(SOURCES),
      assignedTo: exec.id,
      language: pick(["en", "hi", "kn", "hinglish"] as const),
      notesLog: [{ at: created.toISOString(), by: "AI agent", text: `Enquired about ${model}.` }],
      createdAt: created.toISOString(),
      updatedAt: created.toISOString(),
      firstContactedAt: stage === "new" ? undefined : new Date(created.getTime() + int(1, 3) * 60_000).toISOString(),
      optedOut: false,
      revenue: stage === "won" ? PRICE[model] : undefined,
    };
    leads.push(lead);
    await r.leads.set(lead);
  }

  // ---------- test drives for engaged leads ----------
  let tdCount = 0;
  for (const lead of leads.filter((l) => ["test_drive_booked", "negotiation", "won"].includes(l.stage))) {
    const upcoming = lead.stage === "test_drive_booked";
    const start = upcoming ? daysAgo(-int(0, 5), int(10, 17)) : daysAgo(int(1, 20), int(10, 17));
    const td: TestDrive = {
      id: `td-demo-${++tdCount}`,
      orgId: ORG,
      branchId: lead.branchId!,
      leadId: lead.id,
      customerName: lead.name!,
      phone: lead.phone,
      model: lead.interestedModel!,
      start: start.toISOString(),
      end: new Date(start.getTime() + 30 * 60_000).toISOString(),
      status: upcoming ? "booked" : "completed",
      homeTestDrive: false,
      createdAt: new Date(start.getTime() - 2 * 86400_000).toISOString(),
    };
    await r.testDrives.set(td);
  }

  // ---------- 30 service bookings + customer vehicles ----------
  const serviceTypes: ServiceType[] = ["free_service", "paid_service", "paid_service", "repair", "accident", "warranty"];
  for (let i = 0; i < 30; i++) {
    const model = pick([...CAR_MODELS.slice(0, 6), ...BIKE_MODELS.slice(0, 4)]);
    const offset = int(-7, 20); // negative = upcoming
    const start = daysAgo(offset, int(9, 16), pick([0, 30]));
    const status: ServiceBooking["status"] = offset < 0 ? "booked" : offset === 0 ? pick(["in_progress", "ready"]) : pick(["delivered", "delivered", "delivered", "cancelled"]);
    const vehicleNo = `KA${String(int(1, 53)).padStart(2, "0")}${pick(["AB", "MN", "HK", "EV", "MX"])}${int(1000, 9999)}`;
    const customer = name();
    const phone = phoneFor(100 + i);
    const st = pick(serviceTypes);
    await r.serviceBookings.set({
      id: `svc-demo-${i + 1}`,
      orgId: ORG,
      branchId: "br-whitefield-service",
      customerName: customer,
      phone,
      vehicleNo,
      model,
      kilometres: int(1000, 60000),
      serviceType: st,
      pickupDrop: rand() < 0.3,
      start: start.toISOString(),
      end: new Date(start.getTime() + 60 * 60_000).toISOString(),
      status,
      jobCardNo: offset >= 0 ? `JC-${20000 + i}` : undefined,
      estimatedReadyAt: status === "in_progress" ? "5 PM today" : undefined,
      createdAt: new Date(start.getTime() - int(1, 5) * 86400_000).toISOString(),
      revenue: status === "delivered" && st !== "free_service" && st !== "warranty" ? int(2500, 18000) : undefined,
    });
    const lastService = daysAgo(int(150, 200)).toISOString().slice(0, 10);
    await r.customerVehicles.set({
      id: `cv-demo-${i + 1}`,
      orgId: ORG,
      customerName: customer,
      phone,
      vehicleNo,
      model,
      branchId: "br-whitefield-service",
      lastServiceDate: lastService,
      lastServiceKm: int(5000, 40000),
      avgKmPerMonth: int(600, 1500),
      nextServiceDue: daysAgo(-int(-3, 30)).toISOString().slice(0, 10),
      insuranceExpiry: daysAgo(-int(-2, 60)).toISOString().slice(0, 10),
      pucExpiry: daysAgo(-int(0, 90)).toISOString().slice(0, 10),
    });
  }

  // ---------- 50 call logs ----------
  const OUTCOMES: CallOutcome[] = ["test_drive_booked", "lead_captured", "info_provided", "service_booked", "transferred", "callback_scheduled", "complaint_logged", "no_answer", "wrong_number", "feedback_recorded"];
  const SAMPLE: Record<string, [string, string][]> = {
    test_drive_booked: [["caller", "I want a test drive of the Creta tomorrow."], ["agent", "Lovely! May I have your name please?"], ["caller", "Rahul."], ["agent", "I have 11 AM or 11:30 tomorrow at Indiranagar. Which suits you?"], ["caller", "11 is fine."], ["agent", "Done! You're booked for 11 AM tomorrow. I've sent the details on WhatsApp."]],
    service_booked: [["caller", "Gaadi ki service book karni hai."], ["agent", "Zaroor, gaadi ka number batayenge?"], ["caller", "KA01AB1234."], ["agent", "Kal subah 10 baje ka slot khali hai. Book kar doon?"], ["caller", "Haan."], ["agent", "Ho gaya, confirmation WhatsApp par bhej diya hai."]],
    transferred: [["caller", "I want to buy the Venue today, I'm coming to the showroom."], ["agent", "Wonderful! Let me connect you to our sales executive right away."]],
    complaint_logged: [["caller", "My car still makes a noise after service."], ["agent", "I'm sorry about that. I've raised a ticket and our service manager will call you today."]],
    default: [["caller", "What's the on-road price of the Exter CNG?"], ["agent", "The Exter CNG is around 9 lakh 60 thousand to 9 lakh 90 thousand on-road. Final price depends on showroom confirmation. Would you like a test drive?"], ["caller", "Maybe later, thanks."], ["agent", "Sure, thank you for calling!"]],
  };
  for (let i = 0; i < 50; i++) {
    const outcome = pick(OUTCOMES);
    const direction = outcome === "no_answer" || outcome === "feedback_recorded" ? "outbound" : rand() < 0.75 ? "inbound" : "outbound";
    const start = daysAgo(int(0, 29));
    const answered = outcome !== "no_answer";
    const durationSec = answered ? int(45, 320) : 0;
    const lead = pick(leads);
    const lines = answered ? (SAMPLE[outcome] ?? SAMPLE.default!) : [];
    const transcript = lines.map(([role, text], k) => ({ role: role as "agent" | "caller", text, at: new Date(start.getTime() + k * 9000).toISOString(), language: "en" }));
    const turns = lines.filter(([role]) => role === "agent").length;
    const latency = Array.from({ length: turns }, (_, k) => {
      const stt = int(120, 260);
      const llm = int(280, 520);
      const tts = int(120, 260);
      return { turn: k + 1, sttMs: stt, llmFirstTokenMs: llm, ttsFirstByteMs: tts, firstAudioMs: stt + llm + tts + int(40, 120) };
    });
    const usage = { sttSeconds: durationSec * 0.45, ttsChars: turns * 110, llmInputTokens: turns * 6500, llmOutputTokens: turns * 60, messages: outcome.endsWith("booked") ? 1 : 0 };
    const call: Call = {
      id: `call-demo-${i + 1}`,
      orgId: ORG,
      agentId: pick(["agent-car-showroom", "agent-two-wheeler", "agent-service-center"]),
      direction,
      provider: "twilio",
      providerCallId: `CA${String(i).padStart(32, "0")}`,
      from: direction === "inbound" ? lead.phone : "+918041234567",
      to: direction === "inbound" ? "+918041234567" : lead.phone,
      leadId: lead.id,
      startedAt: start.toISOString(),
      endedAt: new Date(start.getTime() + durationSec * 1000).toISOString(),
      durationSec,
      status: answered ? "completed" : "no_answer",
      outcome,
      language: pick(["en", "hi", "kn", "hinglish"] as const),
      recordingConsent: true,
      transcript,
      summary: answered ? `${lead.name} ${outcome === "service_booked" ? "booked a service" : `asked about the ${lead.interestedModel}`}. Outcome: ${outcome.replace(/_/g, " ")}.` : undefined,
      sentiment: outcome === "complaint_logged" ? "negative" : pick(["positive", "neutral", "neutral"] as const),
      extracted: answered ? { name: lead.name, interestedModel: lead.interestedModel, timeline: lead.timeline, paymentMode: lead.paymentMode } : {},
      leadScore: answered ? lead.score : undefined,
      latency,
      avgFirstAudioMs: latency.length ? Math.round(latency.reduce((n, l) => n + l.firstAudioMs, 0) / latency.length) : undefined,
      toolCalls: [],
      cost: computeCost(durationSec, usage),
      usage,
      missedCallRecovered: direction === "outbound" && rand() < 0.1 ? true : undefined,
    };
    await r.calls.set(call);
  }

  // ---------- a few tickets, callbacks and vehicle bookings ----------
  await r.tickets.set({ id: "TKT-100231", orgId: ORG, phone: phoneFor(101), customerName: "Deepa Rao", vehicleNo: "KA05MN2231", category: "delay", description: "Vehicle not ready at promised time", severity: "medium", status: "open", createdAt: daysAgo(1).toISOString() });
  await r.callbacks.set({ id: "cb-demo-1", orgId: ORG, phone: leads[0]!.phone, customerName: leads[0]!.name, department: "sales", reason: "Exchange evaluation for 2017 Honda City", priority: "normal", assignedTo: "u-exec-1", dueAt: new Date(Date.now() + 2 * 3600_000).toISOString(), status: "pending", createdAt: nowIso() });
  await r.vehicleBookings.set({ id: "vb-demo-1", orgId: ORG, leadId: leads[6]!.id, customerName: leads[6]!.name!, phone: leads[6]!.phone, model: "Creta", variant: "SX 1.5 Diesel AT", color: "Abyss Black", status: "documents_pending", pendingDocuments: ["Address proof", "PAN card"], createdAt: daysAgo(6).toISOString(), updatedAt: daysAgo(1).toISOString() });

  getStore().flush?.();
  return { models, leads: 40, testDrives: tdCount, serviceBookings: 30, calls: 50 };
}
