import Link from "next/link";
import { notFound } from "next/navigation";

import { uploadProjectAttachment } from "@/actions/attachments";
import { assignProjectMember, createTask } from "@/actions/projects";
import { updateTaskWorkflowStatus } from "@/actions/tasks";
import { startTaskTimer, stopTaskTimer } from "@/actions/timers";
import { AppShell } from "@/components/app-shell";
import { FormFeedback } from "@/components/form-feedback";
import { TimerCounter } from "@/components/timer-counter";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { formatAttachmentSize } from "@/lib/attachment-policy";
import { permissionKeysFor, requirePagePermission } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import {
  canManageProjectRecord,
  canViewAllProjectTasks,
  projectAccessLevelFor,
  projectAccessScope,
  taskAccessScope,
} from "@/lib/security-policy";

import projectStyles from "../../project-management.module.css";
import styles from "../../section-page.module.css";

const nextTaskStatus = {
  BACKLOG: "IN_PROGRESS",
  TODO: "IN_PROGRESS",
  IN_PROGRESS: "IN_REVIEW",
  IN_REVIEW: "DONE",
  DONE: "TODO",
  CANCELLED: "TODO",
} as const;

const kanbanColumns = [
  { key: "BACKLOG", label: "Backlog" },
  { key: "TODO", label: "To do" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "IN_REVIEW", label: "In review" },
  { key: "DONE", label: "Done" },
] as const;

function taskActionLabel(status: keyof typeof nextTaskStatus, isArabic: boolean) {
  if (status === "BACKLOG" || status === "TODO") return isArabic ? "بدء" : "Start";
  if (status === "IN_PROGRESS") return isArabic ? "إرسال للمراجعة" : "Send to review";
  if (status === "IN_REVIEW") return isArabic ? "إنهاء" : "Mark done";
  return isArabic ? "إعادة فتح" : "Reopen";
}

