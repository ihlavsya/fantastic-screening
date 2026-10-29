import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { loadConfig, PROJECT_ROOT } from "#shared/config.ts";
import { logger } from "#shared/logger.ts";

export type LaunchAgent = {
  label: string;
  nodePath: string;
  projectRoot: string;
  logDir: string;
  intervalSeconds: number;
};

const LABEL = "local.job-tracker";
const SECONDS_PER_MINUTE = 60;
const SNAPSHOT_DIR = resolve(PROJECT_ROOT, "dist");
const LOG_DIR = resolve(PROJECT_ROOT, "logs");
const SNAPSHOT_ENTRIES = ["package.json", "src", "node_modules", "knowledge", "config"];
const TEST_FILE_SUFFIX = ".test.ts";
const XML_ESCAPES = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
]);

if (import.meta.main) installLaunchd();

function installLaunchd(): void {
  const agent: LaunchAgent = {
    label: LABEL,
    nodePath: process.execPath,
    projectRoot: SNAPSHOT_DIR,
    logDir: LOG_DIR,
    intervalSeconds: loadConfig().settings.pollMinutes * SECONDS_PER_MINUTE,
  };
  const plistPath = resolve(homedir(), "Library/LaunchAgents", `${LABEL}.plist`);
  takeSnapshot();
  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(plistPath, buildPlist(agent));
  reloadAgent(plistPath);
  logger.info(
    { eventType: "launchd.installed", plistPath, snapshotDir: SNAPSHOT_DIR, intervalSeconds: agent.intervalSeconds },
    "launchd agent installed",
  );
}

function takeSnapshot(): void {
  rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  SNAPSHOT_ENTRIES.forEach((entry) => {
    cpSync(resolve(PROJECT_ROOT, entry), resolve(SNAPSHOT_DIR, entry), {
      recursive: true,
      verbatimSymlinks: true,
      filter: checkIsRuntimeFile,
    });
  });
}

function checkIsRuntimeFile(sourcePath: string): boolean {
  return !sourcePath.endsWith(TEST_FILE_SUFFIX);
}

export function buildPlist({ label, nodePath, projectRoot, logDir, intervalSeconds }: LaunchAgent): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>src/app/tracker.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(projectRoot)}</string>
  <key>StartInterval</key>
  <integer>${String(intervalSeconds)}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(resolve(logDir, "tracker.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(resolve(logDir, "tracker.err.log"))}</string>
</dict>
</plist>
`;
}

function reloadAgent(plistPath: string): void {
  const domain = `gui/${String(process.getuid?.())}`;
  try {
    execFileSync("launchctl", ["bootout", `${domain}/${LABEL}`], { stdio: "ignore" });
  } catch {
    logger.debug({ eventType: "launchd.not_loaded", label: LABEL }, "agent was not loaded yet");
  }
  execFileSync("launchctl", ["bootstrap", domain, plistPath]);
}

function escapeXml(text: string): string {
  return text.replace(/[&<>]/g, (char) => XML_ESCAPES.get(char) ?? char);
}
