import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  createEmployeeLeave,
  createOrganizationHoliday,
  deleteEmployeeLeave,
  deleteOrganizationHoliday,
} from "@/actions/work-calendar";
import { AppShell } from "@/components/app-shell";
import { FormFeedback } from "@/components/form-feedback";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { permissionKeysFor, requireUser } from "@/lib/dal";
import { getMonthlyHoursReport, hoursReportScopeFor } from "@/lib/hours-report";

import operationStyles from "../../operations.module.css";
import styles from "./hours-report.module.css";

function formatHours(minutes: number | null) {
  if (minutes == null) return "—";
  return `${(minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 2)} h`;
}

function formatMoney(value: number | null, currency: string, lang: string) {
  if (value == null) return "—";
  return new Intl.NumberFormat(lang === "ar" ? "ar-JO" : "en-JO", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(date: Date, lang: string) {
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-JO" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).format(date);
}

function monthLabel(month: string, lang: string) {
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-JO" : "en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00.000Z`));
}

function reportSearch(query: { month?: string; employeeId?: string; departmentId?: string }, lang?: string) {
  const search = new URLSearchParams();
  if (query.month) search.set("month", query.month);
  if (query.employeeId) search.set("employeeId", query.employeeId);
  if (query.departmentId) search.set("departmentId", query.departmentId);
  if (lang) search.set("lang", lang);
  return search.toString();
}

export default async function EmployeeHoursReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{
    month?: string;
    employeeId?: string;
    departmentId?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const { lang } = await params;
  const query = await searchParams;
  if (!isLocale(lang)) notFound();

  const user = await requireUser(lang);
  const permissions = permissionKeysFor(user);
  const scope = hoursReportScopeFor(permissions);
  if (!scope) redirect(`/${lang}?error=${encodeURIComponent(lang === "ar" ? "ليس لديك صلاحية لفتح هذا التقرير." : "You do not have permission to open this report.")}`);

  const canViewCosts = permissions.has("financials.read");
  const canManageCalendar = permissions.has("employees.write");
  const report = await getMonthlyHoursReport({
    organizationId: user.organizationId!,
    userId: user.id,
    scope,
    canViewCosts,
    canManageCalendar,
  }, query);
  if (!report) notFound();

  const dictionary = getDictionary(lang);
  const isArabic = lang === "ar";
  const selectedEmployee = report.filters.employeeId
    ? report.employees.find(({ id }) => id === report.filters.employeeId)
    : report.employees.length === 1 ? report.employees[0] : null;
  const currentQuery = {
    month: report.range.month,
    employeeId: report.filters.employeeId ?? undefined,
    departmentId: report.filters.departmentId ?? undefined,
  };
  const alternateQuery = reportSearch(currentQuery);
  const exportQuery = reportSearch(currentQuery, lang);
  const employeeNameById = new Map(report.employeeOptions.map((employee) => [employee.id, employee.name]));

  return (
    <AppShell
      activeSection="reports"
      alternateHref={`/${lang === "en" ? "ar" : "en"}/reports/hours?${alternateQuery}`}
      dictionary={dictionary}
      locale={lang}
    >
      <header className={operationStyles.pageHeader}>
        <div>
          <span className={operationStyles.eyebrow}>{isArabic ? "تقارير الموارد والفريق" : "TEAM & RESOURCE REPORTING"}</span>
          <h1>{isArabic ? "تقرير ساعات الموظفين" : "Employee hours report"}</h1>
          <p>{monthLabel(report.range.month, lang)} · {isArabic ? "الدوام الرسمي من الأحد إلى الخميس" : "Official schedule Sunday through Thursday"}</p>
        </div>
        <div className={operationStyles.headerActions}>
          <Link className={operationStyles.secondaryButton} href={`/api/documents/reports/hours/pdf?${exportQuery}`}>{isArabic ? "تصدير PDF" : "Export PDF"}</Link>
          <Link className={operationStyles.secondaryButton} href={`/api/documents/reports/hours/excel?${exportQuery}`}>{isArabic ? "تصدير Excel" : "Export Excel"}</Link>
        </div>
      </header>

      <FormFeedback error={query.error} success={query.success} />

      <section className={`${operationStyles.panel} ${styles.filterPanel}`}>
        <form className={styles.filterForm}>
          <label><span>{isArabic ? "الشهر" : "Month"}</span><input defaultValue={report.range.month} key={report.range.month} name="month" type="month" required /></label>
          {scope !== "own" ? <label><span>{isArabic ? "القسم" : "Department"}</span><select defaultValue={report.filters.departmentId ?? ""} key={report.filters.departmentId ?? "all-departments"} name="departmentId"><option value="">{isArabic ? "كل الأقسام" : "All departments"}</option>{report.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label> : <span />}
          {scope !== "own" ? <label><span>{isArabic ? "الموظف" : "Employee"}</span><select defaultValue={report.filters.employeeId ?? "all"} key={report.filters.employeeId ?? "all-employees"} name="employeeId"><option value="all">{isArabic ? "كل الموظفين المتاحين" : "All available employees"}</option>{report.employeeOptions.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}{employee.department ? ` · ${employee.department.name}` : ""}</option>)}</select></label> : <span />}
          <button className={styles.filterButton} type="submit">{isArabic ? "تطبيق" : "Apply"}</button>
        </form>
      </section>

      {scope === "managed" && !report.access.hasFullEmployeeDayAccess ? <p className={styles.privacyNote}>{isArabic ? "يعرض هذا النطاق ساعات مشاريعك فقط. الساعات المطلوبة والتكلفة مخفية لأن الموظف قد يعمل على مشاريع أخرى خارج صلاحيتك." : "This scope shows hours from your managed projects only. Expected time and cost are hidden because an employee may also work on projects outside your access."}</p> : null}

      <section className={`${operationStyles.metrics} ${styles.metricGrid}`} aria-label="Monthly hours summary">
        <article><span>{isArabic ? "الساعات المطلوبة" : "Expected hours"}</span><strong className={report.totals.expectedMinutes == null ? styles.metricUnavailable : undefined}>{formatHours(report.totals.expectedMinutes)}</strong><small>{isArabic ? "بعد العطل والإجازات" : "After holidays and leave"}</small></article>
        <article data-tone="positive"><span>{isArabic ? "المعتمدة" : "Approved"}</span><strong>{formatHours(report.totals.approvedMinutes)}</strong><small>{isArabic ? "جاهزة للاحتساب" : "Ready for costing"}</small></article>
        <article><span>{isArabic ? "قيد الاعتماد" : "Pending"}</span><strong>{formatHours(report.totals.pendingMinutes)}</strong><small>{isArabic ? "مسودة أو مرسلة" : "Draft or submitted"}</small></article>
        <article data-tone={report.totals.missingMinutes && report.totals.missingMinutes > 0 ? "negative" : "positive"}><span>{isArabic ? "الناقص حتى اليوم" : "Missing to date"}</span><strong className={report.totals.missingMinutes == null ? styles.metricUnavailable : undefined}>{formatHours(report.totals.missingMinutes)}</strong><small>{isArabic ? `من أصل ${formatHours(report.totals.expectedToDateMinutes)} مستحقة` : `Of ${formatHours(report.totals.expectedToDateMinutes)} due to date`}</small></article>
        {canViewCosts ? <article><span>{isArabic ? "تكلفة الوقت" : "Time cost"}</span><strong>{formatMoney(report.totals.cost, report.organization.baseCurrency, lang)}</strong><small>{report.totals.missingRateMinutes ? `${formatHours(report.totals.missingRateMinutes)} ${isArabic ? "بدون سعر" : "without a rate"}` : (isArabic ? "حسب السعر بتاريخ العمل" : "Using effective dated rates")}</small></article> : <article><span>{isArabic ? "الساعات الإضافية" : "Overtime"}</span><strong className={report.totals.overtimeMinutes == null ? styles.metricUnavailable : undefined}>{formatHours(report.totals.overtimeMinutes)}</strong><small>{isArabic ? "فوق المطلوب" : "Above expected time"}</small></article>}
      </section>

      <div className={styles.sectionStack}>
        <section className={operationStyles.panel}>
          <div className={operationStyles.panelHeader}><div><h2>{isArabic ? "ملخص الموظفين" : "Employee summary"}</h2><p>{report.employees.length} {isArabic ? "موظف ضمن النطاق" : "employees in scope"}</p></div></div>
          {report.employees.length ? <div className={operationStyles.tableWrap}><table className={operationStyles.table}>
            <thead><tr><th>{isArabic ? "الموظف" : "Employee"}</th><th>{isArabic ? "المطلوب" : "Expected"}</th><th>{isArabic ? "المعتمد" : "Approved"}</th><th>{isArabic ? "المعلق" : "Pending"}</th><th>{isArabic ? "المرفوض" : "Rejected"}</th><th>{isArabic ? "الناقص / الإضافي" : "Missing / overtime"}</th>{canViewCosts ? <th>{isArabic ? "التكلفة" : "Cost"}</th> : null}</tr></thead>
            <tbody>{report.employees.map((employee) => <tr key={employee.id}>
              <td><Link href={`/${lang}/reports/hours?${reportSearch({ month: report.range.month, employeeId: employee.id })}`}><strong className={styles.cellMain}>{employee.name}</strong></Link><span className={styles.cellMeta}>{employee.jobTitle ?? "—"}{employee.department ? ` · ${employee.department.name}` : ""}</span></td>
              <td>{formatHours(employee.expectedMinutes)}<span className={styles.cellMeta}>{employee.leaveMinutes ? `${formatHours(employee.leaveMinutes)} ${isArabic ? "إجازة" : "leave"}` : ""}</span></td>
              <td>{formatHours(employee.approvedMinutes)}</td>
              <td>{formatHours(employee.pendingMinutes)}</td>
              <td>{formatHours(employee.rejectedMinutes)}</td>
              <td><span className={employee.missingMinutes && employee.missingMinutes > 0 ? styles.negative : styles.cellMain}>{formatHours(employee.missingMinutes)}</span><span className={`${styles.cellMeta} ${employee.overtimeMinutes && employee.overtimeMinutes > 0 ? styles.positive : ""}`}>{formatHours(employee.overtimeMinutes)} {isArabic ? "إضافي" : "overtime"}</span></td>
              {canViewCosts ? <td>{formatMoney(employee.cost, report.organization.baseCurrency, lang)}</td> : null}
            </tr>)}</tbody>
          </table></div> : <p className={operationStyles.empty}>{isArabic ? "لا يوجد موظفون ضمن الفلاتر المختارة." : "No employees match the selected filters."}</p>}
        </section>

        {selectedEmployee ? <section className={operationStyles.panel}>
          <div className={operationStyles.panelHeader}><div><h2>{isArabic ? `التفصيل اليومي — ${selectedEmployee.name}` : `Daily detail — ${selectedEmployee.name}`}</h2><p>{isArabic ? "المطلوب والمسجل حسب كل يوم" : "Expected and recorded time for each day"}</p></div><span className={styles.statusPill}>{selectedEmployee.status}</span></div>
          <div className={operationStyles.tableWrap}><table className={operationStyles.table}>
            <thead><tr><th>{isArabic ? "التاريخ" : "Date"}</th><th>{isArabic ? "نوع اليوم" : "Day type"}</th><th>{isArabic ? "المطلوب" : "Expected"}</th><th>{isArabic ? "المعتمد" : "Approved"}</th><th>{isArabic ? "المعلق" : "Pending"}</th><th>{isArabic ? "الناقص / الإضافي" : "Missing / overtime"}</th><th>{isArabic ? "المشاريع والتاسكات" : "Projects and tasks"}</th></tr></thead>
            <tbody>{selectedEmployee.days.map((day) => <tr key={day.date.toISOString()}>
              <td>{formatDate(day.date, lang)}</td>
              <td>{day.holiday ? <><strong className={styles.cellMain}>{day.holiday.name}</strong><span className={styles.cellMeta}>{isArabic ? "عطلة رسمية" : "Official holiday"}</span></> : day.leaves.length ? <><strong className={styles.cellMain}>{day.leaves.map((leave) => leave.type.replaceAll("_", " ")).join(" · ")}</strong><span className={styles.cellMeta}>{isArabic ? "إجازة موظف" : "Employee leave"}</span></> : day.isWorkday ? (isArabic ? "يوم عمل" : "Workday") : (isArabic ? "عطلة أسبوعية" : "Weekend")}</td>
              <td>{formatHours(day.expectedMinutes)}</td>
              <td>{formatHours(day.approvedMinutes)}</td>
              <td>{formatHours(day.pendingMinutes)}</td>
              <td><span className={day.missingMinutes && day.missingMinutes > 0 ? styles.negative : undefined}>{formatHours(day.missingMinutes)}</span><span className={styles.cellMeta}>{formatHours(day.overtimeMinutes)} {isArabic ? "إضافي" : "overtime"}</span></td>
              <td>{day.entries.length ? day.entries.map((entry) => <span className={styles.cellMeta} key={entry.id}>{entry.project.name} · {entry.task.title} · {formatHours(entry.durationMinutes)} · {entry.status}</span>) : "—"}</td>
            </tr>)}</tbody>
          </table></div>
        </section> : null}

        <section className={operationStyles.panel}>
          <div className={operationStyles.panelHeader}><div><h2>{isArabic ? "التوزيع على المشاريع" : "Project distribution"}</h2><p>{isArabic ? "الساعات المسجلة ضمن نطاق التقرير" : "Recorded time within the report scope"}</p></div></div>
          {report.projects.length ? <div className={operationStyles.tableWrap}><table className={operationStyles.table}>
            <thead><tr><th>{isArabic ? "المشروع" : "Project"}</th><th>{isArabic ? "معتمد" : "Approved"}</th><th>{isArabic ? "معلق" : "Pending"}</th><th>{isArabic ? "مرفوض" : "Rejected"}</th>{canViewCosts ? <th>{isArabic ? "التكلفة" : "Cost"}</th> : null}</tr></thead>
            <tbody>{report.projects.map((project) => <tr key={project.id}><td><strong className={styles.cellMain}>{project.name}</strong><span className={styles.cellMeta}>{project.code}</span></td><td>{formatHours(project.approvedMinutes)}</td><td>{formatHours(project.pendingMinutes)}</td><td>{formatHours(project.rejectedMinutes)}</td>{canViewCosts ? <td>{formatMoney(project.cost, report.organization.baseCurrency, lang)}</td> : null}</tr>)}</tbody>
          </table></div> : <p className={operationStyles.empty}>{isArabic ? "لا توجد ساعات مسجلة ضمن هذه الفترة." : "No time was recorded in this period."}</p>}
        </section>
      </div>

      {canManageCalendar ? <section className={`${operationStyles.panel} ${styles.filterPanel}`} style={{ marginTop: 18 }}>
        <div className={operationStyles.panelHeader}><div><h2>{isArabic ? "إعدادات تقويم الدوام" : "Work calendar settings"}</h2><p>{isArabic ? "أضف العطل الرسمية والإجازات المعتمدة ليتم خصمها من الساعات المطلوبة." : "Add official holidays and approved leave so they are deducted from expected hours."}</p></div></div>
        <div className={styles.calendarGrid}>
          <div>
            <form action={createOrganizationHoliday} className={styles.calendarForm}>
              <input name="locale" type="hidden" value={lang} />
              <strong>{isArabic ? "عطلة رسمية جديدة" : "New official holiday"}</strong>
              <label><span>{isArabic ? "اسم العطلة" : "Holiday name"}</span><input name="name" maxLength={160} required /></label>
              <label><span>{isArabic ? "التاريخ" : "Date"}</span><input defaultValue={`${report.range.month}-01`} name="date" type="date" required /></label>
              <label className={styles.checkbox}><input defaultChecked name="isPaid" type="checkbox" /><span>{isArabic ? "عطلة مدفوعة" : "Paid holiday"}</span></label>
              <button className={styles.filterButton} type="submit">{isArabic ? "إضافة العطلة" : "Add holiday"}</button>
            </form>
            <div className={styles.recordList}>{report.holidays.map((holiday) => <div className={styles.recordRow} key={holiday.id}><div><strong>{holiday.name}</strong><span>{formatDate(holiday.date, lang)} · {holiday.isPaid ? (isArabic ? "مدفوعة" : "Paid") : (isArabic ? "غير مدفوعة" : "Unpaid")}</span></div><form action={deleteOrganizationHoliday}><input name="locale" type="hidden" value={lang} /><input name="holidayId" type="hidden" value={holiday.id} /><button className={styles.dangerButton} type="submit">{isArabic ? "حذف" : "Remove"}</button></form></div>)}</div>
          </div>
          <div>
            <form action={createEmployeeLeave} className={styles.calendarForm}>
              <input name="locale" type="hidden" value={lang} />
              <strong>{isArabic ? "إجازة موظف معتمدة" : "Approved employee leave"}</strong>
              <label><span>{isArabic ? "الموظف" : "Employee"}</span><select name="userId" required>{report.employeeOptions.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
              <div className={styles.formGrid}><label><span>{isArabic ? "من" : "From"}</span><input defaultValue={`${report.range.month}-01`} name="startDate" type="date" required /></label><label><span>{isArabic ? "إلى" : "To"}</span><input defaultValue={`${report.range.month}-01`} name="endDate" type="date" required /></label></div>
              <div className={styles.formGrid}><label><span>{isArabic ? "النوع" : "Type"}</span><select name="type"><option value="ANNUAL">{isArabic ? "سنوية" : "Annual"}</option><option value="SICK">{isArabic ? "مرضية" : "Sick"}</option><option value="UNPAID">{isArabic ? "غير مدفوعة" : "Unpaid"}</option><option value="OTHER">{isArabic ? "أخرى" : "Other"}</option></select></label><label><span>{isArabic ? "ساعات اليوم (اتركها فارغة ليوم كامل)" : "Hours/day (blank for full day)"}</span><input max={report.organization.workdayMinutes / 60} min="0.25" name="hoursPerWorkday" step="0.25" type="number" /></label></div>
              <label><span>{isArabic ? "ملاحظات" : "Notes"}</span><textarea maxLength={500} name="notes" /></label>
              <button className={styles.filterButton} type="submit">{isArabic ? "إضافة الإجازة" : "Add leave"}</button>
            </form>
            <div className={styles.recordList}>{report.leaves.map((leave) => <div className={styles.recordRow} key={leave.id}><div><strong>{employeeNameById.get(leave.userId) ?? "—"} · {leave.type.replaceAll("_", " ")}</strong><span>{formatDate(leave.startDate, lang)} — {formatDate(leave.endDate, lang)} · {leave.minutesPerWorkday ? formatHours(leave.minutesPerWorkday) : (isArabic ? "يوم كامل" : "Full day")}</span></div><form action={deleteEmployeeLeave}><input name="locale" type="hidden" value={lang} /><input name="leaveId" type="hidden" value={leave.id} /><button className={styles.dangerButton} type="submit">{isArabic ? "حذف" : "Remove"}</button></form></div>)}</div>
          </div>
        </div>
      </section> : null}
    </AppShell>
  );
}
