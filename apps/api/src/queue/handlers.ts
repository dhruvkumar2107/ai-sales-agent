import { campaignTick, reminderScan, runLeadFollowup, wireCampaignEvents } from "../campaigns/service";
import { purgeExpired } from "../compliance/retention";
import { checkCallable } from "../compliance/dnd";
import { logger } from "../lib/logger";
import { sendOrgMessage } from "../messaging/service";
import type { TemplateName } from "../providers/messaging";
import { wirePostCallWhatsapp } from "../whatsapp/post-call";
import { jobQueue } from "./index";

/** Register job handlers and recurring schedules. Runs in the worker (BullMQ) or in the API process (memory queue). */
export async function startJobs() {
  const q = jobQueue();
  q.process({
    "send-message": async (d) => {
      // Respect opt-outs for scheduled messages too.
      if (await checkCallable(d.orgId, d.to, { allowTransactional: true })) return;
      const res = await sendOrgMessage({ orgId: d.orgId, to: d.to, channel: d.channel ?? "whatsapp", body: d.body, template: d.template as TemplateName | undefined, vars: d.vars, language: d.language });
      // Blocked by the dealership's switches or limits: retrying will not help.
      if (!res.ok && res.status !== "blocked") throw new Error(res.error ?? "message failed");
    },
    "lead-followup": (d) => runLeadFollowup(d as Parameters<typeof runLeadFollowup>[0]),
    "campaign-tick": (d) => campaignTick(d.orgId),
    "reminder-scan": (d) => reminderScan(d.orgId),
    "retention-purge": async () => void (await purgeExpired()),
  });
  await q.repeat("campaign-tick", {}, "*/1 * * * *");
  await q.repeat("reminder-scan", {}, "0 10 * * *");
  await q.repeat("retention-purge", {}, "30 2 * * *");
  logger.info("background jobs started");
}

/** Event subscriptions must live where calls run (the API process). */
export function startEventWiring() {
  wireCampaignEvents();
  wirePostCallWhatsapp();
}
