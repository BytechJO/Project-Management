import { notFound } from "next/navigation";

import {
  approveTimesheet,
  approveVisibleTimesheets,
  createManualTimeEntry,
  returnTimesheet,
  submitTimesheet,
} from "@/actions/timesheets";
import { stopTaskTimer } from "@/actions/timers";
import { AppShell } from "@/components/app-shell";
import { FormFeedback } from "@/components/form-feedback";
import { TimerCounter } from "@/components/timer-counter";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { permissionKeysFor, requirePagePermission } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { canViewAllProjectTasks, projectAccessLevelFor, projectAccessScope, taskAccessScope, timesheetApprovalScope } from "@/lib/security-policy";

import managementStyles from "../management.module.css";
import moduleStyles from "../module-pages.module.css";
import styles from "../section-page.module.css";

function weekStartFor(date: Date) {
  const weekStart = new Date(date);
  weekStart.setUTCDate(date.getUTCDate() - date.getUTCDay());
  weekStart.setUTCHours(0, 0, 0, 0);
  return weekStart;
}

function formatDate(date: Date, lang: string) {
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-JO" : "en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

function formatHours(minutes: number) {
  return `${(minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 2)} h`;
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export default async function TimesheetsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { lang } = await params;
  const feedback = await searchParams;
  if (!isLocale(lang)) notFound();

  const user = await requirePagePermission(lang, "time_entries.own");
  const dictionary = getDictionary(lang);
  const page = dictionary.timesheets;
  const isArabic = lang === "ar";
  const permissions = permissionKeysFor(user);
  const canApprove = permissions.has("timesheets.approve");
  const canApproveAll = permissions.has("financials.write");
  const canViewFinancials = permissions.has("financials.read");
  const projectAccessLevel = projectAccessLevelFor(permissions, Boolean(user.clientContact));
  const canViewAllTasks = canViewAllProjectTasks(permissions);
  const today = new Date();
  const weekStart = weekStartFor(today);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 4);
  const todayInput = today.toISOString().slice(0, 10);
  const weekStartInput = weekStart.toISOString().slice(0, 10);
  const weekEndInput = weekEnd.toISOString().slice(0, 10);

  const [myTimesheet, tasks, approvalQueue, approvedCount, unsubmittedCount] = await Promise.all([
    prisma.timesheet.findUnique({
      where: { userId_weekStart: { userId: user.id, weekStart } },
      include: {
        entries: {
          include: { project: true, task: true },
          orderBy: [{ workDate: "asc" }, { createdAt: "asc" }],
        },
      },
    }),
    prisma.task.findMany({
      where: {
        status: { not: "CANCELLED" },
        ...taskAccessScope(user.id, canViewAllTasks),
        project: {
          organizationId: user.organizationId!,
          ...projectAccessScope(user.id, projectAccessLevel, user.clientContact?.clientId),
        },
      },
      include: { project: true },
      orderBy: [{ project: { name: "asc" } }, { title: "asc" }],
    }),
    canApprove
      ? prisma.timesheet.findMany({
          where: {
            status: "SUBMITTED",
            userId: { not: user.id },
            user: { organizationId: user.organizationId! },
            ...timesheetApprovalScope(user.id, canApproveAll),
          },
          include: {
            user: { include: { costRates: { orderBy: { validFrom: "desc" }, take: 1 } } },
            entries: { include: { project: true, task: true } },
          },
          orderBy: { submittedAt: "desc" },
        })
      : Promise.resolve([]),
    canApprove
      ? prisma.timesheet.count({
          where: {
            status: "APPROVED",
            weekStart,
            approvedById: user.id,
            user: { organizationId: user.organizationId! },
          },
        })
      : Promise.resolve(0),
    canApprove
      ? prisma.timesheet.count({
          where: {
            status: { in: ["DRAFT", "REJECTED"] },
            weekStart,
            userId: { not: user.id },
            user: { organizationId: user.organizationId! },
            ...timesheetApprovalScope(user.id, canApproveAll),
          },
        })
      : Promise.resolve(0),
  ]);

  const myTotalMinutes = myTimesheet?.entries.reduce((total, entry) => total + entry.durationMinutes, 0) ?? 0;
  const canEditMyTimesheet = !myTimesheet || ["DRAFT", "REJECTED"].includes(myTimesheet.status);
  const activeTimer = myTimesheet?.entries.find((entry) => entry.source === "TIMER" && entry.startedAt && !entry.endedAt);

  return (
    <AppShell activeSection="timesheets" dictionary={dictionary} locale={lang}>
      <div className={styles.headingRow}>
        <div>
          <h1>{canApprove ? page.title : (isArabic ? "تسجيل ساعات العمل" : "Time tracking")}</h1>
          <p className={styles.subtitle}>
            {isArabic ? "أسبوع" : "Week"} {formatDate(weekStart, lang)}–{formatDate(weekEnd, lang)} · {user.weeklyCapacityMinutes / 60} {isArabic ? "ساعة متوقعة" : "expected hours"}
          </p>
        </div>
        {canApprove && approvalQueue.length > 0 ? (
          <form action={approveVisibleTimesheets}>
            <input name="locale" type="hidden" value={lang} />
            <button className={styles.secondaryButton} type="submit">{page.approveVisible}</button>
          </form>
        ) : null}
      </div>

      <FormFeedback error={feedback.error} success={feedback.success} />

      {activeTimer?.startedAt ? (
        <section className={moduleStyles.activeTimer}>
          <div>
            <span>{isArabic ? "تعمل الآن على" : "Currently working on"}</span>
            <strong>{activeTimer.project.name} · {activeTimer.task.title}</strong>
          </div>
          <TimerCounter startedAt={activeTimer.startedAt.toISOString()} />
          <form action={stopTaskTimer}>
            <input name="locale" type="hidden" value={lang} />
            <input name="projectId" type="hidden" value={activeTimer.projectId} />
            <input name="entryId" type="hidden" value={activeTimer.id} />
            <input name="context" type="hidden" value="timesheets" />
            <button className={moduleStyles.stopTimerButton} type="submit">{isArabic ? "إيقاف وحفظ" : "Stop & save"}</button>
          </form>
        </section>
      ) : null}

      {canApprove ? (
        <section className={moduleStyles.summaryThree} aria-label="Timesheet approval summary">
          <article className={styles.metric}><div className={styles.metricLabel}>{page.pending}</div><div className={styles.metricValue} data-tone="accent">{approvalQueue.length}</div></article>
          <article className={styles.metric}><div className={styles.metricLabel}>{page.approved}</div><div className={styles.metricValue}>{approvedCount}</div></article>
          <article className={styles.metric}><div className={styles.metricLabel}>{page.unsubmitted}</div><div className={styles.metricValue}>{unsubmittedCount}</div></article>
        </section>
      ) : null}

      <div className={moduleStyles.timesheetLayout}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>{isArabic ? "ساعاتي لهذا الأسبوع" : "My hours this week"}</h2>
              <span className={styles.secondaryText}>{isArabic ? "الحالة" : "Status"}: {myTimesheet?.status.replaceAll("_", " ") ?? "DRAFT"}</span>
            </div>
            <strong>{formatHours(myTotalMinutes)}</strong>
          </div>

          {myTimesheet?.rejectionReason ? (
            <p className={moduleStyles.rejectionReason}><strong>{isArabic ? "سبب الإرجاع:" : "Return reason:"}</strong> {myTimesheet.rejectionReason}</p>
          ) : null}

          {myTimesheet?.entries.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>{isArabic ? "التاريخ" : "Date"}</th><th>{page.projects}</th><th>{isArabic ? "المهمة" : "Task"}</th><th>{page.tracked}</th><th>{isArabic ? "ملاحظة" : "Note"}</th></tr></thead>
                <tbody>{myTimesheet.entries.map((entry) => (
                  <tr key={entry.id}><td>{formatDate(entry.workDate, lang)}</td><td>{entry.project.name}</td><td>{entry.task.title}</td><td>{entry.id === activeTimer?.id && entry.startedAt ? <TimerCounter startedAt={entry.startedAt.toISOString()} /> : formatHours(entry.durationMinutes)}</td><td>{entry.id === activeTimer?.id ? (isArabic ? "التايمر يعمل" : "Timer running") : (entry.note ?? "—")}</td></tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className={managementStyles.empty}>{isArabic ? "لم تسجّل ساعات بعد." : "No hours logged yet."}</p>}

          {myTimesheet && canEditMyTimesheet && myTimesheet.entries.length > 0 && !activeTimer ? (
            <form action={submitTimesheet} className={moduleStyles.submitRow}>
              <input name="locale" type="hidden" value={lang} />
              <input name="timesheetId" type="hidden" value={myTimesheet.id} />
              <button className={styles.button} type="submit">{isArabic ? "إرسال للموافقة" : "Submit for approval"}</button>
            </form>
          ) : activeTimer ? <p className={moduleStyles.timerSubmissionWarning}>{isArabic ? "أوقف التايمر قبل إرسال الساعات للموافقة." : "Stop the running timer before submitting your timesheet."}</p> : null}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}><h2>{isArabic ? "تسجيل ساعات يدوياً" : "Log manual hours"}</h2></div>
          {canEditMyTimesheet ? (
            tasks.length ? (
              <form action={createManualTimeEntry} className={managementStyles.form}>
                <input name="locale" type="hidden" value={lang} />
                <label><span>{isArabic ? "المشروع والمهمة" : "Project and task"}</span><select name="taskId" required>{tasks.map((task) => <option key={task.id} value={task.id}>{task.project.name} · {task.title}</option>)}</select></label>
                <label><span>{isArabic ? "تاريخ العمل" : "Work date"}</span><input name="workDate" type="date" min={weekStartInput} max={weekEndInput} defaultValue={todayInput} required /></label>
                <label><span>{isArabic ? "عدد الساعات" : "Hours"}</span><input name="durationHours" type="number" min="0.25" max="18" step="0.25" required /></label>
                <label><span>{isArabic ? "ملاحظة" : "Note"}</span><textarea name="note" maxLength={500} /></label>
                <button className={styles.button} type="submit">{isArabic ? "إضافة الساعات" : "Add hours"}</button>
              </form>
            ) : <p className={managementStyles.empty}>{isArabic ? "يجب إسنادك إلى مشروع يحتوي على مهام أولاً." : "You need an assigned project with tasks before logging hours."}</p>
          ) : <p className={managementStyles.empty}>{isArabic ? "تم إرسال هذا السجل ولا يمكن تعديله الآن." : "This timesheet has been submitted and cannot be edited now."}</p>}
        </section>
      </div>

      {canApprove ? (
        <section className={`${styles.panel} ${moduleStyles.approvalPanel}`}>
          <div className={styles.panelHeader}><h2>{isArabic ? "قائمة الموافقات" : "Approval queue"}</h2><span className={styles.badge}>{approvalQueue.length} {isArabic ? "بانتظارك" : "waiting"}</span></div>
          {approvalQueue.length ? (
            <div className={moduleStyles.approvalList}>
              {approvalQueue.map((timesheet) => {
                const totalMinutes = timesheet.entries.reduce((total, entry) => total + entry.durationMinutes, 0);
                const rate = timesheet.user.costRates[0];
                const projectNames = Array.from(new Set(timesheet.entries.map((entry) => entry.project.name))).join(" · ");
                const actualCost = rate ? (totalMinutes / 60) * Number(rate.hourlyCost) : null;
                return (
                  <article className={moduleStyles.approvalCard} key={timesheet.id}>
                    <div className={moduleStyles.approvalDetails}>
                      <span className={styles.avatar}>{initials(timesheet.user.name)}</span>
                      <div><strong>{timesheet.user.name}</strong><span>{projectNames || "—"}</span></div>
                      <div><small>{page.tracked}</small><strong>{formatHours(totalMinutes)}</strong></div>
                      {canViewFinancials ? <div><small>{isArabic ? "التكلفة" : "Actual cost"}</small><strong>{actualCost === null ? "Rate not set" : `${actualCost.toFixed(2)} ${rate?.currency}`}</strong></div> : null}
                    </div>
                    <div className={moduleStyles.reviewActions}>
                      <form action={approveTimesheet}>
                        <input name="locale" type="hidden" value={lang} />
                        <input name="timesheetId" type="hidden" value={timesheet.id} />
                        <button className={styles.button} type="submit">{page.approve}</button>
                      </form>
                      <form action={returnTimesheet} className={moduleStyles.returnForm}>
                        <input name="locale" type="hidden" value={lang} />
                        <input name="timesheetId" type="hidden" value={timesheet.id} />
                        <input name="reason" maxLength={500} placeholder={isArabic ? "سبب الرفض أو الإرجاع" : "Reason for return or rejection"} required />
                        <button className={styles.secondaryButton} type="submit">{isArabic ? "رفض / إرجاع" : "Return / reject"}</button>
                      </form>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : <p className={managementStyles.empty}>{isArabic ? "لا توجد ساعات بانتظار الموافقة حالياً." : "No timesheets are waiting for approval."}</p>}
        </section>
      ) : null}
    </AppShell>
  );
}
