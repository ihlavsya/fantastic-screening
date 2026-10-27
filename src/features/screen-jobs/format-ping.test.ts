import { describe, expect, it } from "vitest";
import { type Job, type JobDetails, JobStatus } from "#shared/job.ts";
import { formatPing } from "./format-ping.ts";

const NOW = new Date("2026-10-27T12:00:00Z");
const DETAILS: JobDetails = {
  company: "Acme Health",
  salary: { min: 3000, max: 4000 },
  city: "Kyiv",
  workFormat: "hybrid",
  applicants: 12,
};

describe("formatPing", () => {
  it("shows every field of a full job", () => {
    expect(formatPing(buildJob(), NOW)).toBe(
      [
        "🆕 Middle Full-Stack (React/Node) — Acme Health",
        "💰 $3000–4000 · 📍 Hybrid, Kyiv",
        "⏱ posted 5h ago · 👥 12 applicants",
        "🔗 https://djinni.co/jobs/123456-middle-full-stack/",
      ].join("\n"),
    );
  });

  it("flags an EU-remote job", () => {
    expect(formatPing(buildJob({ isEuRemote: true }), NOW)).toMatch(/^🆕 🇪🇺 Middle/);
  });

  describe("salary", () => {
    it.each([
      [{ min: 3000 }, "💰 from $3000"],
      [{ max: 4000 }, "💰 up to $4000"],
      [{ min: 3000, max: 3000 }, "💰 $3000"],
    ])("%j → %s", (salary, line) => {
      expect(formatPing(buildJob({ details: { ...DETAILS, salary } }), NOW)).toContain(`${line} · 📍`);
    });

    it("is left out when unknown", () => {
      const ping = formatPing(buildJob({ details: { ...DETAILS, salary: undefined } }), NOW);
      expect(ping.split("\n")[1]).toBe("📍 Hybrid, Kyiv");
    });
  });

  describe("place", () => {
    it.each([
      [{ workFormat: "remote", city: undefined }, "📍 Remote"],
      [{ workFormat: undefined, city: "Lviv" }, "📍 Lviv"],
      [{ workFormat: "Flexible Office", city: "Kyiv" }, "📍 Flexible Office, Kyiv"],
    ])("%j → %s", (place, line) => {
      expect(formatPing(buildJob({ details: { ...DETAILS, ...place } }), NOW)).toContain(`· ${line}`);
    });
  });

  it("drops the terms line when neither salary nor place is known", () => {
    const details = { company: "Acme Health", applicants: 12 };
    expect(formatPing(buildJob({ details }), NOW).split("\n")).toHaveLength(3);
  });

  it("drops the applicant count when unknown", () => {
    const ping = formatPing(buildJob({ details: { ...DETAILS, applicants: undefined } }), NOW);
    expect(ping).toContain("⏱ posted 5h ago\n");
  });

  describe("age", () => {
    it.each([
      ["2026-10-27T11:59:30Z", "0m"],
      ["2026-10-27T11:25:00Z", "35m"],
      ["2026-10-27T11:00:00Z", "1h"],
      ["2026-10-26T12:00:01Z", "23h"],
      ["2026-10-25T11:00:00Z", "2d"],
      ["2026-10-27T12:05:00Z", "0m"],
    ])("posted at %s → %s", (postedAt, age) => {
      expect(formatPing(buildJob({ postedAt: new Date(postedAt) }), NOW)).toContain(`⏱ posted ${age} ago`);
    });
  });

  it("escapes html in title, company and place", () => {
    const job = buildJob({
      title: "R&D <React> Dev",
      details: { ...DETAILS, company: "A&B", city: "Kyiv <center>" },
    });
    const ping = formatPing(job, NOW);
    expect(ping).toContain("🆕 R&amp;D &lt;React&gt; Dev — A&amp;B");
    expect(ping).toContain("📍 Hybrid, Kyiv &lt;center&gt;");
  });
});

function buildJob(overrides: Partial<Job> = {}): Job {
  return {
    _id: "djinni:123456",
    source: "djinni",
    sourceJobId: "123456",
    title: "Middle Full-Stack (React/Node)",
    link: "https://djinni.co/jobs/123456-middle-full-stack/",
    description: "",
    category: "Fullstack",
    postedAt: new Date("2026-10-27T07:00:00Z"),
    isEuRemote: false,
    details: DETAILS,
    status: JobStatus.possible,
    seenAt: NOW,
    ...overrides,
  };
}
