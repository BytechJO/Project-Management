import "server-only";

import { prisma } from "@/lib/prisma";
import type { HoursReportScope } from "@/lib/security-policy";

export { hoursReportScopeFor } from "@/lib/security-policy";

export type HoursReportAccess = {
  organizationId: string;
  userId: string;
  scope: HoursReportScope;
  canViewCosts: boolean;
  canManageCalendar: boolean;
};

export type MonthlyHoursFilters = {
  month?: string | null;
  employeeId?: string | null;
  departmentId?: string | null;
};

type CostRate = {
  validFrom: Date;
  validTo: Date | null;
  hourlyCost: { toString(): string };
};

function numberValue(value: { toString(): string } | number | null | undefined) {
  return value == null ? 0 : Number(value.toString());
}

function rateForDate(rates: CostRate[], date: Date) {
  const matching = rates.find((rate) => rate.validFrom <= date && (!rate.validTo || rate.validTo >= date));
  return matching ? numberValue(matching.hourlyCost) : null;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dateInTimeZone(now: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
  } catch {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
}

function validMonth(value: string | null | undefined) {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  const [year, month] = value.split("-").map(Number);
  if (year < 2000 || year > 2100) return null;
  return { value, year, monthIndex: month - 1 };
}

export function parseHoursReportMonth(value: string | null | undefined, now = new Date()) {
  const parsed = validMonth(value);
  const year = parsed?.year ?? now.getUTCFullYear();
  const monthIndex = parsed?.monthIndex ?? now.getUTCMonth();
  const month = parsed?.value ?? `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  return {
    month,
    start: new Date(Date.UTC(year, monthIndex, 1)),
    end: new Date(Date.UTC(year, monthIndex + 1, 0)),
  };
}

function eachDate(start: Date, end: Date) {
  const dates: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function employeeIsActiveOnDate(
  date: Date,
  employee: { employmentStartDate: Date | null; employmentEndDate: Date | null },
) {
  return (!employee.employmentStartDate || employee.employmentStartDate <= date)
    && (!employee.employmentEndDate || employee.employmentEndDate >= date);
}

function entryBuckets(status: string, minutes: number) {
  if (["APPROVED", "LOCKED"].includes(status)) return { approved: minutes, pending: 0, rejected: 0 };
  if (status === "REJECTED") return { approved: 0, pending: 0, rejected: minutes };
  return { approved: 0, pending: minutes, rejected: 0 };
}

export async function getMonthlyHoursReport(access: HoursReportAccess, filters: MonthlyHoursFilters = {}) {
  const range = parseHoursReportMonth(filters.month);
  const managedProjectScope = {
    OR: [{ primaryManagerId: access.userId }, { deputyManagerId: access.userId }],
  };

  const organization = await prisma.organization.findUnique({
    where: { id: access.organizationId },
    select: {
      id: true,
      name: true,
      baseCurrency: true,
      timezone: true,
      workdayMinutes: true,
      workdays: true,
    },
  });
  if (!organization) return null;
  const today = dateInTimeZone(new Date(), organization.timezone);

  const employeeScope = access.scope === "all"
    ? {}
    : access.scope === "own"
      ? { id: access.userId }
      : {
          OR: [
            { id: access.userId },
            { projectMemberships: { some: { project: managedProjectScope } } },
            { timeEntries: { some: { project: managedProjectScope } } },
          ],
        };

  const employees = await prisma.user.findMany({
    where: {
      organizationId: access.organizationId,
      status: { not: "ARCHIVED" },
      ...employeeScope,
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      jobTitle: true,
      status: true,
      weeklyCapacityMinutes: true,
      employmentStartDate: true,
      employmentEndDate: true,
      department: { select: { id: true, name: true } },
      costRates: access.canViewCosts ? { orderBy: { validFrom: "asc" } } : false,
    },
    orderBy: [{ department: { name: "asc" } }, { name: "asc" }],
  });

  const permittedEmployeeIds = new Set(employees.map(({ id }) => id));
  const requestedEmployeeId = filters.employeeId && filters.employeeId !== "all" && permittedEmployeeIds.has(filters.employeeId)
    ? filters.employeeId
    : null;
  const selectedEmployees = requestedEmployeeId
    ? employees.filter(({ id }) => id === requestedEmployeeId)
    : employees;
  const selectedEmployeeIds = selectedEmployees.map(({ id }) => id);
  const viewingOwnEmployee = selectedEmployeeIds.length === 1 && selectedEmployeeIds[0] === access.userId;
  const hasFullEmployeeDayAccess = access.scope === "all" || access.scope === "own" || viewingOwnEmployee;

  const timeEntryProjectScope = access.scope === "managed" && !viewingOwnEmployee
    ? { project: managedProjectScope }
    : {};
  const leaveUserIds = hasFullEmployeeDayAccess ? selectedEmployeeIds : [];

  const [departments, timeEntries, holidays, leaves] = await Promise.all([
    prisma.department.findMany({
      where: {
        organizationId: access.organizationId,
        ...(access.scope === "managed" ? { employees: { some: employeeScope } } : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    selectedEmployeeIds.length
      ? prisma.timeEntry.findMany({
          where: {
            userId: { in: selectedEmployeeIds },
            workDate: { gte: range.start, lte: range.end },
            user: { organizationId: access.organizationId },
            ...timeEntryProjectScope,
          },
          select: {
            id: true,
            userId: true,
            workDate: true,
            durationMinutes: true,
            status: true,
            source: true,
            note: true,
            project: { select: { id: true, code: true, name: true } },
            task: { select: { id: true, title: true } },
          },
          orderBy: [{ workDate: "asc" }, { createdAt: "asc" }],
        })
      : Promise.resolve([]),
    prisma.organizationHoliday.findMany({
      where: { organizationId: access.organizationId, date: { gte: range.start, lte: range.end } },
      select: { id: true, name: true, date: true, isPaid: true },
      orderBy: { date: "asc" },
    }),
    leaveUserIds.length
      ? prisma.employeeLeave.findMany({
          where: {
            organizationId: access.organizationId,
            userId: { in: leaveUserIds },
            status: "APPROVED",
            startDate: { lte: range.end },
            endDate: { gte: range.start },
          },
          select: {
            id: true,
            userId: true,
            startDate: true,
            endDate: true,
            type: true,
            minutesPerWorkday: true,
            notes: true,
          },
          orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
        })
      : Promise.resolve([]),
  ]);

  const entriesByEmployee = new Map<string, typeof timeEntries>();
  for (const entry of timeEntries) {
    const existing = entriesByEmployee.get(entry.userId) ?? [];
    existing.push(entry);
    entriesByEmployee.set(entry.userId, existing);
  }
  const holidaysByDate = new Map(holidays.map((holiday) => [isoDate(holiday.date), holiday]));
  const leavesByEmployee = new Map<string, typeof leaves>();
  for (const leave of leaves) {
    const existing = leavesByEmployee.get(leave.userId) ?? [];
    existing.push(leave);
    leavesByEmployee.set(leave.userId, existing);
  }

  const projectMap = new Map<string, {
    id: string;
    code: string;
    name: string;
    approvedMinutes: number;
    pendingMinutes: number;
    rejectedMinutes: number;
    cost: number;
  }>();
  const taskMap = new Map<string, {
    id: string;
    title: string;
    projectId: string;
    projectName: string;
    approvedMinutes: number;
    pendingMinutes: number;
    rejectedMinutes: number;
    cost: number;
  }>();

  const employeeRows = selectedEmployees.map((employee) => {
    const employeeEntries = entriesByEmployee.get(employee.id) ?? [];
    const entriesByDate = new Map<string, typeof employeeEntries>();
    for (const entry of employeeEntries) {
      const key = isoDate(entry.workDate);
      const existing = entriesByDate.get(key) ?? [];
      existing.push(entry);
      entriesByDate.set(key, existing);
    }
    const employeeLeaves = leavesByEmployee.get(employee.id) ?? [];
    const dailyCapacity = Math.round(employee.weeklyCapacityMinutes / Math.max(organization.workdays.length, 1));
    let expectedMinutes: number | null = hasFullEmployeeDayAccess ? 0 : null;
    let expectedToDateMinutes: number | null = hasFullEmployeeDayAccess ? 0 : null;
    let leaveMinutes = 0;
    let holidayMinutes = 0;
    let approvedMinutes = 0;
    let pendingMinutes = 0;
    let rejectedMinutes = 0;
    let cost = 0;
    let missingRateMinutes = 0;
    let missingMinutes = 0;
    let overtimeMinutes = 0;

    const days = eachDate(range.start, range.end)
      .map((date) => {
        const key = isoDate(date);
        const dayEntries = entriesByDate.get(key) ?? [];
        const workday = organization.workdays.includes(date.getUTCDay()) && employeeIsActiveOnDate(date, employee);
        const holiday = workday ? holidaysByDate.get(key) : undefined;
        const dayLeaves = workday && !holiday
          ? employeeLeaves.filter((leave) => leave.startDate <= date && leave.endDate >= date)
          : [];
        const dayLeaveMinutes = hasFullEmployeeDayAccess
          ? Math.min(dayLeaves.reduce((total, leave) => total + (leave.minutesPerWorkday ?? dailyCapacity), 0), dailyCapacity)
          : 0;
        const dayExpected = hasFullEmployeeDayAccess && workday && !holiday
          ? Math.max(dailyCapacity - dayLeaveMinutes, 0)
          : hasFullEmployeeDayAccess ? 0 : null;
        let dayApproved = 0;
        let dayPending = 0;
        let dayRejected = 0;
        let dayCost = 0;
        for (const entry of dayEntries) {
          const bucket = entryBuckets(entry.status, entry.durationMinutes);
          dayApproved += bucket.approved;
          dayPending += bucket.pending;
          dayRejected += bucket.rejected;
          const rate = access.canViewCosts ? rateForDate(employee.costRates, entry.workDate) : null;
          if (access.canViewCosts && entry.status !== "REJECTED") {
            if (rate == null) missingRateMinutes += entry.durationMinutes;
            else dayCost += (entry.durationMinutes / 60) * rate;
          }

          const project = projectMap.get(entry.project.id) ?? {
            ...entry.project,
            approvedMinutes: 0,
            pendingMinutes: 0,
            rejectedMinutes: 0,
            cost: 0,
          };
          project.approvedMinutes += bucket.approved;
          project.pendingMinutes += bucket.pending;
          project.rejectedMinutes += bucket.rejected;
          if (entry.status !== "REJECTED" && rate != null) project.cost += (entry.durationMinutes / 60) * rate;
          projectMap.set(entry.project.id, project);

          const task = taskMap.get(entry.task.id) ?? {
            id: entry.task.id,
            title: entry.task.title,
            projectId: entry.project.id,
            projectName: entry.project.name,
            approvedMinutes: 0,
            pendingMinutes: 0,
            rejectedMinutes: 0,
            cost: 0,
          };
          task.approvedMinutes += bucket.approved;
          task.pendingMinutes += bucket.pending;
          task.rejectedMinutes += bucket.rejected;
          if (entry.status !== "REJECTED" && rate != null) task.cost += (entry.durationMinutes / 60) * rate;
          taskMap.set(entry.task.id, task);
        }

        const dayRecorded = dayApproved + dayPending;
        const isElapsed = date <= today;
        const dayMissing = dayExpected == null ? null : isElapsed ? Math.max(dayExpected - dayRecorded, 0) : 0;
        const dayOvertime = dayExpected == null ? null : Math.max(dayRecorded - dayExpected, 0);
        if (expectedMinutes != null && dayExpected != null) expectedMinutes += dayExpected;
        if (expectedToDateMinutes != null && dayExpected != null && isElapsed) expectedToDateMinutes += dayExpected;
        if (holiday && workday) holidayMinutes += dailyCapacity;
        leaveMinutes += dayLeaveMinutes;
        approvedMinutes += dayApproved;
        pendingMinutes += dayPending;
        rejectedMinutes += dayRejected;
        cost += dayCost;
        missingMinutes += dayMissing ?? 0;
        overtimeMinutes += dayOvertime ?? 0;

        return {
          date,
          isWorkday: workday,
          holiday: holiday ? { name: holiday.name, isPaid: holiday.isPaid } : null,
          leaves: dayLeaves.map((leave) => ({ id: leave.id, type: leave.type, notes: leave.notes })),
          expectedMinutes: dayExpected,
          approvedMinutes: dayApproved,
          pendingMinutes: dayPending,
          rejectedMinutes: dayRejected,
          recordedMinutes: dayRecorded,
          missingMinutes: dayMissing,
          overtimeMinutes: dayOvertime,
          cost: access.canViewCosts ? dayCost : null,
          entries: dayEntries.map((entry) => ({
            id: entry.id,
            project: entry.project,
            task: entry.task,
            durationMinutes: entry.durationMinutes,
            status: entry.status,
            source: entry.source,
            note: entry.note,
          })),
        };
      })
      .filter((day) => hasFullEmployeeDayAccess || day.entries.length > 0);

    const recordedMinutes = approvedMinutes + pendingMinutes;
    return {
      id: employee.id,
      name: employee.name,
      email: employee.email,
      jobTitle: employee.jobTitle,
      status: employee.status,
      department: employee.department,
      dailyCapacityMinutes: dailyCapacity,
      expectedMinutes,
      expectedToDateMinutes,
      holidayMinutes: hasFullEmployeeDayAccess ? holidayMinutes : null,
      leaveMinutes: hasFullEmployeeDayAccess ? leaveMinutes : null,
      approvedMinutes,
      pendingMinutes,
      rejectedMinutes,
      recordedMinutes,
      missingMinutes: expectedMinutes == null ? null : missingMinutes,
      overtimeMinutes: expectedMinutes == null ? null : overtimeMinutes,
      cost: access.canViewCosts ? cost : null,
      missingRateMinutes: access.canViewCosts ? missingRateMinutes : null,
      days,
    };
  });

  const nullableSum = (values: Array<number | null>) => values.some((value) => value == null)
    ? null
    : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const totals = {
    expectedMinutes: nullableSum(employeeRows.map((row) => row.expectedMinutes)),
    expectedToDateMinutes: nullableSum(employeeRows.map((row) => row.expectedToDateMinutes)),
    approvedMinutes: employeeRows.reduce((sum, row) => sum + row.approvedMinutes, 0),
    pendingMinutes: employeeRows.reduce((sum, row) => sum + row.pendingMinutes, 0),
    rejectedMinutes: employeeRows.reduce((sum, row) => sum + row.rejectedMinutes, 0),
    recordedMinutes: employeeRows.reduce((sum, row) => sum + row.recordedMinutes, 0),
    missingMinutes: nullableSum(employeeRows.map((row) => row.missingMinutes)),
    overtimeMinutes: nullableSum(employeeRows.map((row) => row.overtimeMinutes)),
    leaveMinutes: nullableSum(employeeRows.map((row) => row.leaveMinutes)),
    holidayMinutes: nullableSum(employeeRows.map((row) => row.holidayMinutes)),
    cost: access.canViewCosts ? employeeRows.reduce((sum, row) => sum + (row.cost ?? 0), 0) : null,
    missingRateMinutes: access.canViewCosts
      ? employeeRows.reduce((sum, row) => sum + (row.missingRateMinutes ?? 0), 0)
      : null,
  };

  return {
    organization,
    range,
    filters: {
      employeeId: requestedEmployeeId,
      departmentId: filters.departmentId && employees.some((employee) => employee.department?.id === filters.departmentId)
        ? filters.departmentId
        : null,
    },
    access: {
      scope: access.scope,
      canViewCosts: access.canViewCosts,
      canManageCalendar: access.canManageCalendar,
      hasFullEmployeeDayAccess,
    },
    employeeOptions: employees.map(({ id, name, department }) => ({ id, name, department })),
    departments,
    employees: employeeRows,
    projects: Array.from(projectMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    tasks: Array.from(taskMap.values()).sort((a, b) => a.projectName.localeCompare(b.projectName) || a.title.localeCompare(b.title)),
    holidays,
    leaves,
    totals,
  };
}

export type MonthlyHoursReport = NonNullable<Awaited<ReturnType<typeof getMonthlyHoursReport>>>;
