import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "#shared/logger.ts";
import type { JsonSchema, LanguageModel, ModelReply } from "../language-model.ts";
import { type CliRun, translateCliRun, translateHealthReply } from "./claude-cli-translation.ts";

export type ClaudeCliOptions = {
  model: string;
  oauthToken: string;
};

const CLAUDE_BINARY = join(homedir(), ".local/bin/claude");
const TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const HEALTH_PROMPT = "Reply with ok set to true.";
const HEALTH_SCHEMA: JsonSchema = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};

export function createClaudeCli(options: ClaudeCliOptions): LanguageModel {
  const ask = (prompt: string, answerSchema: JsonSchema): Promise<ModelReply> => askClaude(prompt, answerSchema, options);
  return {
    ask,
    checkHealth: async () => translateHealthReply(await ask(HEALTH_PROMPT, HEALTH_SCHEMA)),
  };
}

async function askClaude(prompt: string, answerSchema: JsonSchema, options: ClaudeCliOptions): Promise<ModelReply> {
  const workDir = await mkdtemp(join(tmpdir(), "claude-screen-"));
  try {
    const run = await runClaude(prompt, answerSchema, options, workDir);
    const { reply, isKnownOutput } = translateCliRun(run);
    if (!isKnownOutput) {
      logger.warn({ eventType: "claude.output_unknown", run }, "unknown claude -p output, add its shape");
    }
    return reply;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function runClaude(
  prompt: string,
  answerSchema: JsonSchema,
  { model, oauthToken }: ClaudeCliOptions,
  workDir: string,
): Promise<CliRun> {
  const args = [
    "-p",
    "--model",
    model,
    "--tools",
    "",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(answerSchema),
  ];
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_CODE_OAUTH_TOKEN: oauthToken };
  return new Promise((resolve) => {
    const child = execFile(
      CLAUDE_BINARY,
      args,
      { cwd: workDir, env, timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
      (error, stdout, stderr) => {
        resolve({ stdout, stderr, hasTimedOut: error?.killed === true, errorMessage: error?.message });
      },
    );
    child.stdin?.end(prompt);
  });
}
