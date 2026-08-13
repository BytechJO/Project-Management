import { notFound, redirect } from "next/navigation";

import {
  approveLeaveRequest,
  cancelLeaveRequest,
  rejectLeaveRequest,
  submitLeaveRequest,
  updateEmployeeLeaveBalance,
} from "@/actions/leave-requests";
import { AppShell } from "@/components/app-shell";
import { FormFeedback } from "@/components/form-feedback";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { permissionKeysFor, requireUser } from "@/lib/dal";
import { getEmployeeLeaveSummary } from "@/lib/leave-management";
import { calculateWorkingLeaveMinutes, isoDate, yearRange } from "@/lib/leave-policy";
import { prisma } from "@/lib/prisma";
import { canOpenLeavePortal, leaveReviewScope } from "@/lib/security-policy";

import operationStyles from "../operations.module.css";
import styles from "./leave.module.css";

function validYear(value: string | undefined, fallback: number) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2020 && year <= 2100 ? year : fallback;
}

function formatDate(date: Date, lang: string) {
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-JO" : "en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).format(date);
}

function formatHours(minutes: number) {
  return `${(minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 2)} h`;
}

function formatDays(minutes: number, dailyCapacityMinutes: number, lang: string) {
  const days = dailyCapacityMinutes > 0 ? minutes / dailyCapacityMinutes : 0;
  return `${days.toFixed(Number.isInteger(days) ? 0 : 2)} ${lang === "ar" ? "يوم" : days === 1 ? "day" : "days"}`;
}

function typeLabel(type: string, isArabic: boolean) {
  const labels: Record<string, [string, string]> = {
    ANNUAL: ["Annual", "سنوية"],
    SICK: ["Sick", "مرضية"],
    UNPAID: ["Unpaid", "غير مدفوعة"],
    OTHER: ["Other", "أخرى"],
  };
  return labels[type]?.[isArabic ? 1 : 0] ?? type;
}

function statusLabel(status: string, isArabic: boolean) {
  const labels: Record<string, [string, string]> = {
    SUBMITTED: ["Submitted", "قيد المراجعة"],
    APPROVED: ["Approved", "معتمدة"],
    REJECTED: ["Rejected", "مرفوضة"],
    CANCELLED: ["Cancelled", "ملغاة"],
  };
  return labels[status]?.[isArabic ? 1 : 0] ?? status.replaceAll("_", " ");
}

