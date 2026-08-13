import Link from "next/link";
import { notFound } from "next/navigation";

import { createEmployee } from "@/actions/organization";
import { AppShell } from "@/components/app-shell";
import { FormFeedback } from "@/components/form-feedback";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { permissionKeysFor, requirePagePermission } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

import managementStyles from "../management.module.css";
import styles from "../section-page.module.css";

export default async function EmployeesPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { lang } = await params;
  const feedback = await searchParams;
  if (!isLocale(lang)) notFound();
  const user = await requirePagePermission(lang, "employees.read");
  const dictionary = getDictionary(lang);
  const isArabic = lang === "ar";
  const [employees, departments, roles] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId: user.organizationId! },
      include: {
        department: true,
        roleAssignments: { include: { role: true } },
        costRates: { orderBy: { validFrom: "desc" }, take: 1 },
      },
      orderBy: { name: "asc" },
    }),
    prisma.department.findMany({ where: { organizationId: user.organizationId!, isActive: true }, orderBy: { name: "asc" } }),
    prisma.role.findMany({ where: { organizationId: user.organizationId!, scope: "ORGANIZATION" }, orderBy: { name: "asc" } }),
  ]);
  const canViewSalary = permissionKeysFor(user).has("financials.read");

  return (
    <AppShell activeSection="employees" dictionary={dictionary} locale={lang}>
      <div className={styles.headingRow}>
        <div><h1>{isArabic ? "الموظفون" : "Employees"}</h1><p className={styles.subtitle}>{isArabic ? "الحسابات والأقسام والأدوار" : "Accounts, departments, and roles"}</p></div>
      </div>
      <FormFeedback error={feedback.error} success={feedback.success} />
      <div className={managementStyles.layout}>
        <section className={`${styles.panel} ${styles.tableWrap}`}>
          <table className={styles.table}>
            <thead><tr><th>{isArabic ? "الموظف" : "Employee"}</th><th>{isArabic ? "القسم" : "Department"}</th><th>{isArabic ? "الدور" : "Role"}</th><th>{isArabic ? "التكلفة الشهرية" : "Monthly employer cost"}</th><th>{isArabic ? "تكلفة الساعة" : "Hourly cost"}</th><th>{isArabic ? "السعة الأسبوعية" : "Weekly capacity"}</th><th>{isArabic ? "الحالة" : "Status"}</th><th>{isArabic ? "الإجراء" : "Action"}</th></tr></thead>
            <tbody>{employees.map((employee) => {
              const costRate = employee.costRates[0];
              const monthlyEmployerCost = costRate ? Number(costRate.monthlySalary) + Number(costRate.monthlyAllowances) + Number(costRate.monthlyBenefits) : 0;
              return <tr key={employee.id}><td><strong>{employee.name}</strong><span className={styles.secondaryText}>{employee.email}</span></td><td>{employee.department?.name ?? "—"}</td><td>{employee.roleAssignments.map(({ role }) => role.name).join(", ") || "—"}</td><td>{canViewSalary ? costRate ? `${monthlyEmployerCost.toFixed(2)} JOD` : (isArabic ? "غير محدد" : "Not set") : "Restricted"}</td><td>{canViewSalary ? costRate ? `${Number(costRate.hourlyCost).toFixed(3)} JOD` : "—" : "Restricted"}</td><td>{employee.weeklyCapacityMinutes / 60} h</td><td><span className={styles.badge}>{employee.status}</span></td><td><Link className={styles.secondaryButton} href={`/${lang}/employees/${employee.id}`}>{isArabic ? "تعديل" : "Edit"}</Link></td></tr>;
            })}</tbody>
          </table>
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><h2>{isArabic ? "إضافة موظف" : "Add employee"}</h2></div>
          <form action={createEmployee} className={managementStyles.form}>
            <input name="locale" type="hidden" value={lang} />
            <label><span>{isArabic ? "الاسم الكامل" : "Full name"}</span><input name="name" maxLength={120} required /></label>
            <label><span>{isArabic ? "البريد الإلكتروني" : "Email"}</span><input name="email" type="email" required /></label>
            <label><span>{isArabic ? "المسمى الوظيفي" : "Job title"}</span><input name="jobTitle" maxLength={120} /></label>
            <label><span>{isArabic ? "القسم" : "Department"}</span><select name="departmentId" required>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
            <label><span>{isArabic ? "الدور" : "Role"}</span><select name="roleId" required>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
            <label><span>{isArabic ? "الراتب الشهري (د.أ)" : "Monthly salary (JOD)"}</span><input name="monthlySalary" type="number" min="0.01" step="0.01" required /></label>
            <label><span>{isArabic ? "البدلات الشهرية (د.أ)" : "Monthly allowances (JOD)"}</span><input name="monthlyAllowances" type="number" min="0" step="0.01" defaultValue="0" required /></label>
            <label><span>{isArabic ? "المزايا الشهرية (د.أ)" : "Monthly benefits (JOD)"}</span><input name="monthlyBenefits" type="number" min="0" step="0.01" defaultValue="0" required /></label>
            <label><span>{isArabic ? "ساعات العمل المنتجة شهريًا" : "Productive hours per month"}</span><input name="productiveHoursPerMonth" type="number" min="1" step="0.5" defaultValue="195" required /></label>
            <label><span>{isArabic ? "كلمة مرور مؤقتة" : "Temporary password"}</span><input name="password" type="password" minLength={12} autoComplete="new-password" required /></label>
            <p className={managementStyles.formHint}>{isArabic ? "تكلفة الساعة = (الراتب + البدلات + المزايا) ÷ ساعات العمل المنتجة. كلمة المرور 12 حرفًا على الأقل." : "Hourly cost = (salary + allowances + benefits) ÷ productive hours. Password must be at least 12 characters."}</p>
            <button className={styles.button} type="submit">{isArabic ? "إنشاء الموظف" : "Create employee"}</button>
          </form>
        </section>
      </div>
    </AppShell>
  );
}
