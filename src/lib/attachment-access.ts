import "server-only";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewAllProjectTasks, permissionKeysFor, projectAccessLevelFor } from "@/lib/security-policy";

export async function getAttachmentRequestAccess(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user.id) return null;

  const user = await prisma.user.findFirst({
    where: { id: session.user.id, status: "ACTIVE", organizationId: { not: null } },
    include: {
      clientContact: true,
      roleAssignments: {
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      },
    },
  });
  if (!user?.organizationId) return null;

  const permissions = permissionKeysFor(user);
  const projectAccessLevel = projectAccessLevelFor(permissions, Boolean(user.clientContact));
  return {
    user,
    permissions,
    projectAccessLevel,
    canViewAllTasks: canViewAllProjectTasks(permissions),
    canReadProjects: permissions.has("projects.read"),
    isInternal: projectAccessLevel !== "client",
  };
}
