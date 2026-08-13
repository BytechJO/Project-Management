"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Locale } from "@/i18n/config";
import { isLocale } from "@/i18n/config";
import { actionErrorMessage, feedbackUrl } from "@/lib/action-feedback";
import { permissionKeysFor, requirePermission, requireUser } from "@/lib/dal";
import { notifyUsers } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { canViewAllProjectTasks, projectAccessLevelFor, projectAccessScope, taskAccessScope } from "@/lib/security-policy";

const taskStatuses = ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"] as const;
const taskPriorities = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

function localeFrom(formData: FormData) {
  const locale = String(formData.get("locale") ?? "en");
  if (!isLocale(locale)) throw new Error("Invalid locale.");
  return locale;
}

function requiredText(formData: FormData, key: string, maxLength = 240) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value || value.length > maxLength) throw new Error(`${key} is required.`);
  return value;
}

function optionalText(formData: FormData, key: string, maxLength = 1500) {
  const value = String(formData.get(key) ?? "").trim();
  if (value.length > maxLength) throw new Error(`Invalid ${key}.`);
  return value || null;
}

function optionalDate(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${key}.`);
  return date;
}

function hoursAsMinutes(formData: FormData, key: string) {
  const value = Number(formData.get(key) ?? 0);
  if (!Number.isFinite(value) || value < 0 || value > 10000) throw new Error(`Invalid ${key}.`);
  return Math.round(value * 60);
}

function idsFrom(formData: FormData, key: string) {
  return [...new Set(formData.getAll(key).map(String).map((value) => value.trim()).filter(Boolean))];
}

function taskDestination(locale: Locale, projectId: string, taskId: string) {
  return `/${locale}/projects/${projectId}/tasks/${taskId}`;
}

async function taskVisibleTo(locale: Locale, projectId: string, taskId: string) {
  const actor = await requirePermission(locale, "projects.read");
  const permissions = permissionKeysFor(actor);
  const projectAccessLevel = projectAccessLevelFor(permissions, Boolean(actor.clientContact));
  const canViewAllTasks = canViewAllProjectTasks(permissions);
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      projectId,
      ...taskAccessScope(actor.id, canViewAllTasks),
      project: {
        organizationId: actor.organizationId!,
        ...projectAccessScope(actor.id, projectAccessLevel, actor.clientContact?.clientId),
      },
    },
    include: { assignees: true },
  });
  if (!task) throw new Error("Task not found.");
  return { actor, permissions, task };
}

async function requireTaskManager(locale: Locale, projectId: string, taskId: string) {
  const actor = await requirePermission(locale, "tasks.write");
  const projectAccessLevel = projectAccessLevelFor(permissionKeysFor(actor), Boolean(actor.clientContact));
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      projectId,
      project: {
        organizationId: actor.organizationId!,
        ...projectAccessScope(actor.id, projectAccessLevel, actor.clientContact?.clientId),
      },
    },
    include: {
      assignees: { select: { userId: true } },
      project: { select: { name: true } },
    },
  });
  if (!task) throw new Error("Task not found.");
  return { actor, task };
}

function revalidateTask(locale: Locale, projectId: string, taskId: string) {
  revalidatePath(`/${locale}`);
  revalidatePath(`/${locale}/projects`);
  revalidatePath(`/${locale}/projects/${projectId}`);
  revalidatePath(taskDestination(locale, projectId, taskId));
  revalidatePath(`/${locale}/calendar`);
  revalidatePath(`/${locale}/resource-planning`);
  revalidatePath(`/${locale}/notifications`);
}

export async function updateTaskSchedule(formData: FormData) {
  const locale = localeFrom(formData);
  const projectId = requiredText(formData, "projectId");
  const taskId = requiredText(formData, "taskId");
  const week = String(formData.get("week") ?? "").trim();
  const destination = `/${locale}/resource-planning${/^\d{4}-\d{2}-\d{2}$/.test(week) ? `?week=${week}` : ""}`;

  try {
    const { actor, task } = await requireTaskManager(locale, projectId, taskId);
    const startDate = optionalDate(formData, "startDate");
    const dueDate = optionalDate(formData, "dueDate");
    const estimatedMinutes = hoursAsMinutes(formData, "estimatedHours");
    const remainingMinutes = hoursAsMinutes(formData, "remainingHours");
    if (startDate && dueDate && dueDate < startDate) {
      throw new Error("Due date must be on or after the start date.");
    }

    await prisma.$transaction([
      prisma.task.update({
        where: { id: task.id },
        data: { startDate, dueDate, estimatedMinutes, remainingMinutes },
      }),
      prisma.auditLog.create({
        data: {
          organizationId: actor.organizationId!,
          actorId: actor.id,
          action: "task.schedule_updated",
          entityType: "Task",
          entityId: task.id,
          before: {
            startDate: task.startDate?.toISOString() ?? null,
            dueDate: task.dueDate?.toISOString() ?? null,
            estimatedMinutes: task.estimatedMinutes,
            remainingMinutes: task.remainingMinutes,
          },
          after: {
            startDate: startDate?.toISOString() ?? null,
            dueDate: dueDate?.toISOString() ?? null,
            estimatedMinutes,
            remainingMinutes,
          },
        },
      }),
    ]);
    await notifyUsers(prisma, {
      organizationId: actor.organizationId!,
      userIds: task.assignees.map(({ userId }) => userId).filter((userId) => userId !== actor.id),
      kind: "TASK_UPDATED",
      titleEn: "Task schedule updated",
      titleAr: "تم تحديث جدول التاسك",
      bodyEn: `${task.title} in ${task.project.name} has a new schedule or estimate.`,
      bodyAr: `تم تحديث مواعيد أو تقدير ${task.title} في مشروع ${task.project.name}.`,
      href: `/projects/${projectId}/tasks/${task.id}`,
      entityType: "Task",
      entityId: task.id,
      dedupeKey: `task.updated:${task.id}`,
    });
    revalidateTask(locale, projectId, taskId);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Task schedule could not be updated.")));
  }

  redirect(feedbackUrl(destination, "success", "Task schedule updated."));
}

export async function updateTaskDetails(formData: FormData) {
  const locale = localeFrom(formData);
  const projectId = requiredText(formData, "projectId");
  const taskId = requiredText(formData, "taskId");
  const destination = taskDestination(locale, projectId, taskId);

  try {
    const { actor, task } = await requireTaskManager(locale, projectId, taskId);
    const title = requiredText(formData, "title");
    const priority = requiredText(formData, "priority");
    const status = requiredText(formData, "status");
    const startDate = optionalDate(formData, "startDate");
    const dueDate = optionalDate(formData, "dueDate");
    const estimatedMinutes = hoursAsMinutes(formData, "estimatedHours");
    const remainingMinutes = hoursAsMinutes(formData, "remainingHours");
    const assigneeIds = idsFrom(formData, "assigneeIds");

    if (!taskPriorities.includes(priority as (typeof taskPriorities)[number])) throw new Error("Invalid priority.");
    if (!taskStatuses.includes(status as (typeof taskStatuses)[number])) throw new Error("Invalid status.");
    if (startDate && dueDate && dueDate < startDate) throw new Error("Due date must be on or after the start date.");

    const projectMembers = assigneeIds.length
      ? await prisma.projectMember.count({ where: { projectId, userId: { in: assigneeIds } } })
      : 0;
    if (projectMembers !== assigneeIds.length) throw new Error("Every assignee must be a member of the project team.");

    await prisma.$transaction(async (transaction) => {
      await transaction.task.update({
        where: { id: taskId },
        data: {
          title,
          description: optionalText(formData, "description"),
          priority: priority as (typeof taskPriorities)[number],
          status: status as (typeof taskStatuses)[number],
          startDate,
          dueDate,
          estimatedMinutes,
          remainingMinutes: status === "DONE" ? 0 : remainingMinutes,
          completedAt: status === "DONE" ? new Date() : null,
          billable: formData.get("billable") === "on",
        },
      });
      await transaction.taskAssignee.deleteMany({ where: { taskId } });
      if (assigneeIds.length) {
        await transaction.taskAssignee.createMany({
          data: assigneeIds.map((userId, index) => ({ taskId, userId, isPrimary: index === 0 })),
        });
      }
      await transaction.auditLog.create({
        data: {
          organizationId: actor.organizationId!,
          actorId: actor.id,
          action: "task.updated",
          entityType: "Task",
          entityId: taskId,
          before: { title: task.title, status: task.status, priority: task.priority },
          after: { title, status, priority, assigneeIds },
        },
      });
    });
    const previousAssigneeIds = new Set(task.assignees.map(({ userId }) => userId));
    const newlyAssignedIds = assigneeIds.filter((userId) => !previousAssigneeIds.has(userId) && userId !== actor.id);
    const existingAssigneeIds = assigneeIds.filter((userId) => previousAssigneeIds.has(userId) && userId !== actor.id);
    await Promise.all([
      notifyUsers(prisma, {
        organizationId: actor.organizationId!,
        userIds: newlyAssignedIds,
        kind: "TASK_ASSIGNED",
        titleEn: "New task assigned to you",
        titleAr: "تم تعيين تاسك جديدة لك",
        bodyEn: `${title} was assigned to you in ${task.project.name}.`,
        bodyAr: `تم تعيين ${title} لك في مشروع ${task.project.name}.`,
        href: `/projects/${projectId}/tasks/${taskId}`,
        entityType: "Task",
        entityId: taskId,
        dedupeKey: `task.assigned:${taskId}`,
      }),
      notifyUsers(prisma, {
        organizationId: actor.organizationId!,
        userIds: existingAssigneeIds,
        kind: "TASK_UPDATED",
        titleEn: "Task details updated",
        titleAr: "تم تحديث تفاصيل التاسك",
        bodyEn: `${title} in ${task.project.name} was updated.`,
        bodyAr: `تم تحديث ${title} في مشروع ${task.project.name}.`,
        href: `/projects/${projectId}/tasks/${taskId}`,
        entityType: "Task",
        entityId: taskId,
        dedupeKey: `task.updated:${taskId}`,
      }),
    ]);
    revalidateTask(locale, projectId, taskId);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Task could not be updated.")));
  }

  redirect(feedbackUrl(destination, "success", "Task updated successfully."));
}

export async function updateTaskWorkflowStatus(formData: FormData) {
  const locale = localeFrom(formData);
  const projectId = requiredText(formData, "projectId");
  const taskId = requiredText(formData, "taskId");
  const destination = formData.get("context") === "detail"
    ? taskDestination(locale, projectId, taskId)
    : `/${locale}/projects/${projectId}`;

  try {
    const actor = await requireUser(locale);
    const permissions = permissionKeysFor(actor);
    const projectAccessLevel = projectAccessLevelFor(permissions, Boolean(actor.clientContact));
    const canViewAllTasks = canViewAllProjectTasks(permissions);
    const status = requiredText(formData, "status");
    if (!taskStatuses.includes(status as (typeof taskStatuses)[number])) throw new Error("Invalid task status.");

    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        projectId,
        ...taskAccessScope(actor.id, canViewAllTasks),
        project: {
          organizationId: actor.organizationId!,
          ...projectAccessScope(actor.id, projectAccessLevel, actor.clientContact?.clientId),
        },
      },
      include: { assignees: true, project: { select: { name: true } } },
    });
    if (!task) throw new Error("Task not found.");
    const assignedToActor = task.assignees.some((assignee) => assignee.userId === actor.id);
    if (!permissions.has("tasks.write") && !assignedToActor) {
      throw new Error("You must be assigned to this task to change its status.");
    }

    await prisma.$transaction([
      prisma.task.update({
        where: { id: taskId },
        data: {
          status: status as (typeof taskStatuses)[number],
          completedAt: status === "DONE" ? new Date() : null,
          remainingMinutes: status === "DONE" ? 0 : task.remainingMinutes,
        },
      }),
      prisma.auditLog.create({
        data: {
          organizationId: actor.organizationId!, actorId: actor.id,
          action: "task.status_updated", entityType: "Task", entityId: taskId,
          before: { status: task.status }, after: { status },
        },
      }),
    ]);
    await notifyUsers(prisma, {
      organizationId: actor.organizationId!,
      userIds: task.assignees.map(({ userId }) => userId).filter((userId) => userId !== actor.id),
      kind: "TASK_UPDATED",
      titleEn: "Task status updated",
      titleAr: "تم تحديث حالة التاسك",
      bodyEn: `${task.title} in ${task.project.name} is now ${status.replaceAll("_", " ").toLowerCase()}.`,
      bodyAr: `تم تحديث حالة ${task.title} في مشروع ${task.project.name}.`,
      href: `/projects/${projectId}/tasks/${taskId}`,
      entityType: "Task",
      entityId: taskId,
      dedupeKey: `task.updated:${taskId}`,
    });
    revalidateTask(locale, projectId, taskId);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Task status could not be updated.")));
  }

  redirect(feedbackUrl(destination, "success", "Task status updated."));
}

export async function createSubtask(formData: FormData) {
  const locale = localeFrom(formData);
  const projectId = requiredText(formData, "projectId");
  const parentId = requiredText(formData, "taskId");
  const destination = taskDestination(locale, projectId, parentId);

  try {
    const { actor, task: parentTask } = await requireTaskManager(locale, projectId, parentId);
    const title = requiredText(formData, "title");
    const assigneeId = String(formData.get("assigneeId") ?? "").trim() || null;
    if (assigneeId) {
      const member = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: assigneeId } } });
      if (!member) throw new Error("The assignee must be a member of the project team.");
    }

    const subtask = await prisma.task.create({
      data: {
        projectId,
        parentId,
        title,
        description: optionalText(formData, "description", 800),
        status: "TODO",
        priority: "MEDIUM",
        estimatedMinutes: hoursAsMinutes(formData, "estimatedHours"),
        remainingMinutes: hoursAsMinutes(formData, "estimatedHours"),
        dueDate: optionalDate(formData, "dueDate"),
        assignees: assigneeId ? { create: { userId: assigneeId, isPrimary: true } } : undefined,
      },
    });
    await prisma.auditLog.create({
      data: {
        organizationId: actor.organizationId!, actorId: actor.id,
        action: "task.subtask_created", entityType: "Task", entityId: parentId,
        after: { subtaskId: subtask.id, title, assigneeId },
      },
    });
    await notifyUsers(prisma, {
      organizationId: actor.organizationId!,
      userIds: assigneeId && assigneeId !== actor.id ? [assigneeId] : [],
      kind: "TASK_ASSIGNED",
      titleEn: "New subtask assigned to you",
      titleAr: "تم تعيين تاسك فرعية جديدة لك",
      bodyEn: `${title} was assigned to you in ${parentTask.project.name}.`,
      bodyAr: `تم تعيين ${title} لك في مشروع ${parentTask.project.name}.`,
      href: `/projects/${projectId}/tasks/${subtask.id}`,
      entityType: "Task",
      entityId: subtask.id,
      dedupeKey: `task.assigned:${subtask.id}`,
    });
    revalidateTask(locale, projectId, parentId);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Subtask could not be created.")));
  }

  redirect(feedbackUrl(destination, "success", "Subtask added."));
}

export async function addTaskComment(formData: FormData) {
  const locale = localeFrom(formData);
  const projectId = requiredText(formData, "projectId");
  const taskId = requiredText(formData, "taskId");
  const destination = taskDestination(locale, projectId, taskId);

  try {
    const { actor } = await taskVisibleTo(locale, projectId, taskId);
    const body = requiredText(formData, "body", 2000);
    const comment = await prisma.taskComment.create({ data: { taskId, authorId: actor.id, body } });
    await prisma.auditLog.create({
      data: {
        organizationId: actor.organizationId!, actorId: actor.id,
        action: "task.comment_added", entityType: "Task", entityId: taskId,
        after: { commentId: comment.id },
      },
    });
    revalidateTask(locale, projectId, taskId);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Comment could not be added.")));
  }

  redirect(feedbackUrl(destination, "success", "Comment added."));
}

export async function addTaskAttachment(formData: FormData) {
  const locale = localeFrom(formData);
  const projectId = requiredText(formData, "projectId");
  const taskId = requiredText(formData, "taskId");
  const destination = taskDestination(locale, projectId, taskId);

  try {
    const { actor } = await taskVisibleTo(locale, projectId, taskId);
    const name = requiredText(formData, "name", 160);
    const urlValue = requiredText(formData, "url", 1000);
    const url = new URL(urlValue);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Attachment URL must use HTTP or HTTPS.");

    const attachment = await prisma.taskAttachment.create({
      data: { taskId, uploadedById: actor.id, name, url: url.toString() },
    });
    await prisma.auditLog.create({
      data: {
        organizationId: actor.organizationId!, actorId: actor.id,
        action: "task.attachment_added", entityType: "Task", entityId: taskId,
        after: { attachmentId: attachment.id, name },
      },
    });
    revalidateTask(locale, projectId, taskId);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Attachment link could not be added.")));
  }

  redirect(feedbackUrl(destination, "success", "Attachment link added."));
}

export async function archiveTask(formData: FormData) {
  const locale = localeFrom(formData);
  const projectId = requiredText(formData, "projectId");
  const taskId = requiredText(formData, "taskId");
  const destination = taskDestination(locale, projectId, taskId);

  try {
    const { actor, task } = await requireTaskManager(locale, projectId, taskId);
    const activeTimer = await prisma.timeEntry.findFirst({
      where: { taskId, source: "TIMER", startedAt: { not: null }, endedAt: null },
      select: { id: true },
    });
    if (activeTimer) throw new Error("Task cannot be archived while a timer is running.");

    await prisma.$transaction([
      prisma.task.update({ where: { id: taskId }, data: { status: "CANCELLED", completedAt: null } }),
      prisma.auditLog.create({
        data: {
          organizationId: actor.organizationId!, actorId: actor.id,
          action: "task.archived", entityType: "Task", entityId: taskId,
          before: { status: task.status }, after: { status: "CANCELLED" },
        },
      }),
    ]);
    revalidateTask(locale, projectId, taskId);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Task could not be archived.")));
  }

  redirect(feedbackUrl(destination, "success", "Task archived."));
}
