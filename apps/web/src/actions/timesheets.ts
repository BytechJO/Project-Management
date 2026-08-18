"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isLocale } from "@/i18n/config";
import { actionErrorMessage, feedbackUrl } from "@/lib/action-feedback";
import { permissionKeysFor, requirePermission } from "@/lib/dal";
import { notifyUsers, timesheetReviewerIds } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import {
  canLogTimeForTask,
  canViewAllProjectTasks,
  projectAccessLevelFor,
  projectAccessScope,
  taskAccessScope,
  timesheetApprovalScope,
} from "@/lib/security-policy";

function localeFrom(formData: FormData) {
  const locale = String(formData.get("locale") ?? "en");
  if (!isLocale(locale)) throw new Error("Invalid locale.");
  return locale;
}

function requiredText(formData: FormData, key: string, maxLength = 500) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value || value.length > maxLength) throw new Error(`${key} is required.`);
  return value;
}

function optionalText(formData: FormData, key: string, maxLength = 1000) {
  const value = String(formData.get(key) ?? "").trim();
  if (value.length > maxLength) throw new Error(`Invalid ${key}.`);
  return value || null;
}

function dateFromInput(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid work date.");
  return date;
}

function weekStartFor(date: Date) {
  const weekStart = new Date(date);
  weekStart.setUTCDate(date.getUTCDate() - date.getUTCDay());
  weekStart.setUTCHours(0, 0, 0, 0);
  return weekStart;
}

export async function createManualTimeEntry(formData: FormData) {
  const locale = localeFrom(formData);

  try {
    const actor = await requirePermission(locale, "time_entries.own");
    const taskId = requiredText(formData, "taskId");
    const workDate = dateFromInput(requiredText(formData, "workDate", 10));
    const durationHours = Number(formData.get("durationHours"));
    if (!Number.isFinite(durationHours) || durationHours < 0.25 || durationHours > 18) {
      throw new Error("Hours must be between 0.25 and 18.");
    }
    if (workDate.getUTCDay() > 4) {
      throw new Error("Work date must be between Sunday and Thursday.");
    }

    const permissions = permissionKeysFor(actor);
    const projectAccessLevel = projectAccessLevelFor(permissions, Boolean(actor.clientContact));
    const canViewAllTasks = canViewAllProjectTasks(permissions);
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        ...taskAccessScope(actor.id, canViewAllTasks),
        project: {
          organizationId: actor.organizationId!,
          ...projectAccessScope(actor.id, projectAccessLevel, actor.clientContact?.clientId),
        },
      },
      include: {
        assignees: { where: { userId: actor.id }, select: { userId: true } },
        project: { include: { members: { where: { userId: actor.id } } } },
      },
    });
    if (!task) throw new Error("Task not found.");

    const canManageProjects = canViewAllTasks;
    if (!canLogTimeForTask({
      canManageProjects,
      isProjectMember: task.project.members.length > 0,
      isTaskAssignee: task.assignees.length > 0,
    })) {
      throw new Error("You must be assigned to the task before logging time.");
    }

    const weekStart = weekStartFor(workDate);
    const existingTimesheet = await prisma.timesheet.findUnique({
      where: { userId_weekStart: { userId: actor.id, weekStart } },
    });
    if (existingTimesheet && ["SUBMITTED", "PARTIALLY_APPROVED", "APPROVED", "LOCKED"].includes(existingTimesheet.status)) {
      throw new Error("This timesheet is already submitted and cannot be changed.");
    }

    const timesheet = await prisma.timesheet.upsert({
      where: { userId_weekStart: { userId: actor.id, weekStart } },
      update: { status: "DRAFT", rejectionReason: null },
      create: { userId: actor.id, weekStart, status: "DRAFT" },
    });

    await prisma.timeEntry.create({
      data: {
        projectId: task.projectId,
        taskId,
        userId: actor.id,
        timesheetId: timesheet.id,
        source: "MANUAL",
        status: "DRAFT",
        workDate,
        durationMinutes: Math.round(durationHours * 60),
        note: optionalText(formData, "note"),
      },
    });
    revalidatePath(`/${locale}/timesheets`);
  } catch (error) {
    redirect(feedbackUrl(`/${locale}/timesheets`, "error", actionErrorMessage(error, "Hours could not be added.")));
  }

  redirect(feedbackUrl(`/${locale}/timesheets`, "success", "Hours added to your weekly timesheet."));
}

