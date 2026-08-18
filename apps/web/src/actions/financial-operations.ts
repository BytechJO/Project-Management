"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Locale } from "@/i18n/config";
import { isLocale } from "@/i18n/config";
import { actionErrorMessage, feedbackUrl } from "@/lib/action-feedback";
import { permissionKeysFor, requirePermission, requireUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { canReviewOwnedResource, projectAccessScope } from "@/lib/security-policy";

const billingFrequencies = ["MONTHLY", "QUARTERLY", "SEMI_ANNUAL", "ANNUAL", "ONE_TIME"] as const;

function localeFrom(formData: FormData) {
  const locale = String(formData.get("locale") ?? "en");
  if (!isLocale(locale)) throw new Error("Invalid locale.");
  return locale;
}

function requiredText(formData: FormData, key: string, maxLength = 180) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value || value.length > maxLength) throw new Error(`${key} is required.`);
  return value;
}

function optionalText(formData: FormData, key: string, maxLength = 500) {
  const value = String(formData.get(key) ?? "").trim();
  if (value.length > maxLength) throw new Error(`Invalid ${key}.`);
  return value || null;
}

function requiredNumber(formData: FormData, key: string) {
  const value = Number(formData.get(key));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${key} must be greater than zero.`);
  return value;
}

function nonNegativeNumber(formData: FormData, key: string) {
  const value = Number(formData.get(key) ?? 0);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${key} cannot be negative.`);
  return value;
}

function dateValue(formData: FormData, key: string, required = true) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value && !required) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!value || Number.isNaN(date.getTime())) throw new Error(`${key} is required.`);
  return date;
}

function optionalHttpUrl(formData: FormData, key: string) {
  const value = optionalText(formData, key, 1000);
  if (!value) return null;
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(`${key} must use HTTP or HTTPS.`);
  return url.toString();
}

function revalidateFinance(locale: Locale, projectId?: string | null) {
  revalidatePath(`/${locale}`);
  revalidatePath(`/${locale}/expenses`);
  revalidatePath(`/${locale}/subscriptions`);
  revalidatePath(`/${locale}/financials`);
  revalidatePath(`/${locale}/notifications`);
  if (projectId) {
    revalidatePath(`/${locale}/projects/${projectId}`);
    revalidatePath(`/${locale}/financials/${projectId}`);
  }
}

async function expenseActor(locale: Locale) {
  const actor = await requireUser(locale);
  const permissions = permissionKeysFor(actor);
  if (!permissions.has("expenses.own") && !permissions.has("expenses.approve")) {
    throw new Error("You do not have permission to manage expenses.");
  }
  return { actor, permissions };
}

async function validatedExpenseRelations(
  organizationId: string,
  actorId: string,
  canReview: boolean,
  projectId: string | null,
  clientId: string | null,
) {
  const project = projectId ? await prisma.project.findFirst({
    where: {
      id: projectId,
      organizationId,
      ...projectAccessScope(actorId, canReview ? "all" : "assigned"),
    },
    select: { id: true, clientId: true },
  }) : null;
  if (projectId && !project) throw new Error("Project not found or is not assigned to you.");
  if (!project && !canReview) throw new Error("Employees must assign an expense to one of their projects.");

  const resolvedClientId = project?.clientId ?? clientId;
  if (resolvedClientId) {
    const client = await prisma.client.findFirst({ where: { id: resolvedClientId, organizationId } });
    if (!client) throw new Error("Client not found.");
  }
  return { projectId: project?.id ?? null, clientId: resolvedClientId };
}

