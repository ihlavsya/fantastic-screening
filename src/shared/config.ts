import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type Config = {
  settings: Settings;
  secrets: Secrets;
};

export type Settings = {
  languageModel: "claude-cli" | "anthropic-api";
  model: string;
  pollMinutes: number;
  quietHours: QuietHours;
  rejectedSummaryTime: string;
  lookbackHours: number;
  maxApplicants: number;
};

export type QuietHours = {
  from: string;
  to: string;
  tz: string;
};

export type Secrets = {
  telegramBotToken: string;
  telegramChatId: string;
  mongoUri: string;
  claudeCodeOauthToken: string;
};

export const PROJECT_ROOT = resolve(import.meta.dirname, "../..");

export function loadConfig(): Config {
  return { settings: loadSettings(), secrets: loadSecrets() };
}

function loadSettings(): Settings {
  const json = readFileSync(resolve(PROJECT_ROOT, "config/config.json"), "utf8");
  return JSON.parse(json) as Settings;
}

function loadSecrets(): Secrets {
  process.loadEnvFile(resolve(PROJECT_ROOT, "config/.env"));
  return {
    telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    telegramChatId: requireEnv("TELEGRAM_CHAT_ID"),
    mongoUri: requireEnv("MONGO_URI"),
    claudeCodeOauthToken: requireEnv("CLAUDE_CODE_OAUTH_TOKEN"),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`Missing ${name} in config/.env`);
  return value;
}
