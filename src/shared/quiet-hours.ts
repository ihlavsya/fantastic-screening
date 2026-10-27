import type { QuietHours } from "./config.ts";

export function checkIsInsideQuietHours(
  now: Date,
  quietHours: QuietHours,
): boolean {
  const current = minutesOfDayIn(quietHours.tz, now);
  const from = parseMinutesOfDay(quietHours.from);
  const to = parseMinutesOfDay(quietHours.to);
  const isOvernight = from > to;
  return isOvernight
    ? current >= from || current < to
    : current >= from && current < to;
}

function minutesOfDayIn(timeZone: string, date: Date): number {
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return parseMinutesOfDay(clock);
}

function parseMinutesOfDay(clock: string): number {
  const [hours, minutes] = clock.split(":").map(Number);
  if (hours === undefined || minutes === undefined) {
    throw new Error(`Invalid time "${clock}", expected HH:MM`);
  }
  return hours * 60 + minutes;
}
