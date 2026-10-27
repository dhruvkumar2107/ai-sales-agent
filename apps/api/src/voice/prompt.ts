import type { AgentConfig, Branch, CatalogModel, Language, Offer, Org } from "@axo/shared";
import { renderAutoPrompt } from "../../prompts/auto";
import type { Repo } from "../db/repo";
import { LANGUAGE_NAMES } from "./language";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function catalogToText(models: CatalogModel[]): string {
  if (!models.length) return "No catalog configured yet. Offer a sales team callback for any model question.";
  return models
    .filter((m) => m.active)
    .map((m) => {
      const variants = m.variants
        .map((v) => {
          const onRoad = v.onRoadMin && v.onRoadMax ? `, on-road ${v.onRoadMin}-${v.onRoadMax}` : "";
          return `${v.name} (${v.fuel}, ${v.transmission}): ex-showroom ${v.exShowroomPrice}${onRoad}${v.inStock === false ? ", currently out of stock" : ""}`;
        })
        .join("; ");
      const parts = [`- ${m.brand} ${m.model} [${m.type}]: ${variants}`];
      if (m.colors.length) parts.push(`  Colours: ${m.colors.join(", ")}`);
      if (m.keyFeatures.length) parts.push(`  Key features: ${m.keyFeatures.join(", ")}`);
      if (m.talkingPoints.length) parts.push(`  Approved comparison talking points: ${m.talkingPoints.join("; ")}`);
      if (m.aliases.length) parts.push(`  Also called: ${m.aliases.join(", ")}`);
      return parts.join("\n");
    })
    .join("\n");
}

export function offersToText(offers: Offer[], today = new Date().toISOString().slice(0, 10)): string {
  const live = offers.filter((o) => o.active && o.validFrom <= today && o.validTo >= today);
  if (!live.length) return "No offers are currently running. Do not mention any offer or discount.";
  return live.map((o) => `- ${o.title}: ${o.description} (models: ${o.models.length ? o.models.join(", ") : "all"}; valid till ${o.validTo})`).join("\n");
}

export function timingsToText(branches: Branch[]): string {
  if (!branches.length) return "Timings not configured; offer a callback.";
  return branches
    .map((b) => {
      const days = b.workingHours.days.map((d) => DAY_NAMES[d]).join(", ");
      return `- ${b.name} (${b.city}): ${days}, ${b.workingHours.open} to ${b.workingHours.close}. Address: ${b.address}`;
    })
    .join("\n");
}

export interface CallPromptContext {
  direction: "inbound" | "outbound" | "web";
  callerPhone: string;
  campaignType?: string;
  campaignScript?: string;
  customerName?: string;
  contactData?: Record<string, string>;
}

export interface BuiltPrompt {
  system: string;
  catalog: CatalogModel[];
  branches: Branch[];
  modelNames: string[];
}

/** Assemble the full system prompt for one call from the dealership's live configuration. */
export async function buildSystemPrompt(r: Repo, org: Org, agent: AgentConfig, ctx: CallPromptContext): Promise<BuiltPrompt> {
  const [catalog, offers, branches] = await Promise.all([r.catalog.list({ orderBy: "model" }), r.offers.list(), r.branches.list()]);
  const brands = org.brands.length ? org.brands.join(", ") : [...new Set(catalog.map((m) => m.brand))].join(", ") || "multiple brands";

  let system = renderAutoPrompt({
    showroom_name: org.showroomName,
    agent_name: agent.name,
    brands,
    catalog: catalogToText(catalog),
    offers: offersToText(offers),
    timings: timingsToText(branches),
    language: LANGUAGE_NAMES[agent.defaultLanguage as Language] ?? "English",
  });

  if (agent.extraInstructions) system += `\n# Dealership-specific instructions\n${agent.extraInstructions}\n`;

  const nowIst = new Date(Date.now() + 5.5 * 3600_000);
  const lines = [
    `Today is ${DAY_NAMES[nowIst.getUTCDay()]}, ${nowIst.toISOString().slice(0, 10)}, and the time is ${nowIst.toISOString().slice(11, 16)} IST.`,
    `Call direction: ${ctx.direction}. Caller phone on record: ${ctx.callerPhone || "unknown"} (confirm it rather than asking them to recite it).`,
    `Branches (use the id in tools): ${branches.map((b) => `${b.name} = ${b.id}`).join("; ") || "none"}.`,
  ];
  if (ctx.customerName) lines.push(`Customer name on record: ${ctx.customerName}.`);
  if (ctx.campaignType) lines.push(`This is an outbound ${ctx.campaignType.replace(/_/g, " ")} call. State the reason for calling in your first reply.`);
  if (ctx.campaignScript) lines.push(`Campaign brief: ${ctx.campaignScript}`);
  if (ctx.contactData && Object.keys(ctx.contactData).length) lines.push(`Customer record: ${Object.entries(ctx.contactData).map(([k, v]) => `${k}: ${v}`).join(", ")}.`);
  system += `\n# This call\n${lines.join("\n")}\n`;

  const modelNames = catalog.flatMap((m) => [m.model, ...m.aliases]);
  return { system, catalog, branches, modelNames };
}