export async function submitTimesheet(formData: FormData) {
  const locale = localeFrom(formData);

  try {
    const actor = await requirePermission(locale, "time_entries.own");
    const timesheetId = requiredText(formData, "timesheetId");
    const timesheet = await prisma.timesheet.findFirst({
      where: { id: timesheetId, userId: actor.id },
      include: {
        _count: { select: { entries: true } },
        entries: {
          where: { source: "TIMER", startedAt: { not: null }, endedAt: null },
          select: { id: true },
        },
      },
    });
    if (!timesheet) throw new Error("Timesheet not found.");
    if (!timesheet._count.entries) throw new Error("Add at least one time entry before submitting.");
    if (timesheet.entries.length) throw new Error("Stop the active timer before submitting your timesheet.");
    if (!["DRAFT", "REJECTED"].includes(timesheet.status)) throw new Error("This timesheet cannot be submitted again.");

    const reviewerIds = await timesheetReviewerIds(actor.organizationId!, timesheetId, actor.id);
    await prisma.$transaction(async (transaction) => {
      await transaction.timesheet.update({
        where: { id: timesheetId },
        data: { status: "SUBMITTED", submittedAt: new Date(), rejectionReason: null },
      });
      await transaction.timeEntry.updateMany({
        where: { timesheetId },
        data: { status: "SUBMITTED", rejectionReason: null },
      });
      await notifyUsers(transaction, {
        organizationId: actor.organizationId!,
        userIds: reviewerIds,
        kind: "TIMESHEET_SUBMITTED",
        titleEn: "Timesheet waiting for approval",
        titleAr: "سجل ساعات بانتظار الموافقة",
        bodyEn: `${actor.name} submitted the week of ${timesheet.weekStart.toISOString().slice(0, 10)}.`,
        bodyAr: `${actor.name} أرسل سجل أسبوع ${timesheet.weekStart.toISOString().slice(0, 10)}.`,
        href: "/timesheets",
        entityType: "Timesheet",
        entityId: timesheetId,
        dedupeKey: `timesheet.submitted:${timesheetId}`,
      });
    });
    revalidatePath(`/${locale}/timesheets`);
    revalidatePath(`/${locale}/notifications`);
  } catch (error) {
    redirect(feedbackUrl(`/${locale}/timesheets`, "error", actionErrorMessage(error, "Timesheet could not be submitted.")));
  }

  redirect(feedbackUrl(`/${locale}/timesheets`, "success", "Timesheet submitted for approval."));
}

async function submittedTimesheet(
  actorOrganizationId: string,
  actorId: string,
  canApproveAll: boolean,
  timesheetId: string,
) {
  return prisma.timesheet.findFirst({
    where: {
      id: timesheetId,
      status: "SUBMITTED",
      userId: { not: actorId },
      user: { organizationId: actorOrganizationId },
      ...timesheetApprovalScope(actorId, canApproveAll),
    },
  });
}

export async function approveTimesheet(formData: FormData) {
  const locale = localeFrom(formData);

  try {
    const actor = await requirePermission(locale, "timesheets.approve");
    const timesheetId = requiredText(formData, "timesheetId");
    const canApproveAll = permissionKeysFor(actor).has("financials.write");
    const timesheet = await submittedTimesheet(actor.organizationId!, actor.id, canApproveAll, timesheetId);
    if (!timesheet) throw new Error("Submitted timesheet not found.");

    await prisma.$transaction(async (transaction) => {
      const updated = await transaction.timesheet.updateManyAndReturn({
        where: { id: timesheetId, status: "SUBMITTED" },
        data: { status: "APPROVED", approvedById: actor.id, approvedAt: new Date(), rejectionReason: null },
        select: { id: true },
      });
      if (updated.length !== 1) throw new Error("Timesheet is no longer waiting for approval.");
      await transaction.timeEntry.updateMany({
        where: { timesheetId, status: "SUBMITTED" },
        data: { status: "APPROVED", approvedById: actor.id, approvedAt: new Date(), rejectionReason: null },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: actor.organizationId!, actorId: actor.id,
          action: "timesheet.approved", entityType: "Timesheet", entityId: timesheetId,
        },
      });
      await transaction.notification.deleteMany({
        where: { organizationId: actor.organizationId!, kind: "TIMESHEET_SUBMITTED", entityId: timesheetId },
      });
      await notifyUsers(transaction, {
        organizationId: actor.organizationId!,
        userIds: [timesheet.userId],
        kind: "TIMESHEET_APPROVED",
        titleEn: "Timesheet approved",
        titleAr: "تمت الموافقة على سجل الساعات",
        bodyEn: `Your timesheet for the week of ${timesheet.weekStart.toISOString().slice(0, 10)} was approved.`,
        bodyAr: `تمت الموافقة على سجل ساعات أسبوع ${timesheet.weekStart.toISOString().slice(0, 10)}.`,
        href: "/timesheets",
        entityType: "Timesheet",
        entityId: timesheetId,
        dedupeKey: `timesheet.decision:${timesheetId}`,
      });
    });
    revalidatePath(`/${locale}/timesheets`);
    revalidatePath(`/${locale}/notifications`);
  } catch (error) {
    redirect(feedbackUrl(`/${locale}/timesheets`, "error", actionErrorMessage(error, "Timesheet could not be approved.")));
  }

  redirect(feedbackUrl(`/${locale}/timesheets`, "success", "Timesheet approved."));
}

