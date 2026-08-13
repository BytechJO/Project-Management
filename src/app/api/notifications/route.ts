import type { NextRequest } from "next/server";

import { auth } from "@/lib/auth";
import { syncOperationalNotificationsIfDue } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user.id) return new Response("Authentication required.", { status: 401 });
  const user = await prisma.user.findFirst({
    where: { id: session.user.id, status: "ACTIVE" },
    include: {
      organization: true,
      roleAssignments: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    },
  });
  if (!user?.organizationId) return new Response("Authentication required.", { status: 401 });
  await syncOperationalNotificationsIfDue({ ...user, organizationId: user.organizationId });
  const locale = request.nextUrl.searchParams.get("lang") === "ar" ? "ar" : "en";
  const [unreadCount, latest] = await Promise.all([
    prisma.notification.count({ where: { organizationId: user.organizationId, userId: user.id, readAt: null } }),
    prisma.notification.findFirst({
      where: { organizationId: user.organizationId, userId: user.id, readAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, titleEn: true, titleAr: true, bodyEn: true, bodyAr: true, href: true, createdAt: true },
    }),
  ]);
  return Response.json({
    unreadCount,
    latest: latest ? {
      id: latest.id,
      title: locale === "ar" ? latest.titleAr : latest.titleEn,
      body: locale === "ar" ? latest.bodyAr : latest.bodyEn,
      href: `/${locale}/notifications/${latest.id}/open`,
      createdAt: latest.createdAt.toISOString(),
    } : null,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
