import Link from "next/link";
import { notFound } from "next/navigation";

import { deleteEmployee } from "@/actions/deletions";
import { updateEmployee } from "@/actions/organization";
import { AppShell } from "@/components/app-shell";
import { DeleteRecordForm } from "@/components/delete-record-form";
import { FormFeedback } from "@/components/form-feedback";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { permissionKeysFor, requirePagePermission } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { canDeleteRecords } from "@/lib/security-policy";

import projectStyles from "../../project-management.module.css";
import styles from "../../section-page.module.css";

export default async function EditEmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; employeeId: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { lang, employeeId } = await params;
  const feedback = await searchParams;
  if (!isLocale(lang)) notFound();
  const currentUser = await requirePagePermission(lang, "employees.write");
  const dictionary = getDictionary(lang);
  const isArabic = lang === "ar";
  const canDelete = canDeleteRecords(permissionKeysFor(currentUser)) && employeeId !== currentUser.id;

  const [employee, departments, roles] = await Promise.all([
    prisma.user.findFirst({
      where: { id: employeeId, organizationId: currentUser.organizationId! },
      include: {
        roleAssignments: { where: { projectId: null }, include: { role: true } },
        costRates: { orderBy: { validFrom: "desc" }, take: 1 },
      },
    }),
    prisma.department.findMany({ where: { organizationId: currentUser.organizationId!, isActive: true }, orderBy: { name: "asc" } }),
    prisma.role.findMany({ where: { organizationId: currentUser.organizationId!, scope: "ORGANIZATION" }, orderBy: { name: "asc" } }),
  ]);
  if (!employee) notFound();
  const currentRoleId = employee.roleAssignments[0]?.roleId ?? roles[0]?.id;
  const currentCostRate = employee.costRates[0];

  return (
    <AppShell
      activeSection="employees"
      alternateHref={`/${lang === "en" ? "ar" : "en"}/employees/${employee.id}`}
      dictionary={dictionary}
      locale={lang}
    >
      <div className={styles.headingRow}>
        <div>
          <Link className={projectStyles.backLink} href={`/${lang}/employees`}>← {isArabic ? "كل الموظفين" : "All employees"}</Link>
          <h1>{isArabic ? "تعديل الموظف" : "Edit employee"}</h1>
          <p className={styles.subtitle}>{employee.name}</p>
        </div>
      </div>
      <FormFeedback error={feedback.error} success={feedback.success} />
      <section className={styles.panel}>
        <form action={updateEmployee} className={projectStyles.form}>
          <input name="locale" type="hidden" value={lang} />
          <input name="employeeId" type="hidden" value={employee.id} />
          <div className={projectStyles.formGrid}>
            <label><span>{isArabic ? "الاسم الكامل" : "Full name"}</span><input name="name" defaultValue={employee.name} maxLength={120} required /></label>
            <label><span>{isArabic ? "البريد الإلكتروني" : "Email"}</span><input name="email" defaultValue={employee.email} type="email" required /></label>
            <label><span>{isArabic ? "المسمى الوظيفي" : "Job title"}</span><input name="jobTitle" defaultValue={employee.jobTitle ?? ""} maxLength={120} /></label>
            <label><span>{isArabic ? "القسم" : "Department"}</span><select name="departmentId" defaultValue={employee.departmentId ?? departments[0]?.id} required>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
            <label><span>{isArabic ? "الدور" : "Role"}</span><select name="roleId" defaultValue={currentRoleId} required>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
            <label><span>{isArabic ? "الحالة" : "Status"}</span><select name="status" defaultValue={employee.status}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="ARCHIVED">Archived</option></select></label>
            <label><span>{isArabic ? "الساعات الأسبوعية" : "Weekly capacity hours"}</span><input name="weeklyCapacityHours" type="number" min="1" max="90" step="0.5" defaultValue={employee.weeklyCapacityMinutes / 60} required /></label>
            <label><span>{isArabic ? "كلمة المرور الجديدة" : "New password"}</span><input name="newPassword" type="password" minLength={12} maxLength={128} autoComplete="new-password" aria-describedby="password-change-hint" /></label>
            <label><span>{isArabic ? "تأكيد كلمة المرور الجديدة" : "Confirm new password"}</span><input name="confirmPassword" type="password" minLength={12} maxLength={128} autoComplete="new-password" aria-describedby="password-change-hint" /></label>
            <label><span>{isArabic ? "الراتب الشهري (د.أ)" : "Monthly salary (JOD)"}</span><input name="monthlySalary" type="number" min="0.01" step="0.01" defaultValue={currentCostRate ? Number(currentCostRate.monthlySalary) : ""} required /></label>
            <label><span>{isArabic ? "البدلات الشهرية (د.أ)" : "Monthly allowances (JOD)"}</span><input name="monthlyAllowances" type="number" min="0" step="0.01" defaultValue={currentCostRate ? Number(currentCostRate.monthlyAllowances) : 0} required /></label>
            <label><span>{isArabic ? "المزايا الشهرية (د.أ)" : "Monthly benefits (JOD)"}</span><input name="monthlyBenefits" type="number" min="0" step="0.01" defaultValue={currentCostRate ? Number(currentCostRate.monthlyBenefits) : 0} required /></label>
            <label><span>{isArabic ? "ساعات العمل المنتجة شهريًا" : "Productive hours per month"}</span><input name="productiveHoursPerMonth" type="number" min="1" step="0.5" defaultValue={currentCostRate ? Number(currentCostRate.productiveHoursPerMonth) : 195} required /></label>
          </div>
          <p className={projectStyles.empty} id="password-change-hint">{isArabic ? "اترك حقلي كلمة المرور فارغين للاحتفاظ بالكلمة الحالية. عند تغييرها سيتم تسجيل خروج المستخدم من جميع أجهزته، ويجب أن تتكون الكلمة الجديدة من 12 إلى 128 حرفًا." : "Leave both password fields empty to keep the current password. Changing it signs the user out on every device, and the new password must be 12–128 characters."}</p>
          <p className={projectStyles.empty}>{isArabic ? "تكلفة الساعة = الراتب + البدلات + المزايا، مقسومة على الساعات المنتجة شهريًا. يبدأ أي تغيير كسعر تاريخي جديد." : "Hourly cost = salary + allowances + benefits, divided by productive monthly hours. Each later change starts a new historical rate."}</p>
          <button className={styles.button} type="submit">{isArabic ? "حفظ التعديلات" : "Save changes"}</button>
        </form>
      </section>
      {canDelete ? <DeleteRecordForm
        action={deleteEmployee}
        buttonLabel={isArabic ? "حذف الموظف نهائيًا" : "Delete employee permanently"}
        confirmationLabel={isArabic ? `أفهم أن حذف حساب ${employee.name} نهائي ولا يمكن التراجع عنه.` : `I understand that deleting ${employee.name}'s account is permanent and cannot be undone.`}
        description={isArabic ? "لا يمكن حذف الموظف إذا كان مدير مشروع أو لديه ساعات أو نشاط مهام أو سجلات مالية. استخدم Archived عند الحاجة للاحتفاظ بالسجل." : "Employees with managed projects, time, task activity, or financial records cannot be deleted. Use Archived to preserve their history."}
        idField="employeeId"
        idValue={employee.id}
        locale={lang}
        pendingLabel={isArabic ? "جاري الحذف..." : "Deleting..."}
        title={isArabic ? "منطقة الخطر" : "Danger zone"}
      /> : null}
    </AppShell>
  );
}
