"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isLocale } from "@/i18n/config";
import { actionErrorMessage, feedbackUrl } from "@/lib/action-feedback";
import { requirePermission } from "@/lib/dal";
import { verifyStoredOneDriveConnection } from "@/lib/onedrive";
import { prisma } from "@/lib/prisma";

function localeFrom(formData: FormData) {
  const locale = String(formData.get("locale") ?? "en");
  if (!isLocale(locale)) throw new Error("Invalid locale.");
  return locale;
}

export async function verifyOneDriveConnection(formData: FormData) {
  const locale = localeFrom(formData);
  const destination = `/${locale}/integrations/onedrive`;

  try {
    const actor = await requirePermission(locale, "integrations.manage");
    const connection = await verifyStoredOneDriveConnection(actor.organizationId!);
    await prisma.auditLog.create({
      data: {
        organizationId: actor.organizationId!,
        actorId: actor.id,
        action: "onedrive.verified",
        entityType: "OneDriveConnection",
        entityId: connection.id,
        after: { accountEmail: connection.accountEmail, rootFolderName: connection.rootFolderName },
      },
    });
    revalidatePath(destination);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "OneDrive connection verification failed.")));
  }

  redirect(feedbackUrl(destination, "success", locale === "ar" ? "اتصال OneDrive يعمل بشكل صحيح." : "OneDrive connection is working correctly."));
}

export async function disconnectOneDrive(formData: FormData) {
  const locale = localeFrom(formData);
  const destination = `/${locale}/integrations/onedrive`;

  try {
    const actor = await requirePermission(locale, "integrations.manage");
    const connection = await prisma.oneDriveConnection.findUnique({ where: { organizationId: actor.organizationId! } });
    if (!connection) throw new Error("OneDrive is not connected.");

    await prisma.$transaction([
      prisma.auditLog.create({
        data: {
          organizationId: actor.organizationId!,
          actorId: actor.id,
          action: "onedrive.disconnected",
          entityType: "OneDriveConnection",
          entityId: connection.id,
          before: { accountEmail: connection.accountEmail, rootFolderName: connection.rootFolderName },
        },
      }),
      prisma.oneDriveConnection.delete({ where: { organizationId: actor.organizationId! } }),
    ]);
    revalidatePath(destination);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "OneDrive could not be disconnected.")));
  }

  redirect(feedbackUrl(destination, "success", locale === "ar" ? "تم فصل OneDrive. بقيت الملفات محفوظة في حساب Microsoft." : "OneDrive was disconnected. Existing files remain in the Microsoft account."));
}
