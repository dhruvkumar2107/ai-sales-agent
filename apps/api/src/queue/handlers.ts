import { campaignTick, reminderScan, runLeadFollowup, wireCampaignEvents } from "../campaigns/service";
import { purgeExpired } from "../compliance/retention";
import { checkCallable } from "../compliance/dnd";
import { logger } from "../lib/logger";
import { renderTemplate, sendMessage, type TemplateName } from "../providers/messaging";
import { jobQueue } from "./index";

/** Register job handlers and recurring schedules. Runs in the worker (BullMQ) or in the API process (memory queue). */
export async function startJobs() {
  const q = jobQueue();
  q.process({
    "send-message": async (d) => {
      // Respect opt-outs for scheduled messages too.
      if (await checkCallable(d.orgId, d.to, { allowTransactional: true })) return;
      const body = d.body ?? renderTemplate(d.template as TemplateName, d.vars ?? {});
      const res = await sendMessage(d.to, body, d.channel ?? "whatsapp");
      if (!res.ok) throw new Error(res.error ?? "message failed");
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
}
