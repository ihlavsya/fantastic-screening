import { type Collection, MongoClient } from "mongodb";
import type { Job } from "./job.ts";

export type Database = {
  jobs: Collection<Job>;
  state: Collection<ClaudeState>;
  close: () => Promise<void>;
};

export type ClaudeState = {
  _id: "claude";
  isFailing: boolean;
  since: Date;
};

const SERVER_SELECTION_TIMEOUT_MS = 5_000;

export async function connectToDatabase(mongoUri: string): Promise<Database> {
  const client = new MongoClient(mongoUri, {
    serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
    ignoreUndefined: true,
  });
  await client.connect();
  const db = client.db();
  return {
    jobs: db.collection<Job>("jobs"),
    state: db.collection<ClaudeState>("state"),
    close: () => client.close(),
  };
}
