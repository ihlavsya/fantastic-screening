export type Job = ListedJob & {
  _id: string;
  details?: JobDetails;
  status: JobStatus;
  rejectReason?: string;
  seenAt: Date;
};

export type ListedJob = {
  source: string;
  sourceJobId: string;
  title: string;
  link: string;
  description: string;
  category: string;
  postedAt: Date;
  isEuRemote: boolean;
};

export type JobDetails = {
  company: string;
  salary?: Salary;
  city?: string;
  workFormat?: WorkFormat;
  applicants?: number;
};

export type Salary = {
  min?: number;
  max?: number;
};

export type WorkFormat = "remote" | "hybrid" | "office" | (string & Record<never, never>);

export const JobStatus = {
  prefilterRejected: "prefilter_rejected",
  tooManyApplicants: "too_many_applicants",
  possible: "possible",
  rejected: "rejected",
  pinged: "pinged",
  applied: "applied",
  badFit: "bad_fit",
} as const;

export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export function buildJobId({ source, sourceJobId }: ListedJob): string {
  return `${source}:${sourceJobId}`;
}
