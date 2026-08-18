export function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function yearRange(year: number) {
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year, 11, 31)),
  };
}

export function eachUtcDate(startDate: Date, endDate: Date) {
  const dates: Date[] = [];
  const cursor = new Date(startDate);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor <= endDate) {
    dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function calculateWorkingLeaveMinutes(options: {
  startDate: Date;
  endDate: Date;
  workdays: number[];
  dailyCapacityMinutes: number;
  minutesPerWorkday: number | null;
  holidayDates: ReadonlySet<string>;
}) {
  const perDay = Math.min(options.minutesPerWorkday ?? options.dailyCapacityMinutes, options.dailyCapacityMinutes);
  if (perDay <= 0 || options.endDate < options.startDate) return 0;
  return eachUtcDate(options.startDate, options.endDate).reduce((total, date) => {
    if (!options.workdays.includes(date.getUTCDay()) || options.holidayDates.has(isoDate(date))) return total;
    return total + perDay;
  }, 0);
}
