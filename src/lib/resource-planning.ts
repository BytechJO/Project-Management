import "server-only";

import { calculateWorkingLeaveMinutes, isoDate } from "@/lib/leave-policy";
import {
  effectiveRemainingMinutes,
  plannedTaskMinutesForWeek,
  workingDatesBetween,
} from "@/lib/resource-planning-policy";
import type { ResourcePlanningScope } from "@/lib/security-policy";
import { prisma } from "@/lib/prisma";

type PlanningTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  startDate: Date | null;
  dueDate: Date | null;
  estimatedMinutes: number;
  remainingMinutes: number;
  projectId: string;
  project: { name: string };
  assignees: Array<{ userId: string; user: { name: string } }>;
};

function employeeScope(userId: string, scope: ResourcePlanningScope) {
  if (scope === "all") return {};
  if (scope === "own") return { id: userId };
  return {
    OR: [
      { id: userId },
      {
        projectMemberships: {
          some: {
            project: {
              OR: [{ primaryManagerId: userId }, { deputyManagerId: userId }],
            },
          },
        },
      },
    ],
  };
}

function taskScope(userId: string, scope: ResourcePlanningScope) {
  if (scope === "all") return {};
  if (scope === "own") return { assignees: { some: { userId } } };
  return {
    project: {
      OR: [{ primaryManagerId: userId }, { deputyManagerId: userId }],
    },
  };
}

function taskDatesInWeek(options: {
  task: PlanningTask;
  weekStart: Date;
  weekEnd: Date;
  workdays: readonly number[];
  holidayDates: ReadonlySet<string>;
  now: Date;
}) {
  const { task, weekStart, weekEnd, workdays, holidayDates, now } = options;
  const lastDay = new Date(weekEnd);
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  const currentWeek = now >= weekStart && now < weekEnd;
  const weekWorkingDates = workingDatesBetween(weekStart, lastDay, workdays, holidayDates);
  if (currentWeek && task.dueDate && task.dueDate < weekStart) return weekWorkingDates;
  if (task.startDate && task.dueDate) {
    const rangeStart = task.startDate > weekStart ? task.startDate : weekStart;
    const rangeEnd = task.dueDate < lastDay ? task.dueDate : lastDay;
    return workingDatesBetween(rangeStart, rangeEnd, workdays, holidayDates);
  }
  if (task.dueDate && task.dueDate >= weekStart && task.dueDate < weekEnd) {
    const dueDate = task.dueDate;
    const dueWorkingDate = [...weekWorkingDates].reverse().find((date) => date <= dueDate);
    return dueWorkingDate ? [dueWorkingDate] : weekWorkingDates.slice(0, 1);
  }
  if (task.startDate && task.startDate >= weekStart && task.startDate < weekEnd) {
    const startDate = task.startDate;
    const startWorkingDate = weekWorkingDates.find((date) => date >= startDate);
    return startWorkingDate ? [startWorkingDate] : weekWorkingDates.slice(-1);
  }
  if (currentWeek && task.startDate && task.startDate < weekStart) return weekWorkingDates;
  return [];
}

