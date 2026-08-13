import { eachUtcDate, isoDate } from "@/lib/leave-policy";

export function startOfWeek(date: Date, weekStartsOn = 0) {
  const start = new Date(date);
  const distance = (start.getUTCDay() - weekStartsOn + 7) % 7;
  start.setUTCDate(start.getUTCDate() - distance);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

export function weekFromInput(value: string | undefined, fallback: Date, weekStartsOn = 0) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return startOfWeek(fallback, weekStartsOn);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || isoDate(parsed) !== value) return startOfWeek(fallback, weekStartsOn);
  return startOfWeek(parsed, weekStartsOn);
}

export function workingDatesBetween(
  startDate: Date,
  endDate: Date,
  workdays: readonly number[],
  holidayDates: ReadonlySet<string>,
) {
  if (endDate < startDate) return [];
  return eachUtcDate(startDate, endDate).filter(
    (date) => workdays.includes(date.getUTCDay()) && !holidayDates.has(isoDate(date)),
  );
}

export function plannedTaskMinutesForWeek(options: {
  startDate: Date | null;
  dueDate: Date | null;
  remainingMinutes: number;
  weekStart: Date;
  weekEnd: Date;
  workdays: readonly number[];
  holidayDates: ReadonlySet<string>;
  now: Date;
}) {
  if (options.remainingMinutes <= 0) return 0;
  const weekLast = new Date(options.weekEnd);
  weekLast.setUTCDate(weekLast.getUTCDate() - 1);
  const currentWeek = options.now >= options.weekStart && options.now < options.weekEnd;

  if (currentWeek && options.dueDate && options.dueDate < options.weekStart) {
    return options.remainingMinutes;
  }

  if (options.startDate && options.dueDate) {
    const scheduleStart = options.startDate <= options.dueDate ? options.startDate : options.dueDate;
    const scheduleEnd = options.dueDate >= options.startDate ? options.dueDate : options.startDate;
    const allWorkingDates = workingDatesBetween(scheduleStart, scheduleEnd, options.workdays, options.holidayDates);
    const overlapStart = scheduleStart > options.weekStart ? scheduleStart : options.weekStart;
    const overlapEnd = scheduleEnd < weekLast ? scheduleEnd : weekLast;
    const weekWorkingDates = workingDatesBetween(overlapStart, overlapEnd, options.workdays, options.holidayDates);
    if (!weekWorkingDates.length) return 0;
    return allWorkingDates.length
      ? Math.round(options.remainingMinutes * (weekWorkingDates.length / allWorkingDates.length))
      : options.remainingMinutes;
  }

  if (options.dueDate) {
    return options.dueDate >= options.weekStart && options.dueDate < options.weekEnd
      ? options.remainingMinutes
      : 0;
  }

  if (options.startDate) {
    if (options.startDate >= options.weekStart && options.startDate < options.weekEnd) return options.remainingMinutes;
    if (currentWeek && options.startDate < options.weekStart) return options.remainingMinutes;
  }

  return 0;
}

export function effectiveRemainingMinutes(
  estimatedMinutes: number,
  configuredRemainingMinutes: number,
  actualMinutes: number,
) {
  return configuredRemainingMinutes === estimatedMinutes
    ? Math.max(estimatedMinutes - actualMinutes, 0)
    : Math.max(configuredRemainingMinutes, 0);
}
