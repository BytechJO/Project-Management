import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createInvoice } from "@/actions/invoices";
import { AppShell } from "@/components/app-shell";
import { FormFeedback } from "@/components/form-feedback";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { permissionKeysFor, requireUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { projectAccessLevelFor, projectAccessScope } from "@/lib/security-policy";

import styles from "../operations.module.css";

const statusOptions = ["ALL", "DRAFT", "SENT", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"] as const;

function money(value: number, lang: string, currency = "JOD") {
  return new Intl.NumberFormat(lang === "ar" ? "ar-JO" : "en-JO", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function formatDate(date: Date, lang: string) {
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-JO" : "en-GB", { dateStyle: "medium" }).format(date);
}

function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function visibleStatus(invoice: { status: string; dueDate: Date }, balance: number, today: Date) {
  if (["SENT", "PARTIALLY_PAID"].includes(invoice.status) && balance > 0 && invoice.dueDate < today) return "OVERDUE";
  return invoice.status;
}

export default async function InvoicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ error?: string; success?: string; status?: string }>;
}) {
  const { lang } = await params;
  const query = await searchParams;
  if (!isLocale(lang)) notFound();
  const user = await requireUser(lang);
  const dictionary = getDictionary(lang);
  const permissions = permissionKeysFor(user);
  const canRead = permissions.has("invoices.read") || permissions.has("invoices.manage");
  const canManage = permissions.has("invoices.manage");
  if (!canRead) redirect(`/${lang}?error=${encodeURIComponent("You do not have permission to open invoices.")}`);
  const isArabic = lang === "ar";
  const selectedStatus = statusOptions.includes(query.status as (typeof statusOptions)[number]) ? query.status! : "ALL";
  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));

  const projectAccessLevel = projectAccessLevelFor(permissions, Boolean(user.clientContact));
  const projectScope = projectAccessLevel === "all"
    ? {}
    : { project: projectAccessScope(user.id, projectAccessLevel, user.clientContact?.clientId) };
  const [invoices, projects, invoiceCount] = await Promise.all([
    prisma.invoice.findMany({
      where: { organizationId: user.organizationId!, ...projectScope },
      include: { client: true, project: true, payments: true },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    }),
    canManage ? prisma.project.findMany({
      where: { organizationId: user.organizationId!, status: { not: "CANCELLED" } },
      include: { client: true },
      orderBy: { name: "asc" },
    }) : Promise.resolve([]),
    prisma.invoice.count({ where: { organizationId: user.organizationId! } }),
  ]);

  const rows = invoices.map((invoice) => {
    const collected = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const balance = Math.max(Number(invoice.totalAmount) - collected, 0);
    return { invoice, collected, balance, displayStatus: visibleStatus(invoice, balance, today) };
  });
  const visibleRows = selectedStatus === "ALL" ? rows : rows.filter((row) => row.displayStatus === selectedStatus);
  const issuedRows = rows.filter(({ invoice }) => !["DRAFT", "CANCELLED"].includes(invoice.status));
  const totalIssued = issuedRows.reduce((sum, row) => sum + Number(row.invoice.totalAmount), 0);
  const totalCollected = issuedRows.reduce((sum, row) => sum + row.collected, 0);
  const totalOutstanding = issuedRows.reduce((sum, row) => sum + row.balance, 0);
  const overdueBalance = rows.filter((row) => row.displayStatus === "OVERDUE").reduce((sum, row) => sum + row.balance, 0);
  const suggestedNumber = `INV-${today.getUTCFullYear()}-${String(invoiceCount + 1).padStart(3, "0")}`;

  return (
    <AppShell activeSection="invoices" alternateHref={`/${lang === "en" ? "ar" : "en"}/invoices`} dictionary={dictionary} locale={lang}>
      <header className={styles.pageHeader}>
        <div><span className={styles.eyebrow}>{isArabic ? "الذمم المدينة" : "ACCOUNTS RECEIVABLE"}</span><h1>{isArabic ? "فواتير العملاء" : "Client invoices"}</h1><p>{isArabic ? "أنشئ الفواتير وتابع الاستحقاق والتحصيل والرصيد المتبقي." : "Create invoices and track due dates, collections, and outstanding balances."}</p></div>
        <div className={styles.headerActions}>{canManage ? <Link className={styles.secondaryButton} href={`/${lang}/invoices/settings`}>{isArabic ? "إعدادات الفوترة" : "Billing settings"}</Link> : null}<Link className={styles.secondaryButton} href={`/${lang}/financials`}>{isArabic ? "لوحة الربحية" : "Profitability"}</Link><Link className={styles.secondaryButton} href={`/${lang}/clients`}>{isArabic ? "العملاء" : "Clients"}</Link></div>
      </header>

      <FormFeedback error={query.error} success={query.success} />

      <section className={styles.metrics} aria-label="Invoice metrics">
        <article><span>{isArabic ? "إجمالي الفواتير المرسلة" : "Total invoiced"}</span><strong>{money(totalIssued, lang)}</strong><small>{issuedRows.length} {isArabic ? "فاتورة" : "issued invoices"}</small></article>
        <article><span>{isArabic ? "المبالغ المحصلة" : "Collected"}</span><strong>{money(totalCollected, lang)}</strong><small>{totalIssued > 0 ? ((totalCollected / totalIssued) * 100).toFixed(1) : "0.0"}% {isArabic ? "نسبة التحصيل" : "collection rate"}</small></article>
        <article><span>{isArabic ? "الرصيد المستحق" : "Outstanding"}</span><strong>{money(totalOutstanding, lang)}</strong><small>{rows.filter((row) => row.balance > 0 && !["DRAFT", "CANCELLED"].includes(row.invoice.status)).length} {isArabic ? "فاتورة مفتوحة" : "open invoices"}</small></article>
        <article data-tone={overdueBalance > 0 ? "negative" : "positive"}><span>{isArabic ? "متأخر التحصيل" : "Overdue"}</span><strong>{money(overdueBalance, lang)}</strong><small>{rows.filter((row) => row.displayStatus === "OVERDUE").length} {isArabic ? "فاتورة متأخرة" : "overdue invoices"}</small></article>
      </section>

      <div className={canManage ? styles.layout : styles.stack}>
        <main className={styles.stack}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>{isArabic ? "سجل الفواتير" : "Invoice register"}</h2><p>{visibleRows.length} {isArabic ? "سجل ظاهر" : "visible records"}</p></div><form className={styles.filterRow}><select aria-label="Invoice status filter" name="status" defaultValue={selectedStatus}>{statusOptions.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select><button className={styles.secondaryButton} type="submit">{isArabic ? "تصفية" : "Filter"}</button></form></div>
            {visibleRows.length ? <div className={styles.tableWrap}><table className={styles.table}>
              <thead><tr><th>{isArabic ? "الفاتورة" : "Invoice"}</th><th>{isArabic ? "العميل / المشروع" : "Client / project"}</th><th>{isArabic ? "الاستحقاق" : "Due date"}</th><th>{isArabic ? "الإجمالي" : "Total"}</th><th>{isArabic ? "المحصل" : "Collected"}</th><th>{isArabic ? "المتبقي" : "Balance"}</th><th>{isArabic ? "الحالة" : "Status"}</th><th /></tr></thead>
              <tbody>{visibleRows.map(({ invoice, collected, balance, displayStatus }) => <tr key={invoice.id}>
                <td><strong>{invoice.number}</strong><small>{invoice.description}</small></td>
                <td><strong>{invoice.client.name}</strong><small>{invoice.project.name}</small></td>
                <td>{formatDate(invoice.dueDate, lang)}</td>
                <td>{money(Number(invoice.totalAmount), lang, invoice.currency)}</td>
                <td>{money(collected, lang, invoice.currency)}</td>
                <td><strong>{money(balance, lang, invoice.currency)}</strong></td>
                <td><span className={styles.status} data-status={displayStatus}>{displayStatus.replaceAll("_", " ")}</span></td>
                <td><div className={styles.tableActions}><Link className={styles.secondaryButton} href={`/${lang}/invoices/${invoice.id}`}>{isArabic ? "التفاصيل" : "Details"}</Link><a className={styles.documentButton} href={`/api/documents/invoices/${invoice.id}?lang=${lang}`} target="_blank" rel="noreferrer">PDF</a></div></td>
              </tr>)}</tbody>
            </table></div> : <p className={styles.empty}>{isArabic ? "لا توجد فواتير ضمن هذا الفلتر." : "No invoices match this filter."}</p>}
          </section>
        </main>

        {canManage ? <aside className={styles.stack}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>{isArabic ? "فاتورة جديدة" : "New invoice"}</h2><p>{isArabic ? "تُحفظ كمسودة قبل إرسالها للعميل." : "Saved as a draft before sending to the client."}</p></div></div>
            <form action={createInvoice} className={styles.form}>
              <input name="locale" type="hidden" value={lang} />
              <label><span>{isArabic ? "المشروع" : "Project"}</span><select name="projectId" required><option value="">—</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {project.client.name}</option>)}</select></label>
              <div className={styles.formGrid}><label><span>{isArabic ? "رقم الفاتورة" : "Invoice number"}</span><input name="number" defaultValue={suggestedNumber} maxLength={60} required /></label><label><span>{isArabic ? "المبلغ قبل الضريبة" : "Subtotal"}</span><input name="subtotal" type="number" min="0.01" step="0.01" required /></label></div>
              <label><span>{isArabic ? "الوصف" : "Description"}</span><textarea name="description" maxLength={1000} required /></label>
              <div className={styles.formGrid}><label><span>{isArabic ? "تاريخ الإصدار" : "Issue date"}</span><input name="issueDate" type="date" defaultValue={dateInputValue(today)} required /></label><label><span>{isArabic ? "تاريخ الاستحقاق" : "Due date"}</span><input name="dueDate" type="date" defaultValue={dateInputValue(addDays(today, 30))} required /></label><label><span>{isArabic ? "الضريبة" : "Tax"}</span><input name="taxAmount" type="number" min="0" step="0.01" defaultValue="0" required /></label></div>
              <label><span>{isArabic ? "ملاحظات" : "Notes"}</span><textarea name="notes" maxLength={2000} /></label>
              <button className={styles.primaryButton} type="submit">{isArabic ? "إنشاء مسودة" : "Create draft"}</button>
            </form>
          </section>
        </aside> : null}
      </div>
    </AppShell>
  );
}
