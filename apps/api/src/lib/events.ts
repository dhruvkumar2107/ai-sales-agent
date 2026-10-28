import { EventEmitter } from "node:events";
import type { Call, Message } from "@axo/shared";

/** In-process domain events, used to decouple calls from campaigns, follow-ups and analytics. */
export interface DomainEvents {
  /** An outbound attempt finished (answered or not). */
  "call.attempt.finished": { orgId: string; callId: string; outcome: string; answered: boolean; campaignId?: string; contactId?: string };
  "lead.created": { orgId: string; leadId: string; source: string };
  "testdrive.booked": { orgId: string; testDriveId: string };
  /** A call was finalized (summary, outcome and extracted fields are on the record). */
  "call.finished": { orgId: string; call: Call };
  /** A WhatsApp/SMS message was sent, blocked or received. */
  "message.logged": { orgId: string; message: Message };
}

class TypedBus extends EventEmitter {
  emitEvent<K extends keyof DomainEvents>(name: K, payload: DomainEvents[K]) {
    return this.emit(name, payload);
  }
  onEvent<K extends keyof DomainEvents>(name: K, fn: (payload: DomainEvents[K]) => void | Promise<void>) {
    return this.on(name, (p) => void Promise.resolve(fn(p)).catch(() => undefined));
  }
}

export const bus = new TypedBus();
