import type { Job, Salary } from "#shared/job.ts";

const NOT_LISTED = "not listed";

export function describeJob({ title, category, isEuRemote, details, description }: Job): string {
  return [
    `Title: ${title}`,
    `Company: ${details?.company ?? NOT_LISTED}`,
    `Category: ${category}`,
    `EU-remote: ${isEuRemote ? "yes" : "no"}`,
    `Work format: ${details?.workFormat ?? NOT_LISTED}`,
    `City: ${details?.city ?? NOT_LISTED}`,
    `Salary: ${describeSalary(details?.salary)}`,
    `Years required: ${details?.yearsRequired === undefined ? NOT_LISTED : String(details.yearsRequired)}`,
    "Posting:",
    description,
  ].join("\n");
}

export function wrapInTag(tag: string, content: string): string {
  return `<${tag}>\n${content}\n</${tag}>`;
}

function describeSalary(salary: Salary | undefined): string {
  const min = salary?.min;
  const max = salary?.max;
  if (min !== undefined && max !== undefined) return min === max ? `$${String(min)}` : `$${String(min)}–${String(max)}`;
  if (min !== undefined) return `from $${String(min)}`;
  if (max !== undefined) return `up to $${String(max)}`;
  return NOT_LISTED;
}
