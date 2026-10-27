import { global, repo } from "../db/repo";
import { logger } from "../lib/logger";
import { deleteObject } from "../lib/storage";

/**
 * DPDP-aware retention: delete recordings and transcripts past each dealership's retention period.
 * Call metadata (outcome, cost, scores) is kept for analytics; personal content is removed.
 */
export async function purgeExpired(now = new Date()) {
  let recordings = 0;
  let transcripts = 0;
  for (const org of await global.orgs().list()) {
    const r = repo(org.id);
    const { retentionDays } = await r.settings();
    const recCutoff = new Date(now.getTime() - retentionDays.recordings * 86400_000).toISOString();
    const txCutoff = new Date(now.getTime() - retentionDays.transcripts * 86400_000).toISOString();
    for (const call of await r.calls.list()) {
      const patch: Record<string, unknown> = {};
      if (call.recordingPath && call.startedAt < recCutoff) {
        await deleteObject(call.recordingPath).catch(() => undefined);
        patch.recordingPath = null;
        recordings++;
      }
      if (call.transcript.length && call.startedAt < txCutoff) {
        patch.transcript = [];
        patch.summary = "[redacted after retention period]";
        transcripts++;
      }
      if (Object.keys(patch).length) await r.calls.update(call.id, patch);
    }
  }
  logger.info({ recordings, transcripts }, "retention purge complete");
  return { recordings, transcripts };
}
