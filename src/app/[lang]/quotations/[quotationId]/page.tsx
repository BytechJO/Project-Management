import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { acceptQuotation, cancelQuotation, convertQuotation, expireQuotation, rejectQuotation, sendQuotation } from "@/actions/quotations";
import { AppShell } from "@/components/app-shell";
import { FormFeedback } from "@/components/form-feedback";
import { QuotationForm } from "@/components/quotation-form";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { permissionKeysFor, requireUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { projectAccessLevelFor, projectAccessScope } from "@/lib/security-policy";

import styles from "../../operations.module.css";

function money(value: number, lang: string, currency: string) {
  return new Intl.NumberFormat(lang === "ar" ? "ar-JO" : "en-JO", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}
function formatDate(date: Date, lang: string) { return new Intl.DateTimeFormat(lang === "ar" ? "ar-JO" : "en-GB", { dateStyle: "medium" }).format(date); }
function dateInputValue(date: Date) { return date.toISOString().slice(0, 10); }
function addDays(date: Date, days: number) { const result = new Date(date); result.setUTCDate(result.getUTCDate() + days); return result; }

export default async function QuotationDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; quotationId: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { lang, quotationId } = await params;
  const query = await searchParams;
  if (!isLocale(lang)) notFound();
  const user = await requireUser(lang);
  const dictionary = getDictionary(lang);
  const permissions = permissionKeysFor(user);
  const canManage = permissions.has("quotations.manage");
  const canRead = canManage || permissions.has("quotations.read");
  if (!canRead) redirect(`/${lang}`);
  const projectAccessLevel = projectAccessLevelFor(permissions, Boolean(user.clientContact));

  const quotation = await prisma.quotation.findFirst({
    where: {
      id: quotationId,
      organizationId: user.organizationId!,
      ...(projectAccessLevel === "all" ? {} : {
        convertedProject: projectAccessScope(user.id, projectAccessLevel, user.clientContact?.clientId),
      }),
    },
    include: {
      client: true,
      createdBy: true,
      lineItems: { orderBy: { sortOrder: "asc" } },
      convertedProject: true,
      convertedInvoice: true,
    },
  });
  if (!quotation) notFound();

  const isArabic = lang === "ar";
  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const displayStatus = quotation.status === "SENT" && quotation.validUntil < today ? "EXPIRED" : quotation.status;
  const [clients, managers, invoiceCount] = canManage ? await Promise.all([
    prisma.client.findMany({ where: { organizationId: user.organizationId!, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { organizationId: user.organizationId!, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.invoice.count({ where: { organizationId: user.organizationId! } }),
  ]) : [[], [], 0];
  const suggestedProjectCode = `PRJ-${quotation.number.replace(/[^A-Za-z0-9]/g, "").slice(-16)}`.slice(0, 24);
  const suggestedInvoiceNumber = `INV-${today.getUTCFullYear()}-${String(invoiceCount + 1).padStart(3, "0")}`;

  return (
    <AppShell activeSection="quotations" alternateHref={`/${lang === "en" ? "ar" : "en"}/quotations/${quotation.id}`} dictionary={dictionary} locale={lang}>
      <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href={`/${lang}/quotations`}>{isArabic ? "عروض الأسعار" : "Quotations"}</Link><span>/</span><span>{quotation.number}</span></nav>
      <header className={styles.pageHeader}>
        <div><span className={styles.eyebrow}>{isArabic ? "تفاصيل عرض السعر" : "QUOTATION DETAILS"}</span><h1>{quotation.number}</h1><p>{quotation.client.name} · {quotation.title}</p></div>
        <div className={styles.headerActions}><span className={styles.status} data-status={displayStatus}>{displayStatus}</span><a className={styles.documentButton} href={`/api/documents/quotations/${quotation.id}?lang=${lang}`} target="_blank" rel="noreferrer">{isArabic ? "معاينة PDF" : "Preview PDF"}</a><a className={styles.secondaryButton} href={`/api/documents/quotations/${quotation.id}?lang=${lang}&download=1`}>{isArabic ? "تنزيل" : "Download"}</a><Link className={styles.secondaryButton} href={`/${lang}/quotations`}>{isArabic ? "العودة" : "Back"}</Link></div>
      </header>

      <FormFeedback error={query.error} success={query.success} />

      <section className={styles.metrics} aria-label="Quotation summary">
        <article><span>{isArabic ? "المجموع الفرعي" : "Subtotal"}</span><strong>{money(Number(quotation.subtotal), lang, quotation.currency)}</strong><small>{quotation.lineItems.length} {isArabic ? "بنود" : "line items"}</small></article>
        <article><span>{isArabic ? "الخصم" : "Discount"}</span><strong>{money(Number(quotation.discountAmount), lang, quotation.currency)}</strong><small>{quotation.discountType === "PERCENTAGE" ? `${Number(quotation.discountValue)}%` : quotation.discountType.replaceAll("_", " ")}</small></article>
        <article><span>{isArabic ? "الضريبة" : "Tax"}</span><strong>{money(Number(quotation.taxAmount), lang, quotation.currency)}</strong><small>{isArabic ? "بعد توزيع الخصم" : "After allocated discount"}</small></article>
        <article data-tone="positive"><span>{isArabic ? "إجمالي العرض" : "Quotation total"}</span><strong>{money(Number(quotation.totalAmount), lang, quotation.currency)}</strong><small>{formatDate(quotation.validUntil, lang)} {isArabic ? "صالح لغاية" : "valid until"}</small></article>
      </section>

      <div className={styles.layout}>
        <main className={styles.stack}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>{quotation.status === "DRAFT" && canManage ? (isArabic ? "تعديل المسودة" : "Edit draft") : (isArabic ? "بيانات العرض" : "Quotation information")}</h2><p>{isArabic ? `أنشأه ${quotation.createdBy.name}` : `Created by ${quotation.createdBy.name}`}</p></div></div>
            {quotation.status === "DRAFT" && canManage ? <QuotationForm
              clients={clients}
              currency={quotation.currency}
              locale={lang}
              initial={{
                id: quotation.id, clientId: quotation.clientId, number: quotation.number, title: quotation.title,
                description: quotation.description ?? "", issueDate: dateInputValue(quotation.issueDate), validUntil: dateInputValue(quotation.validUntil),
                discountType: quotation.discountType, discountValue: Number(quotation.discountValue), notes: quotation.notes ?? "", terms: quotation.terms ?? "",
                lineItems: quotation.lineItems.map((item) => ({ description: item.description, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice), taxRate: Number(item.taxRate) })),
              }}
            /> : <>
              <dl className={styles.infoList}><div><dt>{isArabic ? "العميل" : "Client"}</dt><dd>{quotation.client.name}</dd></div><div><dt>{isArabic ? "تاريخ الإصدار" : "Issue date"}</dt><dd>{formatDate(quotation.issueDate, lang)}</dd></div><div><dt>{isArabic ? "الوصف" : "Summary"}</dt><dd>{quotation.description || "—"}</dd></div><div><dt>{isArabic ? "الشروط" : "Terms"}</dt><dd>{quotation.terms || "—"}</dd></div><div><dt>{isArabic ? "ملاحظات" : "Notes"}</dt><dd>{quotation.notes || "—"}</dd></div></dl>
              <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>{isArabic ? "الوصف" : "Description"}</th><th>{isArabic ? "الكمية" : "Qty"}</th><th>{isArabic ? "سعر الوحدة" : "Unit price"}</th><th>{isArabic ? "الضريبة" : "Tax"}</th><th>{isArabic ? "إجمالي البند" : "Line total"}</th></tr></thead><tbody>{quotation.lineItems.map((item) => <tr key={item.id}><td><strong>{item.description}</strong></td><td>{Number(item.quantity)}</td><td>{money(Number(item.unitPrice), lang, quotation.currency)}</td><td>{Number(item.taxRate)}%<small>{money(Number(item.taxAmount), lang, quotation.currency)}</small></td><td><strong>{money(Number(item.totalAmount), lang, quotation.currency)}</strong></td></tr>)}</tbody></table></div>
            </>}

            {canManage ? <div className={styles.actionRow}>
              {quotation.status === "DRAFT" ? <form action={sendQuotation}><input name="locale" type="hidden" value={lang} /><input name="quotationId" type="hidden" value={quotation.id} /><button className={styles.primaryButton} type="submit">{isArabic ? "تحديد كمرسل" : "Mark as sent"}</button></form> : null}
              {quotation.status === "SENT" && displayStatus !== "EXPIRED" ? <><form action={acceptQuotation}><input name="locale" type="hidden" value={lang} /><input name="quotationId" type="hidden" value={quotation.id} /><button className={styles.approveButton} type="submit">{isArabic ? "قبول العرض" : "Accept quotation"}</button></form><form action={rejectQuotation}><input name="locale" type="hidden" value={lang} /><input name="quotationId" type="hidden" value={quotation.id} /><button className={styles.rejectButton} type="submit">{isArabic ? "رفض العرض" : "Reject quotation"}</button></form></> : null}
              {quotation.status === "SENT" && displayStatus === "EXPIRED" ? <form action={expireQuotation}><input name="locale" type="hidden" value={lang} /><input name="quotationId" type="hidden" value={quotation.id} /><button className={styles.rejectButton} type="submit">{isArabic ? "تأكيد انتهاء الصلاحية" : "Mark expired"}</button></form> : null}
              {["DRAFT", "SENT"].includes(quotation.status) ? <form action={cancelQuotation}><input name="locale" type="hidden" value={lang} /><input name="quotationId" type="hidden" value={quotation.id} /><button className={styles.rejectButton} type="submit">{isArabic ? "إلغاء العرض" : "Cancel quotation"}</button></form> : null}
            </div> : null}
          </section>
        </main>

        <aside className={styles.stack}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>{isArabic ? "التحويل" : "Conversion"}</h2><p>{isArabic ? "اربط العرض بالتنفيذ والتحصيل." : "Connect the sale to delivery and billing."}</p></div></div>
            {quotation.convertedProject ? <div className={styles.stack}><p className={styles.muted}>{isArabic ? "تم تحويل هذا العرض مسبقًا." : "This quotation has already been converted."}</p><div className={styles.conversionLinks}><Link className={styles.primaryButton} href={`/${lang}/projects/${quotation.convertedProject.id}`}>{isArabic ? "فتح المشروع" : "Open project"}</Link>{quotation.convertedInvoice ? <Link className={styles.secondaryButton} href={`/${lang}/invoices/${quotation.convertedInvoice.id}`}>{isArabic ? "فتح الفاتورة" : "Open invoice"}</Link> : null}</div></div> : quotation.status === "ACCEPTED" && canManage ? <form action={convertQuotation} className={styles.form}>
              <input name="locale" type="hidden" value={lang} /><input name="quotationId" type="hidden" value={quotation.id} />
              <label><span>{isArabic ? "اسم المشروع" : "Project name"}</span><input name="projectName" defaultValue={quotation.title} maxLength={160} required /></label>
              <div className={styles.formGrid}><label><span>{isArabic ? "رمز المشروع" : "Project code"}</span><input name="projectCode" defaultValue={suggestedProjectCode} maxLength={24} required /></label><label><span>{isArabic ? "مدير المشروع" : "Project manager"}</span><select name="primaryManagerId" required><option value="">—</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></label></div>
              <label><span>{isArabic ? "نظام التسعير" : "Pricing model"}</span><select name="pricingModel" defaultValue="FIXED_PRICE"><option value="FIXED_PRICE">Fixed price</option><option value="TIME_AND_MATERIALS">Time & materials</option><option value="MONTHLY_RETAINER">Monthly retainer</option></select></label>
              <div className={styles.formGrid}><label><span>{isArabic ? "الميزانية المخططة" : "Planned budget"}</span><input name="plannedBudget" type="number" min="0" step="0.01" defaultValue="0" required /></label><label><span>{isArabic ? "بداية المشروع" : "Start date"}</span><input name="startDate" type="date" defaultValue={dateInputValue(today)} /></label><label><span>{isArabic ? "تاريخ التسليم" : "Target date"}</span><input name="targetDate" type="date" /></label></div>
              <div className={styles.warning}>{isArabic ? "سيتم إنشاء فاتورة أولى تلقائيًا. ضع المبلغ 0 لإنشاء المشروع فقط." : "An initial draft invoice will be created automatically. Set the amount to 0 to create only the project."}</div>
              <div className={styles.formGrid}><label><span>{isArabic ? "رقم الفاتورة" : "Invoice number"}</span><input name="invoiceNumber" defaultValue={suggestedInvoiceNumber} maxLength={60} /></label><label><span>{isArabic ? "مبلغ الفاتورة الأولى" : "Initial invoice total"}</span><input name="invoiceAmount" type="number" min="0" max={Number(quotation.totalAmount)} step="0.01" defaultValue={Number(quotation.totalAmount)} required /></label><label><span>{isArabic ? "استحقاق الفاتورة" : "Invoice due date"}</span><input name="invoiceDueDate" type="date" defaultValue={dateInputValue(addDays(today, 30))} /></label></div>
              <button className={styles.paidButton} type="submit">{isArabic ? "إنشاء المشروع والفاتورة" : "Create project & invoice"}</button>
            </form> : <p className={styles.empty}>{isArabic ? "يظهر نموذج التحويل بعد قبول العرض." : "The conversion form becomes available after the quotation is accepted."}</p>}
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
