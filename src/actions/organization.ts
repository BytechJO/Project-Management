"use server";

import { hashPassword } from "better-auth/crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isLocale } from "@/i18n/config";
import { actionErrorMessage, feedbackUrl } from "@/lib/action-feedback";
import { requirePermission } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

function localeFrom(formData: FormData) {
  const locale = String(formData.get("locale") ?? "en");
  if (!isLocale(locale)) throw new Error("Invalid locale.");
  return locale;
}

function requiredText(formData: FormData, key: string, maxLength = 120) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value || value.length > maxLength) throw new Error(`Invalid ${key}.`);
  return value;
}

function optionalText(formData: FormData, key: string, maxLength = 500) {
  const value = String(formData.get(key) ?? "").trim();
  if (value.length > maxLength) throw new Error(`Invalid ${key}.`);
  return value || null;
}

function positiveNumber(formData: FormData, key: string) {
  const value = Number(formData.get(key));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${key} must be greater than zero.`);
  return value;
}

function nonNegativeNumber(formData: FormData, key: string) {
  const value = Number(formData.get(key) ?? 0);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${key} cannot be negative.`);
  return value;
}

function todayUtc() {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
}

function previousDay(date: Date) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() - 1);
  return result;
}

export async function updateBillingSettings(formData: FormData) {
  const locale = localeFrom(formData);
  const destination = `/${locale}/invoices/settings`;

  try {
    const actor = await requirePermission(locale, "invoices.manage");
    const billingEmail = optionalText(formData, "billingEmail", 180);
    if (billingEmail && !/^\S+@\S+\.\S+$/.test(billingEmail)) throw new Error("Invalid billing email address.");

    const before = await prisma.organization.findUnique({ where: { id: actor.organizationId! } });
    if (!before) throw new Error("Organization not found.");

    const data = {
      billingLegalName: optionalText(formData, "billingLegalName", 200),
      billingEmail,
      billingPhone: optionalText(formData, "billingPhone", 60),
      billingAddress: optionalText(formData, "billingAddress", 500),
      taxNumber: optionalText(formData, "taxNumber", 80),
      website: optionalText(formData, "website", 180),
      bankName: optionalText(formData, "bankName", 160),
      bankAccountName: optionalText(formData, "bankAccountName", 200),
      bankAccountNumber: optionalText(formData, "bankAccountNumber", 100),
      bankIban: optionalText(formData, "bankIban", 100),
      bankSwift: optionalText(formData, "bankSwift", 40),
      paymentTerms: optionalText(formData, "paymentTerms", 1200),
    };

    await prisma.$transaction([
      prisma.organization.update({ where: { id: actor.organizationId! }, data }),
      prisma.auditLog.create({
        data: {
          organizationId: actor.organizationId!,
          actorId: actor.id,
          action: "organization.billing_settings_updated",
          entityType: "Organization",
          entityId: actor.organizationId!,
          before: {
            billingLegalName: before.billingLegalName,
            billingEmail: before.billingEmail,
            taxNumber: before.taxNumber,
            bankIban: before.bankIban,
          },
          after: data,
        },
      }),
    ]);

    revalidatePath(destination);
    revalidatePath(`/${locale}/invoices`);
  } catch (error) {
    redirect(feedbackUrl(destination, "error", actionErrorMessage(error, "Billing settings could not be saved.")));
  }

  redirect(feedbackUrl(destination, "success", "Billing settings saved successfully."));
}

export async function createDepartment(formData: FormData) {
  const locale = localeFrom(formData);
  try {
    const actor = await requirePermission(locale, "departments.write");
    const name = requiredText(formData, "name");
    const code = requiredText(formData, "code", 12).toUpperCase();

    const department = await prisma.department.create({
      data: { organizationId: actor.organizationId!, name, code },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: actor.organizationId!, actorId: actor.id,
        action: "department.created", entityType: "Department", entityId: department.id,
        after: { name, code },
      },
    });
    revalidatePath(`/${locale}/departments`);
  } catch (error) {
    redirect(feedbackUrl(`/${locale}/departments`, "error", actionErrorMessage(error, "Department could not be created.")));
  }

  redirect(feedbackUrl(`/${locale}/departments`, "success", "Department created successfully."));
}

