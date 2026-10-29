import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT_ROOT } from "#shared/config.ts";
import { connectToDatabase, type Database } from "#shared/db.ts";
import { type Job, JobStatus } from "#shared/job.ts";
import { logger } from "#shared/logger.ts";
import type { Telegram } from "#shared/telegram.ts";
import type { LanguageModel, ModelHealth, ModelReply } from "./language-model.ts";
import { screenJobs } from "./screen-jobs.ts";

const TEST_DB_NAME = "job-hunt-test-screen-jobs";
const NOW = new Date("2026-10-27T12:00:00Z");
const FAILURE = { message: "API Error: 529 overloaded", rawOutput: "{}" };
const FIT_REPLY: ModelReply = {
  isOk: true,
  answer: { isFit: true, fitReasons: ["React + Node"], concerns: ["asks 4 yrs, you have 3.5"] },
};
const REJECT_REPLY: ModelReply = { isOk: true, answer: { isFit: false, rejectReason: "office-only in Dnipro" } };
const FAILED_REPLY: ModelReply = { isOk: false, failure: FAILURE };
const DRAFT_REPLY: ModelReply = { isOk: true, answer: { draft: "I'm a full-stack developer." } };
const ASSESSMENT = { fitReasons: ["React + Node"], concerns: ["asks 4 yrs, you have 3.5"] };
const HEALTHY: ModelHealth = { isHealthy: true };
const UNHEALTHY: ModelHealth = { isHealthy: false, failure: FAILURE };

let database: Database;

beforeAll(async () => {
  database = await connectToDatabase(buildTestMongoUri());
});

beforeEach(async () => {
  await database.jobs.deleteMany({});
  await database.state.deleteMany({});
  vi.restoreAllMocks();
  vi.spyOn(logger, "info").mockImplementation(() => undefined);
  vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  vi.spyOn(logger, "error").mockImplementation(() => undefined);
});

afterAll(async () => {
  await database.close();
});

