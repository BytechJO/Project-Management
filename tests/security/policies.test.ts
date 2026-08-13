import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { actionErrorMessage } from "../../src/lib/action-feedback";
import { attachmentMaxBytes, formatAttachmentSize, safeAttachmentName, validateAttachmentDescriptor } from "../../src/lib/attachment-policy";
import { auditActionLabel, auditSnapshotRows } from "../../src/lib/audit-log";
import { decryptOneDriveValue, encryptOneDriveValue } from "../../src/lib/onedrive-crypto";
import { calculateWorkingLeaveMinutes } from "../../src/lib/leave-policy";
import { effectiveRemainingMinutes, plannedTaskMinutesForWeek, startOfWeek, workingDatesBetween } from "../../src/lib/resource-planning-policy";
import {
  canOpenLeavePortal,
  canLogTimeForTask,
  canDeleteRecords,
  canManageProjectRecord,
  canReviewOwnedResource,
  canViewAllProjectTasks,
  documentProjectScope,
  hoursReportScopeFor,
  leaveReviewScope,
  permissionKeysFor,
  projectAccessLevelFor,
  projectAccessScope,
  resourcePlanningScopeFor,
  safeDownloadFilename,
  safeNotificationHref,
  taskAccessScope,
  timesheetApprovalScope,
} from "../../src/lib/security-policy";

describe("organization permission isolation", () => {
  test("accepts permissions only when the assignment and role belong to the active organization", () => {
    const permissions = permissionKeysFor({
      organizationId: "org-a",
      roleAssignments: [
        {
          organizationId: "org-a",
          role: {
            organizationId: "org-a",
            permissions: [
              { permission: { key: "projects.read" } },
              { permission: { key: "projects.write" } },
            ],
          },
        },
        {
          organizationId: "org-b",
          role: {
            organizationId: "org-b",
            permissions: [{ permission: { key: "financials.write" } }],
          },
        },
        {
          organizationId: "org-a",
          role: {
            organizationId: "org-b",
            permissions: [{ permission: { key: "employees.write" } }],
          },
        },
      ],
    });

    assert.deepEqual([...permissions].sort(), ["projects.read", "projects.write"]);
  });

  test("returns no permissions for a user without an organization", () => {
    assert.equal(permissionKeysFor({ organizationId: null, roleAssignments: [] }).size, 0);
  });
});

