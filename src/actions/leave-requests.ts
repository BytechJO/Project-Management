"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isLocale } from "@/i18n/config";
import { actionErrorMessage, feedbackUrl } from "@/lib/action-feedback";
import { permissionKeysFor, requirePermission, requireUser } from "@/lib/dal";
import { getEmployeeLeaveSummary } from "@/lib/leave-management";
import { calculateWorkingLeaveMinutes, isoDate } from "@/lib/leave-policy";
import { leaveReviewerIds, notifyUsers } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { canReviewOwnedResource, leaveReviewScope } from "@/lib/security-policy";

function localeFrom(formData: FormData) {
  const locale = String(formData.get("locale") ?? "en");
  if (!isLocale(locale)) throw new Error("Invalid locale.");
  return locale;
}

function requiredText(formData: FormData, key: string, maxLength = 160) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value || value.length > maxLength) throw new Error(`Invalid ${key}.`);
  return value;
}

function optionalText(formData: FormData, key: string, maxLength = 500) {
  const value = String(formData.get(key) ?? "").trim();
  if (value.length > maxLength) throw new Error(`Invalid ${key}.`);
  return value || null;
}

function dateFromInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid date.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Invalid date.");
  return date;
}

function portalPath(locale: string) {
  return `/${locale}/leave`;
}

function revalidateLeavePaths(locale: string) {
  revalidatePath(portalPath(locale));
  revalidatePath(`/${locale}/reports/hours`);
  revalidatePath(`/${locale}/calendar`);
  revalidatePath(`/${locale}/notifications`);
}

function parseLeaveType(formData: FormData) {
  const type = requiredText(formData, "type", 20);
  if (!["ANNUAL", "SICK", "UNPAID", "OTHER"].includes(type)) throw new Error("Invalid leave type.");
  return type as "ANNUAL" | "SICK" | "UNPAID" | "OTHER";
}

function requestedMinutesPerWorkday(formData: FormData, maximumMinutes: number) {
  const text = String(formData.get("hoursPerWorkday") ?? "").trim();
  if (!text) return null;
  const hours = Number(text);
  const minutes = Math.round(hours * 60);
  if (!Number.isFinite(hours) || minutes < 15 || minutes > maximumMinutes) {
    throw new Error(`Hours must be between 0.25 and ${maximumMinutes / 60}.`);
  }
  return minutes;
}

async function leaveMinutes(options: {
  organizationId: string;
  userId: string;
  startDate: Date;
  endDate: Date;
  minutesPerWorkday: number | null;
}) {
  const [organization, employee, holidays] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: options.organizationId },
      select: { workdays: true },
    }),
    prisma.user.findFirst({
      where: { id: options.userId, organizationId: options.organizationId },
      select: { weeklyCapacityMinutes: true },
    }),
    prisma.organizationHoliday.findMany({
      where: {
        organizationId: options.organizationId,
        date: { gte: options.startDate, lte: options.endDate },
      },
      select: { date: true },
    }),
  ]);
  if (!organization || !employee) throw new Error("Employee not found.");
  const dailyCapacityMinutes = Math.round(employee.weeklyCapacityMinutes / Math.max(organization.workdays.length, 1));
  return calculateWorkingLeaveMinutes({
    startDate: options.startDate,
    endDate: options.endDate,
    workdays: organization.workdays,
    dailyCapacityMinutes,
    minutesPerWorkday: options.minutesPerWorkday,
    holidayDates: new Set(holidays.map(({ date }) => isoDate(date))),
  });
}

async function requireLeaveReviewer(locale: "en" | "ar") {
  const actor = await requireUser(locale);
  const permissions = permissionKeysFor(actor);
  if (!permissions.has("timesheets.approve") && !permissions.has("employees.write")) {
    throw new Error("You do not have permission to review leave requests.");
  }
  return { actor, canReviewAll: permissions.has("employees.write") };
}

export async function submitLeaveRequest(formData: FormData) {
  const locale = localeFrom(formData);
  const destination = portalPath(locale);

  try {
    const actor = await requirePermission(locale, "time_entries.own");
    const startDate = dateFromInput(requiredText(formData, "startDate", 10));
    const endDate = dateFromInput(requiredText(formData, "endDate", 10));
    const type = parseLeaveType(formData);
    const notes = optionalText(formData, "notes", 800);
    if (endDate < startDate) throw new Error("End date must be on or after the start date.");
    if (startDate.getUTCFullYear() !== endDate.getUTCFullYear()) {
      throw new Error("Leave requests must stay within one calendar year.");
    }

    const organization = await prisma.organization.findUnique({
      where: { id: actor.organizationId! },
      select: { workdays: true },
    });
    if (!organization) throw new Error("Organization not found.");
    const dailyCapacityMinutes = Math.round(actor.weeklyCapacityMinutes / Math.max(organization.workdays.length, 1));
    const minutesPerWorkday = requestedMinutesPerWorkday(formData, dailyCapacityMinutes);
    const overlap = await prisma.employeeLeave.findFirst({
      where: {
        organizationId: actor.organizationId!,
        userId: actor.id,
        status: { in: ["SUBMITTED", "APPROVED"] },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
    if (overlap) throw new Error("You already have a pending or approved leave overlapping these dates.");

    const requestedMinutes = await leaveMinutes({
      organizationId: actor.organizationId!,
      userId: actor.id,
      startDate,
      endDate,
      minutesPerWorkday,
    });
    if (requestedMinutes <= 0) throw new Error("Leave must include at least one working day.");

    if (type === "ANNUAL") {
      const summary = await getEmployeeLeaveSummary(actor.organizationId!, actor.id, startDate.getUTCFullYear());
      if (!summary?.configured) throw new Error("Annual leave balance is not configured for this year.");
      const available = summary.annualEntitlementMinutes - summary.annualApprovedMinutes - summary.annualPendingMinutes;
      if (requestedMinutes > available) throw new Error("Annual leave request exceeds the available balance.");
    }

    const reviewerIds = await leaveReviewerIds(actor.organizationId!, actor.id);
    await prisma.$transaction(async (transaction) => {
      const leave = await transaction.employeeLeave.create({
        data: {
          organizationId: actor.organizationId!,
          userId: actor.id,
          startDate,
          endDate,
          type,
          minutesPerWorkday,
          notes,
          status: "SUBMITTED",
          submittedAt: new Date(),
          createdById: actor.id,
        },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: actor.organizationId!,
          actorId: actor.id,
          action: "employee_leave.submitted",
          entityType: "EmployeeLeave",
          entityId: leave.id,
          after: { startDate: startDate.toISOString(), endDate: endDate.toISOString(), type, minutesPerWorkday, requestedMinutes },
        },
      });
      await notifyUsers(transaction, {
        organizationId: actor.organizationId!,
        userIds: reviewerIds,
        kind: "LEAVE_SUBMITTED",
        titleEn: "Leave request waiting for approval",
        titleAr: "طلب إجازة بانتظار الموافقة",
        bodyEn: `${actor.name} requested leave from ${isoDate(startDate)} to ${isoDate(endDate)}.`,
        bodyAr: `${actor.name} طلب إجازة من ${isoDate(startDate)} إلى ${isoDate(endDate)}.`,
        href: "/leave",
        entityType: "EmployeeLeave",
        entityId: leave.id,
        dedupeKey: `leave.submitted:${leave.id}`,
      });
    });
    revalidateLeavePaths(locale);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Leave request could not be submitted.")));
  }

  redirect(feedbackUrl(destination, "success", "Leave request submitted for approval."));
}

export async function cancelLeaveRequest(formData: FormData) {
  const locale = localeFrom(formData);
  const destination = portalPath(locale);

  try {
    const actor = await requirePermission(locale, "time_entries.own");
    const leaveId = requiredText(formData, "leaveId", 128);
    await prisma.$transaction(async (transaction) => {
      const leave = await transaction.employeeLeave.findFirst({
        where: { id: leaveId, organizationId: actor.organizationId!, userId: actor.id, status: "SUBMITTED" },
      });
      if (!leave) throw new Error("Submitted leave request not found.");
      const updated = await transaction.employeeLeave.updateMany({
        where: { id: leave.id, status: "SUBMITTED" },
        data: { status: "CANCELLED", reviewedAt: new Date() },
      });
      if (updated.count !== 1) throw new Error("Leave request was already reviewed.");
      await transaction.auditLog.create({
        data: {
          organizationId: actor.organizationId!,
          actorId: actor.id,
          action: "employee_leave.cancelled",
          entityType: "EmployeeLeave",
          entityId: leave.id,
          before: { status: leave.status },
          after: { status: "CANCELLED" },
        },
      });
      await transaction.notification.deleteMany({
        where: { organizationId: actor.organizationId!, kind: "LEAVE_SUBMITTED", entityId: leave.id },
      });
    });
    revalidateLeavePaths(locale);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Leave request could not be cancelled.")));
  }

  redirect(feedbackUrl(destination, "success", "Leave request cancelled."));
}

export async function approveLeaveRequest(formData: FormData) {
  const locale = localeFrom(formData);
  const destination = portalPath(locale);

  try {
    const { actor, canReviewAll } = await requireLeaveReviewer(locale);
    const leaveId = requiredText(formData, "leaveId", 128);
    const leave = await prisma.employeeLeave.findFirst({
      where: {
        id: leaveId,
        organizationId: actor.organizationId!,
        status: "SUBMITTED",
        userId: { not: actor.id },
        ...leaveReviewScope(actor.id, canReviewAll),
      },
    });
    if (!leave || !canReviewOwnedResource(actor.id, leave.userId)) throw new Error("Leave request is not available for your review.");

    if (leave.type === "ANNUAL") {
      const summary = await getEmployeeLeaveSummary(actor.organizationId!, leave.userId, leave.startDate.getUTCFullYear());
      if (!summary?.configured) throw new Error("Annual leave balance is not configured for this employee.");
      const requestedMinutes = await leaveMinutes({
        organizationId: actor.organizationId!, userId: leave.userId,
        startDate: leave.startDate, endDate: leave.endDate, minutesPerWorkday: leave.minutesPerWorkday,
      });
      if (requestedMinutes > summary.annualRemainingMinutes) throw new Error("Annual leave request exceeds the employee's remaining balance.");
    }

    await prisma.$transaction(async (transaction) => {
      const updated = await transaction.employeeLeave.updateMany({
        where: { id: leave.id, status: "SUBMITTED" },
        data: { status: "APPROVED", reviewedById: actor.id, reviewedAt: new Date(), rejectionReason: null },
      });
      if (updated.count !== 1) throw new Error("Leave request was already reviewed.");
      await transaction.auditLog.create({
        data: {
          organizationId: actor.organizationId!, actorId: actor.id,
          action: "employee_leave.approved", entityType: "EmployeeLeave", entityId: leave.id,
          before: { status: leave.status }, after: { status: "APPROVED", reviewedById: actor.id },
        },
      });
      await transaction.notification.deleteMany({
        where: { organizationId: actor.organizationId!, kind: "LEAVE_SUBMITTED", entityId: leave.id },
      });
      await notifyUsers(transaction, {
        organizationId: actor.organizationId!,
        userIds: [leave.userId],
        kind: "LEAVE_APPROVED",
        titleEn: "Leave request approved",
        titleAr: "تمت الموافقة على طلب الإجازة",
        bodyEn: `Your leave from ${isoDate(leave.startDate)} to ${isoDate(leave.endDate)} was approved.`,
        bodyAr: `تمت الموافقة على إجازتك من ${isoDate(leave.startDate)} إلى ${isoDate(leave.endDate)}.`,
        href: "/leave",
        entityType: "EmployeeLeave",
        entityId: leave.id,
        dedupeKey: `leave.decision:${leave.id}`,
      });
    });
    revalidateLeavePaths(locale);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Leave request could not be approved.")));
  }

  redirect(feedbackUrl(destination, "success", "Leave request approved."));
}

export async function rejectLeaveRequest(formData: FormData) {
  const locale = localeFrom(formData);
  const destination = portalPath(locale);

  try {
    const { actor, canReviewAll } = await requireLeaveReviewer(locale);
    const leaveId = requiredText(formData, "leaveId", 128);
    const reason = requiredText(formData, "reason", 500);
    const leave = await prisma.employeeLeave.findFirst({
      where: {
        id: leaveId,
        organizationId: actor.organizationId!,
        status: "SUBMITTED",
        userId: { not: actor.id },
        ...leaveReviewScope(actor.id, canReviewAll),
      },
    });
    if (!leave || !canReviewOwnedResource(actor.id, leave.userId)) throw new Error("Leave request is not available for your review.");

    await prisma.$transaction(async (transaction) => {
      const updated = await transaction.employeeLeave.updateMany({
        where: { id: leave.id, status: "SUBMITTED" },
        data: { status: "REJECTED", reviewedById: actor.id, reviewedAt: new Date(), rejectionReason: reason },
      });
      if (updated.count !== 1) throw new Error("Leave request was already reviewed.");
      await transaction.auditLog.create({
        data: {
          organizationId: actor.organizationId!, actorId: actor.id,
          action: "employee_leave.rejected", entityType: "EmployeeLeave", entityId: leave.id,
          before: { status: leave.status }, after: { status: "REJECTED", reviewedById: actor.id, reason },
        },
      });
      await transaction.notification.deleteMany({
        where: { organizationId: actor.organizationId!, kind: "LEAVE_SUBMITTED", entityId: leave.id },
      });
      await notifyUsers(transaction, {
        organizationId: actor.organizationId!,
        userIds: [leave.userId],
        kind: "LEAVE_REJECTED",
        titleEn: "Leave request rejected",
        titleAr: "تم رفض طلب الإجازة",
        bodyEn: `Your leave from ${isoDate(leave.startDate)} to ${isoDate(leave.endDate)} was rejected: ${reason}`,
        bodyAr: `تم رفض إجازتك من ${isoDate(leave.startDate)} إلى ${isoDate(leave.endDate)}: ${reason}`,
        href: "/leave",
        entityType: "EmployeeLeave",
        entityId: leave.id,
        dedupeKey: `leave.decision:${leave.id}`,
      });
    });
    revalidateLeavePaths(locale);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Leave request could not be rejected.")));
  }

  redirect(feedbackUrl(destination, "success", "Leave request rejected."));
}

export async function updateEmployeeLeaveBalance(formData: FormData) {
  const locale = localeFrom(formData);
  const destination = portalPath(locale);

  try {
    const actor = await requirePermission(locale, "employees.write");
    const userId = requiredText(formData, "userId", 128);
    const year = Number(requiredText(formData, "year", 4));
    if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new Error("Invalid leave balance year.");

    const [employee, organization, existing] = await Promise.all([
      prisma.user.findFirst({ where: { id: userId, organizationId: actor.organizationId!, status: { not: "ARCHIVED" } } }),
      prisma.organization.findUnique({ where: { id: actor.organizationId! }, select: { workdays: true } }),
      prisma.employeeLeaveBalance.findUnique({ where: { userId_year: { userId, year } } }),
    ]);
    if (!employee || !organization) throw new Error("Employee not found.");
    const dailyCapacityMinutes = Math.round(employee.weeklyCapacityMinutes / Math.max(organization.workdays.length, 1));
    const minutesFromDays = (key: string) => {
      const days = Number(formData.get(key) ?? 0);
      if (!Number.isFinite(days) || days < 0 || days > 365) throw new Error(`${key} must be between 0 and 365 days.`);
      return Math.round(days * dailyCapacityMinutes);
    };
    const data = {
      organizationId: actor.organizationId!,
      annualAllowanceMinutes: minutesFromDays("annualDays"),
      sickAllowanceMinutes: minutesFromDays("sickDays"),
      carriedOverAnnualMinutes: minutesFromDays("carriedOverDays"),
      updatedById: actor.id,
    };
    const balance = await prisma.employeeLeaveBalance.upsert({
      where: { userId_year: { userId, year } },
      update: data,
      create: { ...data, userId, year },
    });
    await prisma.auditLog.create({
      data: {
        organizationId: actor.organizationId!, actorId: actor.id,
        action: "employee_leave_balance.updated", entityType: "EmployeeLeaveBalance", entityId: balance.id,
        before: existing ? {
          annualAllowanceMinutes: existing.annualAllowanceMinutes,
          sickAllowanceMinutes: existing.sickAllowanceMinutes,
          carriedOverAnnualMinutes: existing.carriedOverAnnualMinutes,
        } : undefined,
        after: { userId, year, ...data },
      },
    });
    revalidateLeavePaths(locale);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Employee leave balance could not be saved.")));
  }

  redirect(feedbackUrl(destination, "success", "Employee leave balance saved."));
}
