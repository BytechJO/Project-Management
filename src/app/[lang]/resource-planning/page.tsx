import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { updateTaskSchedule } from "@/actions/tasks";
import { AppShell } from "@/components/app-shell";
import { FormFeedback } from "@/components/form-feedback";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { permissionKeysFor, requireUser } from "@/lib/dal";
import { isoDate } from "@/lib/leave-policy";
import { getResourcePlan } from "@/lib/resource-planning";
import { weekFromInput } from "@/lib/resource-planning-policy";
import { resourcePlanningScopeFor } from "@/lib/security-policy";

import operationStyles from "../operations.module.css";
import styles from "./resource-planning.module.css";

function hours(minutes: number) {
  return (minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1);
}

function dateInput(date: Date | null) {
  return date ? isoDate(date) : "";
}

function formatWeek(date: Date, lang: string) {
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-JO" : "en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).format(date);
}

function shiftedWeek(date: Date, amount: number) {
  const shifted = new Date(date);
  shifted.setUTCDate(shifted.getUTCDate() + amount * 7);
  return isoDate(shifted);
}

function statusLabel(status: string, isArabic: boolean) {
  const labels: Record<string, [string, string]> = {
    AVAILABLE: ["Available", "متاح"],
    NEAR_CAPACITY: ["Near capacity", "قريب من الحد"],
    OVERLOADED: ["Overloaded", "حمل زائد"],
  };
  return labels[status]?.[isArabic ? 1 : 0] ?? status;
}

