import Link from "next/link";
import { notFound } from "next/navigation";

import { uploadTaskAttachment } from "@/actions/attachments";
import { deleteTask } from "@/actions/deletions";
import {
  addTaskAttachment,
  addTaskComment,
  archiveTask,
  createSubtask,
  updateTaskDetails,
  updateTaskWorkflowStatus,
} from "@/actions/tasks";
import { startTaskTimer, stopTaskTimer } from "@/actions/timers";
import { AppShell } from "@/components/app-shell";
import { DeleteRecordForm } from "@/components/delete-record-form";
import { FormFeedback } from "@/components/form-feedback";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { TimerCounter } from "@/components/timer-counter";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { formatAttachmentSize } from "@/lib/attachment-policy";
import { permissionKeysFor, requirePagePermission } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { canDeleteRecords, canViewAllProjectTasks, projectAccessLevelFor, projectAccessScope, taskAccessScope } from "@/lib/security-policy";

import projectStyles from "../../../../project-management.module.css";
import styles from "./task-details.module.css";

const nextTaskStatus = {
  BACKLOG: "IN_PROGRESS",
  TODO: "IN_PROGRESS",
  IN_PROGRESS: "IN_REVIEW",
  IN_REVIEW: "DONE",
  DONE: "TODO",
  CANCELLED: "TODO",
} as const;

function workflowLabel(status: keyof typeof nextTaskStatus, isArabic: boolean) {
  const labels = isArabic
    ? { BACKLOG: "بدء العمل", TODO: "بدء العمل", IN_PROGRESS: "إرسال للمراجعة", IN_REVIEW: "إنهاء التاسك", DONE: "إعادة فتح", CANCELLED: "استعادة التاسك" }
    : { BACKLOG: "Move to progress", TODO: "Start progress", IN_PROGRESS: "Send to review", IN_REVIEW: "Mark as done", DONE: "Reopen task", CANCELLED: "Restore task" };
  return labels[status];
}

function formatDate(date: Date | null, locale: string) {
  if (!date) return "—";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-JO" : "en-GB", { dateStyle: "medium" }).format(date);
}

function formatDateTime(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-JO" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function dateInputValue(date: Date | null) {
  return date?.toISOString().slice(0, 10) ?? "";
}

