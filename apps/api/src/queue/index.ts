import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { env } from "../config";
import { logger } from "../lib/logger";

export type JobName = "outbound-call" | "send-message" | "reminder-scan" | "lead-followup" | "campaign-tick" | "retention-purge";

export interface JobOptions {
  delayMs?: number;
  /** Deduplicate: a job with the same id is not added twice */
  jobId?: string;
  attempts?: number;
}

export type JobHandler = (data: Record<string, any>) => Promise<void>;

export interface JobQueue {
  add(name: JobName, data: Record<string, unknown>, opts?: JobOptions): Promise<void>;
  /** Start consuming jobs with these handlers. */
  process(handlers: Partial<Record<JobName, JobHandler>>): void;
  repeat(name: JobName, data: Record<string, unknown>, cron: string): Promise<void>;
  close(): Promise<void>;
}

/** Single-process queue for development and tests. Jobs are lost on restart. */
class MemoryQueue implements JobQueue {
  private handlers: Partial<Record<JobName, JobHandler>> = {};
  private timers = new Map<string, NodeJS.Timeout>();
  private backlog: { name: JobName; data: Record<string, unknown> }[] = [];

  async add(name: JobName, data: Record<string, unknown>, opts: JobOptions = {}) {
    const id = opts.jobId ?? `${name}:${Math.random().toString(36).slice(2)}`;
    if (this.timers.has(id)) return;
    const run = async (attempt: number) => {
      this.timers.delete(id);
      const h = this.handlers[name];
      if (!h) return void this.backlog.push({ name, data });
      try {
        await h(data);
      } catch (err) {
        logger.warn({ err: (err as Error).message, job: name, attempt }, "job failed");
        if (attempt < (opts.attempts ?? 3)) this.timers.set(id, setTimeout(() => void run(attempt + 1), 2000 * 2 ** attempt).unref());
      }
    };
    this.timers.set(id, setTimeout(() => void run(1), opts.delayMs ?? 0).unref());
  }

  process(handlers: Partial<Record<JobName, JobHandler>>) {
    this.handlers = { ...this.handlers, ...handlers };
    const pending = this.backlog;
    this.backlog = [];
    for (const j of pending) void this.add(j.name, j.data);
  }

  async repeat(name: JobName, data: Record<string, unknown>, cron: string) {
    // Minimal cron support for "m h * * *" (daily) and "*/N * * * *" (every N minutes).
    const every = cron.match(/^\*\/(\d+) \* \* \* \*$/);
    const intervalMs = every ? Number(every[1]) * 60_000 : 24 * 3600_000;
    const tick = () => void this.add(name, data);
    setInterval(tick, intervalMs).unref();
  }

  async close() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}

/** Redis-backed queue (production). Delayed jobs survive restarts; workers can scale horizontally. */
class BullQueue implements JobQueue {
  private connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  private queue = new Queue("axo", { connection: this.connection });
  private worker: Worker | null = null;

  async add(name: JobName, data: Record<string, unknown>, opts: JobOptions = {}) {
    await this.queue.add(name, data, {
      delay: opts.delayMs,
      jobId: opts.jobId,
      attempts: opts.attempts ?? 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  process(handlers: Partial<Record<JobName, JobHandler>>) {
    this.worker = new Worker(
      "axo",
      async (job: Job) => {
        const h = handlers[job.name as JobName];
        if (h) await h(job.data);
      },
      { connection: this.connection, concurrency: 10 },
    );
    this.worker.on("failed", (job, err) => logger.warn({ job: job?.name, err: err.message }, "job failed"));
  }

  async repeat(name: JobName, data: Record<string, unknown>, cron: string) {
    await this.queue.add(name, data, { repeat: { pattern: cron, tz: "Asia/Kolkata" }, jobId: `repeat:${name}` });
  }

  async close() {
    await this.worker?.close();
    await this.queue.close();
    this.connection.disconnect();
  }
}

let q: JobQueue | null = null;

export function jobQueue(): JobQueue {
  if (!q) q = env.QUEUE_BACKEND === "bullmq" ? new BullQueue() : new MemoryQueue();
  return q;
}
