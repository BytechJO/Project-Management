import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type { Locale } from "@/i18n/config";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissionKeysFor } from "@/lib/security-policy";

export { permissionKeysFor } from "@/lib/security-policy";

const getCurrentUser = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user.id) {
    return null;
  }

  return prisma.user.findFirst({
    where: { id: session.user.id, status: "ACTIVE" },
    include: {
      organization: true,
      department: true,
      clientContact: true,
      roleAssignments: {
        include: {
          role: {
            include: {
              permissions: { include: { permission: true } },
            },
          },
        },
      },
    },
  });
});

export async function requireUser(locale: Locale) {
  const user = await getCurrentUser();

  if (!user) {
    redirect(`/${locale}/sign-in`);
  }

  if (!user.organizationId) {
    throw new Error("This user is not assigned to an organization.");
  }

  return user;
}

export async function requirePermission(locale: Locale, permissionKey: string) {
  const user = await requireUser(locale);
  const permissions = permissionKeysFor(user);

  if (!permissions.has(permissionKey)) {
    throw new Error("You do not have permission to perform this action.");
  }

  return user;
}

export async function requirePagePermission(locale: Locale, permissionKey: string) {
  const user = await requireUser(locale);

  if (!permissionKeysFor(user).has(permissionKey)) {
    const search = new URLSearchParams({
      error: locale === "ar" ? "ليس لديك صلاحية لفتح هذه الصفحة." : "You do not have permission to open that page.",
    });
    redirect(`/${locale}?${search.toString()}`);
  }

  return user;
}