/** Opening line: recording disclosure + greeting, spoken without an LLM round-trip. */
export function buildGreeting(org: Org, agent: AgentConfig, lang: Language, ctx: CallPromptContext): string {
  const fill = (s: string) => s.replace(/\{showroom_name\}/g, org.showroomName).replace(/\{agent_name\}/g, agent.name);
  const disclosure = agent.recordingDisclosure[lang] ?? agent.recordingDisclosure.en ?? "";
  if (ctx.direction === "outbound") {
    const name = ctx.customerName ? (lang === "en" || lang === "kn" ? `${ctx.customerName}, ` : `${ctx.customerName} ji, `) : "";
    const reason: Record<string, Record<string, string>> = {
      en: {
        new_lead_followup: "you recently enquired about a vehicle with us. Is this a good time to talk?",
        cold_reengagement: "you'd enquired with us earlier. Are you still looking for a vehicle?",
        service_due: "your vehicle's service is due. Would you like me to book a slot?",
        insurance_expiry: "your vehicle insurance is expiring soon. Would you like help renewing it?",
        puc_expiry: "your vehicle's PUC certificate is expiring soon. Shall I book a check?",
        festive_offer: "we have festive offers running this season. May I share them?",
        booking_update: "I'm calling with an update on your vehicle booking.",
        feedback: "you recently visited us for service. Could you spare a minute for quick feedback?",
      },
      hinglish: {
        new_lead_followup: "aapne haal hi mein gaadi ke baare mein enquiry ki thi. Kya abhi baat kar sakte hain?",
        cold_reengagement: "aapne pehle enquiry ki thi. Kya aap abhi bhi gaadi dekh rahe hain?",
        service_due: "aapki gaadi ki service due hai. Kya slot book kar doon?",
        insurance_expiry: "aapki gaadi ka insurance jaldi expire ho raha hai. Renewal mein madad karoon?",
        puc_expiry: "aapki gaadi ka PUC jaldi expire ho raha hai. Check book kar doon?",
        festive_offer: "is season festive offers chal rahe hain. Kya main bata sakta hoon?",
        booking_update: "aapki gaadi ki booking ka update dene ke liye call kiya hai.",
        feedback: "aap haal hi mein service ke liye aaye the. Ek minute ka feedback denge?",
      },
    };
    const set = reason[lang === "hi" ? "hinglish" : lang] ?? reason.en!;
    const why = set[ctx.campaignType ?? "new_lead_followup"] ?? set.new_lead_followup!;
    const intro =
      lang === "en" || lang === "kn"
        ? `Hello ${name}this is ${agent.name}, the AI assistant from ${org.showroomName}. ${disclosure} I'm calling because ${why}`
        : `Namaste ${name}main ${agent.name}, ${org.showroomName} se AI assistant. ${disclosure} Maine isliye call kiya kyunki ${why}`;
    return intro.replace(/\s+/g, " ").trim();
  }
  const greeting = agent.greeting[lang] ?? agent.greeting.en ?? `Hello, I'm ${agent.name}, the AI assistant at {showroom_name}. How can I help you today?`;
  // Disclosure first: the caller must hear it is an AI assistant and that the call may be recorded.
  return `${disclosure} ${fill(greeting)}`.trim();
}
