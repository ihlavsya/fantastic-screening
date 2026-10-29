import { checkIsRecord, checkIsString } from "#shared/type-guards.ts";
import type { JsonSchema } from "./language-model.ts";

export type ParsedDraft = { isValid: true; draft: string } | { isValid: false; problem: string };

export const DRAFT_SCHEMA: JsonSchema = {
  type: "object",
  properties: { draft: { type: "string", description: "The application message, in English." } },
  required: ["draft"],
  additionalProperties: false,
};

export function parseDraft(answer: unknown): ParsedDraft {
  if (!checkIsRecord(answer)) return { isValid: false, problem: "answer is not an object" };

  const draft = checkIsString(answer.draft) ? answer.draft.trim() : "";
  if (draft === "") return { isValid: false, problem: "draft is missing or empty" };
  return { isValid: true, draft };
}
