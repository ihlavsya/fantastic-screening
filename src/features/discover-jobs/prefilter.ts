import type { ListedJob } from "#shared/job.ts";

export type PrefilterVerdict = { hasPassed: true } | { hasPassed: false; rejectReason: string };

type WholeWordPattern = {
  word: string;
  pattern: RegExp;
};

const DROPPED_TITLE_WORDS = buildWholeWordPatterns(["Lead", "Architect", "Head of", "Principal", "CTO"]);
const DEALBREAKER_WORDS = buildWholeWordPatterns([
  "gambling",
  "betting",
  "casino",
  "iGaming",
  "slots",
  "sportsbook",
  "poker",
  "adult",
  "porn",
  "cam",
  "OnlyFans",
]);

export function prefilter({ title, description }: Pick<ListedJob, "title" | "description">): PrefilterVerdict {
  const droppedTitleWord = findWholeWord(title, DROPPED_TITLE_WORDS);
  if (droppedTitleWord !== undefined) return { hasPassed: false, rejectReason: `title has "${droppedTitleWord}"` };

  const dealbreaker = findWholeWord(`${title}\n${description}`, DEALBREAKER_WORDS);
  if (dealbreaker !== undefined) return { hasPassed: false, rejectReason: `dealbreaker "${dealbreaker}"` };

  return { hasPassed: true };
}

function findWholeWord(text: string, patterns: WholeWordPattern[]): string | undefined {
  return patterns.find(({ pattern }) => pattern.test(text))?.word;
}

function buildWholeWordPatterns(words: string[]): WholeWordPattern[] {
  return words.map((word) => ({ word, pattern: new RegExp(`\\b${word}\\b`, "i") }));
}