describe("resource ownership and project scope", () => {
  test("requires a regular employee to be both a project member and task assignee", () => {
    assert.equal(canLogTimeForTask({ canManageProjects: false, isProjectMember: true, isTaskAssignee: true }), true);
    assert.equal(canLogTimeForTask({ canManageProjects: false, isProjectMember: true, isTaskAssignee: false }), false);
    assert.equal(canLogTimeForTask({ canManageProjects: false, isProjectMember: false, isTaskAssignee: true }), false);
  });

  test("allows a project manager to log time while keeping employee restrictions intact", () => {
    assert.equal(canLogTimeForTask({ canManageProjects: true, isProjectMember: false, isTaskAssignee: false }), true);
  });

  test("prevents reviewers from reviewing their own resource", () => {
    assert.equal(canReviewOwnedResource("user-1", "user-1"), false);
    assert.equal(canReviewOwnedResource("user-1", "user-2"), true);
  });

  test("limits timesheet approval to projects managed by the approver", () => {
    const scope = timesheetApprovalScope("manager-1", false);
    const managedProject = {
      OR: [
        { primaryManagerId: "manager-1" },
        { deputyManagerId: "manager-1" },
      ],
    };

    assert.deepEqual(scope, {
      entries: {
        some: { project: managedProject },
        every: { project: managedProject },
      },
    });
    assert.deepEqual(timesheetApprovalScope("admin-1", true), {});
  });

  test("limits document access using the same project role matrix", () => {
    assert.deepEqual(documentProjectScope("user-1", "all"), {});
    assert.deepEqual(documentProjectScope("manager-1", "managed"), {
      project: {
        OR: [
          { primaryManagerId: "manager-1" },
          { deputyManagerId: "manager-1" },
        ],
      },
    });
    assert.deepEqual(documentProjectScope("user-1", "assigned"), {
      project: {
        OR: [
          { primaryManagerId: "user-1" },
          { deputyManagerId: "user-1" },
          { members: { some: { userId: "user-1" } } },
        ],
      },
    });
    assert.deepEqual(documentProjectScope("client-user", "client", "client-1"), {
      project: { clientId: "client-1" },
    });
  });

  test("limits an employee to assigned projects and tasks", () => {
    assert.deepEqual(projectAccessScope("employee-1", "assigned"), {
      OR: [
        { primaryManagerId: "employee-1" },
        { deputyManagerId: "employee-1" },
        { members: { some: { userId: "employee-1" } } },
      ],
    });
    assert.deepEqual(taskAccessScope("employee-1", false), {
      assignees: { some: { userId: "employee-1" } },
    });
  });

  test("limits project managers to projects they directly manage", () => {
    assert.deepEqual(projectAccessScope("manager-1", "managed"), {
      OR: [
        { primaryManagerId: "manager-1" },
        { deputyManagerId: "manager-1" },
      ],
    });
    assert.deepEqual(taskAccessScope("manager-1", true), {});
  });

  test("keeps organization-wide project access for admin and finance roles", () => {
    assert.equal(projectAccessLevelFor(new Set(["roles.write"])), "all");
    assert.equal(projectAccessLevelFor(new Set(["financials.read"])), "all");
    assert.deepEqual(projectAccessScope("admin-1", "all"), {});
  });

  test("maps employee, project manager, and client roles to separate scopes", () => {
    assert.equal(projectAccessLevelFor(new Set(["projects.read"])), "assigned");
    assert.equal(projectAccessLevelFor(new Set(["projects.read", "projects.write", "tasks.write"])), "managed");
    assert.equal(projectAccessLevelFor(new Set(["projects.read"]), true), "client");
    assert.deepEqual(projectAccessScope("client-user", "client", "client-1"), { clientId: "client-1" });
    assert.deepEqual(projectAccessScope("client-user", "client", null), { clientId: "__no_client_access__" });
  });

  test("grants full task visibility only to task managers and administrators", () => {
    assert.equal(canViewAllProjectTasks(new Set(["roles.write"])), true);
    assert.equal(canViewAllProjectTasks(new Set(["tasks.write"])), true);
    assert.equal(canViewAllProjectTasks(new Set(["financials.read"])), false);
    assert.equal(canViewAllProjectTasks(new Set(["projects.read"])), false);
  });

  test("lets project managers modify only projects they manage", () => {
    const project = { primaryManagerId: "manager-1", deputyManagerId: "manager-2" };
    assert.equal(canManageProjectRecord("manager-1", new Set(["projects.write"]), project), true);
    assert.equal(canManageProjectRecord("manager-2", new Set(["projects.write"]), project), true);
    assert.equal(canManageProjectRecord("manager-3", new Set(["projects.write"]), project), false);
    assert.equal(canManageProjectRecord("admin-1", new Set(["projects.write", "roles.write"]), project), true);
    assert.equal(canManageProjectRecord("manager-1", new Set(["projects.read"]), project), false);
  });

  test("requires the dedicated destructive-record permission", () => {
    assert.equal(canDeleteRecords(new Set(["records.delete"])), true);
    assert.equal(canDeleteRecords(new Set(["roles.write", "projects.write"])), false);
  });

  test("keeps monthly hours reports inside the role-specific scope", () => {
    assert.equal(hoursReportScopeFor(new Set(["financials.read", "timesheets.approve"])), "all");
    assert.equal(hoursReportScopeFor(new Set(["timesheets.approve", "time_entries.own"])), "managed");
    assert.equal(hoursReportScopeFor(new Set(["time_entries.own"])), "own");
    assert.equal(hoursReportScopeFor(new Set(["projects.read"])), null);
  });

  test("opens leave only to employees, reviewers, and employee administrators", () => {
    assert.equal(canOpenLeavePortal(new Set(["time_entries.own"])), true);
    assert.equal(canOpenLeavePortal(new Set(["timesheets.approve"])), true);
    assert.equal(canOpenLeavePortal(new Set(["employees.write"])), true);
    assert.equal(canOpenLeavePortal(new Set(["projects.read"])), false);
  });

  test("limits project managers to leave requests from members of projects they manage", () => {
    assert.deepEqual(leaveReviewScope("manager-1", false), {
      user: {
        projectMemberships: {
          some: {
            project: {
              OR: [
                { primaryManagerId: "manager-1" },
                { deputyManagerId: "manager-1" },
              ],
            },
          },
        },
      },
    });
    assert.deepEqual(leaveReviewScope("admin-1", true), {});
  });

  test("maps resource planning visibility to admin, manager, and employee scopes", () => {
    assert.equal(resourcePlanningScopeFor(new Set(["employees.read"])), "all");
    assert.equal(resourcePlanningScopeFor(new Set(["tasks.write", "time_entries.own"])), "managed");
    assert.equal(resourcePlanningScopeFor(new Set(["time_entries.own"])), "own");
    assert.equal(resourcePlanningScopeFor(new Set(["projects.read"])), null);
  });
});

