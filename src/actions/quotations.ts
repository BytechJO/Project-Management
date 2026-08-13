"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Locale } from "@/i18n/config";
import { isLocale } from "@/i18n/config";
import { actionErrorMessage, feedbackUrl } from "@/lib/action-feedback";
import { requirePermission } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

const discountTypes = ["NONE", "PERCENTAGE", "FIXED"] as const;
const pricingModels = ["FIXED_PRICE", "TIME_AND_MATERIALS", "MONTHLY_RETAINER"] as const;

type RawLineItem = {
  description?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
  taxRate?: unknown;
};

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

function optionalText(formData: FormData, key: string, maxLength = 2000) {
  const value = String(formData.get(key) ?? "").trim();
  if (value.length > maxLength) throw new Error(`Invalid ${key}.`);
  return value || null;
}

function dateValue(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!value || Number.isNaN(date.getTime())) throw new Error(`${key} is required.`);
  return date;
}

function optionalDate(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${key}.`);
  return date;
}

function nonNegativeNumber(formData: FormData, key: string) {
  const value = Number(formData.get(key) ?? 0);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${key} cannot be negative.`);
  return value;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function quotationAmounts(formData: FormData) {
  let rawItems: RawLineItem[];
  try {
    const parsed = JSON.parse(String(formData.get("lineItems") ?? "[]"));
    if (!Array.isArray(parsed)) throw new Error();
    rawItems = parsed;
  } catch {
    throw new Error("Quotation line items are invalid.");
  }
  if (!rawItems.length || rawItems.length > 50) throw new Error("Add between 1 and 50 line items.");

  const baseItems = rawItems.map((raw, index) => {
    const description = String(raw.description ?? "").trim();
    const quantity = Number(raw.quantity);
    const unitPrice = Number(raw.unitPrice);
    const taxRate = Number(raw.taxRate ?? 0);
    if (!description || description.length > 500) throw new Error(`Line ${index + 1} needs a valid description.`);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) throw new Error(`Line ${index + 1} has an invalid quantity.`);
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1_000_000_000) throw new Error(`Line ${index + 1} has an invalid unit price.`);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) throw new Error(`Line ${index + 1} has an invalid tax rate.`);
    return { description, quantity, unitPrice, taxRate, lineSubtotal: roundMoney(quantity * unitPrice), sortOrder: index };
  });

  const subtotal = roundMoney(baseItems.reduce((sum, item) => sum + item.lineSubtotal, 0));
  if (subtotal <= 0) throw new Error("Quotation subtotal must be greater than zero.");
  const discountType = String(formData.get("discountType") ?? "NONE");
  if (!discountTypes.includes(discountType as (typeof discountTypes)[number])) throw new Error("Invalid discount type.");
  const discountValue = discountType === "NONE" ? 0 : nonNegativeNumber(formData, "discountValue");
  if (discountType === "PERCENTAGE" && discountValue > 100) throw new Error("Discount percentage cannot exceed 100%.");
  if (discountType === "FIXED" && discountValue > subtotal) throw new Error("Fixed discount cannot exceed the subtotal.");
  const discountAmount = roundMoney(discountType === "PERCENTAGE" ? subtotal * discountValue / 100 : discountType === "FIXED" ? discountValue : 0);

  const items = baseItems.map((item) => {
    const allocatedDiscount = subtotal > 0 ? discountAmount * item.lineSubtotal / subtotal : 0;
    const taxableAmount = Math.max(item.lineSubtotal - allocatedDiscount, 0);
    const taxAmount = roundMoney(taxableAmount * item.taxRate / 100);
    return { ...item, taxAmount, totalAmount: roundMoney(taxableAmount + taxAmount) };
  });
  const taxAmount = roundMoney(items.reduce((sum, item) => sum + item.taxAmount, 0));
  const totalAmount = roundMoney(subtotal - discountAmount + taxAmount);

  return {
    items,
    subtotal,
    discountType: discountType as (typeof discountTypes)[number],
    discountValue,
    discountAmount,
    taxAmount,
    totalAmount,
  };
}

