import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "better-auth/crypto";

import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed the database.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const permissions = [
  ["dashboard.view", "View dashboard"],
  ["departments.read", "View departments"],
  ["departments.write", "Manage departments"],
  ["employees.read", "View employees"],
  ["employees.write", "Manage employees"],
  ["roles.read", "View roles and permissions"],
  ["roles.write", "Manage roles and permissions"],
  ["clients.read", "View clients"],
  ["clients.write", "Manage clients"],
  ["projects.read", "View projects"],
  ["projects.write", "Manage projects"],
  ["tasks.write", "Manage tasks"],
  ["time_entries.own", "Track own work time"],
  ["timesheets.approve", "Approve team timesheets"],
  ["financials.read", "View financial data"],
  ["financials.write", "Manage financial data"],
  ["expenses.own", "Create and manage own expenses"],
  ["expenses.approve", "Approve expenses"],
  ["subscriptions.manage", "Manage subscriptions"],
  ["invoices.read", "View client invoices and collections"],
  ["invoices.manage", "Manage client invoices and collections"],
  ["quotations.read", "View client quotations"],
  ["quotations.manage", "Manage client quotations"],
  ["audit.read", "View audit log"],
  ["integrations.manage", "Manage company integrations"],
  ["records.delete", "Permanently delete records"],
] as const;

const rolePermissions: Record<string, string[]> = {
  Admin: permissions.map(([key]) => key),
  Accountant: [
    "dashboard.view",
    "clients.read",
    "projects.read",
    "financials.read",
    "financials.write",
    "expenses.own",
    "expenses.approve",
    "subscriptions.manage",
    "invoices.read",
    "invoices.manage",
    "quotations.read",
    "quotations.manage",
  ],
  "Project Manager": [
    "dashboard.view",
    "projects.read",
    "projects.write",
    "tasks.write",
    "time_entries.own",
    "timesheets.approve",
  ],
  Employee: ["dashboard.view", "projects.read", "time_entries.own"],
  Client: ["projects.read"],
};

async function main() {
  const organization = await prisma.organization.upsert({
    where: { slug: "bytech" },
    update: {
      name: "Bytech",
      timezone: "Asia/Amman",
      baseCurrency: "JOD",
      workdayMinutes: 540,
      workdays: [0, 1, 2, 3, 4],
      defaultLocale: "EN",
    },
    create: {
      name: "Bytech",
      slug: "bytech",
      timezone: "Asia/Amman",
      baseCurrency: "JOD",
      workdayMinutes: 540,
      weekStartsOn: 0,
      workdays: [0, 1, 2, 3, 4],
      defaultLocale: "EN",
    },
  });

  const permissionRecords = new Map<string, string>();
  for (const [key, name] of permissions) {
    const permission = await prisma.permission.upsert({
      where: { key },
      update: { name },
      create: { key, name },
    });
    permissionRecords.set(key, permission.id);
  }

  const roles = new Map<string, string>();
  for (const [name, keys] of Object.entries(rolePermissions)) {
    const role = await prisma.role.upsert({
      where: {
        organizationId_name_scope: {
          organizationId: organization.id,
          name,
          scope: "ORGANIZATION",
        },
      },
      update: { isSystem: true },
      create: {
        organizationId: organization.id,
        name,
        scope: "ORGANIZATION",
        isSystem: true,
      },
    });

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: keys.map((key) => ({
        roleId: role.id,
        permissionId: permissionRecords.get(key)!,
      })),
    });
    roles.set(name, role.id);
  }

  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || "Bytech Admin";

  if (!email || !password || password.length < 12) {
    throw new Error("Set BOOTSTRAP_ADMIN_EMAIL and a password of at least 12 characters.");
  }

  const [firstName, ...lastNameParts] = name.split(/\s+/);
  const admin = await prisma.user.upsert({
    where: { email },
    update: {
      organizationId: organization.id,
      departmentId: null,
      name,
      firstName,
      lastName: lastNameParts.join(" ") || null,
      emailVerified: true,
      status: "ACTIVE",
    },
    create: {
      organizationId: organization.id,
      departmentId: null,
      name,
      email,
      firstName,
      lastName: lastNameParts.join(" ") || null,
      emailVerified: true,
      jobTitle: "System Administrator",
      weeklyCapacityMinutes: 2700,
    },
  });

  await prisma.account.upsert({
    where: {
      providerId_accountId: { providerId: "credential", accountId: admin.id },
    },
    update: { password: await hashPassword(password) },
    create: {
      accountId: admin.id,
      providerId: "credential",
      userId: admin.id,
      password: await hashPassword(password),
    },
  });

  const adminRoleId = roles.get("Admin")!;
  const existingAssignment = await prisma.userRole.findFirst({
    where: { userId: admin.id, roleId: adminRoleId, projectId: null },
  });

  if (!existingAssignment) {
    await prisma.userRole.create({
      data: {
        organizationId: organization.id,
        userId: admin.id,
        roleId: adminRoleId,
      },
    });
  }

  console.log(`Seeded Bytech workspace and administrator ${email}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