describe("attachment upload policy", () => {
  test("sanitizes OneDrive path characters while retaining a readable filename", () => {
    assert.equal(safeAttachmentName("../Client: report?.pdf"), "Client- report-.pdf");
  });

  test("accepts ordinary business documents within the upload limit", () => {
    assert.deepEqual(validateAttachmentDescriptor({ name: "proposal.pdf", size: 2048, type: "application/pdf" }), {
      name: "proposal.pdf",
      sizeBytes: 2048,
      mimeType: "application/pdf",
    });
    assert.equal(formatAttachmentSize(2 * 1024 * 1024), "2 MB");
  });

  test("rejects empty, oversized, and executable attachments", () => {
    assert.throws(() => validateAttachmentDescriptor({ name: "empty.pdf", size: 0 }), /cannot be empty/);
    assert.throws(() => validateAttachmentDescriptor({ name: "large.zip", size: attachmentMaxBytes + 1 }), /10 MB/);
    assert.throws(() => validateAttachmentDescriptor({ name: "payload.exe", size: 100 }), /not allowed/);
  });
});

describe("leave duration calculation", () => {
  test("counts only organization workdays and excludes official holidays", () => {
    const minutes = calculateWorkingLeaveMinutes({
      startDate: new Date("2026-08-09T00:00:00.000Z"),
      endDate: new Date("2026-08-13T00:00:00.000Z"),
      workdays: [0, 1, 2, 3, 4],
      dailyCapacityMinutes: 540,
      minutesPerWorkday: null,
      holidayDates: new Set(["2026-08-11"]),
    });

    assert.equal(minutes, 4 * 540);
  });

  test("uses partial-day minutes without exceeding daily capacity", () => {
    const base = {
      startDate: new Date("2026-08-09T00:00:00.000Z"),
      endDate: new Date("2026-08-09T00:00:00.000Z"),
      workdays: [0, 1, 2, 3, 4],
      dailyCapacityMinutes: 540,
      holidayDates: new Set<string>(),
    };

    assert.equal(calculateWorkingLeaveMinutes({ ...base, minutesPerWorkday: 120 }), 120);
    assert.equal(calculateWorkingLeaveMinutes({ ...base, minutesPerWorkday: 900 }), 540);
  });
});

describe("weekly resource planning", () => {
  const weekStart = new Date("2026-08-09T00:00:00.000Z");
  const weekEnd = new Date("2026-08-16T00:00:00.000Z");
  const workdays = [0, 1, 2, 3, 4];

  test("normalizes any date to the configured Sunday week start", () => {
    assert.equal(startOfWeek(new Date("2026-08-13T12:00:00.000Z"), 0).toISOString(), weekStart.toISOString());
  });

  test("excludes weekends and holidays from available planning dates", () => {
    const dates = workingDatesBetween(
      weekStart,
      new Date("2026-08-15T00:00:00.000Z"),
      workdays,
      new Set(["2026-08-11"]),
    );
    assert.deepEqual(dates.map((date) => date.toISOString().slice(0, 10)), ["2026-08-09", "2026-08-10", "2026-08-12", "2026-08-13"]);
  });

  test("spreads remaining effort across the task's scheduled working weeks", () => {
    const minutes = plannedTaskMinutesForWeek({
      startDate: weekStart,
      dueDate: new Date("2026-08-20T00:00:00.000Z"),
      remainingMinutes: 2700,
      weekStart,
      weekEnd,
      workdays,
      holidayDates: new Set(),
      now: new Date("2026-08-10T00:00:00.000Z"),
    });
    assert.equal(minutes, 1350);
  });

  test("moves all overdue remaining work into the current week and leaves unscheduled work unallocated", () => {
    const base = { weekStart, weekEnd, workdays, holidayDates: new Set<string>(), now: new Date("2026-08-10T00:00:00.000Z") };
    assert.equal(plannedTaskMinutesForWeek({ ...base, startDate: null, dueDate: new Date("2026-08-06T00:00:00.000Z"), remainingMinutes: 600 }), 600);
    assert.equal(plannedTaskMinutesForWeek({ ...base, startDate: null, dueDate: null, remainingMinutes: 600 }), 0);
  });

  test("subtracts actual time automatically unless a manager has overridden remaining effort", () => {
    assert.equal(effectiveRemainingMinutes(600, 600, 180), 420);
    assert.equal(effectiveRemainingMinutes(600, 300, 180), 300);
    assert.equal(effectiveRemainingMinutes(600, 600, 900), 0);
  });
});

