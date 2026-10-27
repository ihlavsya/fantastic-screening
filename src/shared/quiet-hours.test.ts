import { describe, expect, it } from "vitest";
import { checkIsInsideQuietHours } from "./quiet-hours.ts";

const KYIV = "Europe/Kyiv";

describe("checkIsInsideQuietHours", () => {
  describe("overnight window 22:00–08:00", () => {
    const night = { from: "22:00", to: "08:00", tz: KYIV };

    it.each([
      ["2026-10-27T21:59:00+02:00", false],
      ["2026-10-27T22:00:00+02:00", true],
      ["2026-10-28T00:30:00+02:00", true],
      ["2026-10-28T07:59:00+02:00", true],
      ["2026-10-28T08:00:00+02:00", false],
      ["2026-10-28T13:00:00+02:00", false],
    ])("at %s Kyiv → %s", (time, isQuiet) => {
      expect(checkIsInsideQuietHours(new Date(time), night)).toBe(isQuiet);
    });

    it("follows Kyiv summer time, not the machine timezone", () => {
      const kyivElevenPmInSummer = new Date("2026-07-15T20:00:00Z");
      expect(checkIsInsideQuietHours(kyivElevenPmInSummer, night)).toBe(true);
    });
  });

  describe("same-day window 13:00–14:00", () => {
    const lunch = { from: "13:00", to: "14:00", tz: KYIV };

    it.each([
      ["2026-10-27T12:59:00+02:00", false],
      ["2026-10-27T13:00:00+02:00", true],
      ["2026-10-27T14:00:00+02:00", false],
    ])("at %s Kyiv → %s", (time, isQuiet) => {
      expect(checkIsInsideQuietHours(new Date(time), lunch)).toBe(isQuiet);
    });
  });

  it("is never quiet when from equals to", () => {
    const empty = { from: "10:00", to: "10:00", tz: KYIV };
    expect(checkIsInsideQuietHours(new Date("2026-10-27T10:00:00+02:00"), empty)).toBe(false);
  });

  it("rejects a time without minutes", () => {
    const broken = { from: "22", to: "08:00", tz: KYIV };
    expect(() => checkIsInsideQuietHours(new Date(), broken)).toThrow('Invalid time "22"');
  });
});