export async function returnTimesheet(formData: FormData) {
  const locale = localeFrom(formData);

  try {
    const actor = await requirePermission(locale, "timesheets.approve");
    const timesheetId = requiredText(formData, "timesheetId");
    const reason = requiredText(formData, "reason", 500);
    const canApproveAll = permissionKeysFor(actor).has("financials.write");
    const timesheet = await submittedTimesheet(actor.organizationId!, actor.id, canApproveAll, timesheetId);
    if (!timesheet) throw new Error("Submitted timesheet not found.");

    await prisma.$transaction(async (transaction) => {
      const updated = await transaction.timesheet.updateManyAndReturn({
        where: { id: timesheetId, status: "SUBMITTED" },
        data: { status: "REJECTED", approvedById: actor.id, approvedAt: new Date(), rejectionReason: reason },
        select: { id: true },
      });
      if (updated.length !== 1) throw new Error("Timesheet is no longer waiting for approval.");
      await transaction.timeEntry.updateMany({
        where: { timesheetId, status: "SUBMITTED" },
        data: { status: "REJECTED", approvedById: actor.id, approvedAt: new Date(), rejectionReason: reason },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: actor.organizationId!, actorId: actor.id,
          action: "timesheet.returned", entityType: "Timesheet", entityId: timesheetId,
          after: { reason },
        },
      });
      await transaction.notification.deleteMany({
        where: { organizationId: actor.organizationId!, kind: "TIMESHEET_SUBMITTED", entityId: timesheetId },
      });
      await notifyUsers(transaction, {
        organizationId: actor.organizationId!,
        userIds: [timesheet.userId],
        kind: "TIMESHEET_REJECTED",
        titleEn: "Timesheet returned",
        titleAr: "تم إرجاع سجل الساعات",
        bodyEn: `Your timesheet for ${timesheet.weekStart.toISOString().slice(0, 10)} was returned: ${reason}`,
        bodyAr: `تم إرجاع سجل ساعات ${timesheet.weekStart.toISOString().slice(0, 10)}: ${reason}`,
        href: "/timesheets",
        entityType: "Timesheet",
        entityId: timesheetId,
        dedupeKey: `timesheet.decision:${timesheetId}`,
      });
    });
    revalidatePath(`/${locale}/timesheets`);
    revalidatePath(`/${locale}/notifications`);
  } catch (error) {
    redirect(feedbackUrl(`/${locale}/timesheets`, "error", actionErrorMessage(error, "Timesheet could not be returned.")));
  }

  redirect(feedbackUrl(`/${locale}/timesheets`, "success", "Timesheet returned to the employee."));
}

export async function approveVisibleTimesheets(formData: FormData) {
  const locale = localeFrom(formData);

  try {
    const actor = await requirePermission(locale, "timesheets.approve");
    const canApproveAll = permissionKeysFor(actor).has("financials.write");
    await prisma.$transaction(async (transaction) => {
      const timesheets = await transaction.timesheet.updateManyAndReturn({
        where: {
          status: "SUBMITTED",
          userId: { not: actor.id },
          user: { organizationId: actor.organizationId! },
          ...timesheetApprovalScope(actor.id, canApproveAll),
        },
        data: { status: "APPROVED", approvedById: actor.id, approvedAt: new Date(), rejectionReason: null },
        select: { id: true, userId: true, weekStart: true },
      });
      if (!timesheets.length) throw new Error("No submitted timesheets are available to approve.");
      const ids = timesheets.map(({ id }) => id);
      await transaction.timeEntry.updateMany({
        where: { timesheetId: { in: ids }, status: "SUBMITTED" },
        data: { status: "APPROVED", approvedById: actor.id, approvedAt: new Date(), rejectionReason: null },
      });
      await transaction.auditLog.createMany({
        data: ids.map((timesheetId) => ({
          organizationId: actor.organizationId!,
          actorId: actor.id,
          action: "timesheet.approved",
          entityType: "Timesheet",
          entityId: timesheetId,
        })),
      });
      await transaction.notification.deleteMany({
        where: { organizationId: actor.organizationId!, kind: "TIMESHEET_SUBMITTED", entityId: { in: ids } },
      });
      await Promise.all(timesheets.map((timesheet) => notifyUsers(transaction, {
        organizationId: actor.organizationId!,
        userIds: [timesheet.userId],
        kind: "TIMESHEET_APPROVED",
        titleEn: "Timesheet approved",
        titleAr: "تمت الموافقة على سجل الساعات",
        bodyEn: `Your timesheet for the week of ${timesheet.weekStart.toISOString().slice(0, 10)} was approved.`,
        bodyAr: `تمت الموافقة على سجل ساعات أسبوع ${timesheet.weekStart.toISOString().slice(0, 10)}.`,
        href: "/timesheets",
        entityType: "Timesheet",
        entityId: timesheet.id,
        dedupeKey: `timesheet.decision:${timesheet.id}`,
      })));
    });
    revalidatePath(`/${locale}/timesheets`);
    revalidatePath(`/${locale}/notifications`);
  } catch (error) {
    redirect(feedbackUrl(`/${locale}/timesheets`, "error", actionErrorMessage(error, "Timesheets could not be approved.")));
  }

  redirect(feedbackUrl(`/${locale}/timesheets`, "success", "Visible timesheets approved."));
}
