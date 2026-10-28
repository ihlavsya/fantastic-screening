export type Job = ListedJob & {
  _id: string;
  details?: JobDetails;
  status: JobStatus;
  rejectReason?: string;
  assessment?: Assessment;
  screeningAttempts?: number;
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
  yearsRequired?: number;
};

export type Salary = {
  min?: number;
  max?: number;
};

export type Assessment = {
  fitReasons: string[];
  concerns: string[];
};

export type WorkFormat = "remote" | "hybrid" | "office" | (string & Record<never, never>);

export const JobStatus = {
  prefilterRejected: "prefilter_rejected",
  detailsRejected: "details_rejected",
  toScreen: "to_screen",
  screeningRejected: "screening_rejected",
  screeningFailed: "screening_failed",
  toPing: "to_ping",
  pinged: "pinged",
  applied: "applied",
  badFit: "bad_fit",
} as const;

export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export function buildJobId({ source, sourceJobId }: ListedJob): string {
  return `${source}:${sourceJobId}`;
}
