import { agentConfigSchema, type Language, type Message } from "@axo/shared";
import { AGENT_TEMPLATES } from "../../prompts/agents";
import { recordOptOut } from "../compliance/dnd";
import { global, newId, nowIso, platformOf, repo } from "../db/repo";
import { bus } from "../lib/events";
import { logger } from "../lib/logger";
import { maskPhone, normalizePhone } from "../lib/mask";
import { upsertLead } from "../leads/service";
import { conversationIdFor, sendOrgMessage, touchConversation } from "../messaging/service";
import { createLlm, type LlmContentBlock, type LlmMessage, type LlmProvider } from "../providers/llm";
import { createToolRegistry, type ToolRegistry } from "../tools";
import { detectLanguage } from "../voice/language";
import { phrase } from "../voice/phrases";
import { checkPrices, collectNumbers } from "../voice/price-guard";
import { buildSystemPrompt } from "../voice/prompt";

type MessageContent = NonNullable<LlmMessage["content"]>;

const STOP = /^\s*(stop|unsubscribe|opt ?out|band karo|mat bhejo|बंद करो)\s*[.!]?\s*$/i;
const MAX_HISTORY = 30;

const WHATSAPP_NOTE = `
# Channel: WhatsApp chat (not a phone call)
You are replying to WhatsApp messages, so ignore the phone-call specific rules above: no recording disclosure, no
spoken-number formatting, no "end the call". Reply in short chat messages (1-4 sentences), in the customer's language
and script. Write prices as ₹ figures (e.g. ₹12.9 lakh) taken only from the catalog or tool results. Do not use
transfer_to_human for a live transfer: it schedules a callback from the team, so say a person will call them shortly.
Links, addresses and brochures can be pasted directly in your reply.
`;

/** One chat turn at a time per customer, so quick double messages don't get two parallel answers. */
const locks = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(
    key,
    next.finally(() => locks.get(key) === next && locks.delete(key)),
  );
  return next;
}

/** Keep the tail of the history, starting on a plain customer message (never on a dangling tool result). */
function trimHistory(history: LlmMessage[]): LlmMessage[] {
  if (history.length <= MAX_HISTORY) return history;
  let start = history.length - MAX_HISTORY;
  const isPlainUser = (m: LlmMessage) => m.role === "user" && (typeof m.content === "string" || !m.content.some((b) => b.type === "tool_result"));
  while (start < history.length && !isPlainUser(history[start]!)) start++;
  return history.slice(start);
}

export interface IncomingWhatsapp {
  orgId: string;
  phone: string;
  text: string;
  customerName?: string;
  providerId?: string;
}

export interface WhatsappTurnResult {
  inboundId: string;
  reply?: string;
  replyStatus?: Message["status"];
  /** Why the AI didn't answer (feature off, staff took over, opt-out) */
  skipped?: string;
}

/** Entry point for every incoming WhatsApp message (Meta webhook, or the dashboard's demo simulator). */
export async function handleIncomingWhatsapp(i: IncomingWhatsapp, deps: { llm?: LlmProvider; tools?: ToolRegistry } = {}): Promise<WhatsappTurnResult> {
  const phone = normalizePhone(i.phone);
  const r = repo(i.orgId);
  const conversationId = conversationIdFor(phone);
  const inbound: Message = {
    id: newId("msg_"),
    orgId: i.orgId,
    channel: "whatsapp",
    direction: "in",
    phone,
    body: i.text,
    status: "received",
    providerId: i.providerId,
    conversationId,
    audience: "customer",
    author: "customer",
    createdAt: nowIso(),
  };
  await r.messages.set(inbound);
  await touchConversation(i.orgId, phone, inbound, { customerName: i.customerName });
  bus.emitEvent("message.logged", { orgId: i.orgId, message: inbound });

  if (STOP.test(i.text)) {
    await recordOptOut(i.orgId, phone, "whatsapp_stop");
    const res = await sendOrgMessage({ orgId: i.orgId, to: phone, body: "You're unsubscribed and won't receive further messages from us. Reply START anytime to chat again.", author: "system" });
    return { inboundId: inbound.id, skipped: "opted out", replyStatus: res.status };
  }

  const org = await global.orgs().get(i.orgId);
  const p = platformOf(org);
  if (!org || org.status === "suspended") return { inboundId: inbound.id, skipped: "account suspended" };
  if (!p.features.whatsapp || !p.features.whatsappBot) return { inboundId: inbound.id, skipped: "WhatsApp AI replies are turned off" };
  const conv = await r.conversations.get(conversationId);
  if (conv && !conv.botEnabled) return { inboundId: inbound.id, skipped: "staff are handling this chat" };

  return serialize(`${i.orgId}:${conversationId}`, async () => {
    try {
      const reply = await runChatTurn(i.orgId, phone, i.text, i.customerName, deps);
      if (!reply) return { inboundId: inbound.id, skipped: "no reply" };
      const res = await sendOrgMessage({ orgId: i.orgId, to: phone, body: reply, author: "ai" });
      return { inboundId: inbound.id, reply, replyStatus: res.status };
    } catch (err) {
      logger.error({ orgId: i.orgId, phone: maskPhone(phone), err: (err as Error).message }, "WhatsApp reply failed");
      return { inboundId: inbound.id, skipped: "AI error" };
    }
  });
}

