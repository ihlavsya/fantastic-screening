import type { Collection } from "mongodb";
import type { Settings } from "#shared/config.ts";
import { buildJobId, type Job, type JobDetails, JobStatus, type ListedJob } from "#shared/job.ts";
import { logger } from "#shared/logger.ts";
import type { JobSource } from "./job-source.ts";
import { prefilter } from "./prefilter.ts";

export type DiscoverJobsContext = {
  sources: JobSource[];
  jobs: Collection<Job>;
  settings: Pick<Settings, "lookbackHours" | "maxApplicants">;
  now: Date;
};

type JobOutcome = Pick<Job, "status" | "rejectReason" | "details">;

const MS_PER_HOUR = 3_600_000;

export async function discoverJobs(context: DiscoverJobsContext): Promise<void> {
  for (const source of context.sources) {
    const recentJobs = keepRecent(await source.fetchRecentJobs(), context);
    const unseenJobs = await dropSeen(recentJobs, context.jobs);
    for (const job of unseenJobs) await discoverJob(job, source, context);
  }
}

function keepRecent(jobs: ListedJob[], { settings, now }: DiscoverJobsContext): ListedJob[] {
  const oldestAllowed = now.getTime() - settings.lookbackHours * MS_PER_HOUR;
  return jobs.filter(({ postedAt }) => postedAt.getTime() >= oldestAllowed);
}

async function dropSeen(jobs: ListedJob[], collection: Collection<Job>): Promise<ListedJob[]> {
  const seen = await collection
    .find({ _id: { $in: jobs.map(buildJobId) } }, { projection: { _id: 1 } })
    .toArray();
  const seenIds = new Set(seen.map((seenJob) => seenJob._id));
  return jobs.filter((job) => !seenIds.has(buildJobId(job)));
}

async function discoverJob(job: ListedJob, source: JobSource, context: DiscoverJobsContext): Promise<void> {
  const verdict = prefilter(job);
  if (!verdict.hasPassed) {
    await saveJob(job, { status: JobStatus.prefilterRejected, rejectReason: verdict.rejectReason }, context);
    return;
  }

  const details = await fetchDetailsOrSkip(job, source);
  if (details === undefined) return;

  const status = checkHasTooManyApplicants(details, context.settings.maxApplicants)
    ? JobStatus.tooManyApplicants
    : JobStatus.possible;
  await saveJob(job, { status, details }, context);
}

async function fetchDetailsOrSkip(job: ListedJob, source: JobSource): Promise<JobDetails | undefined> {
  try {
    return await source.fetchDetails(job);
  } catch (error) {
    logger.warn(
      { eventType: "discover.details_failed", source: source.name, link: job.link, err: error },
      "job details failed, skipping job",
    );
    return undefined;
  }
}

function checkHasTooManyApplicants({ applicants }: JobDetails, maxApplicants: number): boolean {
  return applicants !== undefined && applicants >= maxApplicants;
}

async function saveJob(job: ListedJob, outcome: JobOutcome, { jobs, now }: DiscoverJobsContext): Promise<void> {
  await jobs.insertOne({ _id: buildJobId(job), ...job, ...outcome, seenAt: now });
}
