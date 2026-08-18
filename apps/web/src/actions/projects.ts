"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isLocale } from "@/i18n/config";
import { actionErrorMessage, feedbackUrl } from "@/lib/action-feedback";
import { permissionKeysFor, requirePermission } from "@/lib/dal";
import { notifyUsers } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { canManageAllProjects, projectAccessLevelFor, projectAccessScope } from "@/lib/security-policy";

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

function optionalDate(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${key}.`);
  return date;
}

function nonNegativeNumber(formData: FormData, key: string) {
  const value = Number(formData.get(key) ?? 0);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${key}.`);
  return value;
}

export async function createClient(formData: FormData) {
  const locale = localeFrom(formData);
  try {
    const actor = await requirePermission(locale, "clients.write");
    const name = requiredText(formData, "name");
    const email = optionalText(formData, "email", 160)?.toLowerCase() ?? null;
    const phone = optionalText(formData, "phone", 40);

    if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new Error("Invalid email address.");

    const client = await prisma.client.create({
      data: {
        organizationId: actor.organizationId!,
        name,
        legalName: optionalText(formData, "legalName", 200),
        email,
        phone,
        taxNumber: optionalText(formData, "taxNumber", 60),
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: actor.organizationId!, actorId: actor.id,
        action: "client.created", entityType: "Client", entityId: client.id,
        after: { name, email, phone },
      },
    });

    revalidatePath(`/${locale}/clients`);
    revalidatePath(`/${locale}/projects`);
  } catch (error) {
    redirect(feedbackUrl(`/${locale}/clients`, "error", actionErrorMessage(error, "Client could not be created.")));
  }

  redirect(feedbackUrl(`/${locale}/clients`, "success", "Client created successfully."));
}

export async function updateClient(formData: FormData) {
  const locale = localeFrom(formData);
  const clientId = requiredText(formData, "clientId");

  try {
    const actor = await requirePermission(locale, "clients.write");
    const existing = await prisma.client.findFirst({
      where: { id: clientId, organizationId: actor.organizationId! },
    });
    if (!existing) throw new Error("Client not found.");

    const name = requiredText(formData, "name");
    const email = optionalText(formData, "email", 160)?.toLowerCase() ?? null;
    if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new Error("Invalid email address.");

    const updated = await prisma.client.update({
      where: { id: clientId },
      data: {
        name,
        legalName: optionalText(formData, "legalName", 200),
        email,
        phone: optionalText(formData, "phone", 40),
        taxNumber: optionalText(formData, "taxNumber", 60),
        isActive: String(formData.get("status") ?? "ACTIVE") === "ACTIVE",
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: actor.organizationId!, actorId: actor.id,
        action: "client.updated", entityType: "Client", entityId: clientId,
        before: { name: existing.name, email: existing.email, isActive: existing.isActive },
        after: { name: updated.name, email: updated.email, isActive: updated.isActive },
      },
    });
    revalidatePath(`/${locale}/clients`);
    revalidatePath(`/${locale}/clients/${clientId}`);
    revalidatePath(`/${locale}/projects`);
  } catch (error) {
    redirect(feedbackUrl(`/${locale}/clients/${clientId}`, "error", actionErrorMessage(error, "Client could not be updated.")));
  }

  redirect(feedbackUrl(`/${locale}/clients`, "success", "Client updated successfully."));
}

export async function createProject(formData: FormData) {
  const locale = localeFrom(formData);
  let createdProjectId = "";

  try {
    const actor = await requirePermission(locale, "projects.write");
    if (!canManageAllProjects(permissionKeysFor(actor))) {
      throw new Error("Only organization administrators can create projects.");
    }
    const clientId = requiredText(formData, "clientId");
    const primaryManagerId = requiredText(formData, "primaryManagerId");
    const deputyManagerId = String(formData.get("deputyManagerId") ?? "").trim() || null;
    const name = requiredText(formData, "name");
    const code = requiredText(formData, "code", 24).toUpperCase();
    const pricingModel = requiredText(formData, "pricingModel");

    if (!["FIXED_PRICE", "TIME_AND_MATERIALS", "MONTHLY_RETAINER"].includes(pricingModel)) {
      throw new Error("Invalid pricing model.");
    }

    const [client, manager, deputy] = await Promise.all([
    prisma.client.findFirst({ where: { id: clientId, organizationId: actor.organizationId!, isActive: true } }),
    prisma.user.findFirst({ where: { id: primaryManagerId, organizationId: actor.organizationId!, status: "ACTIVE" } }),
    deputyManagerId
      ? prisma.user.findFirst({ where: { id: deputyManagerId, organizationId: actor.organizationId!, status: "ACTIVE" } })
      : Promise.resolve(null),
  ]);

    if (!client || !manager || (deputyManagerId && !deputy)) {
      throw new Error("Invalid client or project manager.");
    }

    const project = await prisma.$transaction(async (transaction) => {
    const createdProject = await transaction.project.create({
      data: {
        organizationId: actor.organizationId!, clientId, primaryManagerId, deputyManagerId,
        code, name, description: optionalText(formData, "description", 1000), status: "PLANNED",
        pricingModel: pricingModel as "FIXED_PRICE" | "TIME_AND_MATERIALS" | "MONTHLY_RETAINER",
        currency: "JOD", contractValue: nonNegativeNumber(formData, "contractValue"),
        plannedBudget: nonNegativeNumber(formData, "plannedBudget"),
        startDate: optionalDate(formData, "startDate"), targetDate: optionalDate(formData, "targetDate"),
      },
    });

    await transaction.projectMember.create({
      data: { projectId: createdProject.id, userId: primaryManagerId, role: "PROJECT_MANAGER" },
    });
    if (deputyManagerId && deputyManagerId !== primaryManagerId) {
      await transaction.projectMember.create({
        data: { projectId: createdProject.id, userId: deputyManagerId, role: "DEPUTY_MANAGER" },
      });
    }

    await transaction.auditLog.create({
      data: {
        organizationId: actor.organizationId!, actorId: actor.id,
        action: "project.created", entityType: "Project", entityId: createdProject.id,
        after: { name, code, clientId, primaryManagerId, deputyManagerId },
      },
    });
    return createdProject;
    });

    createdProjectId = project.id;
    revalidatePath(`/${locale}/projects`);
  } catch (error) {
    redirect(feedbackUrl(`/${locale}/projects`, "error", actionErrorMessage(error, "Project could not be created.")));
  }

  redirect(feedbackUrl(`/${locale}/projects/${createdProjectId}`, "success", "Project created successfully."));
}

