import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PROJECT_ROOT } from "#shared/config.ts";

export type Knowledge = {
  cv: string;
  fitRules: string;
};

const KNOWLEDGE_DIR = resolve(PROJECT_ROOT, "knowledge");

export async function loadKnowledge(): Promise<Knowledge> {
  const [cv, fitRules] = await Promise.all([readKnowledgeFile("cv.md"), readKnowledgeFile("fit-rules.md")]);
  return { cv, fitRules };
}

function readKnowledgeFile(fileName: string): Promise<string> {
  return readFile(resolve(KNOWLEDGE_DIR, fileName), "utf8");
}
