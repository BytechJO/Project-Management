"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Locale } from "@/i18n/config";
import { isLocale } from "@/i18n/config";
import { actionErrorMessage, feedbackUrl } from "@/lib/action-feedback";
import { requirePermission } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

function localeFrom(formData: FormData) {
  const locale = String(formData.get("locale") ?? "en");
  if (!isLocale(locale)) throw new Error("Invalid locale.");
  return locale;
}

function requiredId(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value || value.length > 128) throw new Error(`Invalid ${key}.`);
  return value;
}

function requireDeletionConfirmation(formData: FormData) {
  if (formData.get("confirmation") !== "DELETE") {
    throw new Error("Deletion confirmation is required.");
  }
}

function revalidateProjectPaths(locale: Locale, projectId?: string) {
  revalidatePath(`/${locale}`);
  revalidatePath(`/${locale}/projects`);
  revalidatePath(`/${locale}/calendar`);
  revalidatePath(`/${locale}/timesheets`);
  revalidatePath(`/${locale}/notifications`);
  if (projectId) revalidatePath(`/${locale}/projects/${projectId}`);
}

export async function deleteTask(formData: FormData) {
  const locale = localeFrom(formData);
  const projectId = requiredId(formData, "projectId");
  const taskId = requiredId(formData, "taskId");
  const destination = `/${locale}/projects/${projectId}/tasks/${taskId}`;

  try {
    requireDeletionConfirmation(formData);
    const actor = await requirePermission(locale, "records.delete");

    await prisma.$transaction(async (transaction) => {
      const task = await transaction.task.findFirst({
        where: {
          id: taskId,
          projectId,
          project: { organizationId: actor.organizationId! },
        },
        select: {
          id: true,
          title: true,
          status: true,
          _count: { select: { timeEntries: true, subtasks: true } },
        },
      });
      if (!task) throw new Error("Task not found.");
      if (task._count.timeEntries) {
        throw new Error("Task cannot be deleted because it has recorded time. Archive it instead.");
      }
      if (task._count.subtasks) {
        throw new Error("Task cannot be deleted while it has subtasks. Delete the subtasks first.");
      }

      await transaction.auditLog.create({
        data: {
          organizationId: actor.organizationId!,
          actorId: actor.id,
          action: "task.deleted",
          entityType: "Task",
          entityId: task.id,
          before: { projectId, title: task.title, status: task.status },
        },
      });
      await transaction.task.delete({ where: { id: task.id } });
    });

    revalidateProjectPaths(locale, projectId);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Task could not be deleted.")));
  }

  redirect(feedbackUrl(`/${locale}/projects/${projectId}`, "success", "Task deleted permanently."));
}

export async function deleteProject(formData: FormData) {
  const locale = localeFrom(formData);
  const projectId = requiredId(formData, "projectId");
  const destination = `/${locale}/projects/${projectId}/edit`;

  try {
    requireDeletionConfirmation(formData);
    const actor = await requirePermission(locale, "records.delete");

    await prisma.$transaction(async (transaction) => {
      const project = await transaction.project.findFirst({
        where: { id: projectId, organizationId: actor.organizationId! },
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          sourceQuotation: { select: { id: true } },
          _count: {
            select: {
              timeEntries: true,
              invoices: true,
              expenses: true,
              subscriptionAllocations: true,
            },
          },
        },
      });
      if (!project) throw new Error("Project not found.");
      if (project._count.timeEntries) {
        throw new Error("Project cannot be deleted because it has recorded time. Cancel it instead.");
      }
      if (project._count.invoices) {
        throw new Error("Project cannot be deleted because invoices are connected to it.");
      }
      if (project._count.expenses) {
        throw new Error("Project cannot be deleted because expenses are connected to it.");
      }
      if (project._count.subscriptionAllocations) {
        throw new Error("Project cannot be deleted because subscription costs are allocated to it.");
      }
      if (project.sourceQuotation) {
        throw new Error("Project cannot be deleted because it was created from a quotation.");
      }

      await transaction.auditLog.create({
        data: {
          organizationId: actor.organizationId!,
          actorId: actor.id,
          action: "project.deleted",
          entityType: "Project",
          entityId: project.id,
          before: { code: project.code, name: project.name, status: project.status },
        },
      });
      await transaction.project.delete({ where: { id: project.id } });
    });

    revalidateProjectPaths(locale, projectId);
    revalidatePath(`/${locale}/financials`);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Project could not be deleted.")));
  }

  redirect(feedbackUrl(`/${locale}/projects`, "success", "Project deleted permanently."));
}

