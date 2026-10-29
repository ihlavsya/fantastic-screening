import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPlist } from "./install-launchd.ts";

const AGENT = {
  label: "local.job-tracker",
  nodePath: "/usr/local/bin/node",
  projectRoot: "/Users/me/Projects/auto-apply-for-positions/dist",
  logDir: "/Users/me/Projects/auto-apply-for-positions/logs",
  intervalSeconds: 900,
};

describe("buildPlist", () => {
  const plist = buildPlist(AGENT);

  it("is a plist macOS accepts", () => {
    const path = resolve(mkdtempSync(resolve(tmpdir(), "plist-")), "agent.plist");
    writeFileSync(path, plist);
    expect(() => execFileSync("plutil", ["-lint", path], { stdio: "pipe" })).not.toThrow();
  });

  it("runs the tracker with node from the snapshot", () => {
    expect(plist).toContain(
      "<array>\n    <string>/usr/local/bin/node</string>\n    <string>src/app/tracker.ts</string>\n  </array>",
    );
    expect(plist).toContain(
      "<key>WorkingDirectory</key>\n  <string>/Users/me/Projects/auto-apply-for-positions/dist</string>",
    );
  });

  it("repeats every interval and also runs once when loaded", () => {
    expect(plist).toContain("<key>StartInterval</key>\n  <integer>900</integer>");
    expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
  });

  it("writes stdout and stderr into the log folder, outside the snapshot", () => {
    expect(plist).toContain("<string>/Users/me/Projects/auto-apply-for-positions/logs/tracker.log</string>");
    expect(plist).toContain("<string>/Users/me/Projects/auto-apply-for-positions/logs/tracker.err.log</string>");
  });

  it("escapes xml in paths", () => {
    expect(buildPlist({ ...AGENT, projectRoot: "/Users/me/R&D" })).toContain("<string>/Users/me/R&amp;D</string>");
  });
});
