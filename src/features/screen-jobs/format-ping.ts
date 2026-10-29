import type { DraftFailure, Job, JobDetails, Salary, WorkFormat } from "#shared/job.ts";

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const WORK_FORMAT_LABELS = new Map<WorkFormat, string>([
  ["remote", "Remote"],
  ["hybrid", "Hybrid"],
  ["office", "Office"],
]);
const HTML_ESCAPES = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
]);
const DRAFT_FAILURE_LABELS: Record<DraftFailure, string> = {
  claude_down: "Claude down",
  call_failed: "call failed",
};
const MAX_FAILURE_CHARS = 500;

export const CLAUDE_BACK_MESSAGE = "✅ Claude back";

export function formatClaudeFailing(failureMessage: string): string {
  const shortMessage =
    failureMessage.length > MAX_FAILURE_CHARS ? `${failureMessage.slice(0, MAX_FAILURE_CHARS)}…` : failureMessage;
  return `⚠️ Claude failing: ${escapeHtml(shortMessage)}`;
}

export function formatPing(job: Job, now: Date): string {
  const summary = [
    formatHeadline(job),
    formatTerms(job.details),
    formatTiming(job, now),
    formatPoints("✅ fit", job.assessment?.fitReasons),
    formatPoints("⚠️ concerns", job.assessment?.concerns),
    `🔗 ${escapeHtml(job.link)}`,
    formatDraftFailure(job.draftFailure),
  ]
    .filter((line) => line !== undefined)
    .join("\n");
  return job.draft === undefined ? summary : `${summary}\n\n<pre>${escapeHtml(job.draft)}</pre>`;
}

function formatDraftFailure(draftFailure: DraftFailure | undefined): string | undefined {
  return draftFailure === undefined ? undefined : `✍️ no draft: ${DRAFT_FAILURE_LABELS[draftFailure]}`;
}

function formatHeadline({ title, isEuRemote, details }: Job): string {
  const marks = isEuRemote ? "🆕 🇪🇺" : "🆕";
  const name = details === undefined ? title : `${title} — ${details.company}`;
  return `${marks} ${escapeHtml(name)}`;
}

function formatTerms(details: JobDetails | undefined): string | undefined {
  const parts = [formatSalary(details?.salary), formatPlace(details), formatYears(details?.yearsRequired)].filter(
    (part) => part !== undefined,
  );
  return parts.length === 0 ? undefined : parts.join(" · ");
}

function formatSalary(salary: Salary | undefined): string | undefined {
  const min = salary?.min;
  const max = salary?.max;
  if (min !== undefined && max !== undefined) {
    return min === max ? `💰 $${String(min)}` : `💰 $${String(min)}–${String(max)}`;
  }
  if (min !== undefined) return `💰 from $${String(min)}`;
  if (max !== undefined) return `💰 up to $${String(max)}`;
  return undefined;
}

function formatPlace(details: JobDetails | undefined): string | undefined {
  const workFormat = details?.workFormat === undefined ? undefined : formatWorkFormat(details.workFormat);
  const parts = [workFormat, details?.city].filter((part) => part !== undefined);
  return parts.length === 0 ? undefined : `📍 ${escapeHtml(parts.join(", "))}`;
}

function formatWorkFormat(workFormat: WorkFormat): string {
  return WORK_FORMAT_LABELS.get(workFormat) ?? workFormat;
}

function formatYears(yearsRequired: number | undefined): string | undefined {
  return yearsRequired === undefined ? undefined : `🎯 ${String(yearsRequired)} yrs`;
}

function formatPoints(label: string, points: string[] | undefined): string | undefined {
  if (points === undefined || points.length === 0) return undefined;
  return `${label}: ${escapeHtml(points.join("; "))}`;
}

function formatTiming({ postedAt, details }: Job, now: Date): string {
  const applicants = details?.applicants === undefined ? undefined : `👥 ${String(details.applicants)} applicants`;
  return [`⏱ posted ${formatAge(postedAt, now)} ago`, applicants].filter((part) => part !== undefined).join(" · ");
}

function formatAge(postedAt: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - postedAt.getTime()) / MS_PER_MINUTE));
  if (minutes < MINUTES_PER_HOUR) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) return `${String(hours)}h`;
  return `${String(Math.floor(hours / HOURS_PER_DAY))}d`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (char) => HTML_ESCAPES.get(char) ?? char);
}
