"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Locale } from "@/i18n/config";
import { isLocale } from "@/i18n/config";
import { actionErrorMessage, feedbackUrl } from "@/lib/action-feedback";
import { requirePermission } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

const paymentMethods = ["BANK_TRANSFER", "CASH", "CHEQUE", "CARD", "OTHER"] as const;

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

function optionalText(formData: FormData, key: string, maxLength = 1000) {
  const value = String(formData.get(key) ?? "").trim();
  if (value.length > maxLength) throw new Error(`Invalid ${key}.`);
  return value || null;
}

function positiveNumber(formData: FormData, key: string) {
  const value = Number(formData.get(key));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${key} must be greater than zero.`);
  return value;
}

function nonNegativeNumber(formData: FormData, key: string) {
  const value = Number(formData.get(key) ?? 0);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${key} cannot be negative.`);
  return value;
}

function dateValue(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!value || Number.isNaN(date.getTime())) throw new Error(`${key} is required.`);
  return date;
}

function revalidateInvoices(locale: Locale, invoiceId?: string, projectId?: string) {
  revalidatePath(`/${locale}`);
  revalidatePath(`/${locale}/invoices`);
  revalidatePath(`/${locale}/financials`);
  revalidatePath(`/${locale}/notifications`);
  if (invoiceId) revalidatePath(`/${locale}/invoices/${invoiceId}`);
  if (projectId) {
    revalidatePath(`/${locale}/projects/${projectId}`);
    revalidatePath(`/${locale}/financials/${projectId}`);
  }
}

async function invoiceProject(organizationId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId, status: { not: "CANCELLED" } },
    select: { id: true, clientId: true, currency: true },
  });
  if (!project) throw new Error("Project not found.");
  return project;
}

export async function createInvoice(formData: FormData) {
  const locale = localeFrom(formData);
  let createdId = "";
  try {
    const actor = await requirePermission(locale, "invoices.manage");
    const project = await invoiceProject(actor.organizationId!, requiredText(formData, "projectId"));
    const issueDate = dateValue(formData, "issueDate");
    const dueDate = dateValue(formData, "dueDate");
    if (dueDate < issueDate) throw new Error("Due date must be on or after the issue date.");
    const subtotal = positiveNumber(formData, "subtotal");
    const taxAmount = nonNegativeNumber(formData, "taxAmount");

    const invoice = await prisma.invoice.create({
      data: {
        organizationId: actor.organizationId!,
        clientId: project.clientId,
        projectId: project.id,
        createdById: actor.id,
        number: requiredText(formData, "number", 60).toUpperCase(),
        description: requiredText(formData, "description", 1000),
        issueDate,
        dueDate,
        subtotal,
        taxAmount,
        totalAmount: subtotal + taxAmount,
        currency: project.currency,
        notes: optionalText(formData, "notes", 2000),
      },
    });
    createdId = invoice.id;
    await prisma.auditLog.create({
      data: {
        organizationId: actor.organizationId!,
        actorId: actor.id,
        action: "invoice.created",
        entityType: "Invoice",
        entityId: invoice.id,
        after: { number: invoice.number, projectId: project.id, totalAmount: invoice.totalAmount.toString(), status: invoice.status },
      },
    });
    revalidateInvoices(locale, invoice.id, project.id);
  } catch (error) {
    redirect(feedbackUrl(`/${locale}/invoices`, "error", actionErrorMessage(error, "Invoice could not be created.")));
  }
  redirect(feedbackUrl(`/${locale}/invoices/${createdId}`, "success", "Invoice created successfully."));
}

export async function updateInvoice(formData: FormData) {
  const locale = localeFrom(formData);
  const invoiceId = requiredText(formData, "invoiceId");
  const destination = `/${locale}/invoices/${invoiceId}`;
  try {
    const actor = await requirePermission(locale, "invoices.manage");
    const existing = await prisma.invoice.findFirst({ where: { id: invoiceId, organizationId: actor.organizationId! } });
    if (!existing) throw new Error("Invoice not found.");
    if (existing.status !== "DRAFT") throw new Error("Invoice must be a draft before it can be edited.");
    const project = await invoiceProject(actor.organizationId!, requiredText(formData, "projectId"));
    const issueDate = dateValue(formData, "issueDate");
    const dueDate = dateValue(formData, "dueDate");
    if (dueDate < issueDate) throw new Error("Due date must be on or after the issue date.");
    const subtotal = positiveNumber(formData, "subtotal");
    const taxAmount = nonNegativeNumber(formData, "taxAmount");

    const updated = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        clientId: project.clientId,
        projectId: project.id,
        number: requiredText(formData, "number", 60).toUpperCase(),
        description: requiredText(formData, "description", 1000),
        issueDate,
        dueDate,
        subtotal,
        taxAmount,
        totalAmount: subtotal + taxAmount,
        currency: project.currency,
        notes: optionalText(formData, "notes", 2000),
      },
    });
    await prisma.auditLog.create({
      data: {
        organizationId: actor.organizationId!, actorId: actor.id,
        action: "invoice.updated", entityType: "Invoice", entityId: invoiceId,
        before: { number: existing.number, totalAmount: existing.totalAmount.toString(), projectId: existing.projectId },
        after: { number: updated.number, totalAmount: updated.totalAmount.toString(), projectId: updated.projectId },
      },
    });
    revalidateInvoices(locale, invoiceId, existing.projectId);
    revalidateInvoices(locale, invoiceId, project.id);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Invoice could not be updated.")));
  }
  redirect(feedbackUrl(destination, "success", "Invoice updated successfully."));
}

