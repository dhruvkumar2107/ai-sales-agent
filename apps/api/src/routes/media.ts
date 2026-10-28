import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { FastifyInstance } from "fastify";
import WebSocket, { WebSocketServer } from "ws";
import type { Language } from "@axo/shared";
import { mulaw8kToPcm16k, pcm16kToMulaw8k, pcm16kToPcm8k, pcm8kToPcm16k } from "../audio/codec";
import { verifyToken } from "../auth/auth";
import { trackSession } from "../calls/live";
import { pendingCalls } from "../calls/outbound";
import { env } from "../config";
import { global } from "../db/repo";
import { bus, type DomainEvents } from "../lib/events";
import { logger } from "../lib/logger";
import { checkCallAllowed } from "../platform/usage";
import { normalizePhone } from "../lib/mask";
import { telephony } from "../providers/telephony";
import { CallSession, type CallSessionOptions, type CallTransport } from "../voice/session";

interface StreamContext {
  orgId: string;
  agentId?: string;
  direction: "inbound" | "outbound";
  callerPhone: string;
  calledNumber: string;
  callId?: string;
  campaign?: CallSessionOptions["campaign"];
  customerName?: string;
  leadId?: string;
}

/** Work out org, agent and campaign for a stream from its parameters (outbound: pending call; inbound: number routing). */
async function resolveContext(p: Record<string, string | undefined>): Promise<StreamContext> {
  if (p.callId) {
    const pending = await pendingCalls().get(p.callId);
    if (pending) {
      await pendingCalls().delete(p.callId);
      return {
        orgId: pending.orgId,
        agentId: pending.agentId,
        direction: "outbound",
        callerPhone: pending.to,
        calledNumber: p.from ?? "",
        callId: pending.id,
        campaign: pending.campaignId ? { id: pending.campaignId, type: pending.campaignType ?? "new_lead_followup", script: pending.campaignScript, contactId: pending.contactId, data: pending.contactData } : pending.campaignType ? { id: "adhoc", type: pending.campaignType, script: pending.campaignScript } : undefined,
        customerName: pending.customerName,
        leadId: pending.leadId,
      };
    }
  }
  const to = p.to ? normalizePhone(p.to) : "";
  const route = to ? await global.phoneRoutes().get(to) : null;
  return {
    orgId: route?.orgId ?? p.orgId ?? env.DEV_ORG_ID,
    agentId: route?.agentId ?? p.agentId,
    direction: "inbound",
    callerPhone: p.from ? normalizePhone(p.from) : "",
    calledNumber: to,
  };
}

async function startSession(ctx: StreamContext, transport: CallTransport, provider: string, providerCallId: string) {
  // Outbound calls were checked when placed; inbound calls are checked here (Exotel has no pre-answer hook).
  if (ctx.direction === "inbound") {
    const gate = await checkCallAllowed(ctx.orgId, "inbound");
    if (!gate.ok) throw new Error(`inbound call not allowed: ${gate.reason}`);
  }
  const session = new CallSession({
    orgId: ctx.orgId,
    agentId: ctx.agentId,
    callId: ctx.callId,
    direction: ctx.direction,
    callerPhone: ctx.callerPhone,
    calledNumber: ctx.calledNumber,
    provider,
    providerCallId,
    transport,
    campaign: ctx.campaign,
    customerName: ctx.customerName,
    leadId: ctx.leadId,
  });
  trackSession(session, { orgId: ctx.orgId, direction: ctx.direction, campaign: ctx.campaign });
  await session.start();
  return session;
}

// ------------------------------------------------------------------ Twilio <Connect><Stream>

function handleTwilio(ws: WebSocket) {
  let session: CallSession | null = null;
  let streamSid = "";
  let callSid = "";
  const send = (obj: unknown) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(obj));

  ws.on("message", async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (msg.event) {
      case "start": {
        streamSid = msg.start.streamSid;
        callSid = msg.start.callSid;
        const ctx = await resolveContext(msg.start.customParameters ?? {});
        const transport: CallTransport = {
          kind: "twilio",
          // Twilio expects 8 kHz mu-law, base64, in media messages.
          sendAudio: (pcm) => send({ event: "media", streamSid, media: { payload: pcm16kToMulaw8k(pcm).toString("base64") } }),
          clearAudio: () => send({ event: "clear", streamSid }),
          hangup: async () => {
            await telephony().hangup(callSid);
            ws.close();
          },
          transfer: (number) => telephony().transfer(callSid, number),
        };
        try {
          session = await startSession(ctx, transport, "twilio", callSid);
        } catch (err) {
          logger.error({ err }, "failed to start twilio session");
          ws.close();
        }
        break;
      }
      case "media":
        if (session && (!msg.media.track || msg.media.track === "inbound")) session.pushAudio(mulaw8kToPcm16k(Buffer.from(msg.media.payload, "base64")));
        break;
      case "stop":
        void session?.end("dropped", { hangup: false });
        break;
    }
  });
  ws.on("close", () => void session?.end("dropped", { hangup: false }));
  ws.on("error", (err) => logger.warn({ err: err.message }, "twilio media ws error"));
}

// ------------------------------------------------------------------ Exotel Voicebot applet