export async function updateProject(formData: FormData) {
  const locale = localeFrom(formData);
  const projectId = requiredText(formData, "projectId");

  try {
    const actor = await requirePermission(locale, "projects.write");
    const projectAccessLevel = projectAccessLevelFor(permissionKeysFor(actor), Boolean(actor.clientContact));
    const existing = await prisma.project.findFirst({
      where: {
        id: projectId,
        organizationId: actor.organizationId!,
        ...projectAccessScope(actor.id, projectAccessLevel, actor.clientContact?.clientId),
      },
    });
    if (!existing) throw new Error("Project not found.");

    const clientId = requiredText(formData, "clientId");
    const primaryManagerId = requiredText(formData, "primaryManagerId");
    const deputyManagerId = String(formData.get("deputyManagerId") ?? "").trim() || null;
    const pricingModel = requiredText(formData, "pricingModel");
    const status = requiredText(formData, "status");

    if (!["FIXED_PRICE", "TIME_AND_MATERIALS", "MONTHLY_RETAINER"].includes(pricingModel)) {
      throw new Error("Invalid pricing model.");
    }
    if (!["DRAFT", "PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"].includes(status)) {
      throw new Error("Invalid project status.");
    }

    const [client, manager, deputy] = await Promise.all([
      prisma.client.findFirst({ where: { id: clientId, organizationId: actor.organizationId! } }),
      prisma.user.findFirst({ where: { id: primaryManagerId, organizationId: actor.organizationId!, status: "ACTIVE" } }),
      deputyManagerId
        ? prisma.user.findFirst({ where: { id: deputyManagerId, organizationId: actor.organizationId!, status: "ACTIVE" } })
        : Promise.resolve(null),
    ]);
    if (!client || !manager || (deputyManagerId && !deputy)) {
      throw new Error("Invalid client or project manager.");
    }

    await prisma.$transaction(async (transaction) => {
      await transaction.project.update({
        where: { id: projectId },
        data: {
          clientId,
          primaryManagerId,
          deputyManagerId,
          name: requiredText(formData, "name"),
          code: requiredText(formData, "code", 24).toUpperCase(),
          description: optionalText(formData, "description", 1000),
          pricingModel: pricingModel as "FIXED_PRICE" | "TIME_AND_MATERIALS" | "MONTHLY_RETAINER",
          status: status as "DRAFT" | "PLANNED" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "CANCELLED",
          contractValue: nonNegativeNumber(formData, "contractValue"),
          plannedBudget: nonNegativeNumber(formData, "plannedBudget"),
          startDate: optionalDate(formData, "startDate"),
          targetDate: optionalDate(formData, "targetDate"),
          completedAt: status === "COMPLETED" ? new Date() : null,
        },
      });

      await transaction.projectMember.updateMany({
        where: { projectId, role: "PROJECT_MANAGER", userId: { not: primaryManagerId } },
        data: { role: "CONTRIBUTOR" },
      });
      await transaction.projectMember.updateMany({
        where: {
          projectId,
          role: "DEPUTY_MANAGER",
          ...(deputyManagerId ? { userId: { not: deputyManagerId } } : {}),
        },
        data: { role: "CONTRIBUTOR" },
      });
      await transaction.projectMember.upsert({
        where: { projectId_userId: { projectId, userId: primaryManagerId } },
        update: { role: "PROJECT_MANAGER" },
        create: { projectId, userId: primaryManagerId, role: "PROJECT_MANAGER" },
      });
      if (deputyManagerId && deputyManagerId !== primaryManagerId) {
        await transaction.projectMember.upsert({
          where: { projectId_userId: { projectId, userId: deputyManagerId } },
          update: { role: "DEPUTY_MANAGER" },
          create: { projectId, userId: deputyManagerId, role: "DEPUTY_MANAGER" },
        });
      }

      await transaction.auditLog.create({
        data: {
          organizationId: actor.organizationId!, actorId: actor.id,
          action: "project.updated", entityType: "Project", entityId: projectId,
          before: { name: existing.name, code: existing.code, status: existing.status },
          after: { name: requiredText(formData, "name"), code: requiredText(formData, "code", 24).toUpperCase(), status },
        },
      });
    });

    revalidatePath(`/${locale}/projects`);
    revalidatePath(`/${locale}/projects/${projectId}`);
  } catch (error) {
    redirect(feedbackUrl(`/${locale}/projects/${projectId}/edit`, "error", actionErrorMessage(error, "Project could not be updated.")));
  }

  redirect(feedbackUrl(`/${locale}/projects/${projectId}`, "success", "Project updated successfully."));
}

