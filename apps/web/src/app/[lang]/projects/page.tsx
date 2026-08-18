import Link from "next/link";
import { notFound } from "next/navigation";

import { createProject } from "@/actions/projects";
import { AppShell } from "@/components/app-shell";
import { FormFeedback } from "@/components/form-feedback";
import { Pagination } from "@/components/pagination";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { permissionKeysFor, requirePagePermission } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PAGE_SIZE, pageNumber } from "@/lib/pagination";
import {
  canManageAllProjects,
  canViewAllProjectTasks,
  projectAccessLevelFor,
  projectAccessScope,
  taskAccessScope,
} from "@/lib/security-policy";

import projectStyles from "../project-management.module.css";
import styles from "../section-page.module.css";

function formatDate(date: Date | null, locale: string) {
  if (!date) return "—";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-JO" : "en-GB", { dateStyle: "medium" }).format(date);
}

export default async function ProjectsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ error?: string; page?: string; success?: string }>;
}) {
  const { lang } = await params;
  const feedback = await searchParams;
  if (!isLocale(lang)) notFound();
  const user = await requirePagePermission(lang, "projects.read");
  const dictionary = getDictionary(lang);
  const page = dictionary.projects;
  const isArabic = lang === "ar";
  const permissions = permissionKeysFor(user);
  const projectAccessLevel = projectAccessLevelFor(permissions, Boolean(user.clientContact));
  const isClientUser = projectAccessLevel === "client";
  const canManageProjects = permissions.has("projects.write");
  const canCreateProjects = canManageProjects && canManageAllProjects(permissions);
  const canViewAllTasks = canViewAllProjectTasks(permissions);
  const currentPage = pageNumber(feedback.page);

  const [projectRows, clients, employees] = await Promise.all([
    prisma.project.findMany({
      where: {
        organizationId: user.organizationId!,
        ...projectAccessScope(user.id, projectAccessLevel, user.clientContact?.clientId),
      },
      select: {
        id: true,
        name: true,
        code: true,
        targetDate: true,
        status: true,
        client: { select: { name: true } },
        primaryManager: { select: { name: true } },
        _count: {
          select: {
            members: true,
            tasks: { where: taskAccessScope(user.id, canViewAllTasks) },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (currentPage - 1) * DEFAULT_PAGE_SIZE,
      take: DEFAULT_PAGE_SIZE + 1,
    }),
    canCreateProjects
      ? prisma.client.findMany({ where: { organizationId: user.organizationId!, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    canCreateProjects
      ? prisma.user.findMany({ where: { organizationId: user.organizationId!, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
  ]);
  const hasNextPage = projectRows.length > DEFAULT_PAGE_SIZE;
  const projects = projectRows.slice(0, DEFAULT_PAGE_SIZE);

  return (
    <AppShell activeSection="projects" dictionary={dictionary} locale={lang}>
      <div className={styles.headingRow}>
        <div><h1>{page.title}</h1><p className={styles.subtitle}>{page.subtitle}</p></div>
      </div>
      <FormFeedback error={feedback.error} success={feedback.success} />
      <div className={canCreateProjects ? projectStyles.twoColumn : undefined}>
        <section className={`${styles.panel} ${styles.tableWrap}`}>
          {projects.length ? (
            <table className={styles.table}>
              <thead><tr><th>{page.project}</th><th>{page.manager}</th>{!isClientUser ? <><th>{page.team}</th><th>{isArabic ? "التاسكات" : "Tasks"}</th></> : null}<th>{page.dueDate}</th><th>{page.status}</th></tr></thead>
              <tbody>{projects.map((project) => (
                <tr key={project.id}>
                  <td><Link className={projectStyles.projectLink} href={`/${lang}/projects/${project.id}`}><strong>{project.name}</strong></Link><span className={styles.secondaryText}>{project.code} · {project.client.name}</span></td>
                  <td><span className={styles.avatar}>{project.primaryManager.name.slice(0, 2).toUpperCase()}</span>{project.primaryManager.name}</td>
                  {!isClientUser ? <><td>{project._count.members}</td><td>{project._count.tasks}</td></> : null}<td>{formatDate(project.targetDate, lang)}</td>
                  <td><span className={styles.badge}>{project.status.replaceAll("_", " ")}</span></td>
                </tr>
              ))}</tbody>
            </table>
          ) : <p className={projectStyles.empty}>{isArabic ? "لا توجد مشاريع بعد." : "No projects yet."}</p>}
          <Pagination basePath={`/${lang}/projects`} currentPage={currentPage} hasNextPage={hasNextPage} isArabic={isArabic} />
        </section>
        {canCreateProjects ? <section className={styles.panel} id="create-project">
          <div className={styles.panelHeader}><h2>{isArabic ? "إنشاء مشروع" : "Create project"}</h2></div>
          {!clients.length ? (
            <p className={projectStyles.empty}>{isArabic ? "أضف عميلًا أولًا من شاشة العملاء." : "Add a client from the Clients screen first."}</p>
          ) : (
            <form action={createProject} className={projectStyles.form}>
              <input name="locale" type="hidden" value={lang} />
              <div className={projectStyles.formGrid}>
                <label className={projectStyles.wide}><span>{isArabic ? "اسم المشروع" : "Project name"}</span><input name="name" maxLength={160} required /></label>
                <label><span>{isArabic ? "رمز المشروع" : "Project code"}</span><input name="code" maxLength={24} placeholder="PRJ-001" required /></label>
                <label><span>{isArabic ? "العميل" : "Client"}</span><select name="clientId" required>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
                <label><span>{isArabic ? "مدير المشروع" : "Project manager"}</span><select name="primaryManagerId" required>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
                <label><span>{isArabic ? "نائب المدير" : "Deputy manager"}</span><select name="deputyManagerId"><option value="">—</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
                <label><span>{isArabic ? "نظام التسعير" : "Pricing model"}</span><select name="pricingModel"><option value="FIXED_PRICE">Fixed price</option><option value="TIME_AND_MATERIALS">Time & materials</option><option value="MONTHLY_RETAINER">Monthly retainer</option></select></label>
                <label><span>{isArabic ? "قيمة البيع (د.أ)" : "Contract value (JOD)"}</span><input name="contractValue" type="number" min="0" step="0.01" defaultValue="0" required /></label>
                <label><span>{isArabic ? "الميزانية (د.أ)" : "Planned budget (JOD)"}</span><input name="plannedBudget" type="number" min="0" step="0.01" defaultValue="0" required /></label>
                <label><span>{isArabic ? "تاريخ البداية" : "Start date"}</span><input name="startDate" type="date" /></label>
                <label><span>{isArabic ? "تاريخ التسليم" : "Target date"}</span><input name="targetDate" type="date" /></label>
                <label className={projectStyles.wide}><span>{isArabic ? "الوصف" : "Description"}</span><textarea name="description" maxLength={1000} /></label>
              </div>
              <button className={styles.button} type="submit">{isArabic ? "إنشاء المشروع" : "Create project"}</button>
            </form>
          )}
        </section> : null}
      </div>
    </AppShell>
  );
}