export async function createEmployee(formData: FormData) {
  const locale = localeFrom(formData);
  try {
    const actor = await requirePermission(locale, "employees.write");
    const name = requiredText(formData, "name");
    const email = requiredText(formData, "email").toLowerCase();
    const password = requiredText(formData, "password", 128);
    const departmentId = requiredText(formData, "departmentId");
    const roleId = requiredText(formData, "roleId");
    const jobTitle = optionalText(formData, "jobTitle", 160);
    const monthlySalary = positiveNumber(formData, "monthlySalary");
    const monthlyAllowances = nonNegativeNumber(formData, "monthlyAllowances");
    const monthlyBenefits = nonNegativeNumber(formData, "monthlyBenefits");
    const productiveHoursPerMonth = positiveNumber(formData, "productiveHoursPerMonth");
    const hourlyCost = (monthlySalary + monthlyAllowances + monthlyBenefits) / productiveHoursPerMonth;

    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Invalid email address.");
    if (password.length < 12) throw new Error("Password must be at least 12 characters.");

    const [department, role, existingUser] = await Promise.all([
    prisma.department.findFirst({ where: { id: departmentId, organizationId: actor.organizationId! } }),
    prisma.role.findFirst({ where: { id: roleId, organizationId: actor.organizationId! } }),
    prisma.user.findUnique({ where: { email } }),
  ]);

    if (!department || !role) throw new Error("Invalid department or role.");
    if (existingUser) throw new Error("A user with this email already exists.");

    const [firstName, ...lastNameParts] = name.split(/\s+/);
    const passwordHash = await hashPassword(password);

    await prisma.$transaction(async (transaction) => {
    const employee = await transaction.user.create({
      data: {
        organizationId: actor.organizationId!,
        departmentId,
        name,
        email,
        firstName,
        lastName: lastNameParts.join(" ") || null,
        jobTitle,
        weeklyCapacityMinutes: 2700,
        costRates: {
          create: {
            validFrom: todayUtc(),
            monthlySalary,
            monthlyAllowances,
            monthlyBenefits,
            productiveHoursPerMonth,
            hourlyCost,
            currency: "JOD",
          },
        },
      },
    });

    await transaction.account.create({
      data: {
        accountId: employee.id,
        providerId: "credential",
        userId: employee.id,
        password: passwordHash,
      },
    });

    await transaction.userRole.create({
      data: {
        organizationId: actor.organizationId!,
        userId: employee.id,
        roleId,
      },
    });

    await transaction.auditLog.create({
      data: {
        organizationId: actor.organizationId!,
        actorId: actor.id,
        action: "employee.created",
        entityType: "User",
        entityId: employee.id,
        after: { name, email, departmentId, roleId, monthlySalary, monthlyAllowances, monthlyBenefits, hourlyCost },
      },
    });
    });

    revalidatePath(`/${locale}/employees`);
    revalidatePath(`/${locale}/financials`);
  } catch (error) {
    redirect(feedbackUrl(`/${locale}/employees`, "error", actionErrorMessage(error, "Employee could not be created.")));
  }

  redirect(feedbackUrl(`/${locale}/employees`, "success", "Employee created successfully."));
}