export async function createExpense(formData: FormData) {
  const locale = localeFrom(formData);
  try {
    const { actor, permissions } = await expenseActor(locale);
    const projectId = String(formData.get("projectId") ?? "").trim() || null;
    const clientId = String(formData.get("clientId") ?? "").trim() || null;
    const canReview = permissions.has("expenses.approve") || permissions.has("financials.write");
    const relations = await validatedExpenseRelations(actor.organizationId!, actor.id, canReview, projectId, clientId);
    const intent = String(formData.get("intent") ?? "draft");
    const status = intent === "submit" ? "SUBMITTED" : "DRAFT";

    const expense = await prisma.expense.create({
      data: {
        organizationId: actor.organizationId!,
        projectId: relations.projectId,
        clientId: relations.clientId,
        submittedById: actor.id,
        vendor: optionalText(formData, "vendor", 160),
        category: requiredText(formData, "category", 80),
        description: requiredText(formData, "description", 1000),
        expenseDate: dateValue(formData, "expenseDate")!,
        amount: requiredNumber(formData, "amount"),
        taxAmount: nonNegativeNumber(formData, "taxAmount"),
        currency: "JOD",
        receiptUrl: optionalHttpUrl(formData, "receiptUrl"),
        status,
        submittedAt: status === "SUBMITTED" ? new Date() : null,
      },
    });
    await prisma.auditLog.create({
      data: {
        organizationId: actor.organizationId!, actorId: actor.id,
        action: status === "SUBMITTED" ? "expense.created_and_submitted" : "expense.created",
        entityType: "Expense", entityId: expense.id,
        after: { projectId: relations.projectId, category: expense.category, amount: expense.amount.toString(), status },
      },
    });
    revalidateFinance(locale, relations.projectId);
  } catch (error) {
    redirect(feedbackUrl(`/${locale}/expenses`, "error", actionErrorMessage(error, "Expense could not be created.")));
  }
  redirect(feedbackUrl(`/${locale}/expenses`, "success", "Expense created successfully."));
}

export async function updateExpense(formData: FormData) {
  const locale = localeFrom(formData);
  const expenseId = requiredText(formData, "expenseId");
  const destination = `/${locale}/expenses/${expenseId}`;
  try {
    const { actor, permissions } = await expenseActor(locale);
    const canReview = permissions.has("expenses.approve") || permissions.has("financials.write");
    const existing = await prisma.expense.findFirst({ where: { id: expenseId, organizationId: actor.organizationId! } });
    if (!existing) throw new Error("Expense not found.");
    if (!canReview && existing.submittedById !== actor.id) throw new Error("You do not have permission to edit this expense.");
    if (!["DRAFT", "REJECTED"].includes(existing.status)) throw new Error("Only draft or rejected expenses can be edited.");

    const projectId = String(formData.get("projectId") ?? "").trim() || null;
    const clientId = String(formData.get("clientId") ?? "").trim() || null;
    const relations = await validatedExpenseRelations(actor.organizationId!, actor.id, canReview, projectId, clientId);
    const intent = String(formData.get("intent") ?? "draft");
    const status = intent === "submit" ? "SUBMITTED" : "DRAFT";

    const updated = await prisma.expense.update({
      where: { id: expenseId },
      data: {
        projectId: relations.projectId,
        clientId: relations.clientId,
        vendor: optionalText(formData, "vendor", 160),
        category: requiredText(formData, "category", 80),
        description: requiredText(formData, "description", 1000),
        expenseDate: dateValue(formData, "expenseDate")!,
        amount: requiredNumber(formData, "amount"),
        taxAmount: nonNegativeNumber(formData, "taxAmount"),
        receiptUrl: optionalHttpUrl(formData, "receiptUrl"),
        status,
        submittedAt: status === "SUBMITTED" ? new Date() : null,
        approvedById: null,
        approvedAt: null,
        rejectionReason: null,
      },
    });
    await prisma.auditLog.create({
      data: {
        organizationId: actor.organizationId!, actorId: actor.id,
        action: "expense.updated", entityType: "Expense", entityId: expenseId,
        before: { amount: existing.amount.toString(), status: existing.status },
        after: { amount: updated.amount.toString(), status, projectId: relations.projectId },
      },
    });
    revalidateFinance(locale, existing.projectId);
    revalidateFinance(locale, relations.projectId);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Expense could not be updated.")));
  }
  redirect(feedbackUrl(destination, "success", "Expense updated successfully."));
}