/** The AI side of one message: same agent, catalog, tools and price guard as phone calls. */
async function runChatTurn(orgId: string, phone: string, text: string, customerName: string | undefined, deps: { llm?: LlmProvider; tools?: ToolRegistry }): Promise<string> {
  const r = repo(orgId);
  const org = (await global.orgs().get(orgId))!;
  const conversationId = conversationIdFor(phone);
  const conv = (await r.conversations.get(conversationId))!;

  const agents = await r.agents.list({ where: { active: true } });
  const agent = agents.find((a) => a.id === conv.agentId) ?? agents.find((a) => a.kind !== "service") ?? agents[0] ?? agentConfigSchema.parse({ ...AGENT_TEMPLATES[1], orgId });

  let lead = (await r.leads.list({ where: { phone } }))[0];
  if (!lead) lead = (await upsertLead(orgId, { phone, name: customerName, source: "whatsapp" })).lead;

  const built = await buildSystemPrompt(r, org, agent, { direction: "web", callerPhone: phone, customerName: lead.name ?? customerName });
  const system = `${built.system}${WHATSAPP_NOTE}${conv.callContext ? `\n# Earlier phone call with this customer\n${conv.callContext}\n` : ""}`;

  const allowed = collectNumbers(built.catalog);
  collectNumbers((await r.offers.list()).map((o) => o.description), allowed);
  collectNumbers((await r.settings()).emi, allowed);
  collectNumbers(text, allowed);

  const guess = detectLanguage(text).language;
  const language: Language = agent.languages.includes(guess) ? guess : guess === "hinglish" && agent.languages.includes("hi") ? "hi" : agent.defaultLanguage;

  const history: LlmMessage[] = trimHistory([...((conv.history as LlmMessage[]) ?? []), { role: "user", content: text }]);
  const llm = deps.llm ?? createLlm();
  const tools = deps.tools ?? createToolRegistry();
  const ctx = {
    orgId,
    repo: r,
    org,
    agent,
    callId: conversationId,
    callerPhone: phone,
    language,
    actions: {},
    canTransfer: false,
    countMessage: () => undefined,
    log: (msg: string, extra?: Record<string, unknown>) => logger.info({ orgId, conversationId, ...extra }, msg),
  };

  const replyParts: string[] = [];
  for (let round = 0; round < 5; round++) {
    const res = await llm.streamTurn({ system, messages: history, tools: tools.defs(), hints: { models: built.modelNames, agentKind: agent.kind, callerPhone: phone }, onText: () => undefined });
    history.push({ role: "assistant", content: res.content.length ? (res.content as MessageContent) : [{ type: "text", text: "..." }] });
    if (res.text.trim()) replyParts.push(res.text.trim());
    if (!res.toolUses.length) break;
    const results: LlmContentBlock[] = [];
    for (const tu of res.toolUses) {
      const exec = await tools.execute(tu.name, tu.input, ctx);
      collectNumbers(exec.result, allowed);
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(exec.result), is_error: !exec.ok } as LlmContentBlock);
    }
    history.push({ role: "user", content: results as MessageContent });
  }

  await r.conversations.update(conversationId, { history: trimHistory(history), agentId: agent.id, leadId: lead.id });
  await r.leads.update(lead.id, { firstContactedAt: lead.firstContactedAt ?? nowIso(), stage: lead.stage === "new" ? "contacted" : lead.stage, updatedAt: nowIso() });

  // Same rule as calls: never send a price that isn't grounded in the catalog, an offer or a tool result.
  return replyParts
    .join("\n")
    .split("\n")
    .map((line) =>
      line
        .split(/(?<=[.!?।])\s+/)
        .map((s) => (checkPrices(s, allowed).ok ? s : phrase("priceFallback", language)))
        .join(" "),
    )
    .join("\n")
    .trim();
}
