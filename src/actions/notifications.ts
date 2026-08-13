"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isLocale } from "@/i18n/config";
import { requireUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

function localeFrom(formData: FormData) {
  const locale = String(formData.get("locale") ?? "en");
  if (!isLocale(locale)) throw new Error("Invalid locale.");
  return locale;
}

export async function markNotificationRead(formData: FormData) {
  const locale = localeFrom(formData);
  const actor = await requireUser(locale);
  const notificationId = String(formData.get("notificationId") ?? "").trim();
  if (!notificationId || notificationId.length > 128) throw new Error("Invalid notification.");
  await prisma.notification.updateMany({
    where: { id: notificationId, organizationId: actor.organizationId!, userId: actor.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath(`/${locale}/notifications`);
  revalidatePath(`/${locale}`);
}

export async function markAllNotificationsRead(formData: FormData) {
  const locale = localeFrom(formData);
  const actor = await requireUser(locale);
  await prisma.notification.updateMany({
    where: { organizationId: actor.organizationId!, userId: actor.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath(`/${locale}/notifications`);
  revalidatePath(`/${locale}`);
  redirect(`/${locale}/notifications`);
}