function formatMoney(value: number, locale: string) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-JO" : "en-JO", {
    style: "currency",
    currency: "JOD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(date: Date | null, locale: string) {
  if (!date) return "—";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-JO" : "en-GB", { dateStyle: "medium" }).format(date);
}

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; projectId: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { lang, projectId } = await params;
  const feedback = await searchParams;
  if (!isLocale(lang)) notFound();
  const user = await requirePagePermission(lang, "projects.read");
  const dictionary = getDictionary(lang);
  const isArabic = lang === "ar";
  const permissionKeys = permissionKeysFor(user);
  const projectAccessLevel = projectAccessLevelFor(permissionKeys, Boolean(user.clientContact));
  const isClientUser = projectAccessLevel === "client";
  const hasProjectWrite = permissionKeys.has("projects.write");
  const canManageTasks = permissionKeys.has("tasks.write");
  const canViewAllTasks = canViewAllProjectTasks(permissionKeys);
  const canViewFinancials = permissionKeys.has("financials.read");

  const [project, employees, activeTimer, oneDriveConnection] = await Promise.all([
    prisma.project.findFirst({
      where: {
        id: projectId,
        organizationId: user.organizationId!,
        ...projectAccessScope(user.id, projectAccessLevel, user.clientContact?.clientId),
      },
      include: {
        client: true,
        primaryManager: true,
        deputyManager: true,
        members: {
          where: isClientUser ? { userId: "__no_internal_team_access__" } : {},
          include: { user: { include: { department: true } } },
          orderBy: { createdAt: "asc" },
        },
        tasks: {
          where: canViewAllTasks
            ? { parentId: null }
            : taskAccessScope(user.id, false),
          include: { assignees: { include: { user: true } } },
          orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
        },
        attachments: {
          include: { uploadedBy: true },
          orderBy: { createdAt: "desc" },
        },
      },
    }),
    hasProjectWrite
      ? prisma.user.findMany({
          where: { organizationId: user.organizationId!, status: "ACTIVE" },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    prisma.timeEntry.findFirst({
      where: { userId: user.id, source: "TIMER", startedAt: { not: null }, endedAt: null },
      include: { task: true, project: true },
    }),
    prisma.oneDriveConnection.findUnique({
      where: { organizationId: user.organizationId! },
      select: { id: true },
    }),
  ]);

  if (!project) notFound();

  const canManageProject = canManageProjectRecord(user.id, permissionKeys, project);

  const contractValue = Number(project.contractValue);
  const plannedBudget = Number(project.plannedBudget);
  const plannedProfit = contractValue - plannedBudget;
  const plannedMargin = contractValue > 0 ? (plannedProfit / contractValue) * 100 : 0;

  return (
    <AppShell
      activeSection="projects"
      alternateHref={`/${lang === "en" ? "ar" : "en"}/projects/${project.id}`}
      dictionary={dictionary}
      locale={lang}
    >
      <div className={styles.headingRow}>
        <div>
          <Link className={projectStyles.backLink} href={`/${lang}/projects`}>← {isArabic ? "كل المشاريع" : "All projects"}</Link>
          <h1>{project.name}</h1>
          <p className={styles.subtitle}>{project.code} · {project.client.name} · {project.status.replaceAll("_", " ")}</p>
        </div>
        <div className={projectStyles.headerButtons}>
          {canViewFinancials ? <Link className={styles.secondaryButton} href={`/${lang}/financials/${project.id}`}>{isArabic ? "التفاصيل المالية" : "Financial breakdown"}</Link> : null}
          {canManageProject ? <Link className={styles.secondaryButton} href={`/${lang}/projects/${project.id}/edit`}>{isArabic ? "تعديل المشروع" : "Edit project"}</Link> : null}
        </div>
      </div>

      <FormFeedback error={feedback.error} success={feedback.success} />

      {activeTimer?.startedAt ? (
        <section className={projectStyles.timerBanner}>
          <div>
            <span>{isArabic ? "التايمر يعمل الآن" : "Timer running"}</span>
            <strong>{activeTimer.project.name} · {activeTimer.task.title}</strong>
          </div>
          <TimerCounter startedAt={activeTimer.startedAt.toISOString()} />
          <form action={stopTaskTimer}>
            <input name="locale" type="hidden" value={lang} />
            <input name="projectId" type="hidden" value={activeTimer.projectId} />
            <input name="entryId" type="hidden" value={activeTimer.id} />
            <button className={projectStyles.stopButton} type="submit">{isArabic ? "إيقاف وحفظ" : "Stop & save"}</button>
          </form>
        </section>
      ) : null}

      <section className={projectStyles.summaryGrid} aria-label="Project summary">
        <article className={projectStyles.summaryCard}><span>{isArabic ? "مدير المشروع" : "Project manager"}</span><strong>{project.primaryManager.name}</strong></article>
        <article className={projectStyles.summaryCard}><span>{isArabic ? "التقدم" : "Progress"}</span><strong>{Number(project.progressPercent).toFixed(0)}%</strong></article>
        <article className={projectStyles.summaryCard}><span>{isArabic ? "تاريخ التسليم" : "Target date"}</span><strong>{formatDate(project.targetDate, lang)}</strong></article>
        {!isClientUser ? <article className={projectStyles.summaryCard}><span>{isArabic ? "حجم الفريق" : "Team size"}</span><strong>{project.members.length}</strong></article> : null}
        {canViewFinancials ? <>
          <article className={projectStyles.summaryCard}><span>{isArabic ? "قيمة البيع" : "Contract value"}</span><strong>{formatMoney(contractValue, lang)}</strong></article>
          <article className={projectStyles.summaryCard}><span>{isArabic ? "الميزانية" : "Planned budget"}</span><strong>{formatMoney(plannedBudget, lang)}</strong></article>
          <article className={projectStyles.summaryCard}><span>{isArabic ? "الربح والهامش المخطط" : "Planned profit & margin"}</span><strong>{formatMoney(plannedProfit, lang)} · {plannedMargin.toFixed(1)}%</strong></article>
        </> : null}
      </section>

      {!isClientUser ? <>
      <section className={`${styles.panel} ${projectStyles.projectFilesPanel}`}>
        <div className={styles.panelHeader}>
          <div><h2>{isArabic ? "ملفات المشروع" : "Project files"}</h2><span className={styles.secondaryText}>{isArabic ? "محفوظة بأمان داخل OneDrive" : "Securely stored in OneDrive"}</span></div>
          <span className={styles.badge}>{project.attachments.length}</span>
        </div>
        {project.attachments.length ? <div className={projectStyles.projectFileList}>{project.attachments.map((attachment) => {
          const size = formatAttachmentSize(attachment.sizeBytes);
          const href = attachment.oneDriveItemId ? `/api/attachments/projects/${attachment.id}` : attachment.url;
          return <a href={href} key={attachment.id} rel="noreferrer" target="_blank"><span>☁</span><div><strong>{attachment.name}</strong><small>{attachment.uploadedBy.name}{size ? ` · ${size}` : ""} · OneDrive</small></div></a>;
        })}</div> : <p className={projectStyles.empty}>{isArabic ? "لا توجد ملفات للمشروع بعد." : "No project files yet."}</p>}
        {oneDriveConnection ? <form action={uploadProjectAttachment} className={projectStyles.fileUploadForm}>
          <input name="locale" type="hidden" value={lang} /><input name="projectId" type="hidden" value={project.id} />
          <label><span>{isArabic ? "اختر ملفًا" : "Choose a file"}</span><input accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.zip" name="file" type="file" required /><small>{isArabic ? "الحد الأقصى 10 MB" : "Maximum 10 MB"}</small></label>
          <button className={styles.button} type="submit">{isArabic ? "رفع إلى OneDrive" : "Upload to OneDrive"}</button>
        </form> : <p className={projectStyles.empty}>{isArabic ? "يجب ربط OneDrive قبل رفع الملفات." : "Connect OneDrive before uploading files."}</p>}
      </section>

      <section className={`${styles.panel} ${projectStyles.kanbanSection}`}>
        <div className={styles.panelHeader}>
          <div><h2>{isArabic ? "لوحة التاسكات" : "Task board"}</h2><span className={styles.secondaryText}>{isArabic ? "تابع سير العمل من البداية إلى الإنجاز" : "Follow work from backlog to completion"}</span></div>
          <span className={styles.badge}>{project.tasks.filter((task) => task.status !== "CANCELLED").length}</span>
        </div>
        <div className={projectStyles.kanbanBoard}>
          {kanbanColumns.map((column) => {
            const columnTasks = project.tasks.filter((task) => task.status === column.key);
            return <section className={projectStyles.kanbanColumn} key={column.key}>
              <header><strong>{column.label}</strong><span>{columnTasks.length}</span></header>
              <div className={projectStyles.kanbanCards}>
                {columnTasks.map((task) => <Link className={projectStyles.kanbanCard} href={`/${lang}/projects/${project.id}/tasks/${task.id}`} key={task.id}>
                  <span className={projectStyles.kanbanPriority} data-priority={task.priority}>{task.priority}</span>
                  <strong>{task.title}</strong>
                  <small>{task.assignees.map(({ user: assignee }) => assignee.name).join(", ") || (isArabic ? "غير مسندة" : "Unassigned")}</small>
                  <footer><span>{task.estimatedMinutes / 60} h</span><span>{formatDate(task.dueDate, lang)}</span></footer>
                </Link>)}
                {!columnTasks.length ? <div className={projectStyles.kanbanEmpty}>{isArabic ? "لا يوجد" : "No tasks"}</div> : null}
              </div>
            </section>;
          })}
        </div>
      </section>

      <div className={projectStyles.contentGrid}>
        <div className={projectStyles.stack}>
          <section className={`${styles.panel} ${styles.tableWrap}`}>
            <div className={styles.panelHeader}><h2>{isArabic ? "التاسكات" : "Tasks"}</h2><span className={styles.badge}>{project.tasks.length}</span></div>
            {project.tasks.length ? (
              <table className={styles.table}>
                <thead><tr><th>{isArabic ? "التاسك" : "Task"}</th><th>{isArabic ? "المسؤول" : "Assignee"}</th><th>{isArabic ? "الأولوية" : "Priority"}</th><th>{isArabic ? "الموعد" : "Due"}</th><th>{isArabic ? "التقدير" : "Estimate"}</th><th>{isArabic ? "الحالة" : "Status"}</th></tr></thead>
                <tbody>{project.tasks.map((task) => {
                  const assignedToCurrentUser = task.assignees.some(({ user: assignee }) => assignee.id === user.id);
                  const timerIsForTask = activeTimer?.taskId === task.id;
                  const timerCanStart = assignedToCurrentUser && !activeTimer && !["DONE", "CANCELLED"].includes(task.status);
                  return <tr key={task.id}>
                    <td><Link className={projectStyles.taskLink} href={`/${lang}/projects/${project.id}/tasks/${task.id}`}><strong>{task.title}</strong></Link>{task.description ? <span className={styles.secondaryText}>{task.description}</span> : null}</td>
                    <td>{task.assignees.map(({ user: assignee }) => assignee.name).join(", ") || "—"}</td>
                    <td><span className={task.priority === "URGENT" || task.priority === "HIGH" ? styles.warningBadge : styles.badge}>{task.priority}</span></td>
                    <td>{formatDate(task.dueDate, lang)}</td><td>{task.estimatedMinutes / 60} h</td>
                    <td><div className={projectStyles.taskActions}>{canManageTasks || assignedToCurrentUser ? (
                      <form action={updateTaskWorkflowStatus} className={projectStyles.statusForm}>
                        <input name="locale" type="hidden" value={lang} /><input name="projectId" type="hidden" value={project.id} /><input name="taskId" type="hidden" value={task.id} />
                        <span className={styles.badge}>{task.status.replaceAll("_", " ")}</span>
                        <button className={projectStyles.smallButton} name="status" value={nextTaskStatus[task.status]} type="submit">{taskActionLabel(task.status, isArabic)}</button>
                      </form>
                    ) : <span className={styles.badge}>{task.status.replaceAll("_", " ")}</span>}
                    {timerIsForTask && activeTimer ? (
                      <form action={stopTaskTimer}>
                        <input name="locale" type="hidden" value={lang} /><input name="projectId" type="hidden" value={project.id} /><input name="entryId" type="hidden" value={activeTimer.id} />
                        <button className={projectStyles.stopButton} type="submit">{isArabic ? "إيقاف" : "Stop timer"}</button>
                      </form>
                    ) : timerCanStart ? (
                      <form action={startTaskTimer}>
                        <input name="locale" type="hidden" value={lang} /><input name="projectId" type="hidden" value={project.id} /><input name="taskId" type="hidden" value={task.id} />
                        <button className={projectStyles.timerButton} type="submit">{isArabic ? "بدء التايمر" : "Start timer"}</button>
                      </form>
                    ) : assignedToCurrentUser && activeTimer ? <span className={projectStyles.timerBusy}>{isArabic ? "يوجد تايمر يعمل" : "Another timer is running"}</span> : null}
                    </div></td>
                  </tr>;
                })}</tbody>
              </table>
            ) : <p className={projectStyles.empty}>{isArabic ? "لا توجد تاسكات بعد." : "No tasks yet."}</p>}
          </section>

          {canManageTasks ? (
            <section className={styles.panel}>
              <div className={styles.panelHeader}><h2>{isArabic ? "إضافة تاسك" : "Add task"}</h2></div>
              <form action={createTask} className={projectStyles.form}>
                <input name="locale" type="hidden" value={lang} /><input name="projectId" type="hidden" value={project.id} />
                <div className={projectStyles.formGrid}>
                  <label className={projectStyles.wide}><span>{isArabic ? "عنوان التاسك" : "Task title"}</span><input name="title" maxLength={240} required /></label>
                  <label><span>{isArabic ? "الموظفون المسؤولون" : "Assignees"}</span><select name="assigneeIds" multiple size={Math.min(4, Math.max(2, project.members.length))}>{project.members.map(({ user: member }) => <option key={member.id} value={member.id}>{member.name}</option>)}</select><small>{isArabic ? "يمكن اختيار أكثر من موظف" : "Select one or more team members"}</small></label>
                  <label><span>{isArabic ? "الأولوية" : "Priority"}</span><select name="priority" defaultValue="MEDIUM"><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></label>
                  <label><span>{isArabic ? "الساعات المتوقعة" : "Estimated hours"}</span><input name="estimatedHours" type="number" min="0" step="0.25" defaultValue="0" required /></label>
                  <label><span>{isArabic ? "تاريخ التسليم" : "Due date"}</span><input name="dueDate" type="date" /></label>
                  <label className={projectStyles.wide}><span>{isArabic ? "الوصف" : "Description"}</span><textarea name="description" maxLength={1500} /></label>
                </div>
                <button className={styles.button} type="submit">{isArabic ? "إضافة التاسك" : "Add task"}</button>
              </form>
            </section>
          ) : null}
        </div>

        <aside className={projectStyles.stack}>
          {!isClientUser ? <section className={styles.panel}>
            <div className={styles.panelHeader}><h2>{isArabic ? "فريق المشروع" : "Project team"}</h2><span className={styles.badge}>{project.members.length}</span></div>
            <div className={projectStyles.memberList}>{project.members.map((member) => (
              <article className={projectStyles.member} key={member.id}>
                <div><strong>{member.user.name}</strong><span>{member.user.department?.name ?? "—"} · {member.role.replaceAll("_", " ")}</span></div>
                <strong>{Number(member.allocationPercent)}%</strong>
              </article>
            ))}</div>
          </section> : null}

          {canManageProject ? (
            <section className={styles.panel}>
              <div className={styles.panelHeader}><h2>{isArabic ? "تعيين موظف" : "Assign employee"}</h2></div>
              <form action={assignProjectMember} className={projectStyles.form}>
                <input name="locale" type="hidden" value={lang} /><input name="projectId" type="hidden" value={project.id} />
                <label><span>{isArabic ? "الموظف" : "Employee"}</span><select name="userId" required>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
                <label><span>{isArabic ? "نسبة التخصيص" : "Allocation percentage"}</span><input name="allocationPercent" type="number" min="0" max="100" step="1" defaultValue="100" required /></label>
                <button className={styles.button} type="submit">{isArabic ? "إضافة للفريق" : "Add to team"}</button>
              </form>
            </section>
          ) : null}

          {!isClientUser ? <section className={styles.panel}>
            <div className={styles.panelHeader}><h2>{isArabic ? "تفاصيل المشروع" : "Project details"}</h2></div>
            <div className={projectStyles.memberList}>
              <article className={projectStyles.member}><span>{isArabic ? "نموذج التسعير" : "Pricing model"}</span><strong>{project.pricingModel.replaceAll("_", " ")}</strong></article>
              <article className={projectStyles.member}><span>{isArabic ? "البداية" : "Start"}</span><strong>{formatDate(project.startDate, lang)}</strong></article>
              <article className={projectStyles.member}><span>{isArabic ? "التسليم" : "Target"}</span><strong>{formatDate(project.targetDate, lang)}</strong></article>
              <article className={projectStyles.member}><span>{isArabic ? "نائب المدير" : "Deputy"}</span><strong>{project.deputyManager?.name ?? "—"}</strong></article>
            </div>
          </section> : null}
        </aside>
      </div>
      </> : null}
    </AppShell>
  );
}
