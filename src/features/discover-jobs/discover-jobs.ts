import type { Collection } from "mongodb";
import type { Settings } from "#shared/config.ts";
import { buildJobId, type Job, type JobDetails, JobStatus, type ListedJob } from "#shared/job.ts";
import { logger } from "#shared/logger.ts";
import { detailsFilter } from "./details-filter.ts";
import type { JobSource } from "./job-source.ts";
import { prefilter } from "./prefilter.ts";

export type DiscoverJobsContext = {
  sources: JobSource[];
  jobs: Collection<Job>;
  settings: Pick<Settings, "lookbackHours" | "maxApplicants">;
  now: Date;
};

type JobOutcome = Pick<Job, "status" | "rejectReason" | "details">;

type DiscoverResult = JobStatus | "details_failed";

const MS_PER_HOUR = 3_600_000;

export async function discoverJobs(context: DiscoverJobsContext): Promise<void> {
  for (const source of context.sources) await discoverFromSource(source, context);
}

async function discoverFromSource(source: JobSource, context: DiscoverJobsContext): Promise<void> {
  const fetchedJobs = await source.fetchRecentJobs();
  const recentJobs = keepRecent(fetchedJobs, context);
  const unseenJobs = await dropSeen(recentJobs, context.jobs);
  const results: DiscoverResult[] = [];
  for (const job of unseenJobs) results.push(await discoverJob(job, source, context));
  logger.info(
    {
      eventType: "discover.source_done",
      source: source.name,
      fetched: fetchedJobs.length,
      recent: recentJobs.length,
      unseen: unseenJobs.length,
      results: countResults(results),
    },
    "source done",
  );
}

function countResults(results: DiscoverResult[]): Partial<Record<DiscoverResult, number>> {
  const counts: Partial<Record<DiscoverResult, number>> = {};
  for (const result of results) counts[result] = (counts[result] ?? 0) + 1;
  return counts;
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

async function discoverJob(job: ListedJob, source: JobSource, context: DiscoverJobsContext): Promise<DiscoverResult> {
  const verdict = prefilter(job);
  if (!verdict.hasPassed) {
    return saveJob(job, { status: JobStatus.prefilterRejected, rejectReason: verdict.rejectReason }, context);
  }

  const details = await fetchDetailsOrSkip(job, source);
  if (details === undefined) return "details_failed";

  const detailsVerdict = detailsFilter(job, details, context.settings.maxApplicants);
  const outcome: JobOutcome = detailsVerdict.hasPassed
    ? { status: JobStatus.toScreen, details }
    : { status: JobStatus.detailsRejected, rejectReason: detailsVerdict.rejectReason, details };
  return saveJob(job, outcome, context);
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

async function saveJob(job: ListedJob, outcome: JobOutcome, { jobs, now }: DiscoverJobsContext): Promise<JobStatus> {
  await jobs.insertOne({ _id: buildJobId(job), ...job, ...outcome, seenAt: now });
  return outcome.status;
}
