export function parseProjectReportDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;

  const [year, month, day] = value.split("-").map(Number);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() + 1 === month
    && date.getUTCDate() === day
    ? date
    : null;
}

export function parseProjectReportRange(fromValue?: string | null, toValue?: string | null) {
  const from = parseProjectReportDate(fromValue);
  const to = parseProjectReportDate(toValue);
  const invalidDate = Boolean((fromValue && !from) || (toValue && !to));
  const invalidOrder = Boolean(from && to && from > to);

  return {
    from,
    to,
    invalidDate,
    invalidOrder,
    invalid: invalidDate || invalidOrder,
  };
}
