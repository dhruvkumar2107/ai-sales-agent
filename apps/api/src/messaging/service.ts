import type { Language, Message } from "@axo/shared";
import { global, newId, nowIso, platformOf, repo } from "../db/repo";
import { decryptString } from "../lib/crypto";
import { bus } from "../lib/events";
import { logger } from "../lib/logger";
import { maskPhone, normalizePhone } from "../lib/mask";
import { renderTemplate, sendMessage, templateParams, type Channel, type TemplateName } from "../providers/messaging";
import { monthStart } from "../platform/usage";

export const conversationIdFor = (phone: string) => `wa_${normalizePhone(phone).replace(/\D/g, "")}`;
const DAY_MS = 24 * 3600_000;

export interface OrgMessageInput {
  orgId: string;
  to: string;
  channel?: Channel;
  template?: TemplateName;
  vars?: Record<string, string | undefined>;
  /** Free text; otherwise rendered from `template` */
  body?: string;
  language?: Language;
  callId?: string;
  audience?: Message["audience"];
  author?: Message["author"];
}

export interface OrgMessageResult {
  ok: boolean;
  status: Message["status"];
  messageId: string;
  error?: string;
}

/**
 * The one way the platform sends WhatsApp/SMS. Applies the platform owner's switches and limits for the
 * dealership, picks free text vs an approved template (Meta 24 h rule), and records every attempt in the
 * dealership's message log (also what the admin panel counts).
 */
export async function sendOrgMessage(i: OrgMessageInput): Promise<OrgMessageResult> {
  const org = await global.orgs().get(i.orgId);
  const p = platformOf(org);
  const r = repo(i.orgId);
  const channel: Channel = i.channel ?? "whatsapp";
  const to = normalizePhone(i.to);
  const audience = i.audience ?? "customer";
  const body = i.body ?? (i.template ? renderTemplate(i.template, i.vars ?? {}, i.language) : "");
  const isCustomerWa = channel === "whatsapp" && audience === "customer";
  const conversationId = isCustomerWa ? conversationIdFor(to) : undefined;

  let blocked: string | undefined;
  if (!org) blocked = "unknown dealership";
  else if (org.status === "suspended") blocked = "account suspended";
  else if (channel === "whatsapp" && !p.features.whatsapp) blocked = "WhatsApp is turned off for this dealership";
  else if (p.limits.monthlyMessages > 0) {
    const from = monthStart();
    const used = (await r.messages.list({ where: { direction: "out" } })).filter((m) => m.createdAt >= from && (m.status === "sent" || m.status === "logged")).length;
    if (used >= p.limits.monthlyMessages) blocked = `monthly message limit of ${p.limits.monthlyMessages} reached`;
  }

  let status: Message["status"] = "blocked";
  let providerId: string | undefined;
  let error = blocked;
  if (!blocked) {
    // Meta: free text inside 24 h of the customer's last message, an approved template outside it.
    const conv = conversationId ? await r.conversations.get(conversationId) : null;
    const windowOpen = Boolean(conv?.lastInboundAt && Date.now() - Date.parse(conv.lastInboundAt) < DAY_MS);
    const metaTemplate = !windowOpen && i.template ? p.whatsapp.templates[i.template] : undefined;
    const settings = await r.settings();
    const res = await sendMessage(to, body, channel, {
      meta: {
        phoneNumberId: p.whatsapp.phoneNumberId || undefined,
        token: settings.secrets.metaWaToken ? decryptString(settings.secrets.metaWaToken) : undefined,
        template: metaTemplate && i.template ? { name: metaTemplate, language: p.whatsapp.templateLanguage, params: templateParams(i.template).map((k) => i.vars?.[k] ?? "") } : undefined,
      },
    });
    status = res.ok ? (res.logged ? "logged" : "sent") : "failed";
    providerId = res.id;
    error = res.error;
  } else {
    logger.info({ orgId: i.orgId, to: maskPhone(to), reason: blocked }, "message blocked");
  }

  const message: Message = {
    id: newId("msg_"),
    orgId: i.orgId,
    channel,
    direction: "out",
    phone: to,
    body,
    template: i.template,
    status,
    error,
    providerId,
    callId: i.callId,
    conversationId,
    audience,
    author: i.author ?? (i.template ? "system" : "ai"),
    createdAt: nowIso(),
  };
  await r.messages.set(message);
  if (conversationId && status !== "blocked") await touchConversation(i.orgId, to, message);
  bus.emitEvent("message.logged", { orgId: i.orgId, message });
  return { ok: status === "sent" || status === "logged", status, messageId: message.id, error };
}

/** Create or update the WhatsApp thread for a customer number with the latest message. */
export async function touchConversation(orgId: string, phone: string, m: Pick<Message, "body" | "direction" | "createdAt">, extra: { customerName?: string } = {}) {
  const r = repo(orgId);
  const id = conversationIdFor(phone);
  const cur = await r.conversations.get(id);
  const inbound = m.direction === "in";
  await r.conversations.set({
    id,
    orgId,
    phone: normalizePhone(phone),
    customerName: extra.customerName ?? cur?.customerName,
    agentId: cur?.agentId,
    leadId: cur?.leadId,
    history: cur?.history ?? [],
    botEnabled: cur?.botEnabled ?? true,
    lastMessageAt: m.createdAt,
    lastInboundAt: inbound ? m.createdAt : cur?.lastInboundAt,
    lastPreview: m.body.slice(0, 140),
    messageCount: (cur?.messageCount ?? 0) + 1,
    unread: inbound ? (cur?.unread ?? 0) + 1 : (cur?.unread ?? 0),
    callContext: cur?.callContext,
    createdAt: cur?.createdAt ?? m.createdAt,
  });
}
