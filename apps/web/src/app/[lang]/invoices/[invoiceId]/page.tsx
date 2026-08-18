import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { cancelInvoice, recordInvoicePayment, sendInvoice, updateInvoice } from "@/actions/invoices";
import { AppShell } from "@/components/app-shell";
import { FormFeedback } from "@/components/form-feedback";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { permissionKeysFor, requireUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { projectAccessLevelFor, projectAccessScope } from "@/lib/security-policy";

import styles from "../../operations.module.css";

function money(value: number, lang: string, currency: string) {
  return new Intl.NumberFormat(lang === "ar" ? "ar-JO" : "en-JO", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function formatDate(date: Date, lang: string) {
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-JO" : "en-GB", { dateStyle: "medium" }).format(date);
}

function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default async function InvoiceDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; invoiceId: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { lang, invoiceId } = await params;
  const query = await searchParams;
  if (!isLocale(lang)) notFound();
  const user = await requireUser(lang);
  const dictionary = getDictionary(lang);
  const permissions = permissionKeysFor(user);
  const canRead = permissions.has("invoices.read") || permissions.has("invoices.manage");
  const canManage = permissions.has("invoices.manage");
  if (!canRead) redirect(`/${lang}`);
  const projectAccessLevel = projectAccessLevelFor(permissions, Boolean(user.clientContact));

  const invoice = await prisma.invoice.findFirst({
    where: {
      id: invoiceId,
      organizationId: user.organizationId!,
      ...(projectAccessLevel === "all" ? {} : {
        project: projectAccessScope(user.id, projectAccessLevel, user.clientContact?.clientId),
      }),
    },
    include: { client: true, project: true, createdBy: true, payments: { include: { recordedBy: true }, orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }] } },
  });
  if (!invoice) notFound();

  const projects = canManage ? await prisma.project.findMany({
    where: { organizationId: user.organizationId!, status: { not: "CANCELLED" } },
    include: { client: true },
    orderBy: { name: "asc" },
  }) : [];
  const isArabic = lang === "ar";
  const collected = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const balance = Math.max(Number(invoice.totalAmount) - collected, 0);
  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const displayStatus = ["SENT", "PARTIALLY_PAID"].includes(invoice.status) && balance > 0 && invoice.dueDate < today ? "OVERDUE" : invoice.status;
  const canCollect = canManage && ["SENT", "PARTIALLY_PAID"].includes(invoice.status) && balance > 0;

  return (
    <AppShell activeSection="invoices" alternateHref={`/${lang === "en" ? "ar" : "en"}/invoices/${invoice.id}`} dictionary={dictionary} locale={lang}>
      <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href={`/${lang}/invoices`}>{isArabic ? "الفواتير" : "Invoices"}</Link><span>/</span><span>{invoice.number}</span></nav>
      <header className={styles.pageHeader}>
        <div><span className={styles.eyebrow}>{isArabic ? "تفاصيل الفاتورة" : "INVOICE DETAILS"}</span><h1>{invoice.number}</h1><p>{invoice.client.name} · {invoice.project.name} · {invoice.description}</p></div>
        <div className={styles.headerActions}><span className={styles.status} data-status={displayStatus}>{displayStatus.replaceAll("_", " ")}</span><a className={styles.documentButton} href={`/api/documents/invoices/${invoice.id}?lang=${lang}`} target="_blank" rel="noreferrer">{isArabic ? "معاينة PDF" : "Preview PDF"}</a><a className={styles.secondaryButton} href={`/api/documents/invoices/${invoice.id}?lang=${lang}&download=1`}>{isArabic ? "تنزيل" : "Download"}</a><a className={styles.secondaryButton} href={`/api/documents/clients/${invoice.clientId}/statement?lang=${lang}`} target="_blank" rel="noreferrer">{isArabic ? "كشف حساب" : "Statement"}</a><Link className={styles.secondaryButton} href={`/${lang}/invoices`}>{isArabic ? "العودة" : "Back"}</Link></div>
      </header>

      <FormFeedback error={query.error} success={query.success} />

      <section className={styles.metrics} aria-label="Invoice summary">
        <article><span>{isArabic ? "إجمالي الفاتورة" : "Invoice total"}</span><strong>{money(Number(invoice.totalAmount), lang, invoice.currency)}</strong><small>{money(Number(invoice.taxAmount), lang, invoice.currency)} {isArabic ? "ضريبة" : "tax"}</small></article>
        <article><span>{isArabic ? "المبلغ المحصل" : "Collected"}</span><strong>{money(collected, lang, invoice.currency)}</strong><small>{invoice.payments.length} {isArabic ? "دفعة" : "payments"}</small></article>
        <article data-tone={balance > 0 ? "negative" : "positive"}><span>{isArabic ? "الرصيد المتبقي" : "Outstanding balance"}</span><strong>{money(balance, lang, invoice.currency)}</strong><small>{isArabic ? "المتبقي على العميل" : "Remaining from client"}</small></article>
        <article><span>{isArabic ? "تاريخ الاستحقاق" : "Due date"}</span><strong>{formatDate(invoice.dueDate, lang)}</strong><small>{formatDate(invoice.issueDate, lang)} {isArabic ? "تاريخ الإصدار" : "issued"}</small></article>
      </section>

      <div className={styles.layout}>
        <main className={styles.stack}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>{invoice.status === "DRAFT" && canManage ? (isArabic ? "تعديل المسودة" : "Edit draft") : (isArabic ? "بيانات الفاتورة" : "Invoice information")}</h2><p>{isArabic ? `أنشأها ${invoice.createdBy.name}` : `Created by ${invoice.createdBy.name}`}</p></div></div>
            {invoice.status === "DRAFT" && canManage ? <form action={updateInvoice} className={styles.form}>
              <input name="locale" type="hidden" value={lang} /><input name="invoiceId" type="hidden" value={invoice.id} />
              <label><span>{isArabic ? "المشروع" : "Project"}</span><select name="projectId" defaultValue={invoice.projectId} required>{projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {project.client.name}</option>)}</select></label>
              <div className={styles.formGrid}><label><span>{isArabic ? "رقم الفاتورة" : "Invoice number"}</span><input name="number" defaultValue={invoice.number} maxLength={60} required /></label><label><span>{isArabic ? "المبلغ قبل الضريبة" : "Subtotal"}</span><input name="subtotal" type="number" min="0.01" step="0.01" defaultValue={Number(invoice.subtotal)} required /></label></div>
              <label><span>{isArabic ? "الوصف" : "Description"}</span><textarea name="description" defaultValue={invoice.description} maxLength={1000} required /></label>
              <div className={styles.formGrid}><label><span>{isArabic ? "تاريخ الإصدار" : "Issue date"}</span><input name="issueDate" type="date" defaultValue={dateInputValue(invoice.issueDate)} required /></label><label><span>{isArabic ? "تاريخ الاستحقاق" : "Due date"}</span><input name="dueDate" type="date" defaultValue={dateInputValue(invoice.dueDate)} required /></label><label><span>{isArabic ? "الضريبة" : "Tax"}</span><input name="taxAmount" type="number" min="0" step="0.01" defaultValue={Number(invoice.taxAmount)} required /></label></div>
              <label><span>{isArabic ? "ملاحظات" : "Notes"}</span><textarea name="notes" defaultValue={invoice.notes ?? ""} maxLength={2000} /></label>
              <button className={styles.primaryButton} type="submit">{isArabic ? "حفظ التعديلات" : "Save changes"}</button>
            </form> : <dl className={styles.infoList}>
              <div><dt>{isArabic ? "العميل" : "Client"}</dt><dd>{invoice.client.name}</dd></div><div><dt>{isArabic ? "المشروع" : "Project"}</dt><dd>{invoice.project.name}</dd></div><div><dt>{isArabic ? "الوصف" : "Description"}</dt><dd>{invoice.description}</dd></div><div><dt>{isArabic ? "قبل الضريبة" : "Subtotal"}</dt><dd>{money(Number(invoice.subtotal), lang, invoice.currency)}</dd></div><div><dt>{isArabic ? "الضريبة" : "Tax"}</dt><dd>{money(Number(invoice.taxAmount), lang, invoice.currency)}</dd></div><div><dt>{isArabic ? "الملاحظات" : "Notes"}</dt><dd>{invoice.notes ?? "—"}</dd></div>
            </dl>}
            {canManage ? <div className={styles.actionRow}>
              {invoice.status === "DRAFT" ? <form action={sendInvoice}><input name="locale" type="hidden" value={lang} /><input name="invoiceId" type="hidden" value={invoice.id} /><button className={styles.primaryButton} type="submit">{isArabic ? "تحديد كمرسلة" : "Mark as sent"}</button></form> : null}
              {!['PAID', 'CANCELLED'].includes(invoice.status) ? <form action={cancelInvoice}><input name="locale" type="hidden" value={lang} /><input name="invoiceId" type="hidden" value={invoice.id} /><button className={styles.rejectButton} type="submit">{isArabic ? "إلغاء الفاتورة" : "Cancel invoice"}</button></form> : null}
            </div> : null}
          </section>
        </main>

        <aside className={styles.stack}>
          {canCollect ? <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>{isArabic ? "تسجيل دفعة" : "Record payment"}</h2><p>{isArabic ? `الرصيد الحالي ${money(balance, lang, invoice.currency)}` : `Current balance ${money(balance, lang, invoice.currency)}`}</p></div></div>
            <form action={recordInvoicePayment} className={styles.form}>
              <input name="locale" type="hidden" value={lang} /><input name="invoiceId" type="hidden" value={invoice.id} />
              <div className={styles.formGrid}><label><span>{isArabic ? "تاريخ الدفع" : "Payment date"}</span><input name="paymentDate" type="date" defaultValue={dateInputValue(today)} required /></label><label><span>{isArabic ? "المبلغ" : "Amount"}</span><input name="amount" type="number" min="0.01" max={balance} step="0.01" defaultValue={balance} required /></label></div>
              <label><span>{isArabic ? "طريقة الدفع" : "Payment method"}</span><select name="method" defaultValue="BANK_TRANSFER"><option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option><option value="CHEQUE">Cheque</option><option value="CARD">Card</option><option value="OTHER">Other</option></select></label>
              <label><span>{isArabic ? "المرجع" : "Reference"}</span><input name="reference" maxLength={160} /></label><label><span>{isArabic ? "ملاحظات" : "Notes"}</span><textarea name="notes" maxLength={1000} /></label>
              <button className={styles.paidButton} type="submit">{isArabic ? "تسجيل التحصيل" : "Record collection"}</button>
            </form>
          </section> : null}

          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>{isArabic ? "سجل التحصيلات" : "Collection history"}</h2><p>{invoice.payments.length} {isArabic ? "دفعة مسجلة" : "recorded payments"}</p></div></div>
            {invoice.payments.length ? <dl className={styles.infoList}>{invoice.payments.map((payment) => <div key={payment.id}><dt>{formatDate(payment.paymentDate, lang)}<small>{payment.method.replaceAll("_", " ")}{payment.reference ? ` · ${payment.reference}` : ""}</small></dt><dd>{money(Number(payment.amount), lang, invoice.currency)}<small>{payment.recordedBy.name}</small><a className={styles.receiptLink} href={`/api/documents/payments/${payment.id}?lang=${lang}`} target="_blank" rel="noreferrer">{isArabic ? "إيصال PDF" : "PDF receipt"}</a></dd></div>)}</dl> : <p className={styles.empty}>{isArabic ? "لا توجد تحصيلات مسجلة." : "No collections have been recorded."}</p>}
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
