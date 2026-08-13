import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

const CONFIRMATION = "CLEAN_BYTECH_DATABASE";
const connectionString = process.env.DATABASE_URL;
const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();

if (process.env.CLEAN_DATABASE_CONFIRMATION !== CONFIRMATION) {
  throw new Error(
    `Refusing to clean the database. Set CLEAN_DATABASE_CONFIRMATION=${CONFIRMATION}.`,
  );
}

if (!connectionString) {
  throw new Error("DATABASE_URL is required.");
}

if (!adminEmail) {
  throw new Error("BOOTSTRAP_ADMIN_EMAIL is required so the administrator can be preserved.");
}

const databaseUrl = new URL(connectionString);
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

if (!localHosts.has(databaseUrl.hostname)) {
  throw new Error(
    `Refusing to clean non-local database host "${databaseUrl.hostname}". This script prepares a local deployment copy only.`,
  );
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  const admin = await prisma.user.findUnique({
    where: { email: adminEmail },
    include: {
      roleAssignments: {
        include: { role: true },
      },
    },
  });

  if (!admin?.organizationId) {
    throw new Error(`Administrator ${adminEmail} was not found in an organization.`);
  }

  const adminRole = admin.roleAssignments.find(
    ({ projectId, role }) => projectId === null && role.name === "Admin" && role.isSystem,
  )?.role;

  if (!adminRole) {
    throw new Error(`User ${adminEmail} does not have the system Admin role.`);
  }

  const organizationId = admin.organizationId;

  await prisma.$transaction(
    async (tx) => {
      // Remove external tokens/configuration, but never delete remote OneDrive files.
      await tx.oneDriveConnection.deleteMany();

      // Operational and historical records.
      await tx.notification.deleteMany();
      await tx.auditLog.deleteMany();
      await tx.organizationHoliday.deleteMany();
      await tx.employeeLeave.deleteMany();
      await tx.employeeLeaveBalance.deleteMany();

      // Financial records must be removed before their client/project/user records.
      await tx.invoicePayment.deleteMany();
      await tx.invoice.deleteMany();
      await tx.quotationLineItem.deleteMany();
      await tx.quotation.deleteMany();
      await tx.expense.deleteMany();
      await tx.subscriptionAllocation.deleteMany();
      await tx.subscription.deleteMany();

      // Work tracking and project records.
      await tx.timeEntry.deleteMany();
      await tx.timesheet.deleteMany();
      await tx.taskAttachment.deleteMany();
      await tx.projectAttachment.deleteMany();
      await tx.taskComment.deleteMany();
      await tx.taskAssignee.deleteMany();
      await tx.task.deleteMany();
      await tx.milestone.deleteMany();
      await tx.projectMember.deleteMany();
      await tx.project.deleteMany();
      await tx.clientContact.deleteMany();
      await tx.client.deleteMany();
      await tx.employeeCostRate.deleteMany();

      // Authentication state is deployment-specific. Keep only the admin credential.
      await tx.session.deleteMany();
      await tx.verification.deleteMany();
      await tx.account.deleteMany({
        where: {
          NOT: {
            userId: admin.id,
            providerId: "credential",
            accountId: admin.id,
          },
        },
      });

      // Rebuild the sole admin assignment after removing all user/project assignments.
      await tx.userRole.deleteMany();
      await tx.user.updateMany({ data: { departmentId: null } });
      await tx.user.deleteMany({ where: { id: { not: admin.id } } });
      await tx.department.deleteMany();
      await tx.role.deleteMany({ where: { isSystem: false } });
      await tx.organization.deleteMany({ where: { id: { not: organizationId } } });

      await tx.user.update({
        where: { id: admin.id },
        data: {
          departmentId: null,
          employeeNumber: null,
          phone: null,
          image: null,
          employmentStartDate: null,
          employmentEndDate: null,
          lastLoginAt: null,
          status: "ACTIVE",
        },
      });

      await tx.userRole.create({
        data: {
          organizationId,
          userId: admin.id,
          roleId: adminRole.id,
        },
      });
    },
    { maxWait: 10_000, timeout: 120_000 },
  );

  // Prisma Postgres local can be intentionally lightweight; verify serially to
  // avoid opening a burst of connections immediately after the transaction.
  const preservedCounts = {
    organizations: await prisma.organization.count(),
    users: await prisma.user.count(),
    adminCredentials: await prisma.account.count({
      where: { userId: admin.id, providerId: "credential", accountId: admin.id },
    }),
    adminRoleAssignments: await prisma.userRole.count({
      where: { userId: admin.id, roleId: adminRole.id, projectId: null },
    }),
  };

  const operationalCounts = {
    departments: await prisma.department.count(),
    holidays: await prisma.organizationHoliday.count(),
    employeeLeaves: await prisma.employeeLeave.count(),
    leaveBalances: await prisma.employeeLeaveBalance.count(),
    notifications: await prisma.notification.count(),
    sessions: await prisma.session.count(),
    verifications: await prisma.verification.count(),
    clients: await prisma.client.count(),
    clientContacts: await prisma.clientContact.count(),
    projects: await prisma.project.count(),
    projectMembers: await prisma.projectMember.count(),
    milestones: await prisma.milestone.count(),
    tasks: await prisma.task.count(),
    taskAssignees: await prisma.taskAssignee.count(),
    taskComments: await prisma.taskComment.count(),
    taskAttachments: await prisma.taskAttachment.count(),
    projectAttachments: await prisma.projectAttachment.count(),
    timesheets: await prisma.timesheet.count(),
    timeEntries: await prisma.timeEntry.count(),
    employeeCostRates: await prisma.employeeCostRate.count(),
    subscriptions: await prisma.subscription.count(),
    subscriptionAllocations: await prisma.subscriptionAllocation.count(),
    expenses: await prisma.expense.count(),
    invoices: await prisma.invoice.count(),
    invoicePayments: await prisma.invoicePayment.count(),
    quotations: await prisma.quotation.count(),
    quotationLineItems: await prisma.quotationLineItem.count(),
    auditLogs: await prisma.auditLog.count(),
    oneDriveConnections: await prisma.oneDriveConnection.count(),
  };

  console.table({
    ...preservedCounts,
    ...operationalCounts,
  });

  if (
    preservedCounts.organizations !== 1 ||
    preservedCounts.users !== 1 ||
    preservedCounts.adminCredentials !== 1 ||
    preservedCounts.adminRoleAssignments !== 1 ||
    Object.values(operationalCounts).some((count) => count !== 0)
  ) {
    throw new Error("Clean deployment verification failed.");
  }

  console.log(`Clean deployment database prepared. Preserved administrator ${adminEmail}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
