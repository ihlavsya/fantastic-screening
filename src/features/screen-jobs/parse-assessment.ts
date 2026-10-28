import type { Assessment } from "#shared/job.ts";
import { checkIsRecord, checkIsString } from "#shared/type-guards.ts";
import type { JsonSchema } from "./language-model.ts";

export type ParsedAssessment = { isValid: true; verdict: ScreeningVerdict } | { isValid: false; problem: string };

export type ScreeningVerdict = { isFit: true; assessment: Assessment } | { isFit: false; rejectReason: string };

export const ASSESSMENT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    isFit: { type: "boolean", description: "Whether the job fits, judged on the whole posting." },
    rejectReason: { type: "string", description: "One line on why it does not fit. Only when isFit is false." },
    fitReasons: {
      type: "array",
      items: { type: "string" },
      description: "1-3 short points on why it fits. Empty when isFit is false.",
    },
    concerns: {
      type: "array",
      items: { type: "string" },
      description: "Anything to check on a fit: skill gaps, stretch asks, terms. Empty when there are none.",
    },
  },
  required: ["isFit", "fitReasons", "concerns"],
  additionalProperties: false,
};

export function parseAssessment(answer: unknown): ParsedAssessment {
  if (!checkIsRecord(answer)) return { isValid: false, problem: "answer is not an object" };
  if (typeof answer.isFit !== "boolean") return { isValid: false, problem: "isFit is not a boolean" };

  if (answer.isFit) {
    const assessment = { fitReasons: readPoints(answer.fitReasons), concerns: readPoints(answer.concerns) };
    return { isValid: true, verdict: { isFit: true, assessment } };
  }

  const rejectReason = checkIsString(answer.rejectReason) ? answer.rejectReason.trim() : "";
  if (rejectReason === "") return { isValid: false, problem: "rejectReason is missing on a reject" };
  return { isValid: true, verdict: { isFit: false, rejectReason } };
}

function readPoints(points: unknown): string[] {
  if (!Array.isArray(points)) return [];
  return points
    .filter(checkIsString)
    .map((point) => point.trim())
    .filter((point) => point !== "");
}
