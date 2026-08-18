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
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid date.");
  }
  return date;
}

function reportPath(locale: string) {
  return `/${locale}/reports/hours`;
}

function revalidateReports(locale: string) {
  revalidatePath(reportPath(locale));
  revalidatePath(`/${locale}/calendar`);
}

export async function createOrganizationHoliday(formData: FormData) {
  const locale = localeFrom(formData);
  const destination = reportPath(locale);

  try {
    const actor = await requirePermission(locale, "employees.write");
    const name = requiredText(formData, "name");
    const date = dateFromInput(requiredText(formData, "date", 10));
    const isPaid = formData.get("isPaid") === "on";

    const holiday = await prisma.organizationHoliday.create({
      data: {
        organizationId: actor.organizationId!,
        name,
        date,
        isPaid,
        createdById: actor.id,
      },
    });
    await prisma.auditLog.create({
      data: {
        organizationId: actor.organizationId!,
        actorId: actor.id,
        action: "organization_holiday.created",
        entityType: "OrganizationHoliday",
        entityId: holiday.id,
        after: { name, date: date.toISOString(), isPaid },
      },
    });
    revalidateReports(locale);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Holiday could not be added.")));
  }

  redirect(feedbackUrl(destination, "success", "Official holiday added successfully."));
}

export async function deleteOrganizationHoliday(formData: FormData) {
  const locale = localeFrom(formData);
  const destination = reportPath(locale);

  try {
    const actor = await requirePermission(locale, "employees.write");
    const holidayId = requiredText(formData, "holidayId", 128);
    await prisma.$transaction(async (transaction) => {
      const holiday = await transaction.organizationHoliday.findFirst({
        where: { id: holidayId, organizationId: actor.organizationId! },
      });
      if (!holiday) throw new Error("Holiday not found.");
      await transaction.auditLog.create({
        data: {
          organizationId: actor.organizationId!,
          actorId: actor.id,
          action: "organization_holiday.deleted",
          entityType: "OrganizationHoliday",
          entityId: holiday.id,
          before: { name: holiday.name, date: holiday.date.toISOString(), isPaid: holiday.isPaid },
        },
      });
      await transaction.organizationHoliday.delete({ where: { id: holiday.id } });
    });
    revalidateReports(locale);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Holiday could not be removed.")));
  }

  redirect(feedbackUrl(destination, "success", "Official holiday removed."));
}

export async function createEmployeeLeave(formData: FormData) {
  const locale = localeFrom(formData);
  const destination = reportPath(locale);

  try {
    const actor = await requirePermission(locale, "employees.write");
    const userId = requiredText(formData, "userId", 128);
    const startDate = dateFromInput(requiredText(formData, "startDate", 10));
    const endDate = dateFromInput(requiredText(formData, "endDate", 10));
    const type = requiredText(formData, "type", 20);
    const notes = optionalText(formData, "notes");
    const partialHoursText = String(formData.get("hoursPerWorkday") ?? "").trim();
    if (endDate < startDate) throw new Error("End date must be on or after the start date.");
    if (!["ANNUAL", "SICK", "UNPAID", "OTHER"].includes(type)) throw new Error("Invalid leave type.");

    const [employee, organization, overlap] = await Promise.all([
      prisma.user.findFirst({ where: { id: userId, organizationId: actor.organizationId!, status: { not: "ARCHIVED" } } }),
      prisma.organization.findUnique({ where: { id: actor.organizationId! }, select: { workdayMinutes: true } }),
      prisma.employeeLeave.findFirst({
        where: {
          organizationId: actor.organizationId!,
          userId,
          status: { in: ["SUBMITTED", "APPROVED"] },
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      }),
    ]);
    if (!employee || !organization) throw new Error("Employee not found.");
    if (overlap) throw new Error("Employee already has leave overlapping these dates.");

    let minutesPerWorkday: number | null = null;
    if (partialHoursText) {
      const hours = Number(partialHoursText);
      if (!Number.isFinite(hours) || hours <= 0 || hours * 60 > organization.workdayMinutes) {
        throw new Error(`Hours must be between 0.25 and ${organization.workdayMinutes / 60}.`);
      }
      minutesPerWorkday = Math.round(hours * 60);
      if (minutesPerWorkday < 15) throw new Error("Hours must be at least 0.25.");
    }

    const leave = await prisma.employeeLeave.create({
      data: {
        organizationId: actor.organizationId!,
        userId,
        startDate,
        endDate,
        type: type as "ANNUAL" | "SICK" | "UNPAID" | "OTHER",
        minutesPerWorkday,
        notes,
        status: "APPROVED",
        reviewedById: actor.id,
        reviewedAt: new Date(),
        createdById: actor.id,
      },
    });
    await prisma.auditLog.create({
      data: {
        organizationId: actor.organizationId!,
        actorId: actor.id,
        action: "employee_leave.created",
        entityType: "EmployeeLeave",
        entityId: leave.id,
        after: {
          userId,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          type,
          minutesPerWorkday,
        },
      },
    });
    revalidateReports(locale);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Employee leave could not be added.")));
  }

  redirect(feedbackUrl(destination, "success", "Employee leave added successfully."));
}

export async function deleteEmployeeLeave(formData: FormData) {
  const locale = localeFrom(formData);
  const destination = reportPath(locale);

  try {
    const actor = await requirePermission(locale, "employees.write");
    const leaveId = requiredText(formData, "leaveId", 128);
    await prisma.$transaction(async (transaction) => {
      const leave = await transaction.employeeLeave.findFirst({
        where: { id: leaveId, organizationId: actor.organizationId! },
      });
      if (!leave) throw new Error("Employee leave not found.");
      await transaction.auditLog.create({
        data: {
          organizationId: actor.organizationId!,
          actorId: actor.id,
          action: "employee_leave.deleted",
          entityType: "EmployeeLeave",
          entityId: leave.id,
          before: {
            userId: leave.userId,
            startDate: leave.startDate.toISOString(),
            endDate: leave.endDate.toISOString(),
            type: leave.type,
            minutesPerWorkday: leave.minutesPerWorkday,
          },
        },
      });
      await transaction.employeeLeave.delete({ where: { id: leave.id } });
    });
    revalidateReports(locale);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Employee leave could not be removed.")));
  }

  redirect(feedbackUrl(destination, "success", "Employee leave removed."));
}