export async function assignProjectMember(formData: FormData) {
  const locale = localeFrom(formData);
  const actor = await requirePermission(locale, "projects.write");
  const projectAccessLevel = projectAccessLevelFor(permissionKeysFor(actor), Boolean(actor.clientContact));
  const projectId = requiredText(formData, "projectId");
  const userId = requiredText(formData, "userId");
  const allocationPercent = nonNegativeNumber(formData, "allocationPercent");
  if (allocationPercent > 100) throw new Error("Allocation cannot exceed 100%.");

  const [project, employee] = await Promise.all([
    prisma.project.findFirst({
      where: {
        id: projectId,
        organizationId: actor.organizationId!,
        ...projectAccessScope(actor.id, projectAccessLevel, actor.clientContact?.clientId),
      },
    }),
    prisma.user.findFirst({ where: { id: userId, organizationId: actor.organizationId!, status: "ACTIVE" } }),
  ]);
  if (!project || !employee) throw new Error("Invalid project or employee.");

  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId, userId } },
    update: { allocationPercent, role: "CONTRIBUTOR" },
    create: { projectId, userId, allocationPercent, role: "CONTRIBUTOR" },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: actor.organizationId!, actorId: actor.id,
      action: "project.member_assigned", entityType: "Project", entityId: projectId,
      after: { userId, allocationPercent },
    },
  });
  revalidatePath(`/${locale}/projects/${projectId}`);
  revalidatePath(`/${locale}/projects`);
}

export async function createTask(formData: FormData) {
  const locale = localeFrom(formData);
  const actor = await requirePermission(locale, "tasks.write");
  const projectAccessLevel = projectAccessLevelFor(permissionKeysFor(actor), Boolean(actor.clientContact));
  const projectId = requiredText(formData, "projectId");
  const title = requiredText(formData, "title", 240);
  const assigneeIds = [...new Set([
    ...formData.getAll("assigneeIds").map(String),
    String(formData.get("assigneeId") ?? ""),
  ].map((value) => value.trim()).filter(Boolean))];
  const priority = requiredText(formData, "priority");
  const estimatedHours = nonNegativeNumber(formData, "estimatedHours");
  if (!["LOW", "MEDIUM", "HIGH", "URGENT"].includes(priority)) throw new Error("Invalid priority.");

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      organizationId: actor.organizationId!,
      ...projectAccessScope(actor.id, projectAccessLevel, actor.clientContact?.clientId),
    },
    include: { members: { select: { userId: true } } },
  });
  if (!project) throw new Error("Project not found.");
  if (assigneeIds.some((assigneeId) => !project.members.some((member) => member.userId === assigneeId))) {
    throw new Error("Every assignee must be a member of the project team.");
  }

  const minutes = Math.round(estimatedHours * 60);
  const task = await prisma.task.create({
    data: {
      projectId, title, description: optionalText(formData, "description", 1500), status: "TODO",
      priority: priority as "LOW" | "MEDIUM" | "HIGH" | "URGENT",
      dueDate: optionalDate(formData, "dueDate"), estimatedMinutes: minutes, remainingMinutes: minutes,
      assignees: assigneeIds.length ? { create: assigneeIds.map((userId, index) => ({ userId, isPrimary: index === 0 })) } : undefined,
    },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: actor.organizationId!, actorId: actor.id,
      action: "task.created", entityType: "Task", entityId: task.id,
      after: { projectId, title, assigneeIds, priority },
    },
  });
  await notifyUsers(prisma, {
    organizationId: actor.organizationId!,
    userIds: assigneeIds.filter((userId) => userId !== actor.id),
    kind: "TASK_ASSIGNED",
    titleEn: "New task assigned to you",
    titleAr: "تم تعيين تاسك جديدة لك",
    bodyEn: `${title} was assigned to you in ${project.name}.`,
    bodyAr: `تم تعيين ${title} لك في مشروع ${project.name}.`,
    href: `/projects/${projectId}/tasks/${task.id}`,
    entityType: "Task",
    entityId: task.id,
    dedupeKey: `task.assigned:${task.id}`,
  });
  revalidatePath(`/${locale}/projects/${projectId}`);
  revalidatePath(`/${locale}/notifications`);
}
