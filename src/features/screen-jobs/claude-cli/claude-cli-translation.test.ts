import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliRun, translateCliRun, translateHealthReply } from "./claude-cli-translation.ts";

const BAD_MODEL_STDERR = '[claude-code:unrecognized_model] {"model":"claude-nonexistent-model","query_source":"sdk"}';

describe("translateCliRun", () => {
  it("returns the structured answer of a successful call", () => {
    expect(translateCliRun(buildRun({ stdout: readFixture("success.json") }))).toEqual({
      reply: { isOk: true, answer: { ok: true } },
      isKnownOutput: true,
    });
  });

  it("returns the error text of an error envelope, keeping stdout and stderr", () => {
    const stdout = readFixture("error-bad-model.json");
    expect(translateCliRun(buildRun({ stdout, stderr: BAD_MODEL_STDERR, errorMessage: "exit 1" }))).toEqual({
      reply: {
        isOk: false,
        failure: {
          message:
            "There's an issue with the selected model (claude-nonexistent-model). It may not exist or you may not have access to it. Run --model to pick a different model.",
          rawOutput: `${stdout}\n${BAD_MODEL_STDERR}`,
        },
      },
      isKnownOutput: true,
    });
  });

  it.each([
    ["not json", "Error: something broke"],
    ["not an object", "[1,2]"],
    ["missing is_error", '{"result":"hi"}'],
    ["a success without structured_output", '{"is_error":false,"result":"hi"}'],
    ["an error without result text", '{"is_error":true}'],
  ])("reports unknown output for %s", (description, stdout) => {
    expect(translateCliRun(buildRun({ stdout }))).toEqual({
      reply: { isOk: false, failure: { message: "unknown CLI output", rawOutput: stdout } },
      isKnownOutput: false,
    });
  });

  it("reports a timeout, even when some output arrived", () => {
    expect(translateCliRun(buildRun({ stdout: '{"is_e', hasTimedOut: true }))).toEqual({
      reply: { isOk: false, failure: { message: "claude -p timed out", rawOutput: '{"is_e' } },
      isKnownOutput: true,
    });
  });

  it("reports the process error when there is no output, e.g. binary not found", () => {
    const errorMessage = "spawn /Users/me/.local/bin/claude ENOENT";
    expect(translateCliRun(buildRun({ errorMessage }))).toEqual({
      reply: { isOk: false, failure: { message: errorMessage, rawOutput: "" } },
      isKnownOutput: true,
    });
  });
});

describe("translateHealthReply", () => {
  it("is healthy when the answer is ok", () => {
    expect(translateHealthReply({ isOk: true, answer: { ok: true } })).toEqual({ isHealthy: true });
  });

  it.each([{ ok: false }, { ok: "yes" }, "ok"])("is unhealthy when the answer is %j", (answer) => {
    expect(translateHealthReply({ isOk: true, answer })).toEqual({
      isHealthy: false,
      failure: { message: "health check answer was not ok", rawOutput: JSON.stringify(answer) },
    });
  });

  it("passes on the failure of a failed call", () => {
    const failure = { message: "claude -p timed out", rawOutput: "" };
    expect(translateHealthReply({ isOk: false, failure })).toEqual({ isHealthy: false, failure });
  });
});

function buildRun(overrides: Partial<CliRun>): CliRun {
  return { stdout: "", stderr: "", hasTimedOut: false, ...overrides };
}

function readFixture(name: string): string {
  return readFileSync(resolve(import.meta.dirname, "fixtures", name), "utf8");
}
