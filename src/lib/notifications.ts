import "server-only";

import type { NotificationKind } from "@/generated/prisma/client";
import { getResourcePlan } from "@/lib/resource-planning";
import { startOfWeek } from "@/lib/resource-planning-policy";
import {
  leaveReviewScope,
  permissionKeysFor,
  resourcePlanningScopeFor,
  safeNotificationHref,
  timesheetApprovalScope,
  type PermissionBearingUser,
} from "@/lib/security-policy";
import { prisma } from "@/lib/prisma";

type NotificationWriter = Pick<typeof prisma, "notification">;

export type NotificationMessage = {
  organizationId: string;
  userIds: string[];
  kind: NotificationKind;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
  href: string;
  entityType?: string;
  entityId?: string;
  dedupeKey: string;
  resetUnread?: boolean;
};

export async function notifyUsers(client: NotificationWriter, message: NotificationMessage) {
  const userIds = [...new Set(message.userIds.filter(Boolean))];
  const href = safeNotificationHref(message.href);
  await Promise.all(userIds.map((userId) => client.notification.upsert({
    where: { userId_dedupeKey: { userId, dedupeKey: message.dedupeKey } },
    create: {
      organizationId: message.organizationId,
      userId,
      kind: message.kind,
      titleEn: message.titleEn,
      titleAr: message.titleAr,
      bodyEn: message.bodyEn,
      bodyAr: message.bodyAr,
      href,
      entityType: message.entityType,
      entityId: message.entityId,
      dedupeKey: message.dedupeKey,
    },
    update: {
      kind: message.kind,
      titleEn: message.titleEn,
      titleAr: message.titleAr,
      bodyEn: message.bodyEn,
      bodyAr: message.bodyAr,
      href,
      entityType: message.entityType,
      entityId: message.entityId,
      ...(message.resetUnread === false ? {} : { readAt: null, createdAt: new Date() }),
    },
  })));
}

async function usersWithAllPermissions(organizationId: string, permissionKeys: string[]) {
  const users = await prisma.user.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      roleAssignments: { some: { role: { permissions: { some: { permission: { key: { in: permissionKeys } } } } } } },
    },
    select: {
      id: true,
      roleAssignments: { select: { role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } } },
    },
  });
  return users
    .filter((user) => {
      const assigned = new Set(user.roleAssignments.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.key)));
      return permissionKeys.every((key) => assigned.has(key));
    })
    .map(({ id }) => id);
}

export async function timesheetReviewerIds(organizationId: string, timesheetId: string, submitterId: string) {
  const [projectRows, organizationApprovers] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { timesheetId, project: { organizationId } },
      distinct: ["projectId"],
      select: { project: { select: { primaryManagerId: true, deputyManagerId: true } } },
    }),
    usersWithAllPermissions(organizationId, ["timesheets.approve", "financials.write"]),
  ]);
  return [...new Set([
    ...projectRows.flatMap(({ project }) => [project.primaryManagerId, project.deputyManagerId].filter((id): id is string => Boolean(id))),
    ...organizationApprovers,
  ])].filter((id) => id !== submitterId);
}

export async function leaveReviewerIds(organizationId: string, employeeId: string) {
  const [projects, administrators] = await Promise.all([
    prisma.projectMember.findMany({
      where: { userId: employeeId, project: { organizationId, status: { not: "CANCELLED" } } },
      select: { project: { select: { primaryManagerId: true, deputyManagerId: true } } },
    }),
    usersWithAllPermissions(organizationId, ["employees.write"]),
  ]);
  return [...new Set([
    ...projects.flatMap(({ project }) => [project.primaryManagerId, project.deputyManagerId].filter((id): id is string => Boolean(id))),
    ...administrators,
  ])].filter((id) => id !== employeeId);
}

type OperationalUser = PermissionBearingUser & {
  id: string;
  organizationId: string;
  organization?: { weekStartsOn: number } | null;
};