export async function submitExpense(formData: FormData) {
  const locale = localeFrom(formData);
  const expenseId = requiredText(formData, "expenseId");
  try {
    const { actor, permissions } = await expenseActor(locale);
    const canReview = permissions.has("expenses.approve") || permissions.has("financials.write");
    const expense = await prisma.expense.findFirst({ where: { id: expenseId, organizationId: actor.organizationId! } });
    if (!expense) throw new Error("Expense not found.");
    if (!canReview && expense.submittedById !== actor.id) throw new Error("You do not have permission to submit this expense.");
    if (!["DRAFT", "REJECTED"].includes(expense.status)) throw new Error("Only draft or rejected expenses can be submitted.");
    await prisma.$transaction([
      prisma.expense.update({ where: { id: expenseId }, data: { status: "SUBMITTED", submittedAt: new Date(), rejectionReason: null } }),
      prisma.auditLog.create({ data: { organizationId: actor.organizationId!, actorId: actor.id, action: "expense.submitted", entityType: "Expense", entityId: expenseId, before: { status: expense.status }, after: { status: "SUBMITTED" } } }),
    ]);
    revalidateFinance(locale, expense.projectId);
  } catch (error) {
    redirect(feedbackUrl(`/${locale}/expenses`, "error", actionErrorMessage(error, "Expense could not be submitted.")));
  }
  redirect(feedbackUrl(`/${locale}/expenses`, "success", "Expense submitted for approval."));
}

export async function reviewExpense(formData: FormData) {
  const locale = localeFrom(formData);
  const expenseId = requiredText(formData, "expenseId");
  try {
    const actor = await requirePermission(locale, "expenses.approve");
    const decision = requiredText(formData, "decision");
    if (!["APPROVED", "REJECTED"].includes(decision)) throw new Error("Invalid expense decision.");
    const expense = await prisma.expense.findFirst({ where: { id: expenseId, organizationId: actor.organizationId!, status: "SUBMITTED" } });
    if (!expense) throw new Error("Submitted expense not found.");
    if (!canReviewOwnedResource(actor.id, expense.submittedById)) {
      throw new Error("You cannot review your own expense.");
    }
    const rejectionReason = decision === "REJECTED" ? requiredText(formData, "rejectionReason", 500) : null;
    await prisma.$transaction([
      prisma.expense.update({
        where: { id: expenseId },
        data: {
          status: decision as "APPROVED" | "REJECTED",
          approvedById: decision === "APPROVED" ? actor.id : null,
          approvedAt: decision === "APPROVED" ? new Date() : null,
          rejectionReason,
        },
      }),
      prisma.auditLog.create({ data: { organizationId: actor.organizationId!, actorId: actor.id, action: decision === "APPROVED" ? "expense.approved" : "expense.rejected", entityType: "Expense", entityId: expenseId, before: { status: expense.status }, after: { status: decision, rejectionReason } } }),
    ]);
    revalidateFinance(locale, expense.projectId);
  } catch (error) {
    redirect(feedbackUrl(`/${locale}/expenses`, "error", actionErrorMessage(error, "Expense could not be reviewed.")));
  }
  redirect(feedbackUrl(`/${locale}/expenses`, "success", "Expense review completed."));
}

export async function markExpensePaid(formData: FormData) {
  const locale = localeFrom(formData);
  const expenseId = requiredText(formData, "expenseId");
  try {
    const actor = await requirePermission(locale, "expenses.approve");
    const expense = await prisma.expense.findFirst({ where: { id: expenseId, organizationId: actor.organizationId!, status: "APPROVED" } });
    if (!expense) throw new Error("Approved expense not found.");
    await prisma.$transaction([
      prisma.expense.update({ where: { id: expenseId }, data: { status: "PAID", paidAt: new Date() } }),
      prisma.auditLog.create({ data: { organizationId: actor.organizationId!, actorId: actor.id, action: "expense.paid", entityType: "Expense", entityId: expenseId, before: { status: "APPROVED" }, after: { status: "PAID" } } }),
    ]);
    revalidateFinance(locale, expense.projectId);
  } catch (error) {
    redirect(feedbackUrl(`/${locale}/expenses`, "error", actionErrorMessage(error, "Expense could not be marked as paid.")));
  }
  redirect(feedbackUrl(`/${locale}/expenses`, "success", "Expense marked as paid."));
}