function revalidateQuotations(locale: Locale, quotationId?: string) {
  revalidatePath(`/${locale}`);
  revalidatePath(`/${locale}/quotations`);
  if (quotationId) revalidatePath(`/${locale}/quotations/${quotationId}`);
}

export async function createQuotation(formData: FormData) {
  const locale = localeFrom(formData);
  let quotationId = "";
  try {
    const actor = await requirePermission(locale, "quotations.manage");
    const clientId = requiredText(formData, "clientId");
    const client = await prisma.client.findFirst({ where: { id: clientId, organizationId: actor.organizationId!, isActive: true } });
    if (!client) throw new Error("Client not found.");
    const issueDate = dateValue(formData, "issueDate");
    const validUntil = dateValue(formData, "validUntil");
    if (validUntil < issueDate) throw new Error("Valid until must be on or after the issue date.");
    const amounts = quotationAmounts(formData);

    const quotation = await prisma.quotation.create({
      data: {
        organizationId: actor.organizationId!,
        clientId,
        createdById: actor.id,
        number: requiredText(formData, "number", 60).toUpperCase(),
        title: requiredText(formData, "title", 240),
        description: optionalText(formData, "description", 1500),
        issueDate,
        validUntil,
        currency: actor.organization?.baseCurrency || "JOD",
        subtotal: amounts.subtotal,
        discountType: amounts.discountType,
        discountValue: amounts.discountValue,
        discountAmount: amounts.discountAmount,
        taxAmount: amounts.taxAmount,
        totalAmount: amounts.totalAmount,
        notes: optionalText(formData, "notes"),
        terms: optionalText(formData, "terms", 4000),
        lineItems: { create: amounts.items },
      },
    });
    quotationId = quotation.id;
    await prisma.auditLog.create({
      data: {
        organizationId: actor.organizationId!, actorId: actor.id,
        action: "quotation.created", entityType: "Quotation", entityId: quotation.id,
        after: { number: quotation.number, clientId, totalAmount: quotation.totalAmount.toString(), status: quotation.status },
      },
    });
    revalidateQuotations(locale, quotation.id);
  } catch (error) {
    redirect(feedbackUrl(`/${locale}/quotations/new`, "error", actionErrorMessage(error, "Quotation could not be created.")));
  }
  redirect(feedbackUrl(`/${locale}/quotations/${quotationId}`, "success", "Quotation created successfully."));
}

export async function updateQuotation(formData: FormData) {
  const locale = localeFrom(formData);
  const quotationId = requiredText(formData, "quotationId");
  const destination = `/${locale}/quotations/${quotationId}`;
  try {
    const actor = await requirePermission(locale, "quotations.manage");
    const existing = await prisma.quotation.findFirst({ where: { id: quotationId, organizationId: actor.organizationId! } });
    if (!existing) throw new Error("Quotation not found.");
    if (existing.status !== "DRAFT") throw new Error("Only draft quotations can be edited.");
    const clientId = requiredText(formData, "clientId");
    const client = await prisma.client.findFirst({ where: { id: clientId, organizationId: actor.organizationId!, isActive: true } });
    if (!client) throw new Error("Client not found.");
    const issueDate = dateValue(formData, "issueDate");
    const validUntil = dateValue(formData, "validUntil");
    if (validUntil < issueDate) throw new Error("Valid until must be on or after the issue date.");
    const amounts = quotationAmounts(formData);

    const updated = await prisma.$transaction(async (transaction) => {
      await transaction.quotationLineItem.deleteMany({ where: { quotationId } });
      return transaction.quotation.update({
        where: { id: quotationId },
        data: {
          clientId,
          number: requiredText(formData, "number", 60).toUpperCase(),
          title: requiredText(formData, "title", 240),
          description: optionalText(formData, "description", 1500),
          issueDate,
          validUntil,
          subtotal: amounts.subtotal,
          discountType: amounts.discountType,
          discountValue: amounts.discountValue,
          discountAmount: amounts.discountAmount,
          taxAmount: amounts.taxAmount,
          totalAmount: amounts.totalAmount,
          notes: optionalText(formData, "notes"),
          terms: optionalText(formData, "terms", 4000),
          lineItems: { create: amounts.items },
        },
      });
    });
    await prisma.auditLog.create({
      data: {
        organizationId: actor.organizationId!, actorId: actor.id,
        action: "quotation.updated", entityType: "Quotation", entityId: quotationId,
        before: { number: existing.number, totalAmount: existing.totalAmount.toString(), clientId: existing.clientId },
        after: { number: updated.number, totalAmount: updated.totalAmount.toString(), clientId: updated.clientId },
      },
    });
    revalidateQuotations(locale, quotationId);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Quotation could not be updated.")));
  }
  redirect(feedbackUrl(destination, "success", "Quotation updated successfully."));
}

