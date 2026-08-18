import "server-only";

import { prisma } from "@/lib/prisma";

type CostRate = {
  validFrom: Date;
  validTo: Date | null;
  hourlyCost: { toString(): string };
};

function numberValue(value: { toString(): string } | number | null | undefined) {
  return value == null ? 0 : Number(value.toString());
}

export async function getOrganizationFinancialSummary(organizationId: string) {
  const totals = await prisma.project.aggregate({
    where: { organizationId, status: { not: "CANCELLED" } },
    _sum: { contractValue: true, plannedBudget: true },
  });
  const contractValue = numberValue(totals._sum.contractValue);
  const plannedBudget = numberValue(totals._sum.plannedBudget);
  const plannedProfit = contractValue - plannedBudget;
  return {
    contractValue,
    plannedBudget,
    plannedProfit,
    plannedMargin: contractValue > 0 ? (plannedProfit / contractValue) * 100 : 0,
  };
}

function rateForDate(rates: CostRate[], date: Date) {
  const matchingRate = rates.find((rate) =>
    rate.validFrom <= date && (!rate.validTo || rate.validTo >= date),
  );
  return matchingRate ? numberValue(matchingRate.hourlyCost) : null;
}

function monthlyEquivalent(amount: number, frequency: string) {
  if (frequency === "MONTHLY") return amount;
  if (frequency === "QUARTERLY") return amount / 3;
  if (frequency === "SEMI_ANNUAL") return amount / 6;
  if (frequency === "ANNUAL") return amount / 12;
  return 0;
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function laterDate(first: Date, second: Date) {
  return first > second ? first : second;
}

function earlierDate(first: Date, second: Date) {
  return first < second ? first : second;
}

function calendarMonths(start: Date, end: Date) {
  if (end < start) return 0;
  return ((end.getUTCFullYear() - start.getUTCFullYear()) * 12)
    + end.getUTCMonth() - start.getUTCMonth() + 1;
}

function subscriptionCostForPeriod(
  subscription: {
    amount: { toString(): string };
    frequency: string;
    startsOn: Date;
    endsOn: Date | null;
  },
  projectStart: Date,
  projectEnd: Date,
  allocationPercent: number,
) {
  const start = laterDate(projectStart, subscription.startsOn);
  const end = subscription.endsOn ? earlierDate(projectEnd, subscription.endsOn) : projectEnd;
  if (end < start) return 0;

  const amount = numberValue(subscription.amount) * (allocationPercent / 100);
  if (subscription.frequency === "ONE_TIME") {
    return subscription.startsOn >= start && subscription.startsOn <= end ? amount : 0;
  }
  return monthlyEquivalent(amount, subscription.frequency) * calendarMonths(start, end);
}

export async function getOrganizationFinancials(organizationId: string) {
  const today = startOfDay(new Date());
  const [projects, subscriptions, overheadExpenses] = await Promise.all([
    prisma.project.findMany({
      where: { organizationId, status: { not: "CANCELLED" } },
      include: {
        client: true,
        primaryManager: true,
        tasks: {
          where: { status: { not: "CANCELLED" } },
          include: {
            assignees: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    costRates: { orderBy: { validFrom: "desc" } },
                  },
                },
              },
            },
          },
        },
        timeEntries: {
          where: { status: { not: "REJECTED" } },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                costRates: { orderBy: { validFrom: "desc" } },
              },
            },
          },
        },
        expenses: { where: { status: { not: "REJECTED" } } },
        subscriptionAllocations: { include: { subscription: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.subscription.findMany({
      where: { organizationId, isActive: true },
      include: { allocations: true },
    }),
    prisma.expense.aggregate({
      where: {
        organizationId,
        projectId: null,
        subscriptionId: null,
        status: { in: ["APPROVED", "PAID"] },
      },
      _sum: { amount: true, taxAmount: true },
    }),
  ]);

  const projectRows = projects.map((project) => {
    const trackedMinutesByTask = new Map<string, number>();
    let approvedLaborCost = 0;
    let pendingLaborCost = 0;
    let approvedMinutes = 0;
    let pendingMinutes = 0;
    let missingRateMinutes = 0;

    for (const entry of project.timeEntries) {
      trackedMinutesByTask.set(entry.taskId, (trackedMinutesByTask.get(entry.taskId) ?? 0) + entry.durationMinutes);
      const rate = rateForDate(entry.user.costRates, entry.workDate);
      if (rate == null) {
        missingRateMinutes += entry.durationMinutes;
        continue;
      }
      const cost = (entry.durationMinutes / 60) * rate;
      if (["APPROVED", "LOCKED"].includes(entry.status)) {
        approvedLaborCost += cost;
        approvedMinutes += entry.durationMinutes;
      } else {
        pendingLaborCost += cost;
        pendingMinutes += entry.durationMinutes;
      }
    }

    let remainingLaborCost = 0;
    let remainingMinutes = 0;
    let unpricedRemainingMinutes = 0;
    for (const task of project.tasks) {
      if (task.status === "DONE") continue;
      const trackedMinutes = trackedMinutesByTask.get(task.id) ?? 0;
      const calculatedRemaining = Math.max(task.estimatedMinutes - trackedMinutes, 0);
      const taskRemaining = task.remainingMinutes === task.estimatedMinutes
        ? calculatedRemaining
        : task.remainingMinutes;
      if (taskRemaining <= 0) continue;

      remainingMinutes += taskRemaining;
      const currentRates = task.assignees
        .map((assignee) => rateForDate(assignee.user.costRates, today))
        .filter((rate): rate is number => rate != null);
      if (!currentRates.length) {
        unpricedRemainingMinutes += taskRemaining;
        continue;
      }
      const averageRate = currentRates.reduce((sum, rate) => sum + rate, 0) / currentRates.length;
      remainingLaborCost += (taskRemaining / 60) * averageRate;
    }

    let approvedExpenses = 0;
    let pendingExpenses = 0;
    for (const expense of project.expenses) {
      if (expense.subscriptionId) continue;
      const amount = numberValue(expense.amount) + numberValue(expense.taxAmount);
      if (["APPROVED", "PAID"].includes(expense.status)) approvedExpenses += amount;
      else pendingExpenses += amount;
    }

    const projectStart = project.startDate ?? today;
    const actualProjectEnd = project.completedAt
      ? earlierDate(project.completedAt, today)
      : today;
    const forecastProjectEnd = project.completedAt ?? project.targetDate ?? actualProjectEnd;
    let actualSubscriptions = 0;
    let forecastSubscriptions = 0;
    for (const allocation of project.subscriptionAllocations) {
      const percentage = numberValue(allocation.allocationPercent);
      if (actualProjectEnd >= projectStart) {
        actualSubscriptions += subscriptionCostForPeriod(
          allocation.subscription,
          projectStart,
          actualProjectEnd,
          percentage,
        );
      }
      const safeForecastEnd = forecastProjectEnd >= projectStart ? forecastProjectEnd : projectStart;
      forecastSubscriptions += subscriptionCostForPeriod(
        allocation.subscription,
        projectStart,
        safeForecastEnd,
        percentage,
      );
    }

    const contractValue = numberValue(project.contractValue);
    const plannedBudget = numberValue(project.plannedBudget);
    const actualCost = approvedLaborCost + approvedExpenses + actualSubscriptions;
    const committedCost = pendingLaborCost + pendingExpenses;
    const forecastLaborCost = approvedLaborCost + pendingLaborCost + remainingLaborCost;
    const forecastCost = forecastLaborCost + approvedExpenses + pendingExpenses + forecastSubscriptions;
    const forecastProfit = contractValue - forecastCost;
    const forecastMargin = contractValue > 0 ? (forecastProfit / contractValue) * 100 : 0;
    const actualProfit = contractValue - actualCost;
    const budgetRemaining = plannedBudget - actualCost;
    const budgetVariance = plannedBudget - forecastCost;
    const budgetUtilization = plannedBudget > 0 ? (actualCost / plannedBudget) * 100 : 0;

    return {
      project: {
        id: project.id,
        code: project.code,
        name: project.name,
        status: project.status,
        currency: project.currency,
        progressPercent: numberValue(project.progressPercent),
        plannedMinutes: project.plannedMinutes,
        targetMarginPercent: numberValue(project.targetMarginPercent),
        startDate: project.startDate,
        targetDate: project.targetDate,
        completedAt: project.completedAt,
        client: project.client,
        primaryManager: project.primaryManager,
      },
      contractValue,
      plannedBudget,
      approvedLaborCost,
      pendingLaborCost,
      remainingLaborCost,
      forecastLaborCost,
      approvedExpenses,
      pendingExpenses,
      actualSubscriptions,
      forecastSubscriptions,
      actualCost,
      committedCost,
      forecastCost,
      actualProfit,
      forecastProfit,
      forecastMargin,
      budgetRemaining,
      budgetVariance,
      budgetUtilization,
      approvedMinutes,
      pendingMinutes,
      remainingMinutes,
      missingRateMinutes,
      unpricedRemainingMinutes,
    };
  });

  const totals = projectRows.reduce((total, row) => ({
    contractValue: total.contractValue + row.contractValue,
    plannedBudget: total.plannedBudget + row.plannedBudget,
    actualCost: total.actualCost + row.actualCost,
    forecastCost: total.forecastCost + row.forecastCost,
    laborCost: total.laborCost + row.approvedLaborCost,
    expenseCost: total.expenseCost + row.approvedExpenses,
    subscriptionCost: total.subscriptionCost + row.actualSubscriptions,
    missingRateMinutes: total.missingRateMinutes + row.missingRateMinutes + row.unpricedRemainingMinutes,
  }), {
    contractValue: 0,
    plannedBudget: 0,
    actualCost: 0,
    forecastCost: 0,
    laborCost: 0,
    expenseCost: 0,
    subscriptionCost: 0,
    missingRateMinutes: 0,
  });

  const monthlySubscriptions = subscriptions.reduce(
    (sum, subscription) => sum + monthlyEquivalent(numberValue(subscription.amount), subscription.frequency),
    0,
  );
  const monthlyUnallocatedSubscriptions = subscriptions.reduce((sum, subscription) => {
    const projectAllocation = subscription.allocations
      .filter((allocation) => allocation.projectId)
      .reduce((allocated, allocation) => allocated + numberValue(allocation.allocationPercent), 0);
    const explicitOverhead = subscription.allocations
      .filter((allocation) => !allocation.projectId)
      .reduce((allocated, allocation) => allocated + numberValue(allocation.allocationPercent), 0);
    const overheadPercent = explicitOverhead || Math.max(100 - projectAllocation, 0);
    return sum + monthlyEquivalent(numberValue(subscription.amount), subscription.frequency) * (overheadPercent / 100);
  }, 0);

  const forecastProfit = totals.contractValue - totals.forecastCost;
  const forecastMargin = totals.contractValue > 0 ? (forecastProfit / totals.contractValue) * 100 : 0;

  return {
    rows: projectRows,
    totals: {
      ...totals,
      forecastProfit,
      forecastMargin,
      monthlySubscriptions,
      monthlyUnallocatedSubscriptions,
      approvedOverhead: numberValue(overheadExpenses._sum.amount) + numberValue(overheadExpenses._sum.taxAmount),
    },
  };
}

