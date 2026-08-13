"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isLocale } from "@/i18n/config";
import { actionErrorMessage, feedbackUrl } from "@/lib/action-feedback";
import { requirePermission } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

function localeFrom(formData: FormData) {
  const locale = String(formData.get("locale") ?? "en");
  if (!isLocale(locale)) throw new Error("Invalid locale.");
  return locale;
}

function requiredText(formData: FormData, key: string, maxLength = 160) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value || value.length > maxLength) throw new Error(`${key} is required.`);
  return value;
}

function workDateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(`${values.year}-${values.month}-${values.day}T00:00:00.000Z`);
}

function weekStartFor(date: Date) {
  const start = new Date(date);
  start.setUTCDate(date.getUTCDate() - date.getUTCDay());
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

export async function startTaskTimer(formData: FormData) {
  const locale = localeFrom(formData);
  const projectId = requiredText(formData, "projectId");

  try {
    const actor = await requirePermission(locale, "time_entries.own");
    const taskId = requiredText(formData, "taskId");
    const now = new Date();
    const workDate = workDateInTimeZone(now, actor.organization?.timezone ?? "Asia/Amman");
    if (workDate.getUTCDay() > 4) throw new Error("Timers can only start on a Sunday-to-Thursday workday.");

    const [task, activeTimer] = await Promise.all([
      prisma.task.findFirst({
        where: {
          id: taskId,
          projectId,
          status: { notIn: ["DONE", "CANCELLED"] },
          project: { organizationId: actor.organizationId! },
          assignees: { some: { userId: actor.id } },
        },
        include: { project: true },
      }),
      prisma.timeEntry.findFirst({
        where: { userId: actor.id, source: "TIMER", startedAt: { not: null }, endedAt: null },
        include: { task: true, project: true },
      }),
    ]);
    if (!task) throw new Error("This task must be assigned to you before you can start its timer.");
    if (activeTimer) throw new Error(`A timer is already running for ${activeTimer.project.name} · ${activeTimer.task.title}.`);

    const weekStart = weekStartFor(workDate);
    const existingTimesheet = await prisma.timesheet.findUnique({
      where: { userId_weekStart: { userId: actor.id, weekStart } },
    });
    if (existingTimesheet && ["SUBMITTED", "PARTIALLY_APPROVED", "APPROVED", "LOCKED"].includes(existingTimesheet.status)) {
      throw new Error("This week's timesheet is already submitted and cannot accept a new timer.");
    }

    const timesheet = await prisma.timesheet.upsert({
      where: { userId_weekStart: { userId: actor.id, weekStart } },
      update: { status: "DRAFT", rejectionReason: null },
      create: { userId: actor.id, weekStart, status: "DRAFT" },
    });

    await prisma.$transaction([
      prisma.timeEntry.create({
        data: {
          projectId,
          taskId,
          userId: actor.id,
          timesheetId: timesheet.id,
          source: "TIMER",
          status: "DRAFT",
          startedAt: now,
          workDate,
          durationMinutes: 0,
          note: `Timer · ${task.title}`,
        },
      }),
      prisma.task.update({
        where: { id: taskId },
        data: { status: "IN_PROGRESS", completedAt: null },
      }),
      prisma.auditLog.create({
        data: {
          organizationId: actor.organizationId!,
          actorId: actor.id,
          action: "timer.started",
          entityType: "Task",
          entityId: taskId,
          after: { projectId, startedAt: now.toISOString() },
        },
      }),
    ]);
    revalidatePath(`/${locale}`);
    revalidatePath(`/${locale}/projects/${projectId}`);
    revalidatePath(`/${locale}/timesheets`);
  } catch (error) {
    redirect(feedbackUrl(`/${locale}/projects/${projectId}`, "error", actionErrorMessage(error, "Timer could not be started.")));
  }

  redirect(feedbackUrl(`/${locale}/projects/${projectId}`, "success", "Timer started. Your work is now being tracked."));
}

export async function stopTaskTimer(formData: FormData) {
  const locale = localeFrom(formData);
  const projectId = requiredText(formData, "projectId");
  const context = String(formData.get("context") ?? "project");
  const destination = context === "timesheets" ? `/${locale}/timesheets` : `/${locale}/projects/${projectId}`;

  try {
    const actor = await requirePermission(locale, "time_entries.own");
    const entryId = requiredText(formData, "entryId");
    const timer = await prisma.timeEntry.findFirst({
      where: {
        id: entryId,
        userId: actor.id,
        projectId,
        source: "TIMER",
        startedAt: { not: null },
        endedAt: null,
      },
      include: { task: true, timesheet: true },
    });
    if (!timer?.startedAt) throw new Error("Active timer not found.");
    if (timer.timesheet && ["SUBMITTED", "PARTIALLY_APPROVED", "APPROVED", "LOCKED"].includes(timer.timesheet.status)) {
      throw new Error("This timesheet is already submitted and the timer cannot be changed.");
    }

    const endedAt = new Date();
    const durationMinutes = Math.max(1, Math.round((endedAt.getTime() - timer.startedAt.getTime()) / 60000));
    await prisma.$transaction([
      prisma.timeEntry.update({
        where: { id: timer.id },
        data: { endedAt, durationMinutes, status: "DRAFT" },
      }),
      prisma.auditLog.create({
        data: {
          organizationId: actor.organizationId!,
          actorId: actor.id,
          action: "timer.stopped",
          entityType: "TimeEntry",
          entityId: timer.id,
          after: { taskId: timer.taskId, durationMinutes, endedAt: endedAt.toISOString() },
        },
      }),
    ]);
    revalidatePath(`/${locale}`);
    revalidatePath(`/${locale}/projects/${projectId}`);
    revalidatePath(`/${locale}/timesheets`);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Timer could not be stopped.")));
  }

  redirect(feedbackUrl(destination, "success", "Timer stopped and the tracked time was added to your timesheet."));
}