describe("screenJobs", () => {
  describe("screening", () => {
    it("drafts a fit from its assessment, pings it and marks it pinged", async () => {
      await database.jobs.insertOne(buildJob("1"));
      const languageModel = fakeLanguageModel([FIT_REPLY, DRAFT_REPLY]);
      const telegram = fakeTelegram();
      await runWith({ telegram, languageModel });
      const [savedJob] = await database.jobs.find().toArray();
      expect(savedJob).toMatchObject({
        status: JobStatus.pinged,
        assessment: ASSESSMENT,
        draft: "I'm a full-stack developer.",
      });
      expect(vi.mocked(languageModel.ask).mock.calls[1]?.[0]).toContain("- asks 4 yrs, you have 3.5");
      expect(readSentMessages(telegram)[0]).toContain("✅ fit: React + Node");
    });

    it("saves a reject with Claude's reason and never pings it", async () => {
      await database.jobs.insertOne(buildJob("1"));
      const telegram = fakeTelegram();
      await runWith({ telegram, languageModel: fakeLanguageModel([REJECT_REPLY]) });
      const [savedJob] = await database.jobs.find().toArray();
      expect(savedJob).toMatchObject({ status: JobStatus.screeningRejected, rejectReason: "office-only in Dnipro" });
      expect(telegram.send).not.toHaveBeenCalled();
    });

    it("logs each verdict, draft and ping", async () => {
      await database.jobs.insertMany([buildJob("1"), buildJob("2")]);
      await runWith({ languageModel: fakeLanguageModel([REJECT_REPLY, FIT_REPLY, DRAFT_REPLY]) });
      const events = vi.mocked(logger.info).mock.calls.map(([event]) => event);
      expect(events).toEqual([
        expect.objectContaining({
          eventType: "screen.job_screened",
          status: JobStatus.screeningRejected,
          rejectReason: "office-only in Dnipro",
        }),
        expect.objectContaining({ eventType: "screen.job_screened", status: JobStatus.toDraft }),
        expect.objectContaining({ eventType: "screen.job_drafted" }),
        expect.objectContaining({ eventType: "screen.job_pinged" }),
      ]);
    });

    it("screens jobs oldest first", async () => {
      await database.jobs.insertMany([
        buildJob("1", { postedAt: new Date("2026-10-27T10:00:00Z") }),
        buildJob("2", { postedAt: new Date("2026-10-27T08:00:00Z") }),
      ]);
      const languageModel = fakeLanguageModel([FIT_REPLY, REJECT_REPLY, DRAFT_REPLY]);
      await runWith({ languageModel });
      expect(await readStatuses()).toEqual({ "djinni:1": JobStatus.screeningRejected, "djinni:2": JobStatus.pinged });
      expect(vi.mocked(languageModel.ask).mock.calls[0]?.[0]).toContain("Title: Job 2");
    });

    it("leaves jobs in other statuses alone", async () => {
      await database.jobs.insertMany([
        buildJob("1", { status: JobStatus.pinged }),
        buildJob("2", { status: JobStatus.prefilterRejected }),
        buildJob("3", { status: JobStatus.screeningFailed }),
      ]);
      const languageModel = fakeLanguageModel([]);
      const telegram = fakeTelegram();
      await runWith({ telegram, languageModel });
      expect(languageModel.ask).not.toHaveBeenCalled();
      expect(telegram.send).not.toHaveBeenCalled();
    });
  });

  describe("failure blamed on the job", () => {
    it("counts a try and keeps the job to_screen when the health check passes", async () => {
      await database.jobs.insertOne(buildJob("1"));
      await runWith({ languageModel: fakeLanguageModel([FAILED_REPLY], [HEALTHY]) });
      const [savedJob] = await database.jobs.find().toArray();
      expect(savedJob).toMatchObject({ status: JobStatus.toScreen, screeningAttempts: 1 });
    });

    it("treats an invalid answer as a failure", async () => {
      await database.jobs.insertOne(buildJob("1"));
      const badAnswer: ModelReply = { isOk: true, answer: { isFit: false } };
      await runWith({ languageModel: fakeLanguageModel([badAnswer], [HEALTHY]) });
      const [savedJob] = await database.jobs.find().toArray();
      expect(savedJob).toMatchObject({ status: JobStatus.toScreen, screeningAttempts: 1 });
    });

    it("marks the job screening_failed on the 3rd failure", async () => {
      await database.jobs.insertOne(buildJob("1", { screeningAttempts: 2 }));
      await runWith({ languageModel: fakeLanguageModel([FAILED_REPLY], [HEALTHY]) });
      const [savedJob] = await database.jobs.find().toArray();
      expect(savedJob).toMatchObject({ status: JobStatus.screeningFailed, screeningAttempts: 3 });
    });

    it("logs the failure with the job id and the prompt", async () => {
      await database.jobs.insertOne(buildJob("1"));
      await runWith({ languageModel: fakeLanguageModel([FAILED_REPLY], [HEALTHY]) });
      const event = vi.mocked(logger.warn).mock.calls[0]?.[0];
      expect(event).toMatchObject({ eventType: "screen.screening_failed", jobId: "djinni:1", failure: FAILURE });
      expect(event?.prompt).toContain("Title: Job 1");
    });

    it("goes on to the next job", async () => {
      await database.jobs.insertMany([
        buildJob("1", { postedAt: new Date("2026-10-27T08:00:00Z") }),
        buildJob("2", { postedAt: new Date("2026-10-27T10:00:00Z") }),
      ]);
      await runWith({ languageModel: fakeLanguageModel([FAILED_REPLY, REJECT_REPLY], [HEALTHY]) });
      expect(await readStatuses()).toEqual({ "djinni:1": JobStatus.toScreen, "djinni:2": JobStatus.screeningRejected });
    });
  });

  describe("failure blamed on Claude", () => {
    it("stops screening, counts no try, turns the flag on and sends one warning", async () => {
      await database.jobs.insertMany([
        buildJob("1", { postedAt: new Date("2026-10-27T08:00:00Z") }),
        buildJob("2", { postedAt: new Date("2026-10-27T10:00:00Z") }),
      ]);
      const languageModel = fakeLanguageModel([FAILED_REPLY], [UNHEALTHY]);
      const telegram = fakeTelegram();
      await runWith({ telegram, languageModel });
      expect(languageModel.ask).toHaveBeenCalledTimes(1);
      const savedJobs = await database.jobs.find().toArray();
      expect(savedJobs.map(({ status, screeningAttempts }) => ({ status, screeningAttempts }))).toEqual([
        { status: JobStatus.toScreen, screeningAttempts: undefined },
        { status: JobStatus.toScreen, screeningAttempts: undefined },
      ]);
      expect(await readClaudeState()).toEqual({ _id: "claude", isFailing: true, since: NOW });
      expect(readSentMessages(telegram)).toEqual(["⚠️ Claude failing: API Error: 529 overloaded"]);
    });

    it("still pings jobs already waiting to be pinged", async () => {
      await database.jobs.insertMany([buildJob("1"), buildJob("2", { status: JobStatus.toPing })]);
      await runWith({ languageModel: fakeLanguageModel([FAILED_REPLY], [UNHEALTHY]) });
      expect(await readStatuses()).toEqual({ "djinni:1": JobStatus.toScreen, "djinni:2": JobStatus.pinged });
    });
  });

  describe("failing flag on", () => {
    it("starts with the health check and stops quietly when it fails", async () => {
      await database.state.insertOne({ _id: "claude", isFailing: true, since: NOW });
      await database.jobs.insertOne(buildJob("1"));
      const languageModel = fakeLanguageModel([], [UNHEALTHY]);
      const telegram = fakeTelegram();
      await runWith({ telegram, languageModel });
      expect(languageModel.ask).not.toHaveBeenCalled();
      expect(telegram.send).not.toHaveBeenCalled();
      expect(await readClaudeState()).toMatchObject({ isFailing: true });
    });

    it("turns the flag off, sends Claude back and screens when the health check passes", async () => {
      await database.state.insertOne({ _id: "claude", isFailing: true, since: new Date("2026-10-27T09:00:00Z") });
      await database.jobs.insertOne(buildJob("1"));
      const telegram = fakeTelegram();
      await runWith({ telegram, languageModel: fakeLanguageModel([REJECT_REPLY], [HEALTHY]) });
      expect(await readClaudeState()).toEqual({ _id: "claude", isFailing: false, since: NOW });
      expect(readSentMessages(telegram)).toEqual(["✅ Claude back"]);
      expect(await readStatuses()).toEqual({ "djinni:1": JobStatus.screeningRejected });
    });

    it("runs the health check even with no job to screen", async () => {
      await database.state.insertOne({ _id: "claude", isFailing: true, since: NOW });
      const languageModel = fakeLanguageModel([], [HEALTHY]);
      const telegram = fakeTelegram();
      await runWith({ telegram, languageModel });
      expect(languageModel.checkHealth).toHaveBeenCalledTimes(1);
      expect(readSentMessages(telegram)).toEqual(["✅ Claude back"]);
    });

    it("skips the health check when the flag is off and nothing fails", async () => {
      await database.jobs.insertOne(buildJob("1"));
      const languageModel = fakeLanguageModel([REJECT_REPLY]);
      await runWith({ languageModel });
      expect(languageModel.checkHealth).not.toHaveBeenCalled();
    });
  });

  describe("drafting", () => {
    it("drafts a to_draft job from its assessment and pings it with the draft", async () => {
      await database.jobs.insertOne(buildDraftJob("1"));
      const languageModel = fakeLanguageModel([DRAFT_REPLY]);
      const telegram = fakeTelegram();
      await runWith({ telegram, languageModel });
      const [savedJob] = await database.jobs.find().toArray();
      expect(savedJob).toMatchObject({ status: JobStatus.pinged, draft: "I'm a full-stack developer." });
      expect(vi.mocked(languageModel.ask).mock.calls[0]?.[0]).toContain("- asks 4 yrs, you have 3.5");
      expect(readSentMessages(telegram)[0]).toContain("<pre>I'm a full-stack developer.</pre>");
    });

    it("logs each draft", async () => {
      await database.jobs.insertOne(buildDraftJob("1"));
      await runWith({ languageModel: fakeLanguageModel([DRAFT_REPLY]) });
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "screen.job_drafted", jobId: "djinni:1" }),
        expect.any(String),
      );
    });

    it("drafts after screening, in the same pass", async () => {
      await database.jobs.insertMany([buildJob("1"), buildDraftJob("2")]);
      const languageModel = fakeLanguageModel([REJECT_REPLY, DRAFT_REPLY]);
      await runWith({ languageModel });
      expect(languageModel.ask).toHaveBeenCalledTimes(2);
      expect(await readStatuses()).toEqual({ "djinni:1": JobStatus.screeningRejected, "djinni:2": JobStatus.pinged });
    });
  });

  describe("drafting failure blamed on the job", () => {
    it("pings the job without a draft, never retried", async () => {
      await database.jobs.insertOne(buildDraftJob("1"));
      const languageModel = fakeLanguageModel([FAILED_REPLY], [HEALTHY]);
      const telegram = fakeTelegram();
      await runWith({ telegram, languageModel });
      expect(languageModel.ask).toHaveBeenCalledTimes(1);
      const [savedJob] = await database.jobs.find().toArray();
      expect(savedJob).toMatchObject({ status: JobStatus.pinged, draftFailure: "call_failed" });
      expect(savedJob?.draft).toBeUndefined();
      expect(readSentMessages(telegram)[0]).toContain("✍️ no draft: call failed");
    });

    it("treats an empty draft as a failure", async () => {
      await database.jobs.insertOne(buildDraftJob("1"));
      const emptyDraft: ModelReply = { isOk: true, answer: { draft: "  " } };
      await runWith({ languageModel: fakeLanguageModel([emptyDraft], [HEALTHY]) });
      const [savedJob] = await database.jobs.find().toArray();
      expect(savedJob).toMatchObject({ status: JobStatus.pinged, draftFailure: "call_failed" });
    });

    it("logs the failure with the job id and the prompt", async () => {
      await database.jobs.insertOne(buildDraftJob("1"));
      await runWith({ languageModel: fakeLanguageModel([FAILED_REPLY], [HEALTHY]) });
      const event = vi.mocked(logger.warn).mock.calls[0]?.[0];
      expect(event).toMatchObject({ eventType: "screen.drafting_failed", jobId: "djinni:1", failure: FAILURE });
      expect(event?.prompt).toContain("Title: Job 1");
    });

    it("goes on to the next job", async () => {
      await database.jobs.insertMany([
        buildDraftJob("1", { postedAt: new Date("2026-10-27T08:00:00Z") }),
        buildDraftJob("2", { postedAt: new Date("2026-10-27T10:00:00Z") }),
      ]);
      await runWith({ languageModel: fakeLanguageModel([FAILED_REPLY, DRAFT_REPLY], [HEALTHY]) });
      const savedJobs = await database.jobs.find().sort({ postedAt: 1 }).toArray();
      expect(savedJobs.map(({ draft, draftFailure }) => ({ draft, draftFailure }))).toEqual([
        { draft: undefined, draftFailure: "call_failed" },
        { draft: "I'm a full-stack developer.", draftFailure: undefined },
      ]);
    });
  });

  describe("drafting failure blamed on Claude", () => {
    it("turns the flag on, sends one warning and pings this and every other to_draft job without a draft", async () => {
      await database.jobs.insertMany([
        buildDraftJob("1", { postedAt: new Date("2026-10-27T08:00:00Z") }),
        buildDraftJob("2", { postedAt: new Date("2026-10-27T10:00:00Z") }),
      ]);
      const languageModel = fakeLanguageModel([FAILED_REPLY], [UNHEALTHY]);
      const telegram = fakeTelegram();
      await runWith({ telegram, languageModel });
      expect(languageModel.ask).toHaveBeenCalledTimes(1);
      const savedJobs = await database.jobs.find().toArray();
      expect(savedJobs.map(({ status, draftFailure }) => ({ status, draftFailure }))).toEqual([
        { status: JobStatus.pinged, draftFailure: "claude_down" },
        { status: JobStatus.pinged, draftFailure: "claude_down" },
      ]);
      expect(await readClaudeState()).toMatchObject({ isFailing: true });
      const sentMessages = readSentMessages(telegram);
      expect(sentMessages[0]).toBe("⚠️ Claude failing: API Error: 529 overloaded");
      expect(sentMessages.slice(1).every((html) => html.endsWith("✍️ no draft: Claude down"))).toBe(true);
    });

    it("makes no draft call when screening found Claude down in the same pass", async () => {
      await database.jobs.insertMany([buildJob("1"), buildDraftJob("2")]);
      const languageModel = fakeLanguageModel([FAILED_REPLY], [UNHEALTHY]);
      await runWith({ languageModel });
      expect(languageModel.ask).toHaveBeenCalledTimes(1);
      expect(languageModel.checkHealth).toHaveBeenCalledTimes(1);
      const draftedJob = await database.jobs.findOne({ _id: "djinni:2" });
      expect(draftedJob).toMatchObject({ status: JobStatus.pinged, draftFailure: "claude_down" });
    });

    it("makes no draft call when the flag is on and the health check fails", async () => {
      await database.state.insertOne({ _id: "claude", isFailing: true, since: NOW });
      await database.jobs.insertOne(buildDraftJob("1"));
      const languageModel = fakeLanguageModel([], [UNHEALTHY]);
      await runWith({ languageModel });
      expect(languageModel.ask).not.toHaveBeenCalled();
      const [savedJob] = await database.jobs.find().toArray();
      expect(savedJob).toMatchObject({ status: JobStatus.pinged, draftFailure: "claude_down" });
    });
  });

  describe("pinging", () => {
    it("pings every to_ping job, oldest first, and marks it pinged", async () => {
      await database.jobs.insertMany([
        buildJob("1", { status: JobStatus.toPing, postedAt: new Date("2026-10-27T10:00:00Z") }),
        buildJob("2", { status: JobStatus.toPing, postedAt: new Date("2026-10-27T08:00:00Z") }),
      ]);
      const telegram = fakeTelegram();
      await runWith({ telegram });
      expect(readSentMessages(telegram).map((html) => html.split("\n")[0])).toEqual([
        "🆕 Job 2 — Acme",
        "🆕 Job 1 — Acme",
      ]);
      expect(await readStatuses()).toEqual({ "djinni:1": JobStatus.pinged, "djinni:2": JobStatus.pinged });
    });

    it("keeps a job to_ping and logs when its ping fails, then pings the rest", async () => {
      await database.jobs.insertMany([
        buildJob("1", { status: JobStatus.toPing, postedAt: new Date("2026-10-27T08:00:00Z") }),
        buildJob("2", { status: JobStatus.toPing, postedAt: new Date("2026-10-27T10:00:00Z") }),
      ]);
      const telegram = fakeTelegram();
      vi.mocked(telegram.send).mockRejectedValueOnce(new Error("Telegram sendMessage failed: 400"));
      await runWith({ telegram });
      expect(await readStatuses()).toEqual({ "djinni:1": JobStatus.toPing, "djinni:2": JobStatus.pinged });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "screen.ping_failed", jobId: "djinni:1" }),
        expect.any(String),
      );
    });

    it("waits between pings", async () => {
      await database.jobs.insertMany([
        buildJob("1", { status: JobStatus.toPing }),
        buildJob("2", { status: JobStatus.toPing }),
      ]);
      const startedAt = performance.now();
      await runWith({ pingGapMs: 50 });
      expect(performance.now() - startedAt).toBeGreaterThanOrEqual(50);
    });
  });
});

