import { describe, expect, it } from "vitest";
import { parseAssessment } from "./parse-assessment.ts";

describe("parseAssessment", () => {
  it("returns a fit with its reasons and concerns", () => {
    const answer = { isFit: true, fitReasons: ["React + Node"], concerns: ["asks 4 yrs, you have 3.5"] };
    expect(parseAssessment(answer)).toEqual({
      isValid: true,
      verdict: { isFit: true, assessment: { fitReasons: ["React + Node"], concerns: ["asks 4 yrs, you have 3.5"] } },
    });
  });

  it("returns a reject with its reason", () => {
    expect(parseAssessment({ isFit: false, rejectReason: "office-only in Dnipro" })).toEqual({
      isValid: true,
      verdict: { isFit: false, rejectReason: "office-only in Dnipro" },
    });
  });

  it("defaults missing lists to empty", () => {
    expect(parseAssessment({ isFit: true })).toEqual({
      isValid: true,
      verdict: { isFit: true, assessment: { fitReasons: [], concerns: [] } },
    });
  });

  it("keeps only non-empty string points, trimmed", () => {
    const answer = { isFit: true, fitReasons: [" React ", "", 3, undefined], concerns: "not a list" };
    expect(parseAssessment(answer)).toEqual({
      isValid: true,
      verdict: { isFit: true, assessment: { fitReasons: ["React"], concerns: [] } },
    });
  });

  it("ignores extra fields and a reject reason on a fit", () => {
    expect(parseAssessment({ isFit: true, rejectReason: "n/a", draft: "Hi" })).toEqual({
      isValid: true,
      verdict: { isFit: true, assessment: { fitReasons: [], concerns: [] } },
    });
  });

  it.each([
    ["not an object", "yes", "answer is not an object"],
    ["an array", [true], "answer is not an object"],
    ["no isFit", { fitReasons: [] }, "isFit is not a boolean"],
    ["isFit as a string", { isFit: "true" }, "isFit is not a boolean"],
    ["a reject without reason", { isFit: false }, "rejectReason is missing on a reject"],
    ["a reject with a blank reason", { isFit: false, rejectReason: "  " }, "rejectReason is missing on a reject"],
  ])("fails on %s", (caseName, answer, problem) => {
    expect(parseAssessment(answer)).toEqual({ isValid: false, problem });
  });
});
