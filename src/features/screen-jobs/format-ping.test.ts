import { describe, expect, it } from "vitest";
import { type Job, type JobDetails, JobStatus } from "#shared/job.ts";
import { formatClaudeFailing, formatPing } from "./format-ping.ts";

const NOW = new Date("2026-10-27T12:00:00Z");
const DETAILS: JobDetails = {
  company: "Acme Health",
  salary: { min: 3000, max: 4000 },
  city: "Kyiv",
  workFormat: "hybrid",
  applicants: 12,
  yearsRequired: 3,
};
const ASSESSMENT = {
  fitReasons: ["healthcare + React forms", "FHIR mention"],
  concerns: ["wants AWS, you don't list it"],
};

describe("formatPing", () => {
  it("shows every field of a full job", () => {
    expect(formatPing(buildJob(), NOW)).toBe(
      [
        "🆕 Middle Full-Stack (React/Node) — Acme Health",
        "💰 $3000–4000 · 📍 Hybrid, Kyiv · 🎯 3 yrs",
        "⏱ posted 5h ago · 👥 12 applicants",
        "✅ fit: healthcare + React forms; FHIR mention",
        "⚠️ concerns: wants AWS, you don't list it",
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
      expect(ping.split("\n")[1]).toBe("📍 Hybrid, Kyiv · 🎯 3 yrs");
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

  describe("years required", () => {
    it.each([
      [0, "· 🎯 0 yrs"],
      [4.5, "· 🎯 4.5 yrs"],
    ])("%j → %s", (yearsRequired, part) => {
      expect(formatPing(buildJob({ details: { ...DETAILS, yearsRequired } }), NOW)).toContain(part);
    });

    it("is left out when unknown", () => {
      const ping = formatPing(buildJob({ details: { ...DETAILS, yearsRequired: undefined } }), NOW);
      expect(ping).not.toContain("🎯");
    });
  });

  it("drops the terms line when salary, place and years are unknown", () => {
    const details = { company: "Acme Health", applicants: 12 };
    expect(formatPing(buildJob({ details, assessment: undefined }), NOW).split("\n")).toHaveLength(3);
  });

  describe("assessment", () => {
    it("drops the fit line when there are no fit reasons", () => {
      const ping = formatPing(buildJob({ assessment: { ...ASSESSMENT, fitReasons: [] } }), NOW);
      expect(ping).not.toContain("✅");
      expect(ping).toContain("⚠️ concerns:");
    });

    it("drops the concerns line when there are no concerns", () => {
      const ping = formatPing(buildJob({ assessment: { ...ASSESSMENT, concerns: [] } }), NOW);
      expect(ping).not.toContain("⚠️");
      expect(ping).toContain("✅ fit:");
    });

    it("drops both lines when the job has no assessment", () => {
      const ping = formatPing(buildJob({ assessment: undefined }), NOW);
      expect(ping).not.toContain("✅");
      expect(ping).not.toContain("⚠️");
    });
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

  it("escapes html in title, company, place and assessment", () => {
    const job = buildJob({
      title: "R&D <React> Dev",
      details: { ...DETAILS, company: "A&B", city: "Kyiv <center>" },
      assessment: { fitReasons: ["<b>React</b>"], concerns: ["R&D only"] },
    });
    const ping = formatPing(job, NOW);
    expect(ping).toContain("🆕 R&amp;D &lt;React&gt; Dev — A&amp;B");
    expect(ping).toContain("📍 Hybrid, Kyiv &lt;center&gt;");
    expect(ping).toContain("✅ fit: &lt;b&gt;React&lt;/b&gt;");
    expect(ping).toContain("⚠️ concerns: R&amp;D only");
  });
});

describe("formatClaudeFailing", () => {
  it("escapes the failure message", () => {
    expect(formatClaudeFailing("model <x> not found")).toBe("⚠️ Claude failing: model &lt;x&gt; not found");
  });

  it("cuts a long failure message", () => {
    const message = formatClaudeFailing("a".repeat(600));
    expect(message).toBe(`⚠️ Claude failing: ${"a".repeat(500)}…`);
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
    assessment: ASSESSMENT,
    status: JobStatus.toPing,
    seenAt: NOW,
    ...overrides,
  };
}