export default async function LeavePortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ year?: string; error?: string; success?: string }>;
}) {
  const { lang } = await params;
  const query = await searchParams;
  if (!isLocale(lang)) notFound();

  const user = await requireUser(lang);
  const permissions = permissionKeysFor(user);
  if (!canOpenLeavePortal(permissions)) redirect(`/${lang}`);
  const dictionary = getDictionary(lang);
  const isArabic = lang === "ar";
  const currentYear = new Date().getUTCFullYear();
  const year = validYear(query.year, currentYear);
  const range = yearRange(year);
  const canReview = permissions.has("timesheets.approve") || permissions.has("employees.write");
  const canReviewAll = permissions.has("employees.write");
  const canManageBalances = permissions.has("employees.write");
  const canRequest = permissions.has("time_entries.own");

  const [summary, organization, holidays, myRequests, teamRequests, employees, balances] = await Promise.all([
    getEmployeeLeaveSummary(user.organizationId!, user.id, year),
    prisma.organization.findUnique({ where: { id: user.organizationId! }, select: { workdays: true, workdayMinutes: true } }),
    prisma.organizationHoliday.findMany({ where: { organizationId: user.organizationId!, date: { gte: range.start, lte: range.end } }, select: { date: true } }),
    prisma.employeeLeave.findMany({
      where: { organizationId: user.organizationId!, userId: user.id, startDate: { lte: range.end }, endDate: { gte: range.start } },
      include: { reviewedBy: { select: { name: true } } },
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    }),
    canReview ? prisma.employeeLeave.findMany({
      where: {
        organizationId: user.organizationId!,
        userId: { not: user.id },
        startDate: { lte: range.end },
        endDate: { gte: range.start },
        ...leaveReviewScope(user.id, canReviewAll),
      },
      include: { user: { select: { name: true, jobTitle: true, weeklyCapacityMinutes: true, department: { select: { name: true } } } }, reviewedBy: { select: { name: true } } },
      orderBy: [{ status: "asc" }, { submittedAt: "desc" }],
      take: 60,
    }) : Promise.resolve([]),
    canManageBalances ? prisma.user.findMany({
      where: { organizationId: user.organizationId!, status: { not: "ARCHIVED" } },
      select: { id: true, name: true, weeklyCapacityMinutes: true, department: { select: { name: true } } },
      orderBy: { name: "asc" },
    }) : Promise.resolve([]),
    canManageBalances ? prisma.employeeLeaveBalance.findMany({
      where: { organizationId: user.organizationId!, year },
      include: { user: { select: { name: true, weeklyCapacityMinutes: true } } },
      orderBy: { user: { name: "asc" } },
    }) : Promise.resolve([]),
  ]);
  if (!summary || !organization) notFound();

  const holidayDates = new Set(holidays.map(({ date }) => isoDate(date)));
  const minutesFor = (leave: { startDate: Date; endDate: Date; minutesPerWorkday: number | null }, weeklyCapacityMinutes: number) => calculateWorkingLeaveMinutes({
    startDate: leave.startDate < range.start ? range.start : leave.startDate,
    endDate: leave.endDate > range.end ? range.end : leave.endDate,
    workdays: organization.workdays,
    dailyCapacityMinutes: Math.round(weeklyCapacityMinutes / Math.max(organization.workdays.length, 1)),
    minutesPerWorkday: leave.minutesPerWorkday,
    holidayDates,
  });
  const reviewQueue = teamRequests.filter(({ status }) => status === "SUBMITTED");
  const today = new Date();
  const todayInput = today.toISOString().slice(0, 10);
  const years = Array.from({ length: 5 }, (_, index) => currentYear - 2 + index);

  return (
    <AppShell
      activeSection="leave"
      alternateHref={`/${lang === "en" ? "ar" : "en"}/leave?year=${year}`}
      dictionary={dictionary}
      locale={lang}
    >
      <header className={operationStyles.pageHeader}>
        <div>
          <span className={operationStyles.eyebrow}>{isArabic ? "الحضور والإجازات" : "ATTENDANCE & LEAVE"}</span>
          <h1>{isArabic ? "طلبات الإجازة" : "Leave requests"}</h1>
          <p>{isArabic ? "اطلب إجازتك وتابع الرصيد وحالة الموافقة." : "Request leave and track balances and approval status."}</p>
        </div>
        <form className={styles.yearFilter}>
          <label><span>{isArabic ? "السنة" : "Year"}</span><select defaultValue={year} name="year">{years.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
          <button className={styles.secondaryButton} type="submit">{isArabic ? "عرض" : "View"}</button>
        </form>
      </header>

      <FormFeedback error={query.error} success={query.success} />

      <section className={`${operationStyles.metrics} ${styles.metrics}`} aria-label="Leave balance summary">
        <article><span>{isArabic ? "رصيد السنوية" : "Annual entitlement"}</span><strong>{summary.configured ? formatDays(summary.annualEntitlementMinutes, summary.dailyCapacityMinutes, lang) : "—"}</strong><small>{summary.configured ? `${formatHours(summary.annualEntitlementMinutes)}` : (isArabic ? "لم يضبط بعد" : "Not configured")}</small></article>
        <article><span>{isArabic ? "السنوية المستخدمة" : "Annual used"}</span><strong>{formatDays(summary.annualApprovedMinutes, summary.dailyCapacityMinutes, lang)}</strong><small>{formatDays(summary.annualPendingMinutes, summary.dailyCapacityMinutes, lang)} {isArabic ? "معلقة" : "pending"}</small></article>
        <article data-tone="positive"><span>{isArabic ? "المتبقي السنوي" : "Annual remaining"}</span><strong>{summary.configured ? formatDays(summary.annualRemainingMinutes, summary.dailyCapacityMinutes, lang) : "—"}</strong><small>{summary.configured ? formatHours(summary.annualRemainingMinutes) : (isArabic ? "بانتظار إعداد الرصيد" : "Waiting for balance setup")}</small></article>
        <article><span>{isArabic ? "المرضية المستخدمة" : "Sick leave used"}</span><strong>{formatDays(summary.sickApprovedMinutes, summary.dailyCapacityMinutes, lang)}</strong><small>{formatDays(summary.sickPendingMinutes, summary.dailyCapacityMinutes, lang)} {isArabic ? "معلقة" : "pending"}</small></article>
      </section>

      <div className={styles.layout}>
        <div className={styles.stack}>
          {canRequest ? <section className={operationStyles.panel}>
            <div className={operationStyles.panelHeader}><div><h2>{isArabic ? "طلب إجازة جديد" : "New leave request"}</h2><p>{isArabic ? "سيصل الطلب للمدير أو الأدمن للمراجعة." : "The request will be sent to your manager or administrator."}</p></div></div>
            <form action={submitLeaveRequest} className={styles.form}>
              <input name="locale" type="hidden" value={lang} />
              <label><span>{isArabic ? "نوع الإجازة" : "Leave type"}</span><select name="type"><option value="ANNUAL">{isArabic ? "سنوية" : "Annual"}</option><option value="SICK">{isArabic ? "مرضية" : "Sick"}</option><option value="UNPAID">{isArabic ? "غير مدفوعة" : "Unpaid"}</option><option value="OTHER">{isArabic ? "أخرى" : "Other"}</option></select></label>
              <div className={styles.formGrid}><label><span>{isArabic ? "من" : "From"}</span><input defaultValue={todayInput} name="startDate" type="date" required /></label><label><span>{isArabic ? "إلى" : "To"}</span><input defaultValue={todayInput} name="endDate" type="date" required /></label></div>
              <label><span>{isArabic ? "ساعات اليوم (اتركها فارغة ليوم كامل)" : "Hours per day (blank for full day)"}</span><input max={summary.dailyCapacityMinutes / 60} min="0.25" name="hoursPerWorkday" step="0.25" type="number" /></label>
              <label><span>{isArabic ? "السبب أو الملاحظات" : "Reason or notes"}</span><textarea maxLength={800} name="notes" /></label>
              {!summary.configured ? <p className={styles.hint}>{isArabic ? "يجب على الأدمن ضبط الرصيد قبل إرسال إجازة سنوية. الأنواع الأخرى متاحة." : "An administrator must configure your balance before annual leave can be submitted. Other leave types remain available."}</p> : null}
              <button className={styles.primaryButton} type="submit">{isArabic ? "إرسال للموافقة" : "Submit for approval"}</button>
            </form>
          </section> : null}

          {canManageBalances ? <section className={operationStyles.panel}>
            <div className={operationStyles.panelHeader}><div><h2>{isArabic ? "إعداد أرصدة الموظفين" : "Employee balance setup"}</h2><p>{year} · {isArabic ? "القيم بالأيام وتتحول حسب ساعات الموظف اليومية." : "Values are entered in days and converted using each employee's daily capacity."}</p></div></div>
            <form action={updateEmployeeLeaveBalance} className={styles.form}>
              <input name="locale" type="hidden" value={lang} /><input name="year" type="hidden" value={year} />
              <label><span>{isArabic ? "الموظف" : "Employee"}</span><select name="userId" required>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}{employee.department ? ` · ${employee.department.name}` : ""}</option>)}</select></label>
              <div className={styles.formGrid}><label><span>{isArabic ? "أيام سنوية" : "Annual days"}</span><input defaultValue="0" min="0" name="annualDays" step="0.25" type="number" required /></label><label><span>{isArabic ? "أيام مرضية" : "Sick days"}</span><input defaultValue="0" min="0" name="sickDays" step="0.25" type="number" required /></label></div>
              <label><span>{isArabic ? "سنوية مرحلة من السنة السابقة" : "Carried-over annual days"}</span><input defaultValue="0" min="0" name="carriedOverDays" step="0.25" type="number" required /></label>
              <button className={styles.primaryButton} type="submit">{isArabic ? "حفظ الرصيد" : "Save balance"}</button>
            </form>
            <div className={styles.balanceList}>{balances.map((balance) => {
              const dailyCapacity = Math.round(balance.user.weeklyCapacityMinutes / Math.max(organization.workdays.length, 1));
              return <div className={styles.balanceRow} key={balance.id}><div><strong>{balance.user.name}</strong><span>{isArabic ? "سنوي" : "Annual"}: {formatDays(balance.annualAllowanceMinutes, dailyCapacity, lang)} · {isArabic ? "مرضي" : "Sick"}: {formatDays(balance.sickAllowanceMinutes, dailyCapacity, lang)}</span></div><strong>{formatDays(balance.carriedOverAnnualMinutes, dailyCapacity, lang)} {isArabic ? "مرحّل" : "carried"}</strong></div>;
            })}</div>
          </section> : null}
        </div>

        <div className={styles.stack}>
          <section className={operationStyles.panel}>
            <div className={operationStyles.panelHeader}><div><h2>{isArabic ? "طلباتي" : "My requests"}</h2><p>{myRequests.length} {isArabic ? "طلب في السنة" : "requests this year"}</p></div></div>
            {myRequests.length ? <div className={styles.stack}>{myRequests.map((leave) => {
              const minutes = minutesFor(leave, user.weeklyCapacityMinutes);
              return <article className={styles.requestCard} key={leave.id}>
                <div className={styles.requestHeader}><strong>{typeLabel(leave.type, isArabic)} · {formatDays(minutes, summary.dailyCapacityMinutes, lang)}</strong><span className={styles.status} data-status={leave.status}>{statusLabel(leave.status, isArabic)}</span></div>
                <div className={styles.requestMeta}><span>{formatDate(leave.startDate, lang)} — {formatDate(leave.endDate, lang)}</span><span>{leave.minutesPerWorkday ? `${formatHours(leave.minutesPerWorkday)} / ${isArabic ? "يوم" : "day"}` : (isArabic ? "يوم كامل" : "Full day")}</span></div>
                {leave.notes ? <p>{leave.notes}</p> : null}
                {leave.rejectionReason ? <p className={styles.muted}><strong>{isArabic ? "سبب الرفض:" : "Rejection reason:"}</strong> {leave.rejectionReason}</p> : null}
                {leave.reviewedBy ? <p className={styles.muted}>{isArabic ? "تمت المراجعة بواسطة" : "Reviewed by"}: {leave.reviewedBy.name}</p> : null}
                {canRequest && leave.status === "SUBMITTED" ? <form action={cancelLeaveRequest}><input name="locale" type="hidden" value={lang} /><input name="leaveId" type="hidden" value={leave.id} /><button className={styles.rejectButton} type="submit">{isArabic ? "إلغاء الطلب" : "Cancel request"}</button></form> : null}
              </article>;
            })}</div> : <p className={styles.muted}>{isArabic ? "لم ترسل أي طلب إجازة لهذه السنة." : "You have not submitted leave for this year."}</p>}
          </section>

          {canReview ? <section className={operationStyles.panel}>
            <div className={operationStyles.panelHeader}><div><h2>{isArabic ? "طلبات بانتظار موافقتك" : "Requests waiting for your approval"}</h2><p>{reviewQueue.length} {isArabic ? "طلب يحتاج قرارًا" : "requests need a decision"}</p></div></div>
            {reviewQueue.length ? <div className={styles.stack}>{reviewQueue.map((leave) => {
              const dailyCapacity = Math.round(leave.user.weeklyCapacityMinutes / Math.max(organization.workdays.length, 1));
              const minutes = minutesFor(leave, leave.user.weeklyCapacityMinutes);
              return <article className={styles.requestCard} key={leave.id}>
                <div className={styles.requestHeader}><div><strong>{leave.user.name}</strong><p className={styles.muted}>{leave.user.jobTitle ?? "—"}{leave.user.department ? ` · ${leave.user.department.name}` : ""}</p></div><span className={styles.status} data-status={leave.status}>{typeLabel(leave.type, isArabic)}</span></div>
                <div className={styles.requestMeta}><span>{formatDate(leave.startDate, lang)} — {formatDate(leave.endDate, lang)}</span><strong>{formatDays(minutes, dailyCapacity, lang)} · {formatHours(minutes)}</strong></div>
                {leave.notes ? <p>{leave.notes}</p> : null}
                <div className={styles.reviewActions}><form action={approveLeaveRequest}><input name="locale" type="hidden" value={lang} /><input name="leaveId" type="hidden" value={leave.id} /><button className={styles.approveButton} type="submit">{isArabic ? "موافقة" : "Approve"}</button></form><form action={rejectLeaveRequest} className={styles.rejectForm}><input name="locale" type="hidden" value={lang} /><input name="leaveId" type="hidden" value={leave.id} /><input maxLength={500} name="reason" placeholder={isArabic ? "سبب الرفض" : "Rejection reason"} required /><button className={styles.rejectButton} type="submit">{isArabic ? "رفض" : "Reject"}</button></form></div>
              </article>;
            })}</div> : <p className={styles.muted}>{isArabic ? "لا توجد طلبات معلقة ضمن فريقك." : "There are no pending requests in your team."}</p>}
          </section> : null}

          {canReview && teamRequests.some(({ status }) => status !== "SUBMITTED") ? <section className={operationStyles.panel}>
            <div className={operationStyles.panelHeader}><div><h2>{isArabic ? "سجل قرارات الفريق" : "Team decision history"}</h2><p>{isArabic ? "أحدث الطلبات المعتمدة والمرفوضة والملغاة." : "Recent approved, rejected and cancelled requests."}</p></div></div>
            <div className={operationStyles.tableWrap}><table className={operationStyles.table}><thead><tr><th>{isArabic ? "الموظف" : "Employee"}</th><th>{isArabic ? "الفترة" : "Period"}</th><th>{isArabic ? "النوع" : "Type"}</th><th>{isArabic ? "الحالة" : "Status"}</th><th>{isArabic ? "المراجع" : "Reviewer"}</th></tr></thead><tbody>{teamRequests.filter(({ status }) => status !== "SUBMITTED").map((leave) => <tr key={leave.id}><td><strong>{leave.user.name}</strong></td><td>{formatDate(leave.startDate, lang)} — {formatDate(leave.endDate, lang)}</td><td>{typeLabel(leave.type, isArabic)}</td><td><span className={styles.status} data-status={leave.status}>{statusLabel(leave.status, isArabic)}</span></td><td>{leave.reviewedBy?.name ?? "—"}</td></tr>)}</tbody></table></div>
          </section> : null}
        </div>
      </div>
    </AppShell>
  );
}