describe("safe public output", () => {
  test("does not expose unexpected internal error messages", () => {
    const internal = new Error("Database connection failed for password=top-secret");
    assert.equal(actionErrorMessage(internal, "The operation failed."), "The operation failed.");
  });

  test("keeps known validation and safe database conflict messages", () => {
    assert.equal(actionErrorMessage(new Error("Hours must be between 0.25 and 18."), "Failed."), "Hours must be between 0.25 and 18.");
    assert.equal(actionErrorMessage({ code: "P2002" }, "Failed."), "A record with the same unique value already exists.");
    assert.equal(actionErrorMessage({ code: "P2003" }, "Failed."), "This record is connected to other data and cannot be changed that way.");
  });

  test("removes header injection characters and bounds download filenames", () => {
    const sanitized = safeDownloadFilename("invoice.pdf\r\nSet-Cookie: stolen=true\".pdf");
    assert.equal(sanitized.includes("\r"), false);
    assert.equal(sanitized.includes("\n"), false);
    assert.equal(sanitized.includes('"'), false);
    assert.ok(sanitized.length <= 180);
    assert.equal(safeDownloadFilename(""), "document.pdf");
  });

  test("allows only same-site notification destinations", () => {
    assert.equal(safeNotificationHref("/projects/project-1/tasks/task-1?tab=hours"), "/projects/project-1/tasks/task-1?tab=hours");
    assert.equal(safeNotificationHref("//evil.example/steal"), "/notifications");
    assert.equal(safeNotificationHref("https://evil.example/steal"), "/notifications");
    assert.equal(safeNotificationHref("/\\evil.example/steal"), "/notifications");
    assert.equal(safeNotificationHref("/projects\r\nLocation: https://evil.example"), "/notifications");
  });

  test("redacts sensitive audit fields while keeping normal changes readable", () => {
    const rows = auditSnapshotRows({
      name: "Updated employee",
      accessToken: "must-not-leak",
      settings: { locale: "EN", sessionSecret: "must-not-leak-either" },
    });
    assert.deepEqual(rows.find(({ key }) => key === "name"), { key: "name", value: "Updated employee" });
    assert.deepEqual(rows.find(({ key }) => key === "accessToken"), { key: "accessToken", value: "[REDACTED]" });
    assert.equal(rows.find(({ key }) => key === "settings")?.value.includes("must-not-leak-either"), false);
  });

  test("labels audit actions in both supported languages", () => {
    assert.equal(auditActionLabel("project.created", "Project", "en"), "Project · Created");
    assert.equal(auditActionLabel("project.created", "Project", "ar"), "إنشاء · مشروع");
  });

  test("encrypts OneDrive tokens with authenticated encryption and rejects tampering", () => {
    const key = "a-dedicated-test-key-that-is-longer-than-thirty-two-characters";
    const token = "refresh-token-that-must-never-appear-in-storage";
    const first = encryptOneDriveValue(token, key);
    const second = encryptOneDriveValue(token, key);

    assert.notEqual(first, second);
    assert.equal(first.includes(token), false);
    assert.equal(decryptOneDriveValue(first, key), token);
    assert.throws(() => decryptOneDriveValue(`${first}.tampered`, key), /Invalid encrypted OneDrive value/);
  });
});
