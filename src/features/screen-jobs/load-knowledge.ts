import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PROJECT_ROOT } from "#shared/config.ts";

export type Knowledge = {
  cv: string;
  fitRules: string;
  styleGuide: string;
};

const KNOWLEDGE_DIR = resolve(PROJECT_ROOT, "knowledge");

export async function loadKnowledge(): Promise<Knowledge> {
  const [cv, fitRules, styleGuide] = await Promise.all([
    readKnowledgeFile("cv.md"),
    readKnowledgeFile("fit-rules.md"),
    readKnowledgeFile("style-guide.md"),
  ]);
  return { cv, fitRules, styleGuide };
}

function readKnowledgeFile(fileName: string): Promise<string> {
  return readFile(resolve(KNOWLEDGE_DIR, fileName), "utf8");
}
