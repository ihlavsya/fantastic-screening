import type { JobDetails, ListedJob } from "#shared/job.ts";

export type JobSource = {
  name: string;
  fetchRecentJobs: () => Promise<ListedJob[]>;
  fetchDetails: (job: ListedJob) => Promise<JobDetails>;
};
