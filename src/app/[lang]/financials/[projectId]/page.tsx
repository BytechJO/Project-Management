import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { requirePagePermission } from "@/lib/dal";
import { getProjectProfitabilityReport } from "@/lib/financials";
import { parseProjectReportRange } from "@/lib/report-range";

import styles from "../financials.module.css";

function money(value: number, lang: string, currency: string) {
  return new Intl.NumberFormat(lang === "ar" ? "ar-JO" : "en-JO", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function hours(minutes: number) {
  return `${(minutes / 60).toFixed(1)} h`;
}

function formatDate(date: Date | null, lang: string) {
  if (!date) return "—";
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-JO" : "en-GB", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

function alertText(
  alert: { code: string; value: number },
  isArabic: boolean,
  lang: string,
  currency: string,
) {
  if (alert.code === "budget") return {
    title: isArabic ? "تجاوز متوقع للميزانية" : "Forecast budget overrun",
    detail: isArabic ? `التوقع يتجاوز الميزانية بمقدار ${money(alert.value, lang, currency)}.` : `Forecast exceeds the planned budget by ${money(alert.value, lang, currency)}.`,
  };
  if (alert.code === "margin") return {
    title: isArabic ? "هامش الربح يحتاج مراجعة" : "Profit margin needs review",
    detail: isArabic ? `الهامش المتوقع حاليًا ${alert.value.toFixed(1)}%.` : `Current forecast margin is ${alert.value.toFixed(1)}%.`,
  };
  if (alert.code === "rates") return {
    title: isArabic ? "ساعات بلا سعر تكلفة" : "Missing employee cost rates",
    detail: isArabic ? `${hours(alert.value)} غير مسعّرة وقد تقلل التكلفة الظاهرة.` : `${hours(alert.value)} is unpriced and may understate the forecast.`,
  };
  if (alert.code === "tasks") return {
    title: isArabic ? "تاسكات متأخرة" : "Overdue tasks",
    detail: isArabic ? `${alert.value} تاسك تجاوزت تاريخ التسليم.` : `${alert.value} tasks are past their due date.`,
  };
  if (alert.code === "receivables") return {
    title: isArabic ? "تحصيلات متأخرة" : "Overdue receivables",
    detail: isArabic ? `${money(alert.value, lang, currency)} متأخرة التحصيل.` : `${money(alert.value, lang, currency)} is overdue for collection.`,
  };
  return {
    title: isArabic ? "الميزانية غير محددة" : "Planned budget is missing",
    detail: isArabic ? "أضف ميزانية مخططة حتى يستطيع النظام قياس التجاوز." : "Add a planned budget so the system can measure variance.",
  };
}

export default async function ProjectFinancialDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; projectId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { lang, projectId } = await params;
  const query = await searchParams;
  if (!isLocale(lang)) notFound();

  const user = await requirePagePermission(lang, "financials.read");
  const dictionary = getDictionary(lang);
  const isArabic = lang === "ar";
  const parsedRange = parseProjectReportRange(query.from, query.to);
  const { from, to, invalidDate } = parsedRange;
  const invalidRange = parsedRange.invalid;
  const report = await getProjectProfitabilityReport(
    user.organizationId!,
    projectId,
    invalidRange ? {} : { from, to },
  );
  if (!report) notFound();

  const { summary: row, period, invoicing } = report;
  const currency = row.project.currency;
  const totalForecastHours = row.approvedMinutes + row.pendingMinutes + row.remainingMinutes;
  const budgetProgress = row.plannedBudget > 0 ? Math.min(Math.max(row.budgetUtilization, 0), 100) : 0;
  const rangeActive = Boolean(from || to) && !invalidRange;
  const periodTitle = rangeActive
    ? `${from ? formatDate(from, lang) : (isArabic ? "البداية" : "Start")} — ${to ? formatDate(to, lang) : (isArabic ? "اليوم" : "Today")}`
    : (isArabic ? "كامل مدة المشروع حتى اليوم" : "Full project to date");
  const alternateSearch = new URLSearchParams();
  if (query.from) alternateSearch.set("from", query.from);
  if (query.to) alternateSearch.set("to", query.to);
  const alternateSuffix = alternateSearch.size ? `?${alternateSearch.toString()}` : "";
  const exportSearch = new URLSearchParams({ lang, download: "1" });
  if (!invalidRange && query.from) exportSearch.set("from", query.from);
  if (!invalidRange && query.to) exportSearch.set("to", query.to);
  const exportQuery = exportSearch.toString();

  return (
    <AppShell
      activeSection="financials"
      alternateHref={`/${lang === "en" ? "ar" : "en"}/financials/${projectId}${alternateSuffix}`}
      dictionary={dictionary}
      locale={lang}
    >
      <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
        <Link href={`/${lang}/financials`}>{isArabic ? "المالية" : "Financials"}</Link><span>/</span><span>{row.project.name}</span>
      </nav>

      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>{row.project.code} · {row.project.status.replaceAll("_", " ")}</span>
          <h1>{isArabic ? `تقرير ربحية ${row.project.name}` : `${row.project.name} profitability`}</h1>
          <p>{row.project.client.name} · {isArabic ? "مدير المشروع" : "Project manager"}: {row.project.primaryManager.name}</p>
        </div>
        <div className={styles.headerActions}>
          <Link className={styles.secondaryButton} href={`/api/documents/projects/${projectId}/profitability/pdf?${exportQuery}`}>{isArabic ? "تصدير PDF" : "Export PDF"}</Link>
          <Link className={styles.secondaryButton} href={`/api/documents/projects/${projectId}/profitability/excel?${exportQuery}`}>{isArabic ? "تصدير Excel" : "Export Excel"}</Link>
          <Link className={styles.secondaryButton} href={`/${lang}/projects/${projectId}`}>{isArabic ? "فتح المشروع" : "Open project"}</Link>
          <Link className={styles.secondaryButton} href={`/${lang}/invoices`}>{isArabic ? "الفواتير" : "Invoices"}</Link>
        </div>
      </header>

      <section className={`${styles.panel} ${styles.filterPanel}`}>
        <div><h2>{isArabic ? "فترة التقرير" : "Report period"}</h2><p>{periodTitle}</p></div>
        <form className={styles.filterForm}>
          <label><span>{isArabic ? "من" : "From"}</span><input defaultValue={query.from ?? ""} name="from" type="date" /></label>
          <label><span>{isArabic ? "إلى" : "To"}</span><input defaultValue={query.to ?? ""} name="to" type="date" /></label>
          <button className={styles.applyButton} type="submit">{isArabic ? "تطبيق" : "Apply"}</button>
          {rangeActive || invalidRange ? <Link className={styles.detailsLink} href={`/${lang}/financials/${projectId}`}>{isArabic ? "إلغاء الفلتر" : "Clear"}</Link> : null}
        </form>
      </section>

      {invalidRange ? <div className={styles.warning} role="alert"><strong>{isArabic ? "فترة غير صحيحة" : "Invalid period"}</strong><span>{invalidDate
        ? (isArabic ? "استخدم تاريخًا صحيحًا بصيغة سنة-شهر-يوم." : "Use a valid date in year-month-day format.")
        : (isArabic ? "تاريخ البداية يجب أن يكون قبل تاريخ النهاية." : "The start date must be on or before the end date.")}</span></div> : null}

      {report.alerts.length ? <section className={styles.alertGrid} aria-label="Project financial alerts">
        {report.alerts.map((alert) => {
          const copy = alertText(alert, isArabic, lang, currency);
          return <article data-severity={alert.severity} key={alert.code}><strong>{copy.title}</strong><span>{copy.detail}</span></article>;
        })}
      </section> : <div className={styles.successNotice}><strong>{isArabic ? "المشروع ماليًا ضمن المسار" : "Project finances are on track"}</strong><span>{isArabic ? "لا توجد تنبيهات مالية أو تشغيلية حالية." : "No current financial or delivery alerts."}</span></div>}

      <section className={styles.metrics} aria-label="Project financial metrics">
        <article><span>{isArabic ? "قيمة العقد" : "Contract value"}</span><strong>{money(row.contractValue, lang, currency)}</strong><small>{isArabic ? "قيمة بيع المشروع" : "Project selling price"}</small></article>
        <article><span>{isArabic ? "الميزانية المخططة" : "Planned budget"}</span><strong>{money(row.plannedBudget, lang, currency)}</strong><small>{row.budgetUtilization.toFixed(1)}% {isArabic ? "مستخدم" : "used"}</small></article>
        <article><span>{isArabic ? "التكلفة الفعلية" : "Actual cost"}</span><strong>{money(row.actualCost, lang, currency)}</strong><small>{isArabic ? "معتمد حتى الآن" : "Approved to date"}</small></article>
        <article data-tone={row.forecastProfit >= 0 ? "positive" : "negative"}><span>{isArabic ? "الربح المتوقع" : "Forecast profit"}</span><strong>{money(row.forecastProfit, lang, currency)}</strong><small>{row.forecastMargin.toFixed(1)}% {isArabic ? "هامش" : "margin"}</small></article>
      </section>

      <section className={`${styles.panel} ${styles.periodPanel}`}>
        <div className={styles.panelHeader}><div><h2>{isArabic ? "نشاط الفترة المحددة" : "Selected-period activity"}</h2><p>{isArabic ? "الفلاتر تؤثر على الساعات والمصاريف وتكلفة الاشتراكات في هذا القسم والجداول التفصيلية؛ توقع الإتمام أعلاه يبقى لكامل المشروع." : "Filters affect labor, expenses, and subscription accrual in this section and the detailed tables; the forecast above remains project-wide."}</p></div></div>
        <dl className={styles.periodMetrics}>
          <div><dt>{isArabic ? "تكلفة معتمدة" : "Approved cost"}</dt><dd>{money(period.actualCost, lang, currency)}<small>{hours(period.approvedMinutes)} {isArabic ? "معتمدة" : "approved"}</small></dd></div>
          <div><dt>{isArabic ? "تكلفة معلقة" : "Pending cost"}</dt><dd>{money(period.committedCost, lang, currency)}<small>{hours(period.pendingMinutes)} {isArabic ? "بانتظار الاعتماد" : "pending"}</small></dd></div>
          <div><dt>{isArabic ? "تكلفة الموظفين" : "Labor cost"}</dt><dd>{money(period.approvedLaborCost + period.pendingLaborCost, lang, currency)}</dd></div>
          <div><dt>{isArabic ? "المصاريف" : "Expenses"}</dt><dd>{money(period.approvedExpenseCost + period.pendingExpenseCost, lang, currency)}</dd></div>
          <div><dt>{isArabic ? "الاشتراكات" : "Subscriptions"}</dt><dd>{money(period.subscriptionCost, lang, currency)}</dd></div>
        </dl>
      </section>

      <div className={styles.detailGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><h2>{isArabic ? "تفصيل التكلفة الكلية" : "Whole-project cost breakdown"}</h2><p>{isArabic ? "الفعلية مقابل توقع الإتمام" : "Actual versus estimate at completion"}</p></div></div>
          <div className={styles.tableWrap}><table className={`${styles.table} ${styles.breakdownTable}`}>
            <thead><tr><th>{isArabic ? "البند" : "Cost category"}</th><th>{isArabic ? "فعلي معتمد" : "Actual approved"}</th><th>{isArabic ? "إضافي متوقع" : "Additional forecast"}</th><th>{isArabic ? "الإجمالي المتوقع" : "Forecast total"}</th></tr></thead>
            <tbody>
              <tr><td><strong>{isArabic ? "تكلفة الموظفين" : "Labor"}</strong><span>{hours(row.approvedMinutes)} {isArabic ? "معتمدة" : "approved"} · {hours(row.pendingMinutes)} {isArabic ? "معلقة" : "pending"} · {hours(row.remainingMinutes)} {isArabic ? "متبقية" : "remaining"}</span></td><td>{money(row.approvedLaborCost, lang, currency)}</td><td>{money(row.pendingLaborCost + row.remainingLaborCost, lang, currency)}</td><td>{money(row.forecastLaborCost, lang, currency)}</td></tr>
              <tr><td><strong>{isArabic ? "المصاريف المباشرة" : "Direct expenses"}</strong><span>{isArabic ? "شاملة الضريبة" : "Including tax"}</span></td><td>{money(row.approvedExpenses, lang, currency)}</td><td>{money(row.pendingExpenses, lang, currency)}</td><td>{money(row.approvedExpenses + row.pendingExpenses, lang, currency)}</td></tr>
              <tr><td><strong>{isArabic ? "الاشتراكات الموزعة" : "Allocated subscriptions"}</strong><span>{isArabic ? "حسب مدة المشروع ونسبة التوزيع" : "By project duration and allocation percentage"}</span></td><td>{money(row.actualSubscriptions, lang, currency)}</td><td>{money(Math.max(row.forecastSubscriptions - row.actualSubscriptions, 0), lang, currency)}</td><td>{money(row.forecastSubscriptions, lang, currency)}</td></tr>
            </tbody>
            <tfoot><tr><th>{isArabic ? "الإجمالي" : "Total"}</th><th>{money(row.actualCost, lang, currency)}</th><th>{money(Math.max(row.forecastCost - row.actualCost, 0), lang, currency)}</th><th>{money(row.forecastCost, lang, currency)}</th></tr></tfoot>
          </table></div>
        </section>

        <aside className={styles.sideStack}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>{isArabic ? "حالة الميزانية" : "Budget health"}</h2><p>{isArabic ? "الاستهلاك الفعلي" : "Actual utilization"}</p></div><strong>{row.budgetUtilization.toFixed(1)}%</strong></div>
            <div className={styles.progress}><span data-risk={row.budgetUtilization > 100} style={{ width: `${budgetProgress}%` }} /></div>
            <dl className={styles.costList}>
              <div><dt>{isArabic ? "المتبقي حاليًا" : "Current remaining"}</dt><dd className={row.budgetRemaining >= 0 ? styles.positive : styles.negative}>{money(row.budgetRemaining, lang, currency)}</dd></div>
              <div><dt>{isArabic ? "فرق الميزانية المتوقع" : "Forecast variance"}</dt><dd className={row.budgetVariance >= 0 ? styles.positive : styles.negative}>{money(row.budgetVariance, lang, currency)}</dd></div>
              <div><dt>{isArabic ? "التكلفة الملتزمة" : "Committed cost"}</dt><dd>{money(row.committedCost, lang, currency)}</dd></div>
            </dl>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>{isArabic ? "توقع الساعات" : "Hours forecast"}</h2><p>{isArabic ? "المسجلة والمتبقية" : "Recorded and remaining"}</p></div><strong>{hours(totalForecastHours)}</strong></div>
            <dl className={styles.costList}>
              <div><dt>{isArabic ? "ساعات معتمدة" : "Approved hours"}</dt><dd>{hours(row.approvedMinutes)}</dd></div>
              <div><dt>{isArabic ? "ساعات بانتظار الاعتماد" : "Pending hours"}</dt><dd>{hours(row.pendingMinutes)}</dd></div>
              <div><dt>{isArabic ? "ساعات عمل متبقية" : "Remaining task hours"}</dt><dd>{hours(row.remainingMinutes)}</dd></div>
            </dl>
          </section>
        </aside>
      </div>

      <section className={`${styles.panel} ${styles.reportSection}`}>
        <div className={styles.panelHeader}><div><h2>{isArabic ? "تكلفة الموظفين" : "Employee cost breakdown"}</h2><p>{isArabic ? "حسب الساعات ضمن فترة التقرير وسعر الموظف بتاريخ العمل" : "Using hours in the report period and the employee rate effective on each work date"}</p></div><strong>{money(period.approvedLaborCost + period.pendingLaborCost, lang, currency)}</strong></div>
        {report.employees.length ? <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>{isArabic ? "الموظف" : "Employee"}</th><th>{isArabic ? "معتمدة" : "Approved"}</th><th>{isArabic ? "معلقة" : "Pending"}</th><th>{isArabic ? "متوسط الساعة" : "Avg. hourly cost"}</th><th>{isArabic ? "التكلفة" : "Cost"}</th></tr></thead>
          <tbody>{report.employees.map((employee) => <tr key={employee.id}>
            <td><strong>{employee.name}</strong><span>{employee.jobTitle ?? "—"}{employee.missingRateMinutes ? ` · ${hours(employee.missingRateMinutes)} ${isArabic ? "بلا سعر" : "unpriced"}` : ""}</span></td>
            <td>{hours(employee.approvedMinutes)}<span>{money(employee.approvedCost, lang, currency)}</span></td>
            <td>{hours(employee.pendingMinutes)}<span>{money(employee.pendingCost, lang, currency)}</span></td>
            <td>{money(employee.averageHourlyCost, lang, currency)}</td>
            <td><strong>{money(employee.totalCost, lang, currency)}</strong></td>
          </tr>)}</tbody>
        </table></div> : <p className={styles.empty}>{isArabic ? "لا توجد ساعات مسجلة ضمن الفترة المحددة." : "No time was recorded in the selected period."}</p>}
      </section>

      <section className={`${styles.panel} ${styles.reportSection}`}>
        <div className={styles.panelHeader}><div><h2>{isArabic ? "أداء التاسكات" : "Task performance"}</h2><p>{isArabic ? "المتوقع مقابل المسجل وتكلفة العمل" : "Estimate versus tracked time and labor cost"}</p></div></div>
        {report.tasks.length ? <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>{isArabic ? "التاسك" : "Task"}</th><th>{isArabic ? "المتوقع" : "Estimate"}</th><th>{isArabic ? "المسجل" : "Tracked"}</th><th>{isArabic ? "الفرق" : "Variance"}</th><th>{isArabic ? "المتبقي" : "Remaining"}</th><th>{isArabic ? "تكلفة العمل" : "Labor cost"}</th><th>{isArabic ? "الحالة" : "Status"}</th></tr></thead>
          <tbody>{report.tasks.map((task) => <tr key={task.id}>
            <td><strong>{task.title}</strong><span>{task.dueDate ? `${isArabic ? "التسليم" : "Due"}: ${formatDate(task.dueDate, lang)}` : (isArabic ? "بدون موعد" : "No due date")}</span></td>
            <td>{hours(task.estimatedMinutes)}</td>
            <td>{hours(task.trackedMinutes)}</td>
            <td className={task.hoursVariance < 0 ? styles.negative : styles.positive}>{task.hoursVariance < 0 ? "+" : ""}{hours(Math.abs(task.hoursVariance))}</td>
            <td>{hours(task.remainingMinutes)}</td>
            <td>{money(task.totalLaborCost, lang, currency)}</td>
            <td><span className={styles.statusPill} data-status={task.status}>{task.status.replaceAll("_", " ")}</span></td>
          </tr>)}</tbody>
        </table></div> : <p className={styles.empty}>{isArabic ? "لا توجد تاسكات في المشروع." : "This project has no tasks."}</p>}
      </section>

      <div className={styles.summaryGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><h2>{isArabic ? "المصاريف المباشرة" : "Direct expenses"}</h2><p>{isArabic ? "ضمن فترة التقرير، شاملة الضريبة" : "Within the report period, including tax"}</p></div><strong>{money(period.approvedExpenseCost + period.pendingExpenseCost, lang, currency)}</strong></div>
          {report.expenses.length ? <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>{isArabic ? "المصروف" : "Expense"}</th><th>{isArabic ? "التاريخ" : "Date"}</th><th>{isArabic ? "الحالة" : "Status"}</th><th>{isArabic ? "الإجمالي" : "Total"}</th></tr></thead>
            <tbody>{report.expenses.map((expense) => <tr key={expense.id}><td><strong>{expense.vendor ?? expense.category}</strong><span>{expense.description} · {expense.submittedBy.name}</span></td><td>{formatDate(expense.expenseDate, lang)}</td><td><span className={styles.statusPill} data-status={expense.status}>{expense.status}</span></td><td>{money(expense.total, lang, currency)}</td></tr>)}</tbody>
          </table></div> : <p className={styles.empty}>{isArabic ? "لا توجد مصاريف ضمن الفترة." : "No expenses fall within this period."}</p>}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><h2>{isArabic ? "الاشتراكات الموزعة" : "Allocated subscriptions"}</h2><p>{isArabic ? "نسبة المشروع وتكلفة الفترة والتوقع" : "Project allocation, period cost, and forecast"}</p></div><strong>{money(period.subscriptionCost, lang, currency)}</strong></div>
          {report.subscriptions.length ? <dl className={styles.subscriptionList}>{report.subscriptions.map((allocation) => <div key={allocation.id}><dt><strong>{allocation.subscription.name}</strong><span>{allocation.subscription.vendor} · {allocation.allocationPercent.toFixed(1)}%</span></dt><dd><strong>{money(allocation.periodCost, lang, currency)}</strong><span>{isArabic ? "التوقع" : "Forecast"}: {money(allocation.forecastCost, lang, currency)}</span></dd></div>)}</dl> : <p className={styles.empty}>{isArabic ? "لا توجد اشتراكات موزعة على المشروع." : "No subscriptions are allocated to this project."}</p>}
        </section>
      </div>

      <section className={`${styles.panel} ${styles.reportSection}`}>
        <div className={styles.panelHeader}><div><h2>{isArabic ? "الفوترة والتحصيل" : "Billing and collections"}</h2><p>{isArabic ? "مقارنة قيمة العقد بالمفوتر والمحصل" : "Contract value compared with invoiced and collected revenue"}</p></div><Link className={styles.detailsLink} href={`/${lang}/invoices`}>{isArabic ? "إدارة الفواتير" : "Manage invoices"}</Link></div>
        <dl className={styles.periodMetrics}>
          <div><dt>{isArabic ? "قيمة العقد" : "Contract value"}</dt><dd>{money(row.contractValue, lang, currency)}</dd></div>
          <div><dt>{isArabic ? "المفوتر" : "Invoiced"}</dt><dd>{money(invoicing.invoiced, lang, currency)}</dd></div>
          <div><dt>{isArabic ? "المحصل" : "Collected"}</dt><dd>{money(invoicing.collected, lang, currency)}</dd></div>
          <div><dt>{isArabic ? "الرصيد" : "Outstanding"}</dt><dd>{money(invoicing.outstanding, lang, currency)}</dd></div>
          <div data-risk={invoicing.overdueBalance > 0}><dt>{isArabic ? "متأخر" : "Overdue"}</dt><dd>{money(invoicing.overdueBalance, lang, currency)}<small>{invoicing.overdueCount} {isArabic ? "فاتورة" : "invoices"}</small></dd></div>
        </dl>
        {invoicing.invoiceRows.length ? <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>{isArabic ? "الفاتورة" : "Invoice"}</th><th>{isArabic ? "الإصدار" : "Issued"}</th><th>{isArabic ? "الاستحقاق" : "Due"}</th><th>{isArabic ? "الإجمالي" : "Total"}</th><th>{isArabic ? "المحصل" : "Collected"}</th><th>{isArabic ? "الرصيد" : "Outstanding"}</th><th>{isArabic ? "الحالة" : "Status"}</th></tr></thead>
          <tbody>{invoicing.invoiceRows.map((invoice) => <tr key={invoice.id}><td><Link href={`/${lang}/invoices/${invoice.id}`}><strong>{invoice.number}</strong></Link></td><td>{formatDate(invoice.issueDate, lang)}</td><td className={invoice.overdue ? styles.negative : undefined}>{formatDate(invoice.dueDate, lang)}</td><td>{money(invoice.total, lang, currency)}</td><td>{money(invoice.collected, lang, currency)}</td><td>{money(invoice.outstanding, lang, currency)}</td><td><span className={styles.statusPill} data-status={invoice.overdue ? "OVERDUE" : invoice.status}>{invoice.overdue ? "OVERDUE" : invoice.status.replaceAll("_", " ")}</span></td></tr>)}</tbody>
        </table></div> : <p className={styles.empty}>{isArabic ? "لم يتم إنشاء فواتير لهذا المشروع." : "No invoices have been created for this project."}</p>}
      </section>

      <section className={`${styles.panel} ${styles.formulaPanel}`}>
        <h2>{isArabic ? "كيف تم الحساب؟" : "How this is calculated"}</h2>
        <div className={styles.formulaGrid}>
          <div><strong>{isArabic ? "تكلفة الساعة" : "Hourly employee cost"}</strong><code>(salary + allowances + benefits) ÷ productive monthly hours</code></div>
          <div><strong>{isArabic ? "التكلفة الفعلية" : "Actual cost"}</strong><code>approved labor + approved expenses + accrued subscriptions</code></div>
          <div><strong>{isArabic ? "توقع الإتمام" : "Forecast at completion"}</strong><code>all tracked work + remaining task work + expenses + project subscriptions</code></div>
          <div><strong>{isArabic ? "هامش الربح" : "Profit margin"}</strong><code>(contract value − forecast cost) ÷ contract value</code></div>
        </div>
      </section>
    </AppShell>
  );
}