export async function updateEmployee(formData: FormData) {
  const locale = localeFrom(formData);
  const employeeId = requiredText(formData, "employeeId");

  try {
    const actor = await requirePermission(locale, "employees.write");
    const existing = await prisma.user.findFirst({
      where: { id: employeeId, organizationId: actor.organizationId! },
      include: {
        roleAssignments: { where: { projectId: null } },
        costRates: { orderBy: { validFrom: "desc" }, take: 1 },
      },
    });
    if (!existing) throw new Error("Employee not found.");

    const name = requiredText(formData, "name");
    const email = requiredText(formData, "email").toLowerCase();
    const departmentId = requiredText(formData, "departmentId");
    const roleId = requiredText(formData, "roleId");
    const status = requiredText(formData, "status");
    const newPassword = String(formData.get("newPassword") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");
    const weeklyCapacityHours = Number(formData.get("weeklyCapacityHours") ?? 45);
    const monthlySalary = positiveNumber(formData, "monthlySalary");
    const monthlyAllowances = nonNegativeNumber(formData, "monthlyAllowances");
    const monthlyBenefits = nonNegativeNumber(formData, "monthlyBenefits");
    const productiveHoursPerMonth = positiveNumber(formData, "productiveHoursPerMonth");
    const hourlyCost = (monthlySalary + monthlyAllowances + monthlyBenefits) / productiveHoursPerMonth;

    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Invalid email address.");
    if (newPassword || confirmPassword) {
      if (newPassword.length < 12 || newPassword.length > 128) {
        throw new Error("Password must be between 12 and 128 characters.");
      }
      if (newPassword !== confirmPassword) throw new Error("Password confirmation does not match.");
    }
    if (!Number.isFinite(weeklyCapacityHours) || weeklyCapacityHours <= 0 || weeklyCapacityHours > 90) {
      throw new Error("Weekly capacity must be between 1 and 90 hours.");
    }
    if (!["ACTIVE", "INACTIVE", "ARCHIVED"].includes(status)) throw new Error("Invalid employee status.");
    if (employeeId === actor.id && status !== "ACTIVE") {
      throw new Error("You cannot deactivate your own account.");
    }

    const [department, role, duplicateEmail] = await Promise.all([
      prisma.department.findFirst({ where: { id: departmentId, organizationId: actor.organizationId! } }),
      prisma.role.findFirst({ where: { id: roleId, organizationId: actor.organizationId! } }),
      prisma.user.findFirst({ where: { email, id: { not: employeeId } } }),
    ]);
    if (!department || !role) throw new Error("Invalid department or role.");
    if (duplicateEmail) throw new Error("A user with this email already exists.");

    const [firstName, ...lastNameParts] = name.split(/\s+/);
    const effectiveDate = todayUtc();
    const latestCostRate = existing.costRates[0];
    const passwordHash = newPassword ? await hashPassword(newPassword) : null;
    await prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: employeeId },
        data: {
          name,
          email,
          firstName,
          lastName: lastNameParts.join(" ") || null,
          departmentId,
          jobTitle: optionalText(formData, "jobTitle", 160),
          status: status as "ACTIVE" | "INACTIVE" | "ARCHIVED",
          weeklyCapacityMinutes: Math.round(weeklyCapacityHours * 60),
        },
      });
      await transaction.userRole.deleteMany({
        where: { userId: employeeId, organizationId: actor.organizationId!, projectId: null },
      });
      await transaction.userRole.create({
        data: { organizationId: actor.organizationId!, userId: employeeId, roleId },
      });
      if (latestCostRate && latestCostRate.validFrom < effectiveDate) {
        await transaction.employeeCostRate.update({
          where: { id: latestCostRate.id },
          data: { validTo: previousDay(effectiveDate) },
        });
      }
      await transaction.employeeCostRate.upsert({
        where: { userId_validFrom: { userId: employeeId, validFrom: effectiveDate } },
        update: { monthlySalary, monthlyAllowances, monthlyBenefits, productiveHoursPerMonth, hourlyCost, currency: "JOD", validTo: null },
        create: {
          userId: employeeId,
          validFrom: effectiveDate,
          monthlySalary,
          monthlyAllowances,
          monthlyBenefits,
          productiveHoursPerMonth,
          hourlyCost,
          currency: "JOD",
        },
      });
      if (passwordHash) {
        await transaction.account.upsert({
          where: {
            providerId_accountId: { providerId: "credential", accountId: employeeId },
          },
          update: { password: passwordHash, userId: employeeId },
          create: {
            accountId: employeeId,
            providerId: "credential",
            userId: employeeId,
            password: passwordHash,
          },
        });
      }
      if (status !== "ACTIVE" || passwordHash) {
        await transaction.session.deleteMany({ where: { userId: employeeId } });
      }
      await transaction.auditLog.create({
        data: {
          organizationId: actor.organizationId!, actorId: actor.id,
          action: "employee.updated", entityType: "User", entityId: employeeId,
          before: { name: existing.name, email: existing.email, status: existing.status },
          after: { name, email, status, departmentId, roleId, monthlySalary, monthlyAllowances, monthlyBenefits, hourlyCost, passwordChanged: Boolean(passwordHash) },
        },
      });
    });

    revalidatePath(`/${locale}/employees`);
    revalidatePath(`/${locale}/employees/${employeeId}`);
    revalidatePath(`/${locale}/financials`);
  } catch (error) {
    redirect(feedbackUrl(`/${locale}/employees/${employeeId}`, "error", actionErrorMessage(error, "Employee could not be updated.")));
  }

  redirect(feedbackUrl(`/${locale}/employees`, "success", "Employee updated successfully."));
}

export async function createRole(formData: FormData) {
  const locale = localeFrom(formData);
  try {
    const actor = await requirePermission(locale, "roles.write");
    const name = requiredText(formData, "name");
    const permissionIds = formData.getAll("permissionId").map(String);

    const validPermissions = await prisma.permission.findMany({
      where: { id: { in: permissionIds } },
      select: { id: true },
    });

    const role = await prisma.role.create({
      data: {
        organizationId: actor.organizationId!,
        name,
        description: optionalText(formData, "description", 500),
        permissions: { create: validPermissions.map(({ id }) => ({ permissionId: id })) },
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: actor.organizationId!, actorId: actor.id,
        action: "role.created", entityType: "Role", entityId: role.id,
        after: { name, permissionIds: validPermissions.map(({ id }) => id) },
      },
    });
    revalidatePath(`/${locale}/roles`);
  } catch (error) {
    redirect(feedbackUrl(`/${locale}/roles`, "error", actionErrorMessage(error, "Role could not be created.")));
  }

  redirect(feedbackUrl(`/${locale}/roles`, "success", "Role created successfully."));
}