function handleExotel(ws: WebSocket, query: URLSearchParams) {
  let session: CallSession | null = null;
  let streamSid = "";
  let callSid = "";
  const send = (obj: unknown) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(obj));

  ws.on("message", async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (msg.event) {
      case "start": {
        streamSid = msg.stream_sid ?? msg.streamSid ?? msg.start?.stream_sid;
        callSid = msg.start?.call_sid ?? msg.start?.callSid ?? "";
        const custom = msg.start?.custom_parameters ?? {};
        const ctx = await resolveContext({ ...Object.fromEntries(query), ...custom, from: msg.start?.from ?? query.get("from") ?? undefined, to: msg.start?.to ?? query.get("to") ?? undefined });
        const transport: CallTransport = {
          kind: "exotel",
          // Exotel expects 16-bit 8 kHz linear PCM; send in multiples of 320 bytes.
          sendAudio: (pcm) => {
            const pcm8 = pcm16kToPcm8k(pcm);
            for (let i = 0; i < pcm8.length; i += 3200) send({ event: "media", stream_sid: streamSid, media: { payload: pcm8.subarray(i, i + 3200).toString("base64") } });
          },
          clearAudio: () => send({ event: "clear", stream_sid: streamSid }),
          hangup: async () => ws.close(),
          transfer: async (number) => {
            const ok = await telephony().transfer(callSid, number);
            setTimeout(() => ws.close(), 200);
            return ok;
          },
        };
        try {
          session = await startSession(ctx, transport, "exotel", callSid);
        } catch (err) {
          logger.error({ err }, "failed to start exotel session");
          ws.close();
        }
        break;
      }
      case "media":
        if (session) session.pushAudio(pcm8kToPcm16k(Buffer.from(msg.media.payload, "base64")));
        break;
      case "stop":
        void session?.end("dropped", { hangup: false });
        break;
    }
  });
  ws.on("close", () => void session?.end("dropped", { hangup: false }));
}

// ------------------------------------------------------------------ Browser test console

async function handleConsole(ws: WebSocket, query: URLSearchParams) {
  let auth;
  try {
    auth = await verifyToken(query.get("token") ?? undefined, { adminKey: query.get("adminKey") ?? undefined, actAsOrg: query.get("actAs") ?? undefined });
  } catch {
    ws.close(4401, "unauthorized");
    return;
  }
  if (!auth.orgId) return ws.close(4403, "no organisation");
  const gate = await checkCallAllowed(auth.orgId, "web");
  if (!gate.ok && !auth.superAdmin) return ws.close(4403, gate.reason);
  const textMode = query.get("mode") === "text";
  const send = (obj: unknown) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(obj));
  const transport: CallTransport = {
    kind: "browser",
    sendAudio: (pcm) => ws.readyState === WebSocket.OPEN && ws.send(pcm),
    clearAudio: () => send({ type: "clear" }),
    hangup: async () => {
      send({ type: "ended" });
      setTimeout(() => ws.close(), 300);
    },
    transfer: async (number) => {
      send({ type: "transfer", number });
      return false; // browsers can't be bridged to a phone; the tool schedules a callback instead
    },
    sendEvent: (e) => send(e),
  };
  const session = new CallSession({
    orgId: auth.orgId,
    agentId: query.get("agentId") ?? undefined,
    direction: "web",
    callerPhone: query.get("phone") ?? "+910000000000",
    provider: "browser",
    transport,
    textMode,
    language: (query.get("lang") as Language | null) ?? undefined,
  });
  trackSession(session, { orgId: auth.orgId, direction: "web" });
  session.on("ended", (call) => send({ type: "call_summary", callId: session.callId, outcome: call?.outcome, summary: call?.summary, leadScore: call?.leadScore, cost: call?.cost, latency: call?.avgFirstAudioMs }));

  ws.on("message", (raw, isBinary) => {
    if (isBinary) return session.pushAudio(Buffer.from(raw as Buffer));
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "text" && msg.text) session.pushText(String(msg.text));
      if (msg.type === "hangup") void session.end("other", { hangup: false });
    } catch {
      /* ignore */
    }
  });
  // Show WhatsApp/SMS the agent sends during (and right after) the test call.
  const onMessage = ({ message }: DomainEvents["message.logged"]) => {
    if (message.callId === session.callId && message.direction === "out") send({ type: "message", channel: message.channel, body: message.body, status: message.status, audience: message.audience, error: message.error });
  };
  bus.on("message.logged", onMessage);
  ws.on("close", () => {
    bus.off("message.logged", onMessage);
    void session.end("dropped", { hangup: false });
  });
  send({ type: "started", callId: session.callId });
  await session.start().catch((err) => {
    logger.error({ err }, "console session failed");
    send({ type: "error", message: (err as Error).message });
    ws.close();
  });
}

/** Attach the media WebSocket server to Fastify's HTTP server (raw `ws`, no framework plugin). */
export function attachMediaServer(app: FastifyInstance) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  app.server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/media/exotel" && env.EXOTEL_WEBHOOK_SECRET && url.searchParams.get("secret") !== env.EXOTEL_WEBHOOK_SECRET) {
      socket.destroy();
      return;
    }
    if (!["/media/twilio", "/media/exotel", "/ws/console"].includes(url.pathname)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (url.pathname === "/media/twilio") handleTwilio(ws);
      else if (url.pathname === "/media/exotel") handleExotel(ws, url.searchParams);
      else void handleConsole(ws, url.searchParams);
    });
  });
  app.addHook("onClose", async () => wss.close());
}