export default async function ResourcePlanningPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ week?: string; error?: string; success?: string }>;
}) {
  const { lang } = await params;
  const query = await searchParams;
  if (!isLocale(lang)) notFound();

  const user = await requireUser(lang);
  const permissions = permissionKeysFor(user);
  const scope = resourcePlanningScopeFor(permissions);
  if (!scope) redirect(`/${lang}`);
  const dictionary = getDictionary(lang);
  const isArabic = lang === "ar";
  const weekStart = weekFromInput(query.week, new Date(), user.organization?.weekStartsOn ?? 0);
  const plan = await getResourcePlan({ organizationId: user.organizationId!, actorId: user.id, scope, weekStart });
  if (!plan) notFound();
  const canManageTasks = permissions.has("tasks.write");
  const weekLast = new Date(plan.weekEnd);
  weekLast.setUTCDate(weekLast.getUTCDate() - 1);
  const relevantTasks = plan.tasks.filter(({ plannedMinutes, isUnscheduled, isOverEstimate }) => plannedMinutes > 0 || isUnscheduled || isOverEstimate);
  const projectHourMap = new Map<string, { id: string; name: string; estimatedMinutes: number; actualMinutes: number; remainingMinutes: number; overEstimateTasks: number }>();
  for (const task of plan.tasks) {
    const row = projectHourMap.get(task.projectId) ?? { id: task.projectId, name: task.project.name, estimatedMinutes: 0, actualMinutes: 0, remainingMinutes: 0, overEstimateTasks: 0 };
    row.estimatedMinutes += task.estimatedMinutes;
    row.actualMinutes += task.actualMinutes;
    row.remainingMinutes += task.remainingMinutes;
    if (task.isOverEstimate) row.overEstimateTasks += 1;
    projectHourMap.set(task.projectId, row);
  }
  const projectHours = [...projectHourMap.values()].sort((a, b) => (b.actualMinutes + b.remainingMinutes) - (a.actualMinutes + a.remainingMinutes));

  return (
    <AppShell
      activeSection="resources"
      alternateHref={`/${lang === "en" ? "ar" : "en"}/resource-planning?week=${isoDate(weekStart)}`}
      dictionary={dictionary}
      locale={lang}
    >
      <header className={operationStyles.pageHeader}>
        <div>
          <span className={operationStyles.eyebrow}>{isArabic ? "التخطيط الأسبوعي" : "WEEKLY PLANNING"}</span>
          <h1>{isArabic ? "تخطيط الموارد وضغط العمل" : "Resource planning & workload"}</h1>
          <p>{formatWeek(weekStart, lang)} — {formatWeek(weekLast, lang)} · {isArabic ? "السعة بعد خصم الإجازات والعطل" : "Capacity after approved leave and holidays"}</p>
        </div>
        <div>
          <form className={styles.weekFilter}>
            <label><span>{isArabic ? "الأسبوع" : "Week"}</span><input defaultValue={isoDate(weekStart)} name="week" type="date" /></label>
            <button type="submit">{isArabic ? "عرض" : "View"}</button>
          </form>
          <nav className={styles.weekNavigation} aria-label={isArabic ? "التنقل بين الأسابيع" : "Week navigation"}>
            <Link href={`/${lang}/resource-planning?week=${shiftedWeek(weekStart, -1)}`}>{isArabic ? "السابق" : "Previous"}</Link>
            <Link href={`/${lang}/resource-planning`}>{isArabic ? "الحالي" : "Current"}</Link>
            <Link href={`/${lang}/resource-planning?week=${shiftedWeek(weekStart, 1)}`}>{isArabic ? "التالي" : "Next"}</Link>
          </nav>
        </div>
      </header>

      <FormFeedback error={query.error} success={query.success} />

      <section className={operationStyles.metrics} aria-label={isArabic ? "مؤشرات الموارد" : "Resource metrics"}>
        <article data-tone={plan.summary.plannedLoadPercent > 110 ? "negative" : undefined}><span>{isArabic ? "الحمل المخطط" : "Planned load"}</span><strong>{plan.summary.plannedLoadPercent.toFixed(0)}%</strong><small>{hours(plan.summary.totalPlannedMinutes)} / {hours(plan.summary.totalCapacityMinutes)} h</small></article>
        <article data-tone={plan.summary.overloadedEmployees ? "negative" : "positive"}><span>{isArabic ? "موظفون بحمل زائد" : "Overloaded employees"}</span><strong>{plan.summary.overloadedEmployees}</strong><small>{isArabic ? "أعلى من 110%" : "Above 110%"}</small></article>
        <article data-tone="positive"><span>{isArabic ? "موظفون متاحون" : "Available employees"}</span><strong>{plan.summary.availableEmployees}</strong><small>{isArabic ? "أقل من 80%" : "Below 80%"}</small></article>
        <article data-tone={plan.summary.overEstimateTasks ? "negative" : undefined}><span>{isArabic ? "تاسكات تجاوزت التقدير" : "Tasks over estimate"}</span><strong>{plan.summary.overEstimateTasks}</strong><small>{plan.summary.unscheduledTasks} {isArabic ? "بدون جدول" : "unscheduled"}</small></article>
      </section>

      <div className={styles.grid}>
        <div className={styles.stack}>
          <section className={operationStyles.panel}>
            <div className={operationStyles.panelHeader}><div><h2>{scope === "own" ? (isArabic ? "حملي الأسبوعي" : "My weekly load") : (isArabic ? "حمل الفريق" : "Team workload")}</h2><p>{isArabic ? "المخطط والفعلـي والسعة الصافية لكل موظف." : "Planned, actual and net capacity for each employee."}</p></div><span className={operationStyles.status}>{plan.employees.length}</span></div>
            {plan.employees.length ? <div className={styles.employeeList}>{plan.employees.map((employee) => (
              <article className={styles.employeeCard} key={employee.id}>
                <div className={styles.employeeHeader}>
                  <div><strong>{employee.name}</strong><span>{employee.jobTitle ?? "—"}{employee.department ? ` · ${employee.department.name}` : ""}</span></div>
                  <span className={styles.status} data-status={employee.status}>{statusLabel(employee.status, isArabic)} · {Math.min(employee.loadPercent, 999).toFixed(0)}%</span>
                </div>
                <div className={styles.loadTrack}><div data-status={employee.status} style={{ width: `${Math.min(employee.loadPercent, 100)}%` }} /></div>
                <div className={styles.loadNumbers}>
                  <span>{isArabic ? "مخطط" : "Planned"}: <strong>{hours(employee.plannedMinutes)} h</strong></span>
                  <span>{isArabic ? "فعلي" : "Actual"}: <strong>{hours(employee.actualMinutes)} h</strong></span>
                  <span>{isArabic ? "متاح" : "Capacity"}: <strong>{hours(employee.capacityMinutes)} h</strong></span>
                  {employee.leaveMinutes ? <span>{isArabic ? "إجازة" : "Leave"}: <strong>{hours(employee.leaveMinutes)} h</strong></span> : null}
                </div>
              </article>
            ))}</div> : <p className={styles.empty}>{isArabic ? "لا يوجد موظفون ضمن صلاحياتك." : "No employees are available in your scope."}</p>}
          </section>
          <section className={operationStyles.panel}>
            <div className={operationStyles.panelHeader}><div><h2>{isArabic ? "ميزانية ساعات المشاريع" : "Project hour outlook"}</h2><p>{isArabic ? "التقدير مقابل الفعلي والتوقع عند الإتمام ضمن نطاقك." : "Estimate versus actual and forecast at completion in your scope."}</p></div></div>
            {projectHours.length ? <div className={operationStyles.tableWrap}><table className={operationStyles.table}>
              <thead><tr><th>{isArabic ? "المشروع" : "Project"}</th><th>{isArabic ? "التقدير" : "Estimate"}</th><th>{isArabic ? "الفعلي" : "Actual"}</th><th>{isArabic ? "التوقع" : "Forecast"}</th><th>{isArabic ? "الحالة" : "Status"}</th></tr></thead>
              <tbody>{projectHours.map((project) => {
                const forecast = project.actualMinutes + project.remainingMinutes;
                const atRisk = project.estimatedMinutes > 0 && forecast > project.estimatedMinutes;
                return <tr key={project.id}><td><Link href={`/${lang}/projects/${project.id}`}><strong>{project.name}</strong></Link><small>{project.overEstimateTasks} {isArabic ? "تاسك متجاوزة" : "tasks over"}</small></td><td>{hours(project.estimatedMinutes)} h</td><td>{hours(project.actualMinutes)} h</td><td>{hours(forecast)} h</td><td><span className={styles.status} data-status={atRisk ? "OVERLOADED" : "AVAILABLE"}>{atRisk ? (isArabic ? "تجاوز متوقع" : "Forecast over") : (isArabic ? "ضمن التقدير" : "Within estimate")}</span></td></tr>;
              })}</tbody>
            </table></div> : <p className={styles.empty}>{isArabic ? "لا توجد مشاريع مفتوحة ضمن نطاقك." : "No open projects are available in your scope."}</p>}
          </section>
        </div>

        <aside className={styles.stack}>
          <section className={operationStyles.panel}>
            <div className={operationStyles.panelHeader}><div><h2>{isArabic ? "خطة التاسكات" : "Task plan"}</h2><p>{isArabic ? "التاسكات لهذا الأسبوع والمخاطر غير المجدولة." : "This week's tasks and unscheduled risks."}</p></div><span className={operationStyles.status}>{relevantTasks.length}</span></div>
            {relevantTasks.length ? <div className={styles.taskList}>{relevantTasks.map((task) => (
              <article className={styles.taskCard} data-risk={task.isOverEstimate || task.isUnscheduled} key={task.id}>
                <div className={styles.taskHeader}>
                  <div><Link href={`/${lang}/projects/${task.projectId}/tasks/${task.id}`}><strong>{task.title}</strong></Link><span>{task.project.name}</span></div>
                  <span className={styles.status} data-status={task.isOverEstimate ? "OVERLOADED" : task.plannedMinutes ? "NEAR_CAPACITY" : "AVAILABLE"}>{task.isOverEstimate ? (isArabic ? "تجاوز التقدير" : "Over estimate") : task.isUnscheduled ? (isArabic ? "غير مجدولة" : "Unscheduled") : `${hours(task.plannedMinutes)} h`}</span>
                </div>
                <div className={styles.taskMeta}><span>{isArabic ? "المتبقي" : "Remaining"}: {hours(task.remainingMinutes)} h</span><span>{isArabic ? "الفعلي الكلي" : "Total actual"}: {hours(task.actualMinutes)} h</span><span>{task.assignees.map(({ user }) => user.name).join(", ") || (isArabic ? "بدون مسؤول" : "Unassigned")}</span></div>
                {canManageTasks ? <form action={updateTaskSchedule} className={styles.scheduleForm}>
                  <input name="locale" type="hidden" value={lang} /><input name="projectId" type="hidden" value={task.projectId} /><input name="taskId" type="hidden" value={task.id} /><input name="week" type="hidden" value={isoDate(weekStart)} />
                  <label><span>{isArabic ? "البدء" : "Start"}</span><input defaultValue={dateInput(task.startDate)} name="startDate" type="date" /></label>
                  <label><span>{isArabic ? "التسليم" : "Due"}</span><input defaultValue={dateInput(task.dueDate)} name="dueDate" type="date" /></label>
                  <label><span>{isArabic ? "التقدير" : "Estimate h"}</span><input defaultValue={hours(task.estimatedMinutes)} min="0" name="estimatedHours" step="0.25" type="number" required /></label>
                  <label><span>{isArabic ? "المتبقي" : "Remaining h"}</span><input defaultValue={hours(task.remainingMinutes)} min="0" name="remainingHours" step="0.25" type="number" required /></label>
                  <button type="submit">{isArabic ? "حفظ" : "Save"}</button>
                </form> : null}
              </article>
            ))}</div> : <p className={styles.empty}>{isArabic ? "لا توجد تاسكات مخططة أو معرضة للخطر." : "No planned or at-risk tasks for this week."}</p>}
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
