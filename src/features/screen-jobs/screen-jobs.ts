import { setTimeout as delay } from "node:timers/promises";
import type { Collection } from "mongodb";
import type { ClaudeState } from "#shared/db.ts";
import { type Assessment, type DraftFailure, type Job, JobStatus } from "#shared/job.ts";
import { logger } from "#shared/logger.ts";
import type { Telegram } from "#shared/telegram.ts";
import { buildDraftPrompt } from "./build-draft-prompt.ts";
import { buildScreeningPrompt } from "./build-screening-prompt.ts";
import { CLAUDE_BACK_MESSAGE, formatClaudeFailing, formatPing } from "./format-ping.ts";
import type { LanguageModel, ModelFailure } from "./language-model.ts";
import { type Knowledge, loadKnowledge } from "./load-knowledge.ts";
import { ASSESSMENT_SCHEMA, parseAssessment, type ScreeningVerdict } from "./parse-assessment.ts";
import { DRAFT_SCHEMA, parseDraft } from "./parse-draft.ts";

export type ScreenJobsContext = {
  jobs: Collection<Job>;
  state: Collection<ClaudeState>;
  languageModel: LanguageModel;
  telegram: Telegram;
  now: Date;
  pingGapMs?: number;
};

type ClaudeAvailability = "up" | "down";

type JobAnswer = { isValid: true; verdict: ScreeningVerdict } | { isValid: false; failure: ModelFailure };

type DraftAnswer = { isValid: true; draft: string } | { isValid: false; failure: ModelFailure };

const PING_GAP_MS = 1_000;
const MAX_SCREENING_ATTEMPTS = 3;
const CLAUDE_STATE_ID = "claude";
const NO_ASSESSMENT: Assessment = { fitReasons: [], concerns: [] };

export async function screenJobs(context: ScreenJobsContext): Promise<void> {
  try {
    const claudeAvailability = await screenWaitingJobs(context);
    await draftFitJobs(claudeAvailability, context);
  } finally {
    await pingFitJobs(context);
  }
}

async function screenWaitingJobs(context: ScreenJobsContext): Promise<ClaudeAvailability> {
  if (!(await checkIsClaudeReady(context))) return "down";

  const jobsToScreen = await context.jobs.find({ status: JobStatus.toScreen }).sort({ postedAt: 1 }).toArray();
  if (jobsToScreen.length === 0) return "up";

  const knowledge = await loadKnowledge();
  for (const job of jobsToScreen) {
    if ((await screenJob(job, knowledge, context)) === "down") return "down";
  }
  return "up";
}

async function checkIsClaudeReady(context: ScreenJobsContext): Promise<boolean> {
  const claudeState = await context.state.findOne({ _id: CLAUDE_STATE_ID });
  if (claudeState?.isFailing !== true) return true;

  const health = await context.languageModel.checkHealth();
  if (!health.isHealthy) {
    logger.warn({ eventType: "screen.claude_still_down", failure: health.failure }, "Claude still down, skip screening");
    return false;
  }

  logger.info({ eventType: "screen.claude_back" }, "Claude back, resume screening");
  await saveClaudeState(false, context);
  await sendServiceMessage(CLAUDE_BACK_MESSAGE, context.telegram);
  return true;
}

async function screenJob(job: Job, knowledge: Knowledge, context: ScreenJobsContext): Promise<ClaudeAvailability> {
  const prompt = buildScreeningPrompt(job, knowledge);
  const answer = await askAboutJob(prompt, context.languageModel);
  if (answer.isValid) {
    await saveVerdict(job, answer.verdict, context.jobs);
    return "up";
  }

  logger.warn(
    { eventType: "screen.screening_failed", jobId: job._id, failure: answer.failure, prompt },
    "screening call failed, running health check",
  );
  return handleScreeningFailure(job, context);
}

async function askAboutJob(prompt: string, languageModel: LanguageModel): Promise<JobAnswer> {
  const reply = await languageModel.ask(prompt, ASSESSMENT_SCHEMA);
  if (!reply.isOk) return { isValid: false, failure: reply.failure };

  const parsed = parseAssessment(reply.answer);
  if (!parsed.isValid) {
    return { isValid: false, failure: { message: parsed.problem, rawOutput: JSON.stringify(reply.answer) } };
  }
  return { isValid: true, verdict: parsed.verdict };
}

async function saveVerdict(job: Job, verdict: ScreeningVerdict, jobs: Collection<Job>): Promise<void> {
  const update = verdict.isFit
    ? { status: JobStatus.toDraft, assessment: verdict.assessment }
    : { status: JobStatus.screeningRejected, rejectReason: verdict.rejectReason };
  await jobs.updateOne({ _id: job._id }, { $set: update });
  logger.info(
    { eventType: "screen.job_screened", jobId: job._id, title: job.title, ...update },
    verdict.isFit ? "Claude: fit" : "Claude: not a fit",
  );
}