export async function createSubscription(formData: FormData) {
  const locale = localeFrom(formData);
  try {
    const actor = await requirePermission(locale, "subscriptions.manage");
    const frequency = requiredText(formData, "frequency");
    if (!billingFrequencies.includes(frequency as (typeof billingFrequencies)[number])) throw new Error("Invalid billing frequency.");
    const dueDayValue = String(formData.get("dueDay") ?? "").trim();
    const dueDay = dueDayValue ? Number(dueDayValue) : null;
    if (dueDay != null && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)) throw new Error("Due day must be between 1 and 31.");
    const startsOn = dateValue(formData, "startsOn")!;
    const endsOn = dateValue(formData, "endsOn", false);
    if (endsOn && endsOn < startsOn) throw new Error("End date must be on or after the start date.");

    const subscription = await prisma.subscription.create({
      data: {
        organizationId: actor.organizationId!,
        vendor: requiredText(formData, "vendor", 160),
        name: requiredText(formData, "name", 160),
        category: requiredText(formData, "category", 80),
        amount: requiredNumber(formData, "amount"),
        currency: "JOD",
        frequency: frequency as (typeof billingFrequencies)[number],
        dueDay,
        startsOn,
        endsOn,
        autoRenew: formData.get("autoRenew") === "on",
      },
    });
    await prisma.auditLog.create({ data: { organizationId: actor.organizationId!, actorId: actor.id, action: "subscription.created", entityType: "Subscription", entityId: subscription.id, after: { name: subscription.name, amount: subscription.amount.toString(), frequency } } });
    revalidateFinance(locale);
  } catch (error) {
    redirect(feedbackUrl(`/${locale}/subscriptions`, "error", actionErrorMessage(error, "Subscription could not be created.")));
  }
  redirect(feedbackUrl(`/${locale}/subscriptions`, "success", "Subscription created successfully."));
}

export async function updateSubscription(formData: FormData) {
  const locale = localeFrom(formData);
  const subscriptionId = requiredText(formData, "subscriptionId");
  const destination = `/${locale}/subscriptions/${subscriptionId}`;
  try {
    const actor = await requirePermission(locale, "subscriptions.manage");
    const existing = await prisma.subscription.findFirst({ where: { id: subscriptionId, organizationId: actor.organizationId! } });
    if (!existing) throw new Error("Subscription not found.");
    const frequency = requiredText(formData, "frequency");
    if (!billingFrequencies.includes(frequency as (typeof billingFrequencies)[number])) throw new Error("Invalid billing frequency.");
    const dueDayValue = String(formData.get("dueDay") ?? "").trim();
    const dueDay = dueDayValue ? Number(dueDayValue) : null;
    if (dueDay != null && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)) throw new Error("Due day must be between 1 and 31.");
    const startsOn = dateValue(formData, "startsOn")!;
    const endsOn = dateValue(formData, "endsOn", false);
    if (endsOn && endsOn < startsOn) throw new Error("End date must be on or after the start date.");

    const updated = await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        vendor: requiredText(formData, "vendor", 160),
        name: requiredText(formData, "name", 160),
        category: requiredText(formData, "category", 80),
        amount: requiredNumber(formData, "amount"),
        frequency: frequency as (typeof billingFrequencies)[number],
        dueDay,
        startsOn,
        endsOn,
        autoRenew: formData.get("autoRenew") === "on",
        isActive: formData.get("isActive") === "on",
      },
    });
    await prisma.auditLog.create({ data: { organizationId: actor.organizationId!, actorId: actor.id, action: "subscription.updated", entityType: "Subscription", entityId: subscriptionId, before: { name: existing.name, amount: existing.amount.toString(), isActive: existing.isActive }, after: { name: updated.name, amount: updated.amount.toString(), isActive: updated.isActive } } });
    revalidateFinance(locale);
    revalidatePath(destination);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Subscription could not be updated.")));
  }
  redirect(feedbackUrl(destination, "success", "Subscription updated successfully."));
}

