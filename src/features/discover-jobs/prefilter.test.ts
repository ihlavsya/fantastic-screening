import { describe, expect, it } from "vitest";
import { prefilter } from "./prefilter.ts";

describe("prefilter", () => {
  it("passes a regular job", () => {
    const job = { title: "Middle Full-Stack Engineer (React/Node)", description: "Healthcare product, FHIR forms." };
    expect(prefilter(job)).toEqual({ hasPassed: true });
  });

  describe("drops titles above my level", () => {
    it.each([
      ["Team Lead (Node.js)", "Lead"],
      ["Senior Frontend Engineer / Tech lead", "Lead"],
      ["Solution Architect", "Architect"],
      ["Head of Engineering", "Head of"],
      ["Principal JavaScript Engineer", "Principal"],
      ["CTO / Co-founder", "CTO"],
    ])("%j", (title, word) => {
      expect(prefilter({ title, description: "" })).toEqual({
        hasPassed: false,
        rejectReason: `title has "${word}"`,
      });
    });
  });

  describe("keeps titles that only contain those words inside other words", () => {
    it.each(["Leading-edge React Developer", "Frontend Developer, Leadership track", "Headless CMS Engineer"])(
      "%j",
      (title) => {
        expect(prefilter({ title, description: "" })).toEqual({ hasPassed: true });
      },
    );
  });

  describe("drops dealbreaker domains", () => {
    it.each([
      [{ title: "Node.js Developer (iGaming)", description: "" }, "iGaming"],
      [{ title: "React Developer", description: "We build an online CASINO platform." }, "casino"],
      [{ title: "Fullstack Engineer", description: "Сервіс для ставок, sportsbook для Європи." }, "sportsbook"],
      [{ title: "JS Developer", description: "A platform like OnlyFans for creators." }, "OnlyFans"],
    ])("%j", (job, word) => {
      expect(prefilter(job)).toEqual({ hasPassed: false, rejectReason: `dealbreaker "${word}"` });
    });
  });

  it("keeps a description that only contains a dealbreaker inside another word", () => {
    const job = { title: "React Developer", description: "Camera app, marketing campaigns, pokerface team." };
    expect(prefilter(job)).toEqual({ hasPassed: true });
  });

  it("reports the title rule first when both match", () => {
    const job = { title: "Tech Lead", description: "Casino platform." };
    expect(prefilter(job)).toEqual({ hasPassed: false, rejectReason: 'title has "Lead"' });
  });
});
