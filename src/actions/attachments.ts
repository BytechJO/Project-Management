"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Locale } from "@/i18n/config";
import { isLocale } from "@/i18n/config";
import { actionErrorMessage, feedbackUrl } from "@/lib/action-feedback";
import { validateAttachmentDescriptor } from "@/lib/attachment-policy";
import { permissionKeysFor, requirePermission } from "@/lib/dal";
import { uploadProjectFileToOneDrive, uploadTaskFileToOneDrive } from "@/lib/onedrive";
import { prisma } from "@/lib/prisma";
import { canViewAllProjectTasks, projectAccessLevelFor, projectAccessScope, taskAccessScope } from "@/lib/security-policy";

function localeFrom(formData: FormData) {
  const locale = String(formData.get("locale") ?? "en");
  if (!isLocale(locale)) throw new Error("Invalid locale.");
  return locale;
}

function requiredId(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value || value.length > 240) throw new Error(`${key} is required.`);
  return value;
}

function attachmentFile(formData: FormData) {
  const value = formData.get("file");
  if (!(value instanceof File)) throw new Error("Attachment file is required.");
  const descriptor = validateAttachmentDescriptor(value);
  return { file: value, descriptor };
}

function revalidateProject(locale: Locale, projectId: string, taskId?: string) {
  revalidatePath(`/${locale}/projects`);
  revalidatePath(`/${locale}/projects/${projectId}`);
  if (taskId) revalidatePath(`/${locale}/projects/${projectId}/tasks/${taskId}`);
  revalidatePath(`/${locale}/activity`);
}

export async function uploadProjectAttachment(formData: FormData) {
  const locale = localeFrom(formData);
  const projectId = requiredId(formData, "projectId");
  const destination = `/${locale}/projects/${projectId}`;

  try {
    const actor = await requirePermission(locale, "projects.read");
    const permissions = permissionKeysFor(actor);
    const accessLevel = projectAccessLevelFor(permissions, Boolean(actor.clientContact));
    if (accessLevel === "client") throw new Error("Project files are available to internal team members only.");

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        organizationId: actor.organizationId!,
        ...projectAccessScope(actor.id, accessLevel, actor.clientContact?.clientId),
      },
      select: { id: true, code: true, name: true, oneDriveFolderId: true },
    });
    if (!project) throw new Error("Project not found.");

    const { file, descriptor } = attachmentFile(formData);
    const item = await uploadProjectFileToOneDrive({
      organizationId: actor.organizationId!,
      project,
      name: descriptor.name,
      mimeType: descriptor.mimeType,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });

    const attachment = await prisma.$transaction(async (tx) => {
      const created = await tx.projectAttachment.create({
        data: {
          projectId,
          uploadedById: actor.id,
          name: descriptor.name,
          url: item.webUrl!,
          storageProvider: "ONEDRIVE",
          oneDriveItemId: item.id,
          mimeType: item.file?.mimeType ?? descriptor.mimeType,
          sizeBytes: item.size ?? descriptor.sizeBytes,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId!,
          actorId: actor.id,
          action: "project.attachment_uploaded",
          entityType: "Project",
          entityId: projectId,
          after: { attachmentId: created.id, name: descriptor.name, storageProvider: "ONEDRIVE" },
        },
      });
      return created;
    });

    revalidateProject(locale, projectId);
    void attachment;
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Attachment could not be uploaded to OneDrive.")));
  }

  redirect(feedbackUrl(destination, "success", locale === "ar" ? "تم رفع الملف إلى OneDrive." : "File uploaded to OneDrive."));
}

export async function uploadTaskAttachment(formData: FormData) {
  const locale = localeFrom(formData);
  const projectId = requiredId(formData, "projectId");
  const taskId = requiredId(formData, "taskId");
  const destination = `/${locale}/projects/${projectId}/tasks/${taskId}`;

  try {
    const actor = await requirePermission(locale, "projects.read");
    const permissions = permissionKeysFor(actor);
    const accessLevel = projectAccessLevelFor(permissions, Boolean(actor.clientContact));
    if (accessLevel === "client") throw new Error("Task files are available to internal team members only.");
    const canViewAllTasks = canViewAllProjectTasks(permissions);

    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        projectId,
        ...taskAccessScope(actor.id, canViewAllTasks),
        project: {
          organizationId: actor.organizationId!,
          ...projectAccessScope(actor.id, accessLevel, actor.clientContact?.clientId),
        },
      },
      select: {
        id: true,
        title: true,
        oneDriveFolderId: true,
        project: { select: { id: true, code: true, name: true, oneDriveFolderId: true } },
      },
    });
    if (!task) throw new Error("Task not found.");

    const { file, descriptor } = attachmentFile(formData);
    const item = await uploadTaskFileToOneDrive({
      organizationId: actor.organizationId!,
      project: task.project,
      task: { id: task.id, title: task.title, oneDriveFolderId: task.oneDriveFolderId },
      name: descriptor.name,
      mimeType: descriptor.mimeType,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });

    await prisma.$transaction(async (tx) => {
      const attachment = await tx.taskAttachment.create({
        data: {
          taskId,
          uploadedById: actor.id,
          name: descriptor.name,
          url: item.webUrl!,
          storageProvider: "ONEDRIVE",
          oneDriveItemId: item.id,
          mimeType: item.file?.mimeType ?? descriptor.mimeType,
          sizeBytes: item.size ?? descriptor.sizeBytes,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: actor.organizationId!,
          actorId: actor.id,
          action: "task.attachment_uploaded",
          entityType: "Task",
          entityId: taskId,
          after: { attachmentId: attachment.id, name: descriptor.name, storageProvider: "ONEDRIVE" },
        },
      });
    });

    revalidateProject(locale, projectId, taskId);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Attachment could not be uploaded to OneDrive.")));
  }

  redirect(feedbackUrl(destination, "success", locale === "ar" ? "تم رفع الملف إلى OneDrive." : "File uploaded to OneDrive."));
}
