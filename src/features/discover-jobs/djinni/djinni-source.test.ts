import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ListedJob } from "#shared/job.ts";
import { logger } from "#shared/logger.ts";
import type { DjinniGateway, FeedQuery } from "./djinni-gateway.ts";
import { createDjinniSource } from "./djinni-source.ts";

const KEYWORDS = ["JavaScript", "React.js", "Node.js", "Fullstack"];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchRecentJobs", () => {
  it("fetches a general and an EU-remote feed per keyword", async () => {
    const queries: FeedQuery[] = [];
    const gateway = fakeGateway((query) => {
      queries.push(query);
      return readFixture("feed.xml");
    });
    await createDjinniSource(gateway).fetchRecentJobs();
    expect(queries).toHaveLength(8);
    expect(queries).toEqual(
      expect.arrayContaining(KEYWORDS.flatMap((keyword) => [{ keyword, isEuRemote: false }, { keyword, isEuRemote: true }])),
    );
  });

  it("keeps one job per id across feeds", async () => {
    const gateway = fakeGateway(() => readFixture("feed.xml"));
    const jobs = await createDjinniSource(gateway).fetchRecentJobs();
    expect(jobs.map(({ sourceJobId }) => sourceJobId)).toEqual(["854148", "855243", "855226"]);
  });

  it("marks a job EU-remote when any EU-remote feed lists it", async () => {
    const gateway = fakeGateway(({ isEuRemote }) =>
      isEuRemote ? buildFeed({ jobIds: ["855226", "900001"] }) : readFixture("feed.xml"),
    );
    const jobs = await createDjinniSource(gateway).fetchRecentJobs();
    expect(jobs.map(pickEuRemote)).toEqual([
      { sourceJobId: "854148", isEuRemote: false },
      { sourceJobId: "855243", isEuRemote: false },
      { sourceJobId: "855226", isEuRemote: true },
      { sourceJobId: "900001", isEuRemote: true },
    ]);
  });

  it("skips and logs feeds whose keyword djinni does not know", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const gateway = fakeGateway(({ keyword }) =>
      keyword === "Node.js"
        ? buildFeed({ categories: ["Java"], jobIds: ["900002"] })
        : buildFeed({ jobIds: ["900001"] }),
    );
    const jobs = await createDjinniSource(gateway).fetchRecentJobs();
    expect(jobs.map(({ sourceJobId }) => sourceJobId)).toEqual(["900001"]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "djinni.keyword_unknown", keyword: "Node.js" }),
      expect.any(String),
    );
  });

  it("fails when any feed fails", async () => {
    const gateway = fakeGateway(({ isEuRemote }) => {
      if (isEuRemote) throw new Error("djinni responded 503");
      return readFixture("feed.xml");
    });
    await expect(createDjinniSource(gateway).fetchRecentJobs()).rejects.toThrow("503");
  });
});

describe("fetchDetails", () => {
  it("reads the details from the job", async () => {
    const gateway = fakeGateway(() => readFixture("feed.xml"));
    const source = createDjinniSource(gateway);
    const [job] = await source.fetchRecentJobs();
    if (job === undefined) throw new Error("feed fixture has no jobs");

    expect(await source.fetchDetails(job)).toEqual({
      company: "DiversiPy",
      salary: { min: 400, max: 500 },
      city: "Kyiv",
      workFormat: "hybrid",
      applicants: 4,
      yearsRequired: 0.5,
    });
    expect(gateway.fetchJob).toHaveBeenCalledWith("854148");
  });
});

function fakeGateway(feedFor: (query: FeedQuery) => string): DjinniGateway {
  return {
    fetchFeed: vi.fn((query: FeedQuery) => Promise.resolve(feedFor(query))),
    fetchJob: vi.fn(() => Promise.resolve(readJsonFixture("job-hybrid-kyiv.json"))),
  };
}

function buildFeed({ categories = KEYWORDS, jobIds }: { categories?: string[]; jobIds: string[] }): string {
  const categoryTags = categories.map((name) => `<category>${name}</category>`).join("");
  const items = jobIds
    .map(
      (id) =>
        `<item><title>Dev ${id}</title><link>https://djinni.co/jobs/${id}-dev/</link><pubDate>Tue, 27 Oct 2026 11:45:54 +0200</pubDate><category>JavaScript</category></item>`,
    )
    .join("");
  return `<rss><channel>${categoryTags}${items}</channel></rss>`;
}

function pickEuRemote({ sourceJobId, isEuRemote }: ListedJob): Pick<ListedJob, "sourceJobId" | "isEuRemote"> {
  return { sourceJobId, isEuRemote };
}

function readJsonFixture(name: string): unknown {
  return JSON.parse(readFixture(name)) as unknown;
}

function readFixture(name: string): string {
  return readFileSync(resolve(import.meta.dirname, "fixtures", name), "utf8");
}
