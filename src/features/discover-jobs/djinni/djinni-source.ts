import type { JobDetails, ListedJob } from "#shared/job.ts";
import { logger } from "#shared/logger.ts";
import type { JobSource } from "../job-source.ts";
import type { DjinniGateway, FeedQuery } from "./djinni-gateway.ts";
import { translateFeed, translateJobDetails } from "./djinni-translation.ts";

const KEYWORDS = ["JavaScript", "React.js", "Node.js", "Fullstack"];
const FEED_QUERIES: FeedQuery[] = KEYWORDS.flatMap((keyword) => [
  { keyword, isEuRemote: false },
  { keyword, isEuRemote: true },
]);

export function createDjinniSource(gateway: DjinniGateway): JobSource {
  return {
    name: "djinni",
    fetchRecentJobs: () => fetchRecentJobs(gateway),
    fetchDetails: (job) => fetchDetails(gateway, job),
  };
}

async function fetchRecentJobs(gateway: DjinniGateway): Promise<ListedJob[]> {
  const feeds = await Promise.all(FEED_QUERIES.map((query) => fetchFeedJobs(gateway, query)));
  return mergeById(feeds.flat());
}

async function fetchFeedJobs(gateway: DjinniGateway, query: FeedQuery): Promise<ListedJob[]> {
  const feed = translateFeed(await gateway.fetchFeed(query));
  if (!feed.categories.includes(query.keyword)) {
    const feedKind = query.isEuRemote ? "EU-remote" : "general";
    logger.warn(
      { eventType: "djinni.keyword_unknown", keyword: query.keyword, feedKind },
      "djinni keyword unknown, skipping feed",
    );
    return [];
  }
  return feed.jobs.map((job) => ({ ...job, isEuRemote: query.isEuRemote }));
}

function mergeById(jobs: ListedJob[]): ListedJob[] {
  const merged = new Map<string, ListedJob>();
  for (const job of jobs) {
    const firstCopy = merged.get(job.sourceJobId);
    merged.set(
      job.sourceJobId,
      firstCopy === undefined ? job : { ...firstCopy, isEuRemote: firstCopy.isEuRemote || job.isEuRemote },
    );
  }
  return [...merged.values()];
}

async function fetchDetails(gateway: DjinniGateway, { sourceJobId }: ListedJob): Promise<JobDetails> {
  return translateJobDetails(await gateway.fetchJob(sourceJobId));
}
