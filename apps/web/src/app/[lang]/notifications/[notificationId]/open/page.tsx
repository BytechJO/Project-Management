import { notFound, redirect } from "next/navigation";

import { isLocale } from "@/i18n/config";
import { requireUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { safeNotificationHref } from "@/lib/security-policy";

export default async function OpenNotificationPage({ params }: {
  params: Promise<{ lang: string; notificationId: string }>;
}) {
  const { lang, notificationId } = await params;
  if (!isLocale(lang)) notFound();
  const user = await requireUser(lang);
  const notification = await prisma.notification.findFirst({
    where: {
      id: notificationId,
      organizationId: user.organizationId!,
      userId: user.id,
    },
    select: { id: true, href: true, readAt: true },
  });
  if (!notification) redirect(`/${lang}/notifications`);
  if (!notification.readAt) {
    await prisma.notification.updateMany({
      where: { id: notification.id, organizationId: user.organizationId!, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
  }
  redirect(`/${lang}${safeNotificationHref(notification.href)}`);
}
