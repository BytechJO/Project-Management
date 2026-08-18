import Link from "next/link";
import { notFound } from "next/navigation";

import { deleteProject } from "@/actions/deletions";
import { updateProject } from "@/actions/projects";
import { AppShell } from "@/components/app-shell";
import { DeleteRecordForm } from "@/components/delete-record-form";
import { FormFeedback } from "@/components/form-feedback";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { permissionKeysFor, requirePagePermission } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { canDeleteRecords, projectAccessLevelFor, projectAccessScope } from "@/lib/security-policy";

import projectStyles from "../../../project-management.module.css";
import styles from "../../../section-page.module.css";

function dateInputValue(date: Date | null) {
  return date?.toISOString().slice(0, 10) ?? "";
}

export default async function EditProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; projectId: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { lang, projectId } = await params;
  const feedback = await searchParams;
  if (!isLocale(lang)) notFound();
  const user = await requirePagePermission(lang, "projects.write");
  const dictionary = getDictionary(lang);
  const isArabic = lang === "ar";
  const permissions = permissionKeysFor(user);
  const projectAccessLevel = projectAccessLevelFor(permissions, Boolean(user.clientContact));
  const canDelete = canDeleteRecords(permissions);

  const [project, clients, employees] = await Promise.all([
    prisma.project.findFirst({
      where: {
        id: projectId,
        organizationId: user.organizationId!,
        ...projectAccessScope(user.id, projectAccessLevel, user.clientContact?.clientId),
      },
    }),
    prisma.client.findMany({ where: { organizationId: user.organizationId! }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { organizationId: user.organizationId!, status: "ACTIVE" }, orderBy: { name: "asc" } }),
  ]);
  if (!project) notFound();

  return (
    <AppShell
      activeSection="projects"
      alternateHref={`/${lang === "en" ? "ar" : "en"}/projects/${project.id}/edit`}
      dictionary={dictionary}
      locale={lang}
    >
      <div className={styles.headingRow}>
        <div>
          <Link className={projectStyles.backLink} href={`/${lang}/projects/${project.id}`}>← {isArabic ? "العودة للمشروع" : "Back to project"}</Link>
          <h1>{isArabic ? "تعديل المشروع" : "Edit project"}</h1>
          <p className={styles.subtitle}>{project.name}</p>
        </div>
      </div>
      <FormFeedback error={feedback.error} success={feedback.success} />
      <section className={styles.panel}>
        <form action={updateProject} className={projectStyles.form}>
          <input name="locale" type="hidden" value={lang} />
          <input name="projectId" type="hidden" value={project.id} />
          <div className={projectStyles.formGrid}>
            <label><span>{isArabic ? "اسم المشروع" : "Project name"}</span><input name="name" defaultValue={project.name} maxLength={160} required /></label>
            <label><span>{isArabic ? "رمز المشروع" : "Project code"}</span><input name="code" defaultValue={project.code} maxLength={24} required /></label>
            <label><span>{isArabic ? "العميل" : "Client"}</span><select name="clientId" defaultValue={project.clientId} required>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
            <label><span>{isArabic ? "مدير المشروع" : "Project manager"}</span><select name="primaryManagerId" defaultValue={project.primaryManagerId} required>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
            <label><span>{isArabic ? "نائب المدير" : "Deputy manager"}</span><select name="deputyManagerId" defaultValue={project.deputyManagerId ?? ""}><option value="">—</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
            <label><span>{isArabic ? "الحالة" : "Status"}</span><select name="status" defaultValue={project.status}><option value="DRAFT">Draft</option><option value="PLANNED">Planned</option><option value="ACTIVE">Active</option><option value="ON_HOLD">On hold</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option></select></label>
            <label><span>{isArabic ? "نظام التسعير" : "Pricing model"}</span><select name="pricingModel" defaultValue={project.pricingModel}><option value="FIXED_PRICE">Fixed price</option><option value="TIME_AND_MATERIALS">Time & materials</option><option value="MONTHLY_RETAINER">Monthly retainer</option></select></label>
            <label><span>{isArabic ? "قيمة البيع (د.أ)" : "Contract value (JOD)"}</span><input name="contractValue" type="number" min="0" step="0.01" defaultValue={Number(project.contractValue)} required /></label>
            <label><span>{isArabic ? "الميزانية (د.أ)" : "Planned budget (JOD)"}</span><input name="plannedBudget" type="number" min="0" step="0.01" defaultValue={Number(project.plannedBudget)} required /></label>
            <label><span>{isArabic ? "تاريخ البداية" : "Start date"}</span><input name="startDate" type="date" defaultValue={dateInputValue(project.startDate)} /></label>
            <label><span>{isArabic ? "تاريخ التسليم" : "Target date"}</span><input name="targetDate" type="date" defaultValue={dateInputValue(project.targetDate)} /></label>
            <label className={projectStyles.wide}><span>{isArabic ? "الوصف" : "Description"}</span><textarea name="description" defaultValue={project.description ?? ""} maxLength={1000} /></label>
          </div>
          <button className={styles.button} type="submit">{isArabic ? "حفظ التعديلات" : "Save changes"}</button>
        </form>
      </section>
      {canDelete ? <DeleteRecordForm
        action={deleteProject}
        buttonLabel={isArabic ? "حذف المشروع نهائيًا" : "Delete project permanently"}
        confirmationLabel={isArabic ? `أفهم أن حذف مشروع ${project.name} نهائي ولا يمكن التراجع عنه.` : `I understand that deleting ${project.name} is permanent and cannot be undone.`}
        description={isArabic ? "يسمح الحذف فقط إذا لم توجد ساعات أو فواتير أو مصاريف أو تكاليف اشتراكات مرتبطة بالمشروع." : "Deletion is allowed only when no time, invoices, expenses, or subscription costs are connected to the project."}
        idField="projectId"
        idValue={project.id}
        locale={lang}
        pendingLabel={isArabic ? "جاري الحذف..." : "Deleting..."}
        title={isArabic ? "منطقة الخطر" : "Danger zone"}
      /> : null}
    </AppShell>
  );
}