export async function getResourcePlan(options: {
  organizationId: string;
  actorId: string;
  scope: ResourcePlanningScope;
  weekStart: Date;
  now?: Date;
}) {
  const now = options.now ?? new Date();
  const weekEnd = new Date(options.weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  const [organization, holidays, employees, tasks] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: options.organizationId },
      select: { workdays: true, workdayMinutes: true, weekStartsOn: true },
    }),
    prisma.organizationHoliday.findMany({
      where: { organizationId: options.organizationId, date: { gte: options.weekStart, lt: weekEnd } },
      select: { date: true },
    }),
    prisma.user.findMany({
      where: {
        organizationId: options.organizationId,
        status: "ACTIVE",
        clientContact: { is: null },
        ...employeeScope(options.actorId, options.scope),
      },
      select: {
        id: true,
        name: true,
        jobTitle: true,
        weeklyCapacityMinutes: true,
        employmentStartDate: true,
        employmentEndDate: true,
        department: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.task.findMany({
      where: {
        status: { not: "CANCELLED" },
        project: { organizationId: options.organizationId, status: { notIn: ["COMPLETED", "CANCELLED"] } },
        ...taskScope(options.actorId, options.scope),
      },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        startDate: true,
        dueDate: true,
        estimatedMinutes: true,
        remainingMinutes: true,
        projectId: true,
        project: { select: { name: true } },
        assignees: { select: { userId: true, user: { select: { name: true } } } },
      },
      orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
    }),
  ]);
  if (!organization) return null;

  const employeeIds = employees.map(({ id }) => id);
  const taskIds = tasks.map(({ id }) => id);
  const [leaves, weekTime, allTaskTime] = await Promise.all([
    employeeIds.length
      ? prisma.employeeLeave.findMany({
          where: {
            organizationId: options.organizationId,
            userId: { in: employeeIds },
            status: "APPROVED",
            startDate: { lt: weekEnd },
            endDate: { gte: options.weekStart },
          },
          select: { userId: true, startDate: true, endDate: true, minutesPerWorkday: true },
        })
      : Promise.resolve([]),
    employeeIds.length
      ? prisma.timeEntry.groupBy({
          by: ["userId"],
          where: { userId: { in: employeeIds }, workDate: { gte: options.weekStart, lt: weekEnd } },
          _sum: { durationMinutes: true },
        })
      : Promise.resolve([]),
    taskIds.length
      ? prisma.timeEntry.groupBy({
          by: ["taskId"],
          where: { taskId: { in: taskIds } },
          _sum: { durationMinutes: true },
        })
      : Promise.resolve([]),
  ]);

  const holidayDates = new Set(holidays.map(({ date }) => isoDate(date)));
  const actualByEmployee = new Map(weekTime.map((row) => [row.userId, row._sum.durationMinutes ?? 0]));
  const actualByTask = new Map(allTaskTime.map((row) => [row.taskId, row._sum.durationMinutes ?? 0]));
  const plannedByEmployee = new Map<string, number>();
  const dailyPlanned = new Map<string, number>();
  const taskRows = tasks.map((task) => {
    const actualMinutes = actualByTask.get(task.id) ?? 0;
    const remainingMinutes = effectiveRemainingMinutes(task.estimatedMinutes, task.remainingMinutes, actualMinutes);
    const plannedMinutes = plannedTaskMinutesForWeek({
      startDate: task.startDate,
      dueDate: task.dueDate,
      remainingMinutes,
      weekStart: options.weekStart,
      weekEnd,
      workdays: organization.workdays,
      holidayDates: new Set<string>(),
      now,
    });
    const visibleAssignees = task.assignees.filter(({ userId }) => employeeIds.includes(userId));
    const perAssigneeMinutes = visibleAssignees.length ? Math.round(plannedMinutes / visibleAssignees.length) : 0;
    for (const assignee of visibleAssignees) {
      plannedByEmployee.set(assignee.userId, (plannedByEmployee.get(assignee.userId) ?? 0) + perAssigneeMinutes);
    }
    const plannedDates = taskDatesInWeek({ task, weekStart: options.weekStart, weekEnd, workdays: organization.workdays, holidayDates, now });
    const perDateMinutes = plannedDates.length ? Math.round(plannedMinutes / plannedDates.length) : 0;
    for (const date of plannedDates) {
      dailyPlanned.set(isoDate(date), (dailyPlanned.get(isoDate(date)) ?? 0) + perDateMinutes);
    }
    return {
      ...task,
      remainingMinutes,
      plannedMinutes,
      perAssigneeMinutes,
      actualMinutes,
      varianceMinutes: task.estimatedMinutes - actualMinutes,
      isOverEstimate: task.estimatedMinutes > 0 && actualMinutes > task.estimatedMinutes,
      isUnscheduled: remainingMinutes > 0 && !["DONE", "CANCELLED"].includes(task.status) && !task.startDate && !task.dueDate,
    };
  });

  const lastDay = new Date(weekEnd);
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  const employeesRows = employees.map((employee) => {
    const dailyCapacity = Math.round(employee.weeklyCapacityMinutes / Math.max(organization.workdays.length, 1));
    const employmentStart = employee.employmentStartDate && employee.employmentStartDate > options.weekStart
      ? employee.employmentStartDate
      : options.weekStart;
    const employmentEnd = employee.employmentEndDate && employee.employmentEndDate < lastDay
      ? employee.employmentEndDate
      : lastDay;
    const availableWorkingDays = workingDatesBetween(employmentStart, employmentEnd, organization.workdays, holidayDates).length;
    const grossCapacityMinutes = availableWorkingDays * dailyCapacity;
    const leaveMinutes = leaves
      .filter(({ userId }) => userId === employee.id)
      .reduce((total, leave) => total + calculateWorkingLeaveMinutes({
        startDate: leave.startDate > options.weekStart ? leave.startDate : options.weekStart,
        endDate: leave.endDate < lastDay ? leave.endDate : lastDay,
        workdays: organization.workdays,
        dailyCapacityMinutes: dailyCapacity,
        minutesPerWorkday: leave.minutesPerWorkday,
        holidayDates,
      }), 0);
    const capacityMinutes = Math.max(grossCapacityMinutes - leaveMinutes, 0);
    const plannedMinutes = plannedByEmployee.get(employee.id) ?? 0;
    const actualMinutes = actualByEmployee.get(employee.id) ?? 0;
    const loadPercent = capacityMinutes > 0 ? (plannedMinutes / capacityMinutes) * 100 : plannedMinutes > 0 ? 999 : 0;
    const status = loadPercent > 110 ? "OVERLOADED" : loadPercent >= 80 ? "NEAR_CAPACITY" : "AVAILABLE";
    return { ...employee, grossCapacityMinutes, leaveMinutes, capacityMinutes, plannedMinutes, actualMinutes, loadPercent, status };
  });

  const totalCapacityMinutes = employeesRows.reduce((sum, row) => sum + row.capacityMinutes, 0);
  const totalPlannedMinutes = employeesRows.reduce((sum, row) => sum + row.plannedMinutes, 0);
  const totalActualMinutes = employeesRows.reduce((sum, row) => sum + row.actualMinutes, 0);
  return {
    weekStart: options.weekStart,
    weekEnd,
    employees: employeesRows,
    tasks: taskRows,
    dailyPlanned: [...dailyPlanned].map(([date, plannedMinutes]) => ({ date, plannedMinutes })),
    summary: {
      totalCapacityMinutes,
      totalPlannedMinutes,
      totalActualMinutes,
      plannedLoadPercent: totalCapacityMinutes > 0 ? (totalPlannedMinutes / totalCapacityMinutes) * 100 : 0,
      overloadedEmployees: employeesRows.filter(({ status }) => status === "OVERLOADED").length,
      availableEmployees: employeesRows.filter(({ status }) => status === "AVAILABLE").length,
      overEstimateTasks: taskRows.filter(({ isOverEstimate }) => isOverEstimate).length,
      unscheduledTasks: taskRows.filter(({ isUnscheduled }) => isUnscheduled).length,
    },
  };
}