const globalNotificationSync = globalThis as typeof globalThis & {
  bytechOperationalNotificationSync?: Map<string, number>;
};
const operationalNotificationSync = globalNotificationSync.bytechOperationalNotificationSync ?? new Map<string, number>();
if (process.env.NODE_ENV !== "production") {
  globalNotificationSync.bytechOperationalNotificationSync = operationalNotificationSync;
}

async function replaceOperationalKind(
  userId: string,
  kind: "TASK_OVERDUE" | "TASK_ESTIMATE_EXCEEDED",
  keys: string[],
) {
  await prisma.notification.deleteMany({
    where: {
      userId,
      kind,
      ...(keys.length ? { dedupeKey: { notIn: keys } } : {}),
    },
  });
}

export async function syncOperationalNotifications(user: OperationalUser) {
  const permissions = permissionKeysFor(user);
  const scope = resourcePlanningScopeFor(permissions);
  if (!scope) return;
  const now = new Date();
  const weekStart = startOfWeek(now, user.organization?.weekStartsOn ?? 0);
  const plan = await getResourcePlan({ organizationId: user.organizationId, actorId: user.id, scope, weekStart, now });
  if (!plan) return;

  const overdueTasks = plan.tasks.filter((task) => task.dueDate && task.dueDate < now && !["DONE", "CANCELLED"].includes(task.status));
  const overEstimateTasks = plan.tasks.filter(({ isOverEstimate }) => isOverEstimate);
  const overdueKeys = overdueTasks.map(({ id }) => `task.overdue:${id}`);
  const overEstimateKeys = overEstimateTasks.map(({ id }) => `task.over-estimate:${id}`);

  await Promise.all([
    ...overdueTasks.map((task) => notifyUsers(prisma, {
      organizationId: user.organizationId,
      userIds: [user.id],
      kind: "TASK_OVERDUE",
      titleEn: "Task is overdue",
      titleAr: "تاسك متأخرة",
      bodyEn: `${task.title} in ${task.project.name} is past its due date.`,
      bodyAr: `${task.title} في مشروع ${task.project.name} تجاوزت تاريخ التسليم.`,
      href: `/projects/${task.projectId}/tasks/${task.id}`,
      entityType: "Task",
      entityId: task.id,
      dedupeKey: `task.overdue:${task.id}`,
      resetUnread: false,
    })),
    ...overEstimateTasks.map((task) => notifyUsers(prisma, {
      organizationId: user.organizationId,
      userIds: [user.id],
      kind: "TASK_ESTIMATE_EXCEEDED",
      titleEn: "Task exceeded its estimate",
      titleAr: "تاسك تجاوزت التقدير",
      bodyEn: `${task.title} logged ${(task.actualMinutes / 60).toFixed(1)}h against ${(task.estimatedMinutes / 60).toFixed(1)}h estimated.`,
      bodyAr: `${task.title} سجلت ${(task.actualMinutes / 60).toFixed(1)} ساعة مقابل ${(task.estimatedMinutes / 60).toFixed(1)} ساعة مقدّرة.`,
      href: `/projects/${task.projectId}/tasks/${task.id}`,
      entityType: "Task",
      entityId: task.id,
      dedupeKey: `task.over-estimate:${task.id}`,
      resetUnread: false,
    })),
    replaceOperationalKind(user.id, "TASK_OVERDUE", overdueKeys),
    replaceOperationalKind(user.id, "TASK_ESTIMATE_EXCEEDED", overEstimateKeys),
  ]);

  const workloadKey = `workload.overload:${weekStart.toISOString().slice(0, 10)}`;
  if (plan.summary.overloadedEmployees) {
    await notifyUsers(prisma, {
      organizationId: user.organizationId,
      userIds: [user.id],
      kind: "WORKLOAD_OVERLOAD",
      titleEn: "Weekly workload needs attention",
      titleAr: "ضغط العمل الأسبوعي يحتاج متابعة",
      bodyEn: `${plan.summary.overloadedEmployees} employee(s) are planned above 110% capacity.`,
      bodyAr: `${plan.summary.overloadedEmployees} موظف/موظفين مخطط لهم بأكثر من 110% من السعة.`,
      href: "/resource-planning",
      entityType: "ResourcePlan",
      entityId: weekStart.toISOString().slice(0, 10),
      dedupeKey: workloadKey,
      resetUnread: false,
    });
  } else {
    await prisma.notification.deleteMany({ where: { userId: user.id, kind: "WORKLOAD_OVERLOAD", dedupeKey: workloadKey } });
  }

  const canApproveTimesheets = permissions.has("timesheets.approve");
  const canReviewLeave = canApproveTimesheets || permissions.has("employees.write");
  const [pendingTimesheets, pendingLeave] = await Promise.all([
    canApproveTimesheets
      ? prisma.timesheet.findMany({
          where: {
            status: "SUBMITTED",
            userId: { not: user.id },
            user: { organizationId: user.organizationId },
            ...timesheetApprovalScope(user.id, permissions.has("financials.write")),
          },
          select: { id: true, weekStart: true, user: { select: { name: true } } },
        })
      : Promise.resolve([]),
    canReviewLeave
      ? prisma.employeeLeave.findMany({
          where: {
            organizationId: user.organizationId,
            status: "SUBMITTED",
            userId: { not: user.id },
            ...leaveReviewScope(user.id, permissions.has("employees.write")),
          },
          select: { id: true, startDate: true, endDate: true, user: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);
  const timesheetKeys = pendingTimesheets.map(({ id }) => `timesheet.submitted:${id}`);
  const leaveKeys = pendingLeave.map(({ id }) => `leave.submitted:${id}`);
  await Promise.all([
    ...pendingTimesheets.map((timesheet) => notifyUsers(prisma, {
      organizationId: user.organizationId,
      userIds: [user.id],
      kind: "TIMESHEET_SUBMITTED",
      titleEn: "Timesheet waiting for approval",
      titleAr: "سجل ساعات بانتظار الموافقة",
      bodyEn: `${timesheet.user.name} submitted the week of ${timesheet.weekStart.toISOString().slice(0, 10)}.`,
      bodyAr: `${timesheet.user.name} أرسل سجل أسبوع ${timesheet.weekStart.toISOString().slice(0, 10)}.`,
      href: "/timesheets",
      entityType: "Timesheet",
      entityId: timesheet.id,
      dedupeKey: `timesheet.submitted:${timesheet.id}`,
      resetUnread: false,
    })),
    ...pendingLeave.map((leave) => notifyUsers(prisma, {
      organizationId: user.organizationId,
      userIds: [user.id],
      kind: "LEAVE_SUBMITTED",
      titleEn: "Leave request waiting for approval",
      titleAr: "طلب إجازة بانتظار الموافقة",
      bodyEn: `${leave.user.name} requested leave from ${leave.startDate.toISOString().slice(0, 10)} to ${leave.endDate.toISOString().slice(0, 10)}.`,
      bodyAr: `${leave.user.name} طلب إجازة من ${leave.startDate.toISOString().slice(0, 10)} إلى ${leave.endDate.toISOString().slice(0, 10)}.`,
      href: "/leave",
      entityType: "EmployeeLeave",
      entityId: leave.id,
      dedupeKey: `leave.submitted:${leave.id}`,
      resetUnread: false,
    })),
    prisma.notification.deleteMany({ where: { userId: user.id, kind: "TIMESHEET_SUBMITTED", ...(timesheetKeys.length ? { dedupeKey: { notIn: timesheetKeys } } : {}) } }),
    prisma.notification.deleteMany({ where: { userId: user.id, kind: "LEAVE_SUBMITTED", ...(leaveKeys.length ? { dedupeKey: { notIn: leaveKeys } } : {}) } }),
  ]);
}

export async function syncOperationalNotificationsIfDue(user: OperationalUser, intervalMs = 5 * 60_000) {
  const lastStartedAt = operationalNotificationSync.get(user.id) ?? 0;
  if (Date.now() - lastStartedAt < intervalMs) return;
  operationalNotificationSync.set(user.id, Date.now());
  try {
    await syncOperationalNotifications(user);
  } catch (error) {
    operationalNotificationSync.delete(user.id);
    throw error;
  }
}
