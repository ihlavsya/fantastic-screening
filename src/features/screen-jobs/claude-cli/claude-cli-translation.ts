import { checkIsRecord } from "#shared/type-guards.ts";
import type { ModelHealth, ModelReply } from "../language-model.ts";

export type CliRun = {
  stdout: string;
  stderr: string;
  hasTimedOut: boolean;
  errorMessage?: string;
};

export type CliTranslation = {
  reply: ModelReply;
  isKnownOutput: boolean;
};

const UNKNOWN_OUTPUT = "unknown CLI output";

export function translateCliRun(run: CliRun): CliTranslation {
  const rawOutput = [run.stdout, run.stderr].filter((text) => text !== "").join("\n");
  if (run.hasTimedOut) return knownFailure("claude -p timed out", rawOutput);
  if (run.stdout.trim() === "" && run.errorMessage !== undefined) return knownFailure(run.errorMessage, rawOutput);

  const envelope = parseJson(run.stdout);
  if (!checkIsRecord(envelope)) return unknownFailure(rawOutput);
  if (envelope.is_error === false && envelope.structured_output !== undefined) {
    return { reply: { isOk: true, answer: envelope.structured_output }, isKnownOutput: true };
  }
  if (envelope.is_error === true && typeof envelope.result === "string") return knownFailure(envelope.result, rawOutput);
  return unknownFailure(rawOutput);
}

export function translateHealthReply(reply: ModelReply): ModelHealth {
  if (!reply.isOk) return { isHealthy: false, failure: reply.failure };
  if (checkIsRecord(reply.answer) && reply.answer.ok === true) return { isHealthy: true };
  return {
    isHealthy: false,
    failure: { message: "health check answer was not ok", rawOutput: JSON.stringify(reply.answer) },
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function knownFailure(message: string, rawOutput: string): CliTranslation {
  return { reply: { isOk: false, failure: { message, rawOutput } }, isKnownOutput: true };
}

function unknownFailure(rawOutput: string): CliTranslation {
  return { reply: { isOk: false, failure: { message: UNKNOWN_OUTPUT, rawOutput } }, isKnownOutput: false };
}