async function changeQuotationStatus(formData: FormData, target: "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "CANCELLED") {
  const locale = localeFrom(formData);
  const quotationId = requiredText(formData, "quotationId");
  const destination = `/${locale}/quotations/${quotationId}`;
  try {
    const actor = await requirePermission(locale, "quotations.manage");
    const quotation = await prisma.quotation.findFirst({ where: { id: quotationId, organizationId: actor.organizationId! } });
    if (!quotation) throw new Error("Quotation not found.");
    const allowed: Record<typeof target, string[]> = {
      SENT: ["DRAFT"], ACCEPTED: ["SENT"], REJECTED: ["SENT"], EXPIRED: ["SENT"], CANCELLED: ["DRAFT", "SENT"],
    };
    if (!allowed[target].includes(quotation.status)) throw new Error(`Quotation cannot be marked ${target.toLowerCase()} from its current status.`);
    const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
    if (target === "ACCEPTED" && quotation.validUntil < today) throw new Error("This quotation has expired and cannot be accepted.");
    if (target === "EXPIRED" && quotation.validUntil >= today) throw new Error("Quotation validity has not ended yet.");
    const timestamp = new Date();
    await prisma.$transaction([
      prisma.quotation.update({
        where: { id: quotationId },
        data: {
          status: target,
          sentAt: target === "SENT" ? timestamp : quotation.sentAt,
          acceptedAt: target === "ACCEPTED" ? timestamp : null,
          rejectedAt: target === "REJECTED" ? timestamp : null,
          expiredAt: target === "EXPIRED" ? timestamp : null,
          cancelledAt: target === "CANCELLED" ? timestamp : null,
        },
      }),
      prisma.auditLog.create({ data: { organizationId: actor.organizationId!, actorId: actor.id, action: `quotation.${target.toLowerCase()}`, entityType: "Quotation", entityId: quotationId, before: { status: quotation.status }, after: { status: target } } }),
    ]);
    revalidateQuotations(locale, quotationId);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Quotation status could not be updated.")));
  }
  redirect(feedbackUrl(destination, "success", `Quotation marked ${target.toLowerCase()}.`));
}

export async function sendQuotation(formData: FormData) { return changeQuotationStatus(formData, "SENT"); }
export async function acceptQuotation(formData: FormData) { return changeQuotationStatus(formData, "ACCEPTED"); }
export async function rejectQuotation(formData: FormData) { return changeQuotationStatus(formData, "REJECTED"); }
export async function expireQuotation(formData: FormData) { return changeQuotationStatus(formData, "EXPIRED"); }
export async function cancelQuotation(formData: FormData) { return changeQuotationStatus(formData, "CANCELLED"); }

