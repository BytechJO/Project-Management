import "server-only";

import { calculateWorkingLeaveMinutes, isoDate, yearRange } from "@/lib/leave-policy";
import { prisma } from "@/lib/prisma";

export async function getEmployeeLeaveSummary(organizationId: string, userId: string, year: number) {
  const range = yearRange(year);
  const [organization, employee, balance, holidays, leaves] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { workdays: true, workdayMinutes: true },
    }),
    prisma.user.findFirst({
      where: { id: userId, organizationId },
      select: { id: true, weeklyCapacityMinutes: true },
    }),
    prisma.employeeLeaveBalance.findUnique({
      where: { userId_year: { userId, year } },
    }),
    prisma.organizationHoliday.findMany({
      where: { organizationId, date: { gte: range.start, lte: range.end } },
      select: { date: true },
    }),
    prisma.employeeLeave.findMany({
      where: {
        organizationId,
        userId,
        status: { in: ["SUBMITTED", "APPROVED"] },
        startDate: { lte: range.end },
        endDate: { gte: range.start },
      },
      select: { id: true, type: true, status: true, startDate: true, endDate: true, minutesPerWorkday: true },
    }),
  ]);
  if (!organization || !employee) return null;

  const dailyCapacityMinutes = Math.round(employee.weeklyCapacityMinutes / Math.max(organization.workdays.length, 1));
  const holidayDates = new Set(holidays.map(({ date }) => isoDate(date)));
  const usage = {
    annualApprovedMinutes: 0,
    annualPendingMinutes: 0,
    sickApprovedMinutes: 0,
    sickPendingMinutes: 0,
  };

  for (const leave of leaves) {
    const minutes = calculateWorkingLeaveMinutes({
      startDate: leave.startDate < range.start ? range.start : leave.startDate,
      endDate: leave.endDate > range.end ? range.end : leave.endDate,
      workdays: organization.workdays,
      dailyCapacityMinutes,
      minutesPerWorkday: leave.minutesPerWorkday,
      holidayDates,
    });
    if (leave.type === "ANNUAL") {
      if (leave.status === "APPROVED") usage.annualApprovedMinutes += minutes;
      else usage.annualPendingMinutes += minutes;
    }
    if (leave.type === "SICK") {
      if (leave.status === "APPROVED") usage.sickApprovedMinutes += minutes;
      else usage.sickPendingMinutes += minutes;
    }
  }

  const annualEntitlementMinutes = (balance?.annualAllowanceMinutes ?? 0) + (balance?.carriedOverAnnualMinutes ?? 0);
  const sickEntitlementMinutes = balance?.sickAllowanceMinutes ?? 0;
  return {
    year,
    configured: Boolean(balance),
    dailyCapacityMinutes,
    annualAllowanceMinutes: balance?.annualAllowanceMinutes ?? 0,
    carriedOverAnnualMinutes: balance?.carriedOverAnnualMinutes ?? 0,
    annualEntitlementMinutes,
    annualApprovedMinutes: usage.annualApprovedMinutes,
    annualPendingMinutes: usage.annualPendingMinutes,
    annualRemainingMinutes: Math.max(annualEntitlementMinutes - usage.annualApprovedMinutes, 0),
    sickAllowanceMinutes: sickEntitlementMinutes,
    sickApprovedMinutes: usage.sickApprovedMinutes,
    sickPendingMinutes: usage.sickPendingMinutes,
    sickRemainingMinutes: Math.max(sickEntitlementMinutes - usage.sickApprovedMinutes, 0),
  };
}