async function handleScreeningFailure(job: Job, context: ScreenJobsContext): Promise<ClaudeAvailability> {
  const health = await context.languageModel.checkHealth();
  if (!health.isHealthy) {
    logger.error({ eventType: "screen.claude_down", failure: health.failure }, "Claude down, stop screening");
    await saveClaudeState(true, context);
    await sendServiceMessage(formatClaudeFailing(health.failure.message), context.telegram);
    return "down";
  }

  const screeningAttempts = (job.screeningAttempts ?? 0) + 1;
  const status = screeningAttempts >= MAX_SCREENING_ATTEMPTS ? JobStatus.screeningFailed : JobStatus.toScreen;
  await context.jobs.updateOne({ _id: job._id }, { $set: { screeningAttempts, status } });
  return "up";
}

async function draftFitJobs(claudeAvailability: ClaudeAvailability, context: ScreenJobsContext): Promise<void> {
  const jobsToDraft = await context.jobs.find({ status: JobStatus.toDraft }).sort({ postedAt: 1 }).toArray();
  if (jobsToDraft.length === 0) return;
  if (claudeAvailability === "down") {
    await skipDrafts(jobsToDraft, context.jobs);
    return;
  }

  const knowledge = await loadKnowledge();
  for (const [index, job] of jobsToDraft.entries()) {
    if ((await draftJob(job, knowledge, context)) === "down") {
      await skipDrafts(jobsToDraft.slice(index), context.jobs);
      return;
    }
  }
}

async function draftJob(job: Job, knowledge: Knowledge, context: ScreenJobsContext): Promise<ClaudeAvailability> {
  const prompt = buildDraftPrompt(job, job.assessment ?? NO_ASSESSMENT, knowledge);
  const answer = await askForDraft(prompt, context.languageModel);
  if (answer.isValid) {
    await context.jobs.updateOne({ _id: job._id }, { $set: { status: JobStatus.toPing, draft: answer.draft } });
    logger.info({ eventType: "screen.job_drafted", jobId: job._id, title: job.title }, "draft written");
    return "up";
  }

  logger.warn(
    { eventType: "screen.drafting_failed", jobId: job._id, failure: answer.failure, prompt },
    "drafting call failed, running health check",
  );
  return handleDraftingFailure(job, context);
}

async function askForDraft(prompt: string, languageModel: LanguageModel): Promise<DraftAnswer> {
  const reply = await languageModel.ask(prompt, DRAFT_SCHEMA);
  if (!reply.isOk) return { isValid: false, failure: reply.failure };

  const parsed = parseDraft(reply.answer);
  if (!parsed.isValid) {
    return { isValid: false, failure: { message: parsed.problem, rawOutput: JSON.stringify(reply.answer) } };
  }
  return { isValid: true, draft: parsed.draft };
}

async function handleDraftingFailure(job: Job, context: ScreenJobsContext): Promise<ClaudeAvailability> {
  const health = await context.languageModel.checkHealth();
  if (!health.isHealthy) {
    logger.error({ eventType: "screen.claude_down", failure: health.failure }, "Claude down, stop drafting");
    await saveClaudeState(true, context);
    await sendServiceMessage(formatClaudeFailing(health.failure.message), context.telegram);
    return "down";
  }

  await saveDraftFailure([job._id], "call_failed", context.jobs);
  return "up";
}

async function skipDrafts(jobsToSkip: Job[], jobs: Collection<Job>): Promise<void> {
  const jobIds = jobsToSkip.map((job) => job._id);
  await saveDraftFailure(jobIds, "claude_down", jobs);
  logger.warn({ eventType: "screen.drafting_skipped", jobIds }, "Claude down, ping without drafts");
}

async function saveDraftFailure(jobIds: string[], draftFailure: DraftFailure, jobs: Collection<Job>): Promise<void> {
  await jobs.updateMany({ _id: { $in: jobIds } }, { $set: { status: JobStatus.toPing, draftFailure } });
}

async function saveClaudeState(isFailing: boolean, { state, now }: ScreenJobsContext): Promise<void> {
  await state.updateOne({ _id: CLAUDE_STATE_ID }, { $set: { isFailing, since: now } }, { upsert: true });
}

async function sendServiceMessage(html: string, telegram: Telegram): Promise<void> {
  try {
    await telegram.send(html);
  } catch (error) {
    logger.warn({ eventType: "screen.service_message_failed", html, err: error }, "service message failed");
  }
}

async function pingFitJobs(context: ScreenJobsContext): Promise<void> {
  const jobsToPing = await context.jobs.find({ status: JobStatus.toPing }).sort({ postedAt: 1 }).toArray();
  for (const [index, job] of jobsToPing.entries()) {
    if (index > 0) await delay(context.pingGapMs ?? PING_GAP_MS);
    await pingJob(job, context);
  }
}

async function pingJob(job: Job, { jobs, telegram, now }: ScreenJobsContext): Promise<void> {
  try {
    await telegram.send(formatPing(job, now));
  } catch (error) {
    logger.warn({ eventType: "screen.ping_failed", jobId: job._id, err: error }, "ping failed, job stays to_ping");
    return;
  }
  await jobs.updateOne({ _id: job._id }, { $set: { status: JobStatus.pinged } });
  logger.info({ eventType: "screen.job_pinged", jobId: job._id, title: job.title }, "job pinged");
}
