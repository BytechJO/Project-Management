export type PermissionBearingUser = {
  organizationId: string | null;
  roleAssignments: Array<{
    organizationId: string;
    role: {
      organizationId: string;
      permissions: Array<{ permission: { key: string } }>;
    };
  }>;
};

export function permissionKeysFor(user: PermissionBearingUser) {
  if (!user.organizationId) return new Set<string>();

  return new Set(
    user.roleAssignments
      .filter(
        (assignment) =>
          assignment.organizationId === user.organizationId
          && assignment.role.organizationId === user.organizationId,
      )
      .flatMap((assignment) =>
        assignment.role.permissions.map(({ permission }) => permission.key),
      ),
  );
}

export function timesheetApprovalScope(userId: string, canApproveAll: boolean) {
  if (canApproveAll) return {};

  const managedProject = {
    OR: [
      { primaryManagerId: userId },
      { deputyManagerId: userId },
    ],
  };

  return {
    entries: {
      some: { project: managedProject },
      every: { project: managedProject },
    },
  };
}

export type ProjectAccessLevel = "all" | "managed" | "assigned" | "client";

export function projectAccessLevelFor(
  permissions: ReadonlySet<string>,
  hasClientContact = false,
): ProjectAccessLevel {
  if (permissions.has("roles.write") || permissions.has("financials.read")) return "all";
  if (permissions.has("projects.write") || permissions.has("tasks.write") || permissions.has("timesheets.approve")) {
    return "managed";
  }
  if (hasClientContact) return "client";
  return "assigned";
}

export function projectAccessScope(
  userId: string,
  accessLevel: ProjectAccessLevel,
  clientId?: string | null,
) {
  if (accessLevel === "all") return {};
  if (accessLevel === "managed") {
    return { OR: [{ primaryManagerId: userId }, { deputyManagerId: userId }] };
  }
  if (accessLevel === "client") {
    return { clientId: clientId ?? "__no_client_access__" };
  }
  return {
        OR: [
          { primaryManagerId: userId },
          { deputyManagerId: userId },
          { members: { some: { userId } } },
        ],
      };
}

export function documentProjectScope(
  userId: string,
  accessLevel: ProjectAccessLevel,
  clientId?: string | null,
) {
  return accessLevel === "all"
    ? {}
    : { project: projectAccessScope(userId, accessLevel, clientId) };
}

export function taskAccessScope(userId: string, canViewAllTasks: boolean) {
  return canViewAllTasks ? {} : { assignees: { some: { userId } } };
}

export function canViewAllProjectTasks(permissions: ReadonlySet<string>) {
  return permissions.has("roles.write") || permissions.has("tasks.write");
}

export function canManageAllProjects(permissions: ReadonlySet<string>) {
  return permissions.has("roles.write");
}

export function canDeleteRecords(permissions: ReadonlySet<string>) {
  return permissions.has("records.delete");
}

export type HoursReportScope = "all" | "managed" | "own";

export function hoursReportScopeFor(permissions: ReadonlySet<string>): HoursReportScope | null {
  if (permissions.has("financials.read")) return "all";
  if (permissions.has("timesheets.approve")) return "managed";
  if (permissions.has("time_entries.own")) return "own";
  return null;
}

export function canOpenLeavePortal(permissions: ReadonlySet<string>) {
  return permissions.has("time_entries.own")
    || permissions.has("timesheets.approve")
    || permissions.has("employees.write");
}

export type ResourcePlanningScope = "all" | "managed" | "own";

export function resourcePlanningScopeFor(permissions: ReadonlySet<string>): ResourcePlanningScope | null {
  if (permissions.has("employees.read") || permissions.has("roles.write")) return "all";
  if (permissions.has("tasks.write") || permissions.has("timesheets.approve") || permissions.has("projects.write")) {
    return "managed";
  }
  if (permissions.has("time_entries.own")) return "own";
  return null;
}

export function leaveReviewScope(userId: string, canReviewAll: boolean) {
  if (canReviewAll) return {};
  return {
    user: {
      projectMemberships: {
        some: {
          project: {
            OR: [{ primaryManagerId: userId }, { deputyManagerId: userId }],
          },
        },
      },
    },
  };
}

export function canManageProjectRecord(
  userId: string,
  permissions: ReadonlySet<string>,
  project: { primaryManagerId: string; deputyManagerId: string | null },
) {
  if (!permissions.has("projects.write")) return false;
  return canManageAllProjects(permissions)
    || project.primaryManagerId === userId
    || project.deputyManagerId === userId;
}

export function canLogTimeForTask(options: {
  canManageProjects: boolean;
  isProjectMember: boolean;
  isTaskAssignee: boolean;
}) {
  return options.canManageProjects || (options.isProjectMember && options.isTaskAssignee);
}

export function canReviewOwnedResource(actorId: string, ownerId: string) {
  return actorId !== ownerId;
}

export function safeDownloadFilename(filename: string) {
  return filename
    .replace(/[\r\n"]/g, "-")
    .replace(/[^\x20-\x7E]/g, "-")
    .slice(0, 180) || "document.pdf";
}

export function safeNotificationHref(href: string) {
  if (!href.startsWith("/") || href.startsWith("//") || /[\\\0\r\n]/.test(href)) {
    return "/notifications";
  }
  try {
    const parsed = new URL(href, "https://bytech.internal");
    if (parsed.origin !== "https://bytech.internal") return "/notifications";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/notifications";
  }
}
