import { loadConfig } from "#shared/config.ts";
import { connectToDatabase } from "#shared/db.ts";
import { logger } from "#shared/logger.ts";
import { createTelegram } from "#shared/telegram.ts";
import { discoverJobs } from "../features/discover-jobs/discover-jobs.ts";
import { djinniGateway } from "../features/discover-jobs/djinni/djinni-gateway.ts";
import { createDjinniSource } from "../features/discover-jobs/djinni/djinni-source.ts";
import { screenJobs } from "../features/screen-jobs/screen-jobs.ts";

await runTracker();

async function runTracker(): Promise<void> {
  try {
    await runOnePass();
    logger.info({ eventType: "tracker.pass_done" }, "tracker pass done");
  } catch (error) {
    logger.error({ eventType: "tracker.pass_failed", err: error }, "tracker pass failed");
    process.exitCode = 1;
  }
}

async function runOnePass(): Promise<void> {
  const config = loadConfig();
  const database = await connectToDatabase(config.secrets.mongoUri);
  try {
    await discoverJobs({
      sources: [createDjinniSource(djinniGateway)],
      jobs: database.jobs,
      settings: config.settings,
      now: new Date(),
    });
    await screenJobs({ jobs: database.jobs, telegram: createTelegram(config), now: new Date() });
  } finally {
    await database.close();
  }
}
