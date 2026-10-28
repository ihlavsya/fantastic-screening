import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { translateFeed, translateJobDetails } from "./djinni-translation.ts";

const MINIMAL_JOB = { company_name: "Acme", applications_count: 4 };

describe("translateFeed", () => {
  const feed = translateFeed(readFixture("feed.xml"));

  it("lists the channel categories, for validating feed keywords", () => {
    expect(feed.categories).toEqual(["JavaScript", "React.js", "Node.js", "Fullstack", "Java", "Python"]);
  });

  it("turns each item into a job", () => {
    expect(feed.jobs).toHaveLength(3);
    expect(feed.jobs[0]).toMatchObject({
      source: "djinni",
      sourceJobId: "854148",
      title: "Product Engineer",
      link: "https://djinni.co/jobs/854148-product-engineer/",
      category: "Fullstack",
      postedAt: new Date("2026-10-27T11:45:54+02:00"),
    });
  });

  it("keeps the description as plain text", () => {
    const description = feed.jobs[0]?.description ?? "";
    expect(description.length).toBeGreaterThan(100);
    expect(description).not.toMatch(/<[a-z/]|&nbsp;|&amp;/i);
  });

  it("converts html line breaks and entities", () => {
    const xml = feedWithItem({
      description: "&lt;p&gt;Hi&amp;nbsp;there&lt;/p&gt;&lt;ul&gt;&lt;li&gt;R&amp;amp;D&lt;/li&gt;&lt;li&gt;&amp;#8212; ok&lt;/li&gt;&lt;/ul&gt;",
    });
    expect(translateFeed(xml).jobs[0]?.description).toBe("Hi there\nR&D\n— ok");
  });

  it("returns no jobs for an empty feed", () => {
    const xml = "<rss><channel><category>JavaScript</category></channel></rss>";
    expect(translateFeed(xml).jobs).toEqual([]);
  });

  it("rejects a link without a job id", () => {
    const xml = feedWithItem({ link: "https://djinni.co/jobs/" });
    expect(() => translateFeed(xml)).toThrow("No djinni job id");
  });

  it("rejects an unparseable pubDate", () => {
    const xml = feedWithItem({ pubDate: "someday" });
    expect(() => translateFeed(xml)).toThrow('"pubDate" to be a date');
  });
});

describe("translateJobDetails", () => {
  it("reads a hybrid job in Kyiv with a salary", () => {
    const job = JSON.parse(readFixture("job-hybrid-kyiv.json")) as unknown;
    expect(translateJobDetails(job)).toEqual({
      company: "DiversiPy",
      salary: { min: 400, max: 500 },
      city: "Kyiv",
      workFormat: "hybrid",
      applicants: 4,
      yearsRequired: 0.5,
    });
  });

  it("reads a job without a salary", () => {
    const job = JSON.parse(readFixture("job-office-or-remote.json")) as unknown;
    expect(translateJobDetails(job)).toEqual({
      company: "N-iX",
      city: "Kyiv, Ivano-Frankivsk, Lviv",
      workFormat: "remote",
      applicants: 4,
      yearsRequired: 7,
    });
  });

  describe("work format: picks the least strict one offered", () => {
    it.each([
      ["Full Remote", "remote"],
      ["Hybrid Remote", "hybrid"],
      ["Office Work", "office"],
      ["Remote, Hybrid Remote", "remote"],
      ["Office, Remote", "remote"],
      ["Office, Hybrid Remote", "hybrid"],
      ["Remote, Flexible Hours", "remote"],
      ["Flexible Office", "Flexible Office"],
      ["", undefined],
    ])("%j → %j", (workFormat, translated) => {
      const job = { ...MINIMAL_JOB, work_format: workFormat };
      expect(translateJobDetails(job).workFormat).toBe(translated);
    });
  });

  describe("salary", () => {
    it.each([
      [{ public_salary_min: 0, public_salary_max: 0 }, undefined],
      [{ public_salary_min: 3000, public_salary_max: null }, { min: 3000 }],
      [{ public_salary_min: null, public_salary_max: 4000 }, { max: 4000 }],
    ])("%j → %j", (salaryFields, salary) => {
      const job = { ...MINIMAL_JOB, ...salaryFields };
      expect(translateJobDetails(job).salary).toEqual(salary);
    });
  });

  describe("years required", () => {
    it.each([
      [{ experience: 0 }, 0],
      [{ experience: 3.5 }, 3.5],
      [{ experience: null }, undefined],
      [{}, undefined],
    ])("%j → %j", (experienceField, yearsRequired) => {
      const job = { ...MINIMAL_JOB, ...experienceField };
      expect(translateJobDetails(job).yearsRequired).toBe(yearsRequired);
    });
  });

  it("reads zero applicants on a fresh job", () => {
    expect(translateJobDetails({ ...MINIMAL_JOB, applications_count: 0 }).applicants).toBe(0);
  });

  it("rejects a job without a company", () => {
    expect(() => translateJobDetails({ title: "Dev", applications_count: 4 })).toThrow('"company_name"');
  });

  it("rejects a job without an applicant count", () => {
    expect(() => translateJobDetails({ company_name: "Acme" })).toThrow('"applications_count"');
  });
});

function readFixture(name: string): string {
  return readFileSync(resolve(import.meta.dirname, "fixtures", name), "utf8");
}

function feedWithItem(overrides: { link?: string; pubDate?: string; description?: string }): string {
  const item = {
    link: "https://djinni.co/jobs/123-dev/",
    pubDate: "Tue, 27 Oct 2026 11:45:54 +0200",
    description: "",
    ...overrides,
  };
  return `<rss><channel><item><title>Dev</title><link>${item.link}</link><description>${item.description}</description><pubDate>${item.pubDate}</pubDate><category>JavaScript</category><category/></item></channel></rss>`;
}
