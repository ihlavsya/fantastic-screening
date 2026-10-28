import { XMLParser } from "fast-xml-parser";
import type { JobDetails, ListedJob, Salary, WorkFormat } from "#shared/job.ts";
import { checkIsRecord, checkIsString } from "#shared/type-guards.ts";

export type Feed = {
  categories: string[];
  jobs: FeedJob[];
};

export type FeedJob = Omit<ListedJob, "isEuRemote">;

type KnownWorkFormat = "remote" | "hybrid" | "office";

const SOURCE = "djinni";
const JOB_ID_IN_LINK = /\/jobs\/(\d+)-/;
const LEAST_STRICT_FIRST: KnownWorkFormat[] = ["remote", "hybrid", "office"];
const KNOWN_WORK_FORMATS = new Map<string, KnownWorkFormat>([
  ["Full Remote", "remote"],
  ["Remote", "remote"],
  ["Hybrid Remote", "hybrid"],
  ["Office Work", "office"],
  ["Office", "office"],
]);
const HTML_ENTITIES = new Map([
  ["nbsp", " "],
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

const xmlParser = new XMLParser({
  parseTagValue: false,
  isArray: (tagName) => tagName === "item" || tagName === "category",
});

export function translateFeed(xml: string): Feed {
  const document = readRecord(xmlParser.parse(xml) as unknown, "feed document");
  const rss = readRecord(document.rss, "rss");
  const channel = readRecord(rss.channel, "rss.channel");
  return {
    categories: readOptionalArray(channel, "category").filter(checkIsString),
    jobs: readOptionalArray(channel, "item").map(translateFeedItem),
  };
}

function translateFeedItem(value: unknown): FeedJob {
  const item = readRecord(value, "feed item");
  const link = readString(item, "link");
  return {
    source: SOURCE,
    sourceJobId: extractJobId(link),
    title: readString(item, "title"),
    link,
    description: htmlToText(readOptionalString(item, "description") ?? ""),
    category: readOptionalArray(item, "category").filter(checkIsString).find((name) => name !== "") ?? "",
    postedAt: readDate(item, "pubDate"),
  };
}

function extractJobId(link: string): string {
  const jobId = JOB_ID_IN_LINK.exec(link)?.[1];
  if (jobId === undefined) throw new Error(`No djinni job id in link "${link}"`);
  return jobId;
}

function htmlToText(html: string): string {
  const withLineBreaks = html.replace(/<br\s*\/?>|<\/(p|li|div|h\d)>/gi, "\n");
  const withoutTags = withLineBreaks.replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(withoutTags)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n\s*/g, "\n")
    .trim();
}

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.startsWith("#x")) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
    return HTML_ENTITIES.get(code) ?? entity;
  });
}

export function translateJobDetails(job: unknown): JobDetails {
  const jobRecord = readRecord(job, "job");
  return {
    company: readString(jobRecord, "company_name"),
    salary: translateSalary(jobRecord),
    city: readOptionalString(jobRecord, "location"),
    workFormat: translateWorkFormat(readOptionalString(jobRecord, "work_format")),
    applicants: readNumber(jobRecord, "applications_count"),
    yearsRequired: readOptionalNumber(jobRecord, "experience"),
  };
}

function translateSalary(job: Record<string, unknown>): Salary | undefined {
  const min = readPositiveNumber(job, "public_salary_min");
  const max = readPositiveNumber(job, "public_salary_max");
  if (min === undefined && max === undefined) return undefined;
  return { min, max };
}

function translateWorkFormat(raw: string | undefined): WorkFormat | undefined {
  if (raw === undefined) return undefined;
  const offered = raw
    .split(",")
    .map((part) => KNOWN_WORK_FORMATS.get(part.trim()))
    .filter((format) => format !== undefined);
  return LEAST_STRICT_FIRST.find((format) => offered.includes(format)) ?? raw;
}

function readRecord(value: unknown, what: string): Record<string, unknown> {
  if (!checkIsRecord(value)) throw new Error(`Expected ${what} to be an object`);
  return value;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (!checkIsString(value)) throw new Error(`Expected "${key}" to be a string`);
  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null || value === "") return undefined;
  return readString(record, key);
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number") throw new Error(`Expected "${key}" to be a number`);
  return value;
}

function readOptionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  if (record[key] === undefined || record[key] === null) return undefined;
  return readNumber(record, key);
}

function readPositiveNumber(record: Record<string, unknown>, key: string): number | undefined {
  if (record[key] === undefined || record[key] === null) return undefined;
  const value = readNumber(record, key);
  return value > 0 ? value : undefined;
}

function readDate(record: Record<string, unknown>, key: string): Date {
  const date = new Date(readString(record, key));
  if (Number.isNaN(date.getTime())) throw new Error(`Expected "${key}" to be a date`);
  return date;
}

function readOptionalArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}
