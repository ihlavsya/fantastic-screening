import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT_ROOT } from "#shared/config.ts";
import { connectToDatabase, type Database } from "#shared/db.ts";
import { type JobDetails, JobStatus, type ListedJob } from "#shared/job.ts";
import { logger } from "#shared/logger.ts";
import { discoverJobs } from "./discover-jobs.ts";
import type { JobSource } from "./job-source.ts";

const TEST_DB_NAME = "job-hunt-test";
const NOW = new Date("2026-10-27T12:00:00Z");
const SETTINGS = { lookbackHours: 24, maxApplicants: 50 };
const DETAILS: JobDetails = { company: "Acme", workFormat: "remote", applicants: 12 };

let database: Database;

beforeAll(async () => {
  database = await connectToDatabase(buildTestMongoUri());
});

beforeEach(async () => {
  await database.jobs.deleteMany({});
  vi.restoreAllMocks();
  vi.spyOn(logger, "info").mockImplementation(() => undefined);
});

afterAll(async () => {
  await database.close();
});

describe("discoverJobs", () => {
  it("saves a job that passes every rule as to_screen, with its details", async () => {
    await runWith(fakeSource([listedJob("1")]));
    expect(await database.jobs.findOne({ _id: "fake:1" })).toMatchObject({
      title: "React Developer",
      status: JobStatus.toScreen,
      details: DETAILS,
      seenAt: NOW,
    });
  });

  it("ignores jobs posted before the lookback window", async () => {
    const source = fakeSource([listedJob("1", { postedAt: new Date("2026-10-26T11:59:00Z") })]);
    await runWith(source);
    expect(await database.jobs.countDocuments()).toBe(0);
    expect(source.fetchDetails).not.toHaveBeenCalled();
  });

  it("leaves already seen jobs untouched", async () => {
    await database.jobs.insertOne({ _id: "fake:1", ...listedJob("1"), status: JobStatus.pinged, seenAt: NOW });
    const source = fakeSource([listedJob("1")]);
    await runWith(source);
    expect(await database.jobs.findOne({ _id: "fake:1" })).toMatchObject({ status: JobStatus.pinged });
    expect(source.fetchDetails).not.toHaveBeenCalled();
  });

  it("saves a prefilter reject with its reason, without fetching details", async () => {
    const source = fakeSource([listedJob("1", { title: "Tech Lead" })]);
    await runWith(source);
    expect(await database.jobs.findOne({ _id: "fake:1" })).toMatchObject({
      status: JobStatus.prefilterRejected,
      rejectReason: 'title has "Lead"',
    });
    expect(source.fetchDetails).not.toHaveBeenCalled();
  });

  it("logs per-source counts of what happened to the jobs", async () => {
    const jobs = [
      listedJob("1"),
      listedJob("2", { title: "Tech Lead" }),
      listedJob("3", { postedAt: new Date("2026-10-26T11:59:00Z") }),
    ];
    await runWith(fakeSource(jobs));
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "discover.source_done",
        fetched: 3,
        recent: 2,
        unseen: 2,
        results: { to_screen: 1, prefilter_rejected: 1 },
      }),
      "source done",
    );
  });

  it("saves a details reject with its reason and details", async () => {
    const details = { ...DETAILS, applicants: 52 };
    await runWith(fakeSource([listedJob("1")], () => Promise.resolve(details)));
    expect(await database.jobs.findOne({ _id: "fake:1" })).toMatchObject({
      status: JobStatus.detailsRejected,
      rejectReason: "52 applicants",
      details,
    });
  });

  it("skips and logs a job whose details fail, and keeps going", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const source = fakeSource([listedJob("1"), listedJob("2")], ({ sourceJobId }) =>
      sourceJobId === "1" ? Promise.reject(new Error("404")) : Promise.resolve(DETAILS),
    );
    await runWith(source);
    expect(await database.jobs.find().map((savedJob) => savedJob._id).toArray()).toEqual(["fake:2"]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "discover.details_failed", link: "https://example.com/jobs/1" }),
      expect.any(String),
    );
  });

  it("fails when a source cannot list its jobs", async () => {
    const source = fakeSource([]);
    vi.mocked(source.fetchRecentJobs).mockRejectedValue(new Error("djinni responded 503"));
    await expect(runWith(source)).rejects.toThrow("503");
  });
});

function runWith(source: JobSource): Promise<void> {
  return discoverJobs({ sources: [source], jobs: database.jobs, settings: SETTINGS, now: NOW });
}

function fakeSource(
  jobs: ListedJob[],
  fetchDetails: (job: ListedJob) => Promise<JobDetails> = () => Promise.resolve(DETAILS),
): JobSource {
  return {
    name: "fake",
    fetchRecentJobs: vi.fn(() => Promise.resolve(jobs)),
    fetchDetails: vi.fn(fetchDetails),
  };
}

function listedJob(sourceJobId: string, overrides: Partial<ListedJob> = {}): ListedJob {
  return {
    source: "fake",
    sourceJobId,
    title: "React Developer",
    link: `https://example.com/jobs/${sourceJobId}`,
    description: "Healthcare product.",
    category: "React.js",
    postedAt: new Date("2026-10-27T10:00:00Z"),
    isEuRemote: false,
    ...overrides,
  };
}

function buildTestMongoUri(): string {
  process.loadEnvFile(resolve(PROJECT_ROOT, "config/.env"));
  const uri = new URL(process.env.MONGO_URI ?? "");
  uri.pathname = `/${TEST_DB_NAME}`;
  return uri.toString();
}