export async function convertQuotation(formData: FormData) {
  const locale = localeFrom(formData);
  const quotationId = requiredText(formData, "quotationId");
  const destination = `/${locale}/quotations/${quotationId}`;
  try {
    const actor = await requirePermission(locale, "quotations.manage");
    const managerId = requiredText(formData, "primaryManagerId");
    const manager = await prisma.user.findFirst({ where: { id: managerId, organizationId: actor.organizationId!, status: "ACTIVE" } });
    if (!manager) throw new Error("Project manager not found.");
    const pricingModel = requiredText(formData, "pricingModel");
    if (!pricingModels.includes(pricingModel as (typeof pricingModels)[number])) throw new Error("Invalid pricing model.");
    const startDate = optionalDate(formData, "startDate");
    const targetDate = optionalDate(formData, "targetDate");
    if (startDate && targetDate && targetDate < startDate) throw new Error("Target date must be on or after the start date.");
    const invoiceAmount = nonNegativeNumber(formData, "invoiceAmount");
    const invoiceDueDate = invoiceAmount > 0 ? dateValue(formData, "invoiceDueDate") : null;

    await prisma.$transaction(async (transaction) => {
      const quotation = await transaction.quotation.findFirst({ where: { id: quotationId, organizationId: actor.organizationId! } });
      if (!quotation) throw new Error("Quotation not found.");
      if (quotation.status !== "ACCEPTED") throw new Error("Only accepted quotations can be converted.");
      if (quotation.convertedProjectId || quotation.convertedInvoiceId) throw new Error("Quotation has already been converted.");
      if (invoiceAmount > Number(quotation.totalAmount) + 0.001) throw new Error("Initial invoice cannot exceed the quotation total.");

      const project = await transaction.project.create({
        data: {
          organizationId: actor.organizationId!,
          clientId: quotation.clientId,
          primaryManagerId: managerId,
          code: requiredText(formData, "projectCode", 24).toUpperCase(),
          name: requiredText(formData, "projectName"),
          description: quotation.description || quotation.title,
          status: "PLANNED",
          pricingModel: pricingModel as (typeof pricingModels)[number],
          currency: quotation.currency,
          contractValue: quotation.totalAmount,
          plannedBudget: nonNegativeNumber(formData, "plannedBudget"),
          startDate,
          targetDate,
        },
      });
      await transaction.projectMember.create({ data: { projectId: project.id, userId: managerId, role: "PROJECT_MANAGER" } });

      let invoiceId: string | null = null;
      if (invoiceAmount > 0 && invoiceDueDate) {
        const ratio = invoiceAmount / Number(quotation.totalAmount);
        const netAmount = Number(quotation.subtotal) - Number(quotation.discountAmount);
        const invoiceSubtotal = roundMoney(netAmount * ratio);
        const invoiceTax = roundMoney(invoiceAmount - invoiceSubtotal);
        const invoice = await transaction.invoice.create({
          data: {
            organizationId: actor.organizationId!, clientId: quotation.clientId, projectId: project.id, createdById: actor.id,
            number: requiredText(formData, "invoiceNumber", 60).toUpperCase(),
            description: `Initial invoice - ${quotation.title}`,
            issueDate: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())),
            dueDate: invoiceDueDate,
            subtotal: invoiceSubtotal,
            taxAmount: invoiceTax,
            totalAmount: roundMoney(invoiceSubtotal + invoiceTax),
            currency: quotation.currency,
            notes: `Created from quotation ${quotation.number}.`,
          },
        });
        invoiceId = invoice.id;
      }

      await transaction.quotation.update({ where: { id: quotationId }, data: { convertedProjectId: project.id, convertedInvoiceId: invoiceId } });
      await transaction.auditLog.createMany({
        data: [
          { organizationId: actor.organizationId!, actorId: actor.id, action: "quotation.converted", entityType: "Quotation", entityId: quotationId, after: { projectId: project.id, invoiceId } },
          { organizationId: actor.organizationId!, actorId: actor.id, action: "project.created_from_quotation", entityType: "Project", entityId: project.id, after: { quotationId, contractValue: quotation.totalAmount.toString() } },
        ],
      });
    });
    revalidateQuotations(locale, quotationId);
    revalidatePath(`/${locale}/projects`);
    revalidatePath(`/${locale}/invoices`);
    revalidatePath(`/${locale}/financials`);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Quotation could not be converted.")));
  }
  redirect(feedbackUrl(destination, "success", "Quotation converted to a project successfully."));
}
