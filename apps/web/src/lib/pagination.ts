export const DEFAULT_PAGE_SIZE = 25;

export function pageNumber(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw ?? "1");
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 10_000) : 1;
}
