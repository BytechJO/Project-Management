import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { requirePagePermission } from "@/lib/dal";
import { getOrganizationFinancials } from "@/lib/financials";
import { getOrganizationReceivables } from "@/lib/receivables";

import styles from "./financials.module.css";

function money(value: number, lang: string, currency = "JOD") {
  return new Intl.NumberFormat(lang === "ar" ? "ar-JO" : "en-JO", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function hours(minutes: number) {
  return (minutes / 60).toFixed(1);
}

export default async function FinancialsPage({ params }: PageProps<"/[lang]/financials">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  const user = await requirePagePermission(lang, "financials.read");
  const dictionary = getDictionary(lang);
  const isArabic = lang === "ar";
  const [financials, receivables] = await Promise.all([
    getOrganizationFinancials(user.organizationId!),
    getOrganizationReceivables(user.organizationId!),
  ]);
  const { rows, totals } = financials;
  const forecastProfitTone = totals.forecastProfit >= 0 ? "positive" : "negative";
  const costBase = Math.max(totals.actualCost, 1);
  const laborPercent = (totals.laborCost / costBase) * 100;
  const expensePercent = (totals.expenseCost / costBase) * 100;
  const subscriptionPercent = (totals.subscriptionCost / costBase) * 100;

  return (
    <AppShell activeSection="financials" dictionary={dictionary} locale={lang}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>{isArabic ? "المراقبة المالية" : "FINANCIAL CONTROL"}</span>
          <h1>{isArabic ? "ربحية المشاريع" : "Project profitability"}</h1>
          <p>{isArabic ? "تكلفة فعلية من الساعات المعتمدة وتوقع مالي حتى إتمام كل مشروع." : "Actual cost from approved hours, with an estimate at completion for every project."}</p>
        </div>
        <div className={styles.headerActions}>
          <Link className={styles.secondaryButton} href={`/${lang}/employees`}>{isArabic ? "تكاليف الموظفين" : "Employee costs"}</Link>
          <Link className={styles.secondaryButton} href={`/${lang}/expenses`}>{isArabic ? "المصاريف" : "Expenses"}</Link>
          <Link className={styles.secondaryButton} href={`/${lang}/subscriptions`}>{isArabic ? "الاشتراكات" : "Subscriptions"}</Link>
          <Link className={styles.secondaryButton} href={`/${lang}/invoices`}>{isArabic ? "الفواتير" : "Invoices"}</Link>
        </div>
      </header>

      {totals.missingRateMinutes > 0 ? (
        <div className={styles.warning} role="alert">
          <strong>{isArabic ? "توجد ساعات بلا سعر تكلفة" : "Some hours are missing a cost rate"}</strong>
          <span>{hours(totals.missingRateMinutes)} {isArabic ? "ساعة تحتاج راتبًا أو سعرًا للموظف المسؤول." : "hours need a salary or hourly cost for their assigned employee."}</span>
        </div>
      ) : null}

      <section className={styles.metrics} aria-label="Financial metrics">
        <article><span>{isArabic ? "قيمة العقود" : "Contract value"}</span><strong>{money(totals.contractValue, lang)}</strong><small>{rows.length} {isArabic ? "مشروع" : "projects"}</small></article>
        <article><span>{isArabic ? "التكلفة الفعلية" : "Actual cost"}</span><strong>{money(totals.actualCost, lang)}</strong><small>{isArabic ? "ساعات ومصاريف معتمدة" : "Approved labor and costs"}</small></article>
        <article><span>{isArabic ? "التكلفة المتوقعة عند الإتمام" : "Forecast at completion"}</span><strong>{money(totals.forecastCost, lang)}</strong><small>{isArabic ? "تشمل العمل المتبقي" : "Includes remaining work"}</small></article>
        <article data-tone={forecastProfitTone}><span>{isArabic ? "الربح المتوقع" : "Forecast profit"}</span><strong>{money(totals.forecastProfit, lang)}</strong><small>{totals.forecastMargin.toFixed(1)}% {isArabic ? "هامش" : "margin"}</small></article>
      </section>

      <div className={styles.summaryGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><h2>{isArabic ? "تركيبة التكلفة الفعلية" : "Actual cost composition"}</h2><p>{isArabic ? "من البنود المعتمدة فقط" : "Approved items only"}</p></div><strong>{money(totals.actualCost, lang)}</strong></div>
          <div className={styles.allocationBar} aria-label="Cost composition">
            <span style={{ width: `${laborPercent}%` }} />
            <span style={{ width: `${expensePercent}%` }} />
            <span style={{ width: `${subscriptionPercent}%` }} />
          </div>
          <div className={styles.legend}>
            <div><i data-color="labor" /><span>{isArabic ? "الموظفون" : "Labor"}</span><strong>{money(totals.laborCost, lang)}</strong></div>
            <div><i data-color="expense" /><span>{isArabic ? "المصاريف" : "Expenses"}</span><strong>{money(totals.expenseCost, lang)}</strong></div>
            <div><i data-color="subscription" /><span>{isArabic ? "الاشتراكات" : "Subscriptions"}</span><strong>{money(totals.subscriptionCost, lang)}</strong></div>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}><div><h2>{isArabic ? "المصاريف التشغيلية" : "Operating overhead"}</h2><p>{isArabic ? "خارج تكاليف المشاريع المباشرة" : "Outside direct project costs"}</p></div></div>
          <dl className={styles.costList}>
            <div><dt>{isArabic ? "كل الاشتراكات شهريًا" : "All subscriptions / month"}</dt><dd>{money(totals.monthlySubscriptions, lang)}</dd></div>
            <div><dt>{isArabic ? "اشتراكات غير موزعة شهريًا" : "Unallocated subscriptions / month"}</dt><dd>{money(totals.monthlyUnallocatedSubscriptions, lang)}</dd></div>
            <div><dt>{isArabic ? "مصاريف عامة معتمدة" : "Approved general expenses"}</dt><dd>{money(totals.approvedOverhead, lang)}</dd></div>
          </dl>
        </section>
      </div>

      <section className={`${styles.panel} ${styles.receivablesPanel}`}>
        <div className={styles.panelHeader}><div><h2>{isArabic ? "الفواتير والتحصيل" : "Invoicing and collections"}</h2><p>{isArabic ? "الذمم المدينة الفعلية من الفواتير المرسلة." : "Actual accounts receivable from issued invoices."}</p></div><Link className={styles.detailsLink} href={`/${lang}/invoices`}>{isArabic ? "إدارة الفواتير" : "Manage invoices"}</Link></div>
        <dl className={styles.receivablesGrid}>
          <div><dt>{isArabic ? "إجمالي المفوتر" : "Total invoiced"}</dt><dd>{money(receivables.totalInvoiced, lang)}</dd></div>
          <div><dt>{isArabic ? "المحصل" : "Collected"}</dt><dd>{money(receivables.totalCollected, lang)}</dd></div>
          <div><dt>{isArabic ? "الرصيد المستحق" : "Outstanding"}</dt><dd>{money(receivables.outstandingBalance, lang)}</dd></div>
          <div data-risk={receivables.overdueBalance > 0}><dt>{isArabic ? "متأخر التحصيل" : "Overdue"}</dt><dd>{money(receivables.overdueBalance, lang)}<small>{receivables.overdueCount} {isArabic ? "فاتورة" : "invoices"}</small></dd></div>
        </dl>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div><h2>{isArabic ? "تحليل المشاريع" : "Project analysis"}</h2><p>{isArabic ? "القيمة والتكلفة والتوقع والهامش" : "Value, cost, forecast, and margin"}</p></div>
        </div>
        {rows.length ? (
          <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>{isArabic ? "المشروع" : "Project"}</th><th>{isArabic ? "قيمة العقد" : "Contract"}</th><th>{isArabic ? "فعلي" : "Actual"}</th><th>{isArabic ? "المتوقع" : "Forecast"}</th><th>{isArabic ? "فرق الميزانية" : "Budget variance"}</th><th>{isArabic ? "الربح المتوقع" : "Forecast profit"}</th><th>{isArabic ? "الهامش" : "Margin"}</th><th /></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.project.id}>
              <td><strong>{row.project.name}</strong><span>{row.project.code} · {row.project.client.name}</span></td>
              <td>{money(row.contractValue, lang, row.project.currency)}</td>
              <td>{money(row.actualCost, lang, row.project.currency)}</td>
              <td>{money(row.forecastCost, lang, row.project.currency)}</td>
              <td className={row.budgetVariance >= 0 ? styles.positive : styles.negative}>{money(row.budgetVariance, lang, row.project.currency)}</td>
              <td className={row.forecastProfit >= 0 ? styles.positive : styles.negative}>{money(row.forecastProfit, lang, row.project.currency)}</td>
              <td><span className={row.forecastMargin >= 0 ? styles.goodBadge : styles.riskBadge}>{row.forecastMargin.toFixed(1)}%</span></td>
              <td><Link className={styles.detailsLink} href={`/${lang}/financials/${row.project.id}`}>{isArabic ? "التفاصيل" : "Details"}</Link></td>
            </tr>)}</tbody>
          </table></div>
        ) : <p className={styles.empty}>{isArabic ? "لا توجد مشاريع للحساب." : "No projects are available for calculation."}</p>}
      </section>
    </AppShell>
  );
}
