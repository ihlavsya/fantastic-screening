import { describe, expect, it } from "vitest";
import type { JobDetails } from "#shared/job.ts";
import { detailsFilter } from "./details-filter.ts";

const MAX_APPLICANTS = 50;
const REGULAR_JOB = { title: "Middle React Developer" };

describe("detailsFilter", () => {
  describe("applicants", () => {
    it.each([
      [49, { hasPassed: true }],
      [undefined, { hasPassed: true }],
      [50, { hasPassed: false, rejectReason: "50 applicants" }],
      [52, { hasPassed: false, rejectReason: "52 applicants" }],
    ])("%j → %j", (applicants, verdict) => {
      expect(detailsFilter(REGULAR_JOB, { applicants }, MAX_APPLICANTS)).toEqual(verdict);
    });
  });

  describe("junior / intern pay", () => {
    it.each<[string, JobDetails["salary"], string]>([
      ["Junior React Developer", { min: 400, max: 500 }, '"Junior" title, top pay $500 < $1k'],
      ["Junior React Developer", { min: 800 }, '"Junior" title, top pay $800 < $1k'],
      ["Frontend Intern", { max: 999 }, '"Intern" title, top pay $999 < $1k'],
      ["React Internship", undefined, '"Internship" title, no salary'],
      ["junior node.js developer", undefined, '"junior" title, no salary'],
    ])("drops %j with %j", (title, salary, rejectReason) => {
      expect(detailsFilter({ title }, { salary }, MAX_APPLICANTS)).toEqual({ hasPassed: false, rejectReason });
    });

    it.each<[string, JobDetails["salary"]]>([
      ["Junior React Developer", { min: 800, max: 1200 }],
      ["Junior React Developer", { max: 1000 }],
      ["Frontend Intern", { min: 1000 }],
      ["Middle React Developer", undefined],
      ["Internal Tools Developer", undefined],
      ["Junior/Middle React Developer", undefined],
      ["Middle/Junior Frontend Developer", { max: 500 }],
      ["Junior-Mid Node.js Developer", undefined],
    ])("keeps %j with %j", (title, salary) => {
      expect(detailsFilter({ title }, { salary }, MAX_APPLICANTS)).toEqual({ hasPassed: true });
    });
  });

  it("checks applicants before pay", () => {
    expect(detailsFilter({ title: "Junior Developer" }, { applicants: 60 }, MAX_APPLICANTS)).toEqual({
      hasPassed: false,
      rejectReason: "60 applicants",
    });
  });
});