export async function sendInvoice(formData: FormData) {
  const locale = localeFrom(formData);
  const invoiceId = requiredText(formData, "invoiceId");
  const destination = `/${locale}/invoices/${invoiceId}`;
  try {
    const actor = await requirePermission(locale, "invoices.manage");
    const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, organizationId: actor.organizationId! } });
    if (!invoice) throw new Error("Invoice not found.");
    if (invoice.status !== "DRAFT") throw new Error("Invoice must be a draft before it can be sent.");
    await prisma.$transaction([
      prisma.invoice.update({ where: { id: invoiceId }, data: { status: "SENT", sentAt: new Date() } }),
      prisma.auditLog.create({ data: { organizationId: actor.organizationId!, actorId: actor.id, action: "invoice.sent", entityType: "Invoice", entityId: invoiceId, before: { status: "DRAFT" }, after: { status: "SENT" } } }),
    ]);
    revalidateInvoices(locale, invoiceId, invoice.projectId);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Invoice could not be sent.")));
  }
  redirect(feedbackUrl(destination, "success", "Invoice marked as sent."));
}

export async function cancelInvoice(formData: FormData) {
  const locale = localeFrom(formData);
  const invoiceId = requiredText(formData, "invoiceId");
  const destination = `/${locale}/invoices/${invoiceId}`;
  try {
    const actor = await requirePermission(locale, "invoices.manage");
    const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, organizationId: actor.organizationId! }, include: { _count: { select: { payments: true } } } });
    if (!invoice) throw new Error("Invoice not found.");
    if (invoice.status === "PAID") throw new Error("Paid invoices cannot be cancelled.");
    if (invoice.status === "CANCELLED") throw new Error("Invoice is already cancelled.");
    if (invoice._count.payments > 0) throw new Error("Invoices with recorded payments cannot be cancelled.");
    await prisma.$transaction([
      prisma.invoice.update({ where: { id: invoiceId }, data: { status: "CANCELLED" } }),
      prisma.auditLog.create({ data: { organizationId: actor.organizationId!, actorId: actor.id, action: "invoice.cancelled", entityType: "Invoice", entityId: invoiceId, before: { status: invoice.status }, after: { status: "CANCELLED" } } }),
    ]);
    revalidateInvoices(locale, invoiceId, invoice.projectId);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Invoice could not be cancelled.")));
  }
  redirect(feedbackUrl(destination, "success", "Invoice cancelled."));
}

export async function recordInvoicePayment(formData: FormData) {
  const locale = localeFrom(formData);
  const invoiceId = requiredText(formData, "invoiceId");
  const destination = `/${locale}/invoices/${invoiceId}`;
  try {
    const actor = await requirePermission(locale, "invoices.manage");
    const amount = positiveNumber(formData, "amount");
    const paymentDate = dateValue(formData, "paymentDate");
    const method = requiredText(formData, "method");
    if (!paymentMethods.includes(method as (typeof paymentMethods)[number])) throw new Error("Invalid payment method.");

    const projectId = await prisma.$transaction(async (transaction) => {
      const invoice = await transaction.invoice.findFirst({
        where: { id: invoiceId, organizationId: actor.organizationId! },
        include: { payments: { select: { amount: true } } },
      });
      if (!invoice) throw new Error("Invoice not found.");
      if (!["SENT", "PARTIALLY_PAID"].includes(invoice.status)) throw new Error("Invoice must be sent before a payment can be recorded.");
      const paidBefore = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
      const balance = Number(invoice.totalAmount) - paidBefore;
      if (amount > balance + 0.001) throw new Error("Payment cannot exceed the outstanding balance.");
      const paidAfter = paidBefore + amount;
      const isPaid = paidAfter >= Number(invoice.totalAmount) - 0.001;

      const payment = await transaction.invoicePayment.create({
        data: {
          invoiceId,
          recordedById: actor.id,
          paymentDate,
          amount,
          method: method as (typeof paymentMethods)[number],
          reference: optionalText(formData, "reference", 160),
          notes: optionalText(formData, "notes", 1000),
        },
      });
      await transaction.invoice.update({
        where: { id: invoiceId },
        data: { status: isPaid ? "PAID" : "PARTIALLY_PAID", paidAt: isPaid ? new Date() : null },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: actor.organizationId!, actorId: actor.id,
          action: "invoice.payment_recorded", entityType: "Invoice", entityId: invoiceId,
          after: { paymentId: payment.id, amount, paidAfter, status: isPaid ? "PAID" : "PARTIALLY_PAID" },
        },
      });
      return invoice.projectId;
    }, { isolationLevel: "Serializable" });
    revalidateInvoices(locale, invoiceId, projectId);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Payment could not be recorded.")));
  }
  redirect(feedbackUrl(destination, "success", "Payment recorded successfully."));
}
