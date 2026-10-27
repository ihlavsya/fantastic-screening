import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT_ROOT } from "#shared/config.ts";
import { connectToDatabase, type Database } from "#shared/db.ts";
import { type Job, JobStatus } from "#shared/job.ts";
import { logger } from "#shared/logger.ts";
import type { Telegram } from "#shared/telegram.ts";
import { screenJobs } from "./screen-jobs.ts";

const TEST_DB_NAME = "job-hunt-test-screen-jobs";
const NOW = new Date("2026-10-27T12:00:00Z");

let database: Database;

beforeAll(async () => {
  database = await connectToDatabase(buildTestMongoUri());
});

beforeEach(async () => {
  await database.jobs.deleteMany({});
  vi.restoreAllMocks();
});

afterAll(async () => {
  await database.close();
});

describe("screenJobs", () => {
  it("pings every possible job, oldest first, and marks it pinged", async () => {
    await database.jobs.insertMany([
      buildJob("1", { postedAt: new Date("2026-10-27T10:00:00Z") }),
      buildJob("2", { postedAt: new Date("2026-10-27T08:00:00Z") }),
    ]);
    const telegram = fakeTelegram();
    await runWith(telegram);
    expect(vi.mocked(telegram.send).mock.calls.map(([html]) => html.split("\n")[0])).toEqual([
      "🆕 Job 2 — Acme",
      "🆕 Job 1 — Acme",
    ]);
    expect(await readStatuses()).toEqual({ "djinni:1": JobStatus.pinged, "djinni:2": JobStatus.pinged });
  });

  it("leaves jobs in other statuses alone", async () => {
    await database.jobs.insertMany([
      buildJob("1", { status: JobStatus.pinged }),
      buildJob("2", { status: JobStatus.prefilterRejected }),
      buildJob("3", { status: JobStatus.tooManyApplicants }),
    ]);
    const telegram = fakeTelegram();
    await runWith(telegram);
    expect(telegram.send).not.toHaveBeenCalled();
  });

  it("keeps a job possible and logs when its ping fails, then pings the rest", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    await database.jobs.insertMany([
      buildJob("1", { postedAt: new Date("2026-10-27T08:00:00Z") }),
      buildJob("2", { postedAt: new Date("2026-10-27T10:00:00Z") }),
    ]);
    const telegram = fakeTelegram();
    vi.mocked(telegram.send).mockRejectedValueOnce(new Error("Telegram sendMessage failed: 400"));
    await runWith(telegram);
    expect(await readStatuses()).toEqual({ "djinni:1": JobStatus.possible, "djinni:2": JobStatus.pinged });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "screen.ping_failed", jobId: "djinni:1" }),
      expect.any(String),
    );
  });

  it("waits between pings", async () => {
    await database.jobs.insertMany([buildJob("1"), buildJob("2")]);
    const startedAt = performance.now();
    await runWith(fakeTelegram(), 50);
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(50);
  });
});

function runWith(telegram: Telegram, pingGapMs = 0): Promise<void> {
  return screenJobs({ jobs: database.jobs, telegram, now: NOW, pingGapMs });
}

function fakeTelegram(): Telegram {
  return { send: vi.fn(() => Promise.resolve()) };
}

async function readStatuses(): Promise<Record<string, string>> {
  const savedJobs = await database.jobs.find().toArray();
  return Object.fromEntries(savedJobs.map((savedJob) => [savedJob._id, savedJob.status]));
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
    status: JobStatus.possible,
    seenAt: NOW,
    ...overrides,
  };
}

function buildTestMongoUri(): string {
  process.loadEnvFile(resolve(PROJECT_ROOT, "config/.env"));
  const uri = new URL(process.env.MONGO_URI ?? "");
  uri.pathname = `/${TEST_DB_NAME}`;
  return uri.toString();
}
