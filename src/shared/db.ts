import { type Collection, MongoClient } from "mongodb";
import type { Job } from "./job.ts";

export type Database = {
  jobs: Collection<Job>;
  close: () => Promise<void>;
};

const SERVER_SELECTION_TIMEOUT_MS = 5_000;

export async function connectToDatabase(mongoUri: string): Promise<Database> {
  const client = new MongoClient(mongoUri, {
    serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
    ignoreUndefined: true,
  });
  await client.connect();
  return {
    jobs: client.db().collection<Job>("jobs"),
    close: () => client.close(),
  };
}