function hours(minutes: number) {
  const value = minutes / 60;
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function activityLabel(action: string, isArabic: boolean) {
  const labels: Record<string, string> = isArabic ? {
    "task.created": "أنشأ التاسك",
    "task.updated": "عدّل تفاصيل التاسك",
    "task.status_updated": "غيّر حالة سير العمل",
    "task.subtask_created": "أضاف تاسك فرعية",
    "task.comment_added": "أضاف تعليقًا",
    "task.attachment_added": "أضاف رابط مرفق",
    "task.attachment_uploaded": "رفع ملفًا إلى OneDrive",
    "task.archived": "أرشف التاسك",
    "timer.started": "شغّل تايمر التاسك",
  } : {
    "task.created": "Created the task",
    "task.updated": "Updated task details",
    "task.status_updated": "Changed the workflow status",
    "task.subtask_created": "Added a subtask",
    "task.comment_added": "Added a comment",
    "task.attachment_added": "Added an attachment link",
    "task.attachment_uploaded": "Uploaded a file to OneDrive",
    "task.archived": "Archived the task",
    "timer.started": "Started the task timer",
  };
  return labels[action] ?? action.replaceAll(".", " ").replaceAll("_", " ");
}

export default async function TaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; projectId: string; taskId: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { lang, projectId, taskId } = await params;
  const feedback = await searchParams;
  if (!isLocale(lang)) notFound();

  const user = await requirePagePermission(lang, "projects.read");
  const dictionary = getDictionary(lang);
  const permissions = permissionKeysFor(user);
  const canManageTasks = permissions.has("tasks.write");
  const canDelete = canDeleteRecords(permissions);
  const projectAccessLevel = projectAccessLevelFor(permissions, Boolean(user.clientContact));
  const canViewAllTasks = canViewAllProjectTasks(permissions);
  const isArabic = lang === "ar";

  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      projectId,
      ...taskAccessScope(user.id, canViewAllTasks),
      project: {
        organizationId: user.organizationId!,
        ...projectAccessScope(user.id, projectAccessLevel, user.clientContact?.clientId),
      },
    },
    include: {
      project: {
        include: {
          client: true,
          members: {
            where: canManageTasks ? {} : { userId: user.id },
            include: { user: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
      parent: {
        select: {
          id: true,
          title: true,
          assignees: { where: { userId: user.id }, select: { userId: true } },
        },
      },
      subtasks: {
        where: taskAccessScope(user.id, canViewAllTasks),
        include: { assignees: { include: { user: true } } },
        orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "asc" }],
      },
      assignees: { include: { user: true }, orderBy: { assignedAt: "asc" } },
      comments: { include: { author: true }, orderBy: { createdAt: "asc" } },
      attachments: { include: { uploadedBy: true }, orderBy: { createdAt: "desc" } },
      timeEntries: {
        where: {
          status: { not: "REJECTED" },
          ...(canViewAllTasks ? {} : { userId: user.id }),
        },
        select: { durationMinutes: true },
      },
    },
  });

  if (!task) notFound();

  const [activeTimer, activities, oneDriveConnection] = await Promise.all([
    prisma.timeEntry.findFirst({
      where: { userId: user.id, source: "TIMER", startedAt: { not: null }, endedAt: null },
      include: { task: true, project: true },
    }),
    prisma.auditLog.findMany({
      where: { organizationId: user.organizationId!, entityType: "Task", entityId: taskId },
      include: { actor: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.oneDriveConnection.findUnique({
      where: { organizationId: user.organizationId! },
      select: { id: true },
    }),
  ]);

  const assignedToCurrentUser = task.assignees.some((assignee) => assignee.userId === user.id);
  const visibleParent = task.parent && (canViewAllTasks || task.parent.assignees.length)
    ? task.parent
    : null;
  const canUpdateWorkflow = canManageTasks || assignedToCurrentUser;
  const timerIsForTask = activeTimer?.taskId === task.id;
  const timerCanStart = assignedToCurrentUser && !activeTimer && !["DONE", "CANCELLED"].includes(task.status);
  const trackedMinutes = task.timeEntries.reduce((sum, entry) => sum + entry.durationMinutes, 0);
  const completedSubtasks = task.subtasks.filter((subtask) => subtask.status === "DONE").length;
  const subtaskProgress = task.subtasks.length ? Math.round((completedSubtasks / task.subtasks.length) * 100) : 0;

  return (
    <AppShell
      activeSection="projects"
      alternateHref={`/${lang === "en" ? "ar" : "en"}/projects/${projectId}/tasks/${taskId}`}
      dictionary={dictionary}
      locale={lang}
    >
      <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
        <Link href={`/${lang}/projects`}>{isArabic ? "المشاريع" : "Projects"}</Link>
        <span>/</span>
        <Link href={`/${lang}/projects/${projectId}`}>{task.project.name}</Link>
        <span>/</span>
        <span>{task.title}</span>
      </nav>

      <header className={styles.taskHeader}>
        <div>
          <div className={styles.eyebrow}>{task.project.code} · {task.parent ? (isArabic ? "تاسك فرعية" : "Subtask") : (isArabic ? "تاسك" : "Task")}</div>
          <h1>{task.title}</h1>
          <div className={styles.headerMeta}>
            <span className={styles.statusChip} data-status={task.status}>{task.status.replaceAll("_", " ")}</span>
            <span className={styles.priorityChip} data-priority={task.priority}>{task.priority}</span>
            <span>{task.assignees.map((assignee) => assignee.user.name).join(", ") || (isArabic ? "غير مسندة" : "Unassigned")}</span>
          </div>
        </div>
        <div className={styles.headerActions}>
          {canUpdateWorkflow ? (
            <form action={updateTaskWorkflowStatus}>
              <input name="locale" type="hidden" value={lang} />
              <input name="projectId" type="hidden" value={projectId} />
              <input name="taskId" type="hidden" value={taskId} />
              <input name="context" type="hidden" value="detail" />
              <PendingSubmitButton className={styles.primaryAction} name="status" pendingLabel={isArabic ? "جارٍ التحديث..." : "Updating..."} value={nextTaskStatus[task.status]}>
                {workflowLabel(task.status, isArabic)}
              </PendingSubmitButton>
            </form>
          ) : null}
          {timerIsForTask && activeTimer ? (
            <form action={stopTaskTimer}>
              <input name="locale" type="hidden" value={lang} />
              <input name="projectId" type="hidden" value={projectId} />
              <input name="entryId" type="hidden" value={activeTimer.id} />
              <PendingSubmitButton className={styles.stopAction} pendingLabel={isArabic ? "جارٍ الحفظ..." : "Saving..."}>{isArabic ? "إيقاف وحفظ" : "Stop & save"}</PendingSubmitButton>
            </form>
          ) : timerCanStart ? (
            <form action={startTaskTimer}>
              <input name="locale" type="hidden" value={lang} />
              <input name="projectId" type="hidden" value={projectId} />
              <input name="taskId" type="hidden" value={taskId} />
              <PendingSubmitButton className={styles.timerAction} pendingLabel={isArabic ? "جارٍ البدء..." : "Starting..."}>{isArabic ? "بدء التايمر" : "Start timer"}</PendingSubmitButton>
            </form>
          ) : null}
        </div>
      </header>

      <FormFeedback error={feedback.error} success={feedback.success} />

      {activeTimer?.startedAt ? (
        <section className={projectStyles.timerBanner}>
          <div><span>{isArabic ? "العمل الحالي" : "Currently tracking"}</span><strong>{activeTimer.project.name} · {activeTimer.task.title}</strong></div>
          <TimerCounter startedAt={activeTimer.startedAt.toISOString()} />
          {timerIsForTask ? <span>{isArabic ? "هذه التاسك" : "This task"}</span> : <span>{isArabic ? "تايمر آخر يعمل" : "Another timer is running"}</span>}
        </section>
      ) : null}

      <section className={styles.metrics} aria-label="Task metrics">
        <article><span>{isArabic ? "الوقت المتوقع" : "Estimate"}</span><strong>{hours(task.estimatedMinutes)} h</strong></article>
        <article><span>{isArabic ? "الوقت المسجل" : "Tracked"}</span><strong>{hours(trackedMinutes)} h</strong></article>
        <article><span>{isArabic ? "المتبقي" : "Remaining"}</span><strong>{hours(task.remainingMinutes)} h</strong></article>
        <article><span>{isArabic ? "التاسكات الفرعية" : "Subtasks"}</span><strong>{completedSubtasks}/{task.subtasks.length} · {subtaskProgress}%</strong></article>
      </section>

      <div className={styles.layout}>
        <main className={styles.mainColumn}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2>{isArabic ? "التفاصيل" : "Overview"}</h2></div>
            <p className={task.description ? styles.description : styles.emptyText}>
              {task.description ?? (isArabic ? "لا يوجد وصف لهذه التاسك بعد." : "No description has been added yet.")}
            </p>
            {visibleParent ? <p className={styles.parentLink}>{isArabic ? "تابعة لـ" : "Parent task"}: <Link href={`/${lang}/projects/${projectId}/tasks/${visibleParent.id}`}>{visibleParent.title}</Link></p> : null}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>{isArabic ? "التاسكات الفرعية" : "Subtasks"}</h2>
              <span>{completedSubtasks}/{task.subtasks.length}</span>
            </div>
            <div className={styles.progressTrack}><span style={{ width: `${subtaskProgress}%` }} /></div>
            {task.subtasks.length ? (
              <div className={styles.subtaskList}>{task.subtasks.map((subtask) => (
                <Link className={styles.subtaskRow} href={`/${lang}/projects/${projectId}/tasks/${subtask.id}`} key={subtask.id}>
                  <span className={styles.subtaskState} data-done={subtask.status === "DONE"}>{subtask.status === "DONE" ? "✓" : ""}</span>
                  <div><strong>{subtask.title}</strong><span>{subtask.assignees.map((assignee) => assignee.user.name).join(", ") || (isArabic ? "غير مسندة" : "Unassigned")}</span></div>
                  <span className={styles.statusChip} data-status={subtask.status}>{subtask.status.replaceAll("_", " ")}</span>
                </Link>
              ))}</div>
            ) : <p className={styles.emptyText}>{isArabic ? "لا توجد تاسكات فرعية." : "No subtasks yet."}</p>}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2>{isArabic ? "التعليقات" : "Comments"}</h2><span>{task.comments.length}</span></div>
            {task.comments.length ? <div className={styles.commentList}>{task.comments.map((comment) => (
              <article className={styles.comment} key={comment.id}>
                <div className={styles.avatar}>{comment.author.name.slice(0, 1).toUpperCase()}</div>
                <div><div className={styles.commentMeta}><strong>{comment.author.name}</strong><time>{formatDateTime(comment.createdAt, lang)}</time></div><p>{comment.body}</p></div>
              </article>
            ))}</div> : <p className={styles.emptyText}>{isArabic ? "ابدأ النقاش حول هذه التاسك." : "Start the conversation about this task."}</p>}
            <form action={addTaskComment} className={styles.commentForm}>
              <input name="locale" type="hidden" value={lang} /><input name="projectId" type="hidden" value={projectId} /><input name="taskId" type="hidden" value={taskId} />
              <textarea aria-label="Comment" name="body" maxLength={2000} placeholder={isArabic ? "اكتب تعليقًا..." : "Write a comment..."} required />
              <PendingSubmitButton className={styles.primaryAction} pendingLabel={isArabic ? "جارٍ الإضافة..." : "Adding..."}>{isArabic ? "إضافة تعليق" : "Add comment"}</PendingSubmitButton>
            </form>
          </section>
        </main>

        <aside className={styles.sideColumn}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2>{isArabic ? "معلومات التاسك" : "Task information"}</h2></div>
            <dl className={styles.infoList}>
              <div><dt>{isArabic ? "المشروع" : "Project"}</dt><dd><Link href={`/${lang}/projects/${projectId}`}>{task.project.name}</Link></dd></div>
              <div><dt>{isArabic ? "العميل" : "Client"}</dt><dd>{task.project.client.name}</dd></div>
              <div><dt>{isArabic ? "تاريخ البدء" : "Start date"}</dt><dd>{formatDate(task.startDate, lang)}</dd></div>
              <div><dt>{isArabic ? "تاريخ التسليم" : "Due date"}</dt><dd>{formatDate(task.dueDate, lang)}</dd></div>
              <div><dt>{isArabic ? "قابلة للفوترة" : "Billable"}</dt><dd>{task.billable ? (isArabic ? "نعم" : "Yes") : (isArabic ? "لا" : "No")}</dd></div>
            </dl>
          </section>

          {canManageTasks ? (
            <details className={styles.panel} open>
              <summary>{isArabic ? "تعديل التاسك" : "Edit task"}</summary>
              <form action={updateTaskDetails} className={styles.form}>
                <input name="locale" type="hidden" value={lang} /><input name="projectId" type="hidden" value={projectId} /><input name="taskId" type="hidden" value={taskId} />
                <label><span>{isArabic ? "العنوان" : "Title"}</span><input name="title" defaultValue={task.title} maxLength={240} required /></label>
                <label><span>{isArabic ? "الوصف" : "Description"}</span><textarea name="description" defaultValue={task.description ?? ""} maxLength={1500} /></label>
                <div className={styles.formGrid}>
                  <label><span>{isArabic ? "الحالة" : "Status"}</span><select name="status" defaultValue={task.status}>{["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"].map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label>
                  <label><span>{isArabic ? "الأولوية" : "Priority"}</span><select name="priority" defaultValue={task.priority}>{["LOW", "MEDIUM", "HIGH", "URGENT"].map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label>
                  <label><span>{isArabic ? "البدء" : "Start"}</span><input name="startDate" type="date" defaultValue={dateInputValue(task.startDate)} /></label>
                  <label><span>{isArabic ? "التسليم" : "Due"}</span><input name="dueDate" type="date" defaultValue={dateInputValue(task.dueDate)} /></label>
                  <label><span>{isArabic ? "الساعات المتوقعة" : "Estimated hours"}</span><input name="estimatedHours" type="number" min="0" step="0.25" defaultValue={hours(task.estimatedMinutes)} /></label>
                  <label><span>{isArabic ? "الساعات المتبقية" : "Remaining hours"}</span><input name="remainingHours" type="number" min="0" step="0.25" defaultValue={hours(task.remainingMinutes)} /></label>
                </div>
                <fieldset><legend>{isArabic ? "الموظفون المسؤولون" : "Assignees"}</legend><div className={styles.checkList}>{task.project.members.map((member) => <label key={member.userId}><input name="assigneeIds" type="checkbox" value={member.userId} defaultChecked={task.assignees.some((assignee) => assignee.userId === member.userId)} /><span>{member.user.name}</span></label>)}</div></fieldset>
                <label className={styles.checkbox}><input name="billable" type="checkbox" defaultChecked={task.billable} /><span>{isArabic ? "وقت قابل للفوترة" : "Billable time"}</span></label>
                <PendingSubmitButton className={styles.primaryAction} pendingLabel={isArabic ? "جارٍ الحفظ..." : "Saving..."}>{isArabic ? "حفظ التعديلات" : "Save changes"}</PendingSubmitButton>
              </form>
              {task.status !== "CANCELLED" ? <form action={archiveTask} className={styles.archiveForm}><input name="locale" type="hidden" value={lang} /><input name="projectId" type="hidden" value={projectId} /><input name="taskId" type="hidden" value={taskId} /><PendingSubmitButton pendingLabel={isArabic ? "جارٍ الأرشفة..." : "Archiving..."}>{isArabic ? "أرشفة التاسك" : "Archive task"}</PendingSubmitButton></form> : null}
            </details>
          ) : null}

          {canManageTasks ? (
            <details className={styles.panel}>
              <summary>{isArabic ? "إضافة تاسك فرعية" : "Add subtask"}</summary>
              <form action={createSubtask} className={styles.form}>
                <input name="locale" type="hidden" value={lang} /><input name="projectId" type="hidden" value={projectId} /><input name="taskId" type="hidden" value={taskId} />
                <label><span>{isArabic ? "العنوان" : "Title"}</span><input name="title" maxLength={240} required /></label>
                <label><span>{isArabic ? "الموظف" : "Assignee"}</span><select name="assigneeId"><option value="">—</option>{task.project.members.map((member) => <option key={member.userId} value={member.userId}>{member.user.name}</option>)}</select></label>
                <div className={styles.formGrid}><label><span>{isArabic ? "الساعات" : "Hours"}</span><input name="estimatedHours" type="number" min="0" step="0.25" defaultValue="0" /></label><label><span>{isArabic ? "التسليم" : "Due"}</span><input name="dueDate" type="date" /></label></div>
                <label><span>{isArabic ? "الوصف" : "Description"}</span><textarea name="description" maxLength={800} /></label>
                <PendingSubmitButton className={styles.primaryAction} pendingLabel={isArabic ? "جارٍ الإضافة..." : "Adding..."}>{isArabic ? "إضافة" : "Add subtask"}</PendingSubmitButton>
              </form>
            </details>
          ) : null}

          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2>{isArabic ? "المرفقات" : "Attachments"}</h2><span>{task.attachments.length}</span></div>
            {task.attachments.length ? <div className={styles.attachmentList}>{task.attachments.map((attachment) => {
              const href = attachment.storageProvider === "ONEDRIVE" && attachment.oneDriveItemId
                ? `/api/attachments/tasks/${attachment.id}`
                : attachment.url;
              const size = formatAttachmentSize(attachment.sizeBytes);
              return <a href={href} key={attachment.id} rel="noreferrer" target="_blank"><span>{attachment.storageProvider === "ONEDRIVE" ? "☁" : "↗"}</span><div><strong>{attachment.name}</strong><small>{attachment.uploadedBy.name}{size ? ` · ${size}` : ""}{attachment.storageProvider === "ONEDRIVE" ? " · OneDrive" : ""}</small></div></a>;
            })}</div> : <p className={styles.emptyText}>{isArabic ? "لا توجد مرفقات بعد." : "No attachments yet."}</p>}
            {oneDriveConnection ? <form action={uploadTaskAttachment} className={styles.form}>
              <input name="locale" type="hidden" value={lang} /><input name="projectId" type="hidden" value={projectId} /><input name="taskId" type="hidden" value={taskId} />
              <label><span>{isArabic ? "اختر ملفًا" : "Upload file"}</span><input accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.zip" name="file" type="file" required /><small>{isArabic ? "الحد الأقصى 10 MB. سيُحفظ داخل مجلد التاسك على OneDrive." : "Maximum 10 MB. Stored in this task's OneDrive folder."}</small></label>
              <PendingSubmitButton className={styles.primaryAction} pendingLabel={isArabic ? "جارٍ الرفع..." : "Uploading..."}>{isArabic ? "رفع إلى OneDrive" : "Upload to OneDrive"}</PendingSubmitButton>
            </form> : <p className={styles.emptyText}>{isArabic ? "يجب ربط OneDrive قبل رفع الملفات." : "Connect OneDrive before uploading files."}</p>}
            <details className={styles.linkDetails}>
              <summary>{isArabic ? "إضافة رابط خارجي بدلًا من ملف" : "Add an external link instead"}</summary>
              <form action={addTaskAttachment} className={styles.form}>
                <input name="locale" type="hidden" value={lang} /><input name="projectId" type="hidden" value={projectId} /><input name="taskId" type="hidden" value={taskId} />
                <label><span>{isArabic ? "اسم الرابط" : "Link name"}</span><input name="name" maxLength={160} required /></label>
                <label><span>{isArabic ? "الرابط" : "URL"}</span><input name="url" type="url" placeholder="https://" maxLength={1000} required /></label>
                <PendingSubmitButton className={styles.secondaryAction} pendingLabel={isArabic ? "جارٍ الإضافة..." : "Adding..."}>{isArabic ? "إضافة الرابط" : "Add link"}</PendingSubmitButton>
              </form>
            </details>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2>{isArabic ? "سجل النشاط" : "Activity"}</h2></div>
            {activities.length ? <ol className={styles.activityList}>{activities.map((activity) => <li key={activity.id}><span /><div><strong>{activity.actor?.name ?? "System"}</strong><p>{activityLabel(activity.action, isArabic)}</p><time>{formatDateTime(activity.createdAt, lang)}</time></div></li>)}</ol> : <p className={styles.emptyText}>{isArabic ? "لا يوجد نشاط مسجل." : "No activity recorded yet."}</p>}
          </section>
        </aside>
      </div>
      {canDelete ? <DeleteRecordForm
        action={deleteTask}
        buttonLabel={isArabic ? "حذف التاسك نهائيًا" : "Delete task permanently"}
        confirmationLabel={isArabic ? `أفهم أن حذف التاسك ${task.title} نهائي ولا يمكن التراجع عنه.` : `I understand that deleting ${task.title} is permanent and cannot be undone.`}
        description={isArabic ? "لا يمكن حذف تاسك لديها ساعات مسجلة أو تاسكات فرعية. استخدم الأرشفة إذا أردت الاحتفاظ بالسجل." : "A task with recorded time or subtasks cannot be deleted. Archive it when the history must be preserved."}
        idField="taskId"
        idValue={task.id}
        locale={lang}
        pendingLabel={isArabic ? "جاري الحذف..." : "Deleting..."}
        projectId={projectId}
        title={isArabic ? "منطقة الخطر" : "Danger zone"}
      /> : null}
    </AppShell>
  );
}
