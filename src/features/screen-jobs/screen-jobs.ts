import { setTimeout as delay } from "node:timers/promises";
import type { Collection } from "mongodb";
import { type Job, JobStatus } from "#shared/job.ts";
import { logger } from "#shared/logger.ts";
import type { Telegram } from "#shared/telegram.ts";
import { formatPing } from "./format-ping.ts";

export type ScreenJobsContext = {
  jobs: Collection<Job>;
  telegram: Telegram;
  now: Date;
  pingGapMs?: number;
};

const PING_GAP_MS = 1_000;

export async function screenJobs(context: ScreenJobsContext): Promise<void> {
  const possibleJobs = await context.jobs.find({ status: JobStatus.possible }).sort({ postedAt: 1 }).toArray();
  for (const [index, job] of possibleJobs.entries()) {
    if (index > 0) await delay(context.pingGapMs ?? PING_GAP_MS);
    await pingJob(job, context);
  }
}

async function pingJob(job: Job, { jobs, telegram, now }: ScreenJobsContext): Promise<void> {
  try {
    await telegram.send(formatPing(job, now));
  } catch (error) {
    logger.warn({ eventType: "screen.ping_failed", jobId: job._id, err: error }, "ping failed, job stays possible");
    return;
  }
  await jobs.updateOne({ _id: job._id }, { $set: { status: JobStatus.pinged } });
}
