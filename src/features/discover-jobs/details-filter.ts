import type { JobDetails, ListedJob, Salary } from "#shared/job.ts";

export type DetailsFilterVerdict = { hasPassed: true } | { hasPassed: false; rejectReason: string };

const JUNIOR_TITLE_PATTERN = /\b(Junior|Intern|Internship)\b/i;
const MIDDLE_TITLE_PATTERN = /\b(Middle|Mid)\b/i;
const JUNIOR_MIN_TOP_PAY = 1_000;

export function detailsFilter(
  { title }: Pick<ListedJob, "title">,
  { applicants, salary }: Pick<JobDetails, "applicants" | "salary">,
  maxApplicants: number,
): DetailsFilterVerdict {
  if (applicants !== undefined && applicants >= maxApplicants) {
    return { hasPassed: false, rejectReason: `${String(applicants)} applicants` };
  }

  const juniorTitleWord = JUNIOR_TITLE_PATTERN.exec(title)?.[0];
  if (juniorTitleWord === undefined || MIDDLE_TITLE_PATTERN.test(title)) return { hasPassed: true };

  const topPay = findTopPay(salary);
  if (topPay === undefined) return { hasPassed: false, rejectReason: `"${juniorTitleWord}" title, no salary` };
  if (topPay < JUNIOR_MIN_TOP_PAY) {
    return { hasPassed: false, rejectReason: `"${juniorTitleWord}" title, top pay $${String(topPay)} < $1k` };
  }

  return { hasPassed: true };
}

function findTopPay(salary: Salary | undefined): number | undefined {
  return salary?.max ?? salary?.min;
}
