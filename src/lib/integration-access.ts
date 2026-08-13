import "server-only";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { permissionKeysFor } from "@/lib/security-policy";

export async function getIntegrationRequestUser(requestHeaders: globalThis.Headers) {
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session?.user.id) return null;

  return prisma.user.findFirst({
    where: { id: session.user.id, status: "ACTIVE", organizationId: { not: null } },
    include: {
      organization: true,
      roleAssignments: {
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      },
    },
  });
}

export function canManageIntegrations(user: NonNullable<Awaited<ReturnType<typeof getIntegrationRequestUser>>>) {
  return permissionKeysFor(user).has("integrations.manage");
}
