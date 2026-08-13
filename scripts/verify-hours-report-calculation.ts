import "dotenv/config";

import assert from "node:assert/strict";

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { getMonthlyHoursReport } = await import("../src/lib/hours-report");
  let holidayId: string | null = null;
  let leaveId: string | null = null;

  try {
    const organization = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
    if (!organization) throw new Error("No organization is available for report verification.");
    const employee = await prisma.user.findFirst({
      where: { organizationId: organization.id, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
    });
    if (!employee) throw new Error("No employee is available for report verification.");

    const access = {
      organizationId: organization.id,
      userId: employee.id,
      scope: "own" as const,
      canViewCosts: false,
      canManageCalendar: false,
    };
    const baseline = await getMonthlyHoursReport(access);
    if (!baseline) throw new Error("Baseline report could not be loaded.");
    assert.equal(baseline.employees.length, 1);
    assert.equal(baseline.employees[0].id, employee.id);
    assert.equal(baseline.employees[0].cost, null);

    const eligibleDays = baseline.employees[0].days.filter((day) => day.isWorkday && !day.holiday && day.leaves.length === 0 && (day.expectedMinutes ?? 0) > 0);
    assert.ok(eligibleDays.length >= 2, "Two regular workdays are required for calculation verification.");
    const fullDay = eligibleDays[0];
    const partialDay = eligibleDays[1];

    const holiday = await prisma.organizationHoliday.create({
      data: {
        organizationId: organization.id,
        name: "Automated calculation verification",
        date: fullDay.date,
        isPaid: true,
        createdById: employee.id,
      },
    });
    holidayId = holiday.id;
    const withHoliday = await getMonthlyHoursReport(access, { month: baseline.range.month });
    assert.ok(withHoliday);
    assert.equal(
      withHoliday.totals.expectedMinutes,
      (baseline.totals.expectedMinutes ?? 0) - (fullDay.expectedMinutes ?? 0),
    );
    await prisma.organizationHoliday.delete({ where: { id: holiday.id } });
    holidayId = null;

    const leave = await prisma.employeeLeave.create({
      data: {
        organizationId: organization.id,
        userId: employee.id,
        startDate: partialDay.date,
        endDate: partialDay.date,
        type: "ANNUAL",
        minutesPerWorkday: 120,
        notes: "Automated calculation verification",
        createdById: employee.id,
      },
    });
    leaveId = leave.id;
    const withLeave = await getMonthlyHoursReport(access, { month: baseline.range.month });
    assert.ok(withLeave);
    assert.equal(withLeave.totals.expectedMinutes, (baseline.totals.expectedMinutes ?? 0) - 120);
    assert.equal(withLeave.totals.leaveMinutes, 120);
    await prisma.employeeLeave.delete({ where: { id: leave.id } });
    leaveId = null;

    console.log(JSON.stringify({
      employeeId: employee.id,
      baselineExpectedMinutes: baseline.totals.expectedMinutes,
      holidayDeductionMinutes: fullDay.expectedMinutes,
      partialLeaveDeductionMinutes: 120,
      ownScopeEmployeeCount: baseline.employees.length,
      costHidden: baseline.employees[0].cost === null,
    }));
  } finally {
    if (holidayId) await prisma.organizationHoliday.deleteMany({ where: { id: holidayId } });
    if (leaveId) await prisma.employeeLeave.deleteMany({ where: { id: leaveId } });
    await prisma.$disconnect();
  }
}

void main();