export async function deleteEmployee(formData: FormData) {
  const locale = localeFrom(formData);
  const employeeId = requiredId(formData, "employeeId");
  const destination = `/${locale}/employees/${employeeId}`;

  try {
    requireDeletionConfirmation(formData);
    const actor = await requirePermission(locale, "records.delete");
    if (employeeId === actor.id) throw new Error("You cannot delete your own account.");

    await prisma.$transaction(async (transaction) => {
      const employee = await transaction.user.findFirst({
        where: { id: employeeId, organizationId: actor.organizationId! },
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          _count: {
            select: {
              primaryManagedProjects: true,
              timeEntries: true,
              timesheets: true,
              taskComments: true,
              taskAttachments: true,
              submittedExpenses: true,
              createdInvoices: true,
              createdQuotations: true,
              recordedInvoicePayments: true,
            },
          },
        },
      });
      if (!employee) throw new Error("Employee not found.");
      if (employee._count.primaryManagedProjects) {
        throw new Error("Employee cannot be deleted while assigned as a primary project manager.");
      }
      if (employee._count.timeEntries || employee._count.timesheets) {
        throw new Error("Employee cannot be deleted because time records exist. Archive the account instead.");
      }
      if (employee._count.taskComments || employee._count.taskAttachments) {
        throw new Error("Employee cannot be deleted because task activity is connected to the account.");
      }
      if (
        employee._count.submittedExpenses
        || employee._count.createdInvoices
        || employee._count.createdQuotations
        || employee._count.recordedInvoicePayments
      ) {
        throw new Error("Employee cannot be deleted because financial records are connected to the account.");
      }

      await transaction.auditLog.create({
        data: {
          organizationId: actor.organizationId!,
          actorId: actor.id,
          action: "employee.deleted",
          entityType: "User",
          entityId: employee.id,
          before: { name: employee.name, email: employee.email, status: employee.status },
        },
      });
      await transaction.user.delete({ where: { id: employee.id } });
    });

    revalidatePath(`/${locale}/employees`);
    revalidatePath(`/${locale}/projects`);
    revalidatePath(`/${locale}/financials`);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Employee could not be deleted.")));
  }

  redirect(feedbackUrl(`/${locale}/employees`, "success", "Employee deleted permanently."));
}

export async function deleteClient(formData: FormData) {
  const locale = localeFrom(formData);
  const clientId = requiredId(formData, "clientId");
  const destination = `/${locale}/clients/${clientId}`;

  try {
    requireDeletionConfirmation(formData);
    const actor = await requirePermission(locale, "records.delete");

    await prisma.$transaction(async (transaction) => {
      const client = await transaction.client.findFirst({
        where: { id: clientId, organizationId: actor.organizationId! },
        select: {
          id: true,
          name: true,
          isActive: true,
          contacts: {
            where: { portalUserId: { not: null } },
            select: { id: true },
            take: 1,
          },
          _count: { select: { projects: true, expenses: true, invoices: true, quotations: true } },
        },
      });
      if (!client) throw new Error("Client not found.");
      if (client._count.projects) {
        throw new Error("Client cannot be deleted while projects are connected to it.");
      }
      if (client._count.invoices || client._count.quotations || client._count.expenses) {
        throw new Error("Client cannot be deleted because financial records are connected to it.");
      }
      if (client.contacts.length) {
        throw new Error("Client cannot be deleted while a portal user is connected to it.");
      }

      await transaction.auditLog.create({
        data: {
          organizationId: actor.organizationId!,
          actorId: actor.id,
          action: "client.deleted",
          entityType: "Client",
          entityId: client.id,
          before: { name: client.name, isActive: client.isActive },
        },
      });
      await transaction.client.delete({ where: { id: client.id } });
    });

    revalidatePath(`/${locale}/clients`);
    revalidatePath(`/${locale}/projects`);
    revalidatePath(`/${locale}/invoices`);
    revalidatePath(`/${locale}/quotations`);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Client could not be deleted.")));
  }

  redirect(feedbackUrl(`/${locale}/clients`, "success", "Client deleted permanently."));
}
