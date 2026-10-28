export function checkIsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function checkIsString(value: unknown): value is string {
  return typeof value === "string";
}