export async function updateSubscriptionAllocations(formData: FormData) {
  const locale = localeFrom(formData);
  const subscriptionId = requiredText(formData, "subscriptionId");
  const destination = `/${locale}/subscriptions/${subscriptionId}`;
  try {
    const actor = await requirePermission(locale, "subscriptions.manage");
    const subscription = await prisma.subscription.findFirst({ where: { id: subscriptionId, organizationId: actor.organizationId! } });
    if (!subscription) throw new Error("Subscription not found.");
    const projects = await prisma.project.findMany({ where: { organizationId: actor.organizationId!, status: { not: "CANCELLED" } }, select: { id: true } });
    const allocations = projects.map((project) => ({
      projectId: project.id,
      allocationPercent: Number(formData.get(`allocation_${project.id}`) ?? 0),
    })).filter((allocation) => allocation.allocationPercent > 0);
    if (allocations.some((allocation) => !Number.isFinite(allocation.allocationPercent) || allocation.allocationPercent > 100)) {
      throw new Error("Each allocation must be between 0 and 100 percent.");
    }
    const total = allocations.reduce((sum, allocation) => sum + allocation.allocationPercent, 0);
    if (total > 100.001) throw new Error("Project allocations cannot exceed 100 percent in total.");

    const previous = await prisma.subscriptionAllocation.findMany({ where: { subscriptionId } });
    await prisma.$transaction(async (transaction) => {
      await transaction.subscriptionAllocation.deleteMany({ where: { subscriptionId } });
      if (allocations.length) {
        await transaction.subscriptionAllocation.createMany({ data: allocations.map((allocation) => ({ subscriptionId, ...allocation })) });
      }
      await transaction.auditLog.create({ data: { organizationId: actor.organizationId!, actorId: actor.id, action: "subscription.allocations_updated", entityType: "Subscription", entityId: subscriptionId, before: { allocations: previous.map((allocation) => ({ projectId: allocation.projectId, percent: allocation.allocationPercent.toString() })) }, after: { allocations, overheadPercent: 100 - total } } });
    });
    revalidateFinance(locale);
    revalidatePath(destination);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Subscription allocations could not be updated.")));
  }
  redirect(feedbackUrl(destination, "success", "Subscription allocations updated."));
}

export async function recordSubscriptionPayment(formData: FormData) {
  const locale = localeFrom(formData);
  const subscriptionId = requiredText(formData, "subscriptionId");
  const destination = `/${locale}/subscriptions/${subscriptionId}`;
  try {
    const actor = await requirePermission(locale, "subscriptions.manage");
    const subscription = await prisma.subscription.findFirst({ where: { id: subscriptionId, organizationId: actor.organizationId! } });
    if (!subscription) throw new Error("Subscription not found.");
    const paidAt = new Date();
    const payment = await prisma.expense.create({
      data: {
        organizationId: actor.organizationId!,
        subscriptionId,
        submittedById: actor.id,
        approvedById: actor.id,
        vendor: subscription.vendor,
        category: "Subscription",
        description: `${subscription.name} payment`,
        expenseDate: dateValue(formData, "expenseDate")!,
        amount: requiredNumber(formData, "amount"),
        taxAmount: nonNegativeNumber(formData, "taxAmount"),
        currency: subscription.currency,
        receiptUrl: optionalHttpUrl(formData, "receiptUrl"),
        status: "PAID",
        submittedAt: paidAt,
        approvedAt: paidAt,
        paidAt,
      },
    });
    await prisma.auditLog.create({ data: { organizationId: actor.organizationId!, actorId: actor.id, action: "subscription.payment_recorded", entityType: "Subscription", entityId: subscriptionId, after: { expenseId: payment.id, amount: payment.amount.toString(), expenseDate: payment.expenseDate.toISOString() } } });
    revalidateFinance(locale);
    revalidatePath(destination);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Subscription payment could not be recorded.")));
  }
  redirect(feedbackUrl(destination, "success", "Subscription payment recorded."));
}
