import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { VoiceHandler } from "../voice/handler";
import { logger } from "../lib/logger";
import { authenticate } from "../auth/auth";
import { orgOf } from "../auth/auth";

export async function setupVoiceWebSocket(app: FastifyInstance) {
  app.get("/ws/call", { preHandler: authenticate }, async (req, reply) => {
    try {
      const auth = await authenticate(req);
      if (!auth.orgId) {
        return reply.code(403).send({ error: "No organisation" });
      }
      
      const orgId = auth.orgId;
      const callSid = (req as any).callSid ?? `call_${Date.now()}`;
      // Store callSid on the request so VoiceHandler can access it
      (req as any).callSid = callSid;
      
      const socket = req.socket as any;
      
      const handler = new VoiceHandler(callSid, orgId, socket);
      await handler.handleSetup();
      
      // Handle incoming messages from WebSocket
socket.on("message", async (data: any) => {
        const message = data;
        
        if (message.type === "inbound_audio") {
          // Handle incoming audio from telephony provider
          await handler.handleCallerAudio(Buffer.from(message.audioBase64, "base64"));
        } else if (message.type === "dtmf") {
          // Handle DTMF inputs
          logger.info({ callSid: handler.callSid }, "DTMF received");
        } else if (message.type === "hook_state") {
          // Handle call hook state (answered, completed, etc.)
          logger.info({ callSid: handler.callSid, hookState: message.hookState }, "hook state");
        }
      });
      
      socket.on("close", () => {
        logger.info({ callSid: handler.callSid }, "WebSocket closed");
        handler.endCall("no_answer");
      });
      
      socket.on("error", (err: Error) => {
        logger.error({ callSid: handler.callSid, err }, "WebSocket error");
        handler.endCall("failed");
      });
      
    } catch (e) {
      const err = e as Error;
      logger.error({ err: err.message }, "Voice WebSocket authentication failed");
      reply.code(401).send({ error: err.message });
    }
  });
}