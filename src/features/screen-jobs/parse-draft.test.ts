import { describe, expect, it } from "vitest";
import { parseDraft } from "./parse-draft.ts";

describe("parseDraft", () => {
  it("returns the draft, trimmed", () => {
    expect(parseDraft({ draft: "  I'm a full-stack developer.\n" })).toEqual({
      isValid: true,
      draft: "I'm a full-stack developer.",
    });
  });

  it("keeps line breaks inside the draft", () => {
    expect(parseDraft({ draft: "First paragraph.\n\nSecond paragraph." })).toEqual({
      isValid: true,
      draft: "First paragraph.\n\nSecond paragraph.",
    });
  });

  it("ignores extra fields", () => {
    expect(parseDraft({ draft: "Hi there.", isFit: true })).toEqual({ isValid: true, draft: "Hi there." });
  });

  it.each([
    ["Hi there.", "answer is not an object"],
    [["Hi there."], "answer is not an object"],
    [{}, "draft is missing or empty"],
    [{ draft: 3 }, "draft is missing or empty"],
    [{ draft: "  \n " }, "draft is missing or empty"],
  ])("rejects %j", (answer, problem) => {
    expect(parseDraft(answer)).toEqual({ isValid: false, problem });
  });
});