export type ProjectFinancialReportRange = {
  from?: Date | null;
  to?: Date | null;
};

function reportDateWhere(range: ProjectFinancialReportRange) {
  if (!range.from && !range.to) return undefined;
  return {
    ...(range.from ? { gte: range.from } : {}),
    ...(range.to ? { lte: range.to } : {}),
  };
}

export async function getProjectProfitabilityReport(
  organizationId: string,
  projectId: string,
  range: ProjectFinancialReportRange = {},
) {
  const [financials, project] = await Promise.all([
    getOrganizationFinancials(organizationId),
    prisma.project.findFirst({
      where: { id: projectId, organizationId, status: { not: "CANCELLED" } },
      include: {
        tasks: {
          where: { status: { not: "CANCELLED" } },
          select: {
            id: true,
            title: true,
            status: true,
            dueDate: true,
            estimatedMinutes: true,
            remainingMinutes: true,
          },
          orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "asc" }],
        },
        timeEntries: {
          where: {
            status: { not: "REJECTED" },
            ...(reportDateWhere(range) ? { workDate: reportDateWhere(range) } : {}),
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                jobTitle: true,
                costRates: { orderBy: { validFrom: "desc" } },
              },
            },
            task: { select: { id: true, title: true } },
          },
          orderBy: [{ workDate: "desc" }, { createdAt: "desc" }],
        },
        expenses: {
          where: {
            status: { not: "REJECTED" },
            subscriptionId: null,
            ...(reportDateWhere(range) ? { expenseDate: reportDateWhere(range) } : {}),
          },
          include: { submittedBy: { select: { id: true, name: true } } },
          orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
        },
        subscriptionAllocations: {
          include: { subscription: true },
          orderBy: { subscription: { name: "asc" } },
        },
        invoices: {
          include: { payments: { select: { amount: true, paymentDate: true } } },
          orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
        },
      },
    }),
  ]);

  const summary = financials.rows.find((row) => row.project.id === projectId);
  if (!summary || !project) return null;

  const employeeMap = new Map<string, {
    id: string;
    name: string;
    jobTitle: string | null;
    approvedMinutes: number;
    pendingMinutes: number;
    approvedCost: number;
    pendingCost: number;
    missingRateMinutes: number;
  }>();
  const taskActivity = new Map<string, {
    approvedMinutes: number;
    pendingMinutes: number;
    approvedCost: number;
    pendingCost: number;
    missingRateMinutes: number;
  }>();

  for (const entry of project.timeEntries) {
    const employee = employeeMap.get(entry.userId) ?? {
      id: entry.userId,
      name: entry.user.name,
      jobTitle: entry.user.jobTitle,
      approvedMinutes: 0,
      pendingMinutes: 0,
      approvedCost: 0,
      pendingCost: 0,
      missingRateMinutes: 0,
    };
    const task = taskActivity.get(entry.taskId) ?? {
      approvedMinutes: 0,
      pendingMinutes: 0,
      approvedCost: 0,
      pendingCost: 0,
      missingRateMinutes: 0,
    };
    const approved = ["APPROVED", "LOCKED"].includes(entry.status);
    const rate = rateForDate(entry.user.costRates, entry.workDate);
    const cost = rate == null ? 0 : (entry.durationMinutes / 60) * rate;

    if (approved) {
      employee.approvedMinutes += entry.durationMinutes;
      employee.approvedCost += cost;
      task.approvedMinutes += entry.durationMinutes;
      task.approvedCost += cost;
    } else {
      employee.pendingMinutes += entry.durationMinutes;
      employee.pendingCost += cost;
      task.pendingMinutes += entry.durationMinutes;
      task.pendingCost += cost;
    }
    if (rate == null) {
      employee.missingRateMinutes += entry.durationMinutes;
      task.missingRateMinutes += entry.durationMinutes;
    }
    employeeMap.set(entry.userId, employee);
    taskActivity.set(entry.taskId, task);
  }

  const employees = [...employeeMap.values()]
    .map((employee) => {
      const totalMinutes = employee.approvedMinutes + employee.pendingMinutes;
      const totalCost = employee.approvedCost + employee.pendingCost;
      return {
        ...employee,
        totalMinutes,
        totalCost,
        averageHourlyCost: totalMinutes > employee.missingRateMinutes
          ? totalCost / ((totalMinutes - employee.missingRateMinutes) / 60)
          : 0,
      };
    })
    .sort((first, second) => second.totalCost - first.totalCost || first.name.localeCompare(second.name));

  const tasks = project.tasks.map((task) => {
    const activity = taskActivity.get(task.id) ?? {
      approvedMinutes: 0,
      pendingMinutes: 0,
      approvedCost: 0,
      pendingCost: 0,
      missingRateMinutes: 0,
    };
    const trackedMinutes = activity.approvedMinutes + activity.pendingMinutes;
    return {
      ...task,
      ...activity,
      trackedMinutes,
      totalLaborCost: activity.approvedCost + activity.pendingCost,
      hoursVariance: task.estimatedMinutes - trackedMinutes,
    };
  });

  let approvedExpenseCost = 0;
  let pendingExpenseCost = 0;
  const expenses = project.expenses.map((expense) => {
    const total = numberValue(expense.amount) + numberValue(expense.taxAmount);
    if (["APPROVED", "PAID"].includes(expense.status)) approvedExpenseCost += total;
    else pendingExpenseCost += total;
    return {
      id: expense.id,
      vendor: expense.vendor,
      category: expense.category,
      description: expense.description,
      expenseDate: expense.expenseDate,
      status: expense.status,
      amount: numberValue(expense.amount),
      taxAmount: numberValue(expense.taxAmount),
      total,
      submittedBy: expense.submittedBy,
    };
  });

  const today = startOfDay(new Date());
  const projectStart = project.startDate ?? project.createdAt;
  const actualProjectEnd = project.completedAt ? earlierDate(project.completedAt, today) : today;
  const forecastProjectEnd = project.completedAt ?? project.targetDate ?? actualProjectEnd;
  const periodStart = range.from ? laterDate(projectStart, range.from) : projectStart;
  const periodEndCandidate = range.to ? earlierDate(actualProjectEnd, range.to) : actualProjectEnd;

  let periodSubscriptionCost = 0;
  const subscriptions = project.subscriptionAllocations.map((allocation) => {
    const allocationPercent = numberValue(allocation.allocationPercent);
    const actualCost = actualProjectEnd >= projectStart
      ? subscriptionCostForPeriod(allocation.subscription, projectStart, actualProjectEnd, allocationPercent)
      : 0;
    const safeForecastEnd = forecastProjectEnd >= projectStart ? forecastProjectEnd : projectStart;
    const forecastCost = subscriptionCostForPeriod(
      allocation.subscription,
      projectStart,
      safeForecastEnd,
      allocationPercent,
    );
    const periodCost = periodEndCandidate >= periodStart
      ? subscriptionCostForPeriod(allocation.subscription, periodStart, periodEndCandidate, allocationPercent)
      : 0;
    periodSubscriptionCost += periodCost;
    return {
      id: allocation.id,
      allocationPercent,
      actualCost,
      forecastCost,
      periodCost,
      subscription: {
        id: allocation.subscription.id,
        name: allocation.subscription.name,
        vendor: allocation.subscription.vendor,
        category: allocation.subscription.category,
        amount: numberValue(allocation.subscription.amount),
        frequency: allocation.subscription.frequency,
      },
    };
  });

  const periodApprovedLaborCost = employees.reduce((sum, employee) => sum + employee.approvedCost, 0);
  const periodPendingLaborCost = employees.reduce((sum, employee) => sum + employee.pendingCost, 0);
  const periodApprovedMinutes = employees.reduce((sum, employee) => sum + employee.approvedMinutes, 0);
  const periodPendingMinutes = employees.reduce((sum, employee) => sum + employee.pendingMinutes, 0);
  const periodMissingRateMinutes = employees.reduce((sum, employee) => sum + employee.missingRateMinutes, 0);

  const issuedInvoices = project.invoices.filter((invoice) => !["DRAFT", "CANCELLED"].includes(invoice.status));
  const invoiceRows = issuedInvoices.map((invoice) => {
    const total = numberValue(invoice.totalAmount);
    const collected = invoice.payments.reduce((sum, payment) => sum + numberValue(payment.amount), 0);
    const outstanding = Math.max(total - collected, 0);
    return {
      id: invoice.id,
      number: invoice.number,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      status: invoice.status,
      total,
      collected,
      outstanding,
      overdue: outstanding > 0 && invoice.dueDate < today && !["DRAFT", "CANCELLED"].includes(invoice.status),
    };
  });
  const invoiced = issuedInvoices.reduce((sum, invoice) => sum + numberValue(invoice.totalAmount), 0);
  const collected = issuedInvoices.reduce(
    (sum, invoice) => sum + invoice.payments.reduce((paymentSum, payment) => paymentSum + numberValue(payment.amount), 0),
    0,
  );
  const outstanding = Math.max(invoiced - collected, 0);
  const overdueInvoices = invoiceRows.filter((invoice) => invoice.overdue);
  const overdueTasks = tasks.filter((task) =>
    task.dueDate && task.dueDate < today && !["DONE", "CANCELLED"].includes(task.status),
  );

  const alerts: Array<{
    code: "budget" | "margin" | "rates" | "tasks" | "receivables" | "planning";
    severity: "critical" | "warning" | "info";
    value: number;
  }> = [];
  if (summary.plannedBudget <= 0) alerts.push({ code: "planning", severity: "warning", value: 0 });
  if (summary.plannedBudget > 0 && summary.forecastCost > summary.plannedBudget) {
    alerts.push({ code: "budget", severity: "critical", value: summary.forecastCost - summary.plannedBudget });
  }
  if (summary.forecastMargin < summary.project.targetMarginPercent || summary.forecastMargin < 0) {
    alerts.push({
      code: "margin",
      severity: summary.forecastMargin < 0 ? "critical" : "warning",
      value: summary.forecastMargin,
    });
  }
  if (summary.missingRateMinutes + summary.unpricedRemainingMinutes > 0) {
    alerts.push({
      code: "rates",
      severity: "warning",
      value: summary.missingRateMinutes + summary.unpricedRemainingMinutes,
    });
  }
  if (overdueTasks.length) alerts.push({ code: "tasks", severity: "warning", value: overdueTasks.length });
  if (overdueInvoices.length) {
    alerts.push({
      code: "receivables",
      severity: "warning",
      value: overdueInvoices.reduce((sum, invoice) => sum + invoice.outstanding, 0),
    });
  }

  return {
    summary,
    range: { from: range.from ?? null, to: range.to ?? null },
    period: {
      approvedLaborCost: periodApprovedLaborCost,
      pendingLaborCost: periodPendingLaborCost,
      approvedExpenseCost,
      pendingExpenseCost,
      subscriptionCost: periodSubscriptionCost,
      approvedMinutes: periodApprovedMinutes,
      pendingMinutes: periodPendingMinutes,
      missingRateMinutes: periodMissingRateMinutes,
      actualCost: periodApprovedLaborCost + approvedExpenseCost + periodSubscriptionCost,
      committedCost: periodPendingLaborCost + pendingExpenseCost,
    },
    employees,
    tasks,
    expenses,
    subscriptions,
    invoicing: {
      invoiced,
      collected,
      outstanding,
      invoiceRows,
      overdueCount: overdueInvoices.length,
      overdueBalance: overdueInvoices.reduce((sum, invoice) => sum + invoice.outstanding, 0),
    },
    alerts,
  };
}