type RunOverrides = {
  telegram?: Telegram;
  languageModel?: LanguageModel;
  pingGapMs?: number;
};

function runWith({ telegram, languageModel, pingGapMs }: RunOverrides): Promise<void> {
  return screenJobs({
    jobs: database.jobs,
    state: database.state,
    languageModel: languageModel ?? fakeLanguageModel([]),
    telegram: telegram ?? fakeTelegram(),
    now: NOW,
    pingGapMs: pingGapMs ?? 0,
  });
}

function fakeLanguageModel(replies: ModelReply[], healthChecks: ModelHealth[] = []): LanguageModel {
  const ask = vi.fn<LanguageModel["ask"]>();
  for (const reply of replies) ask.mockResolvedValueOnce(reply);
  const checkHealth = vi.fn<LanguageModel["checkHealth"]>();
  for (const health of healthChecks) checkHealth.mockResolvedValueOnce(health);
  return { ask, checkHealth };
}

function fakeTelegram(): Telegram {
  return { send: vi.fn(() => Promise.resolve()) };
}

function readSentMessages(telegram: Telegram): string[] {
  return vi.mocked(telegram.send).mock.calls.map(([html]) => html);
}

async function readStatuses(): Promise<Record<string, string>> {
  const savedJobs = await database.jobs.find().toArray();
  return Object.fromEntries(savedJobs.map((savedJob) => [savedJob._id, savedJob.status]));
}

function readClaudeState(): Promise<unknown> {
  return database.state.findOne({ _id: "claude" });
}

function buildJob(sourceJobId: string, overrides: Partial<Job> = {}): Job {
  return {
    _id: `djinni:${sourceJobId}`,
    source: "djinni",
    sourceJobId,
    title: `Job ${sourceJobId}`,
    link: `https://djinni.co/jobs/${sourceJobId}-job/`,
    description: "",
    category: "React.js",
    postedAt: new Date("2026-10-27T10:00:00Z"),
    isEuRemote: false,
    details: { company: "Acme", applicants: 3 },
    status: JobStatus.toScreen,
    seenAt: NOW,
    ...overrides,
  };
}

function buildDraftJob(sourceJobId: string, overrides: Partial<Job> = {}): Job {
  return buildJob(sourceJobId, { status: JobStatus.toDraft, assessment: ASSESSMENT, ...overrides });
}

function buildTestMongoUri(): string {
  process.loadEnvFile(resolve(PROJECT_ROOT, "config/.env"));
  const uri = new URL(process.env.MONGO_URI ?? "");
  uri.pathname = `/${TEST_DB_NAME}`;
  return uri.toString();
}
