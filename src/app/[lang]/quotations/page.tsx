import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { FormFeedback } from "@/components/form-feedback";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { permissionKeysFor, requireUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { projectAccessLevelFor, projectAccessScope } from "@/lib/security-policy";

import styles from "../operations.module.css";

const statusOptions = ["ALL", "DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"] as const;

function money(value: number, lang: string, currency: string) {
  return new Intl.NumberFormat(lang === "ar" ? "ar-JO" : "en-JO", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function formatDate(date: Date, lang: string) {
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-JO" : "en-GB", { dateStyle: "medium" }).format(date);
}

function effectiveStatus(quotation: { status: string; validUntil: Date }, today: Date) {
  return quotation.status === "SENT" && quotation.validUntil < today ? "EXPIRED" : quotation.status;
}

export default async function QuotationsPage({
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
  const canManage = permissions.has("quotations.manage");
  const canRead = canManage || permissions.has("quotations.read");
  if (!canRead) redirect(`/${lang}?error=${encodeURIComponent("You do not have permission to open quotations.")}`);
  const isArabic = lang === "ar";
  const selectedStatus = statusOptions.includes(query.status as (typeof statusOptions)[number]) ? query.status! : "ALL";
  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const projectAccessLevel = projectAccessLevelFor(permissions, Boolean(user.clientContact));

  const quotations = await prisma.quotation.findMany({
    where: {
      organizationId: user.organizationId!,
      ...(projectAccessLevel === "all" ? {} : {
        convertedProject: projectAccessScope(user.id, projectAccessLevel, user.clientContact?.clientId),
      }),
    },
    include: { client: true, convertedProject: true, convertedInvoice: true },
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
  });
  const rows = quotations.map((quotation) => ({ quotation, displayStatus: effectiveStatus(quotation, today) }));
  const visibleRows = selectedStatus === "ALL" ? rows : rows.filter((row) => row.displayStatus === selectedStatus);
  const draftValue = rows.filter((row) => row.displayStatus === "DRAFT").reduce((sum, row) => sum + Number(row.quotation.totalAmount), 0);
  const sentValue = rows.filter((row) => row.displayStatus === "SENT").reduce((sum, row) => sum + Number(row.quotation.totalAmount), 0);
  const acceptedValue = rows.filter((row) => row.displayStatus === "ACCEPTED").reduce((sum, row) => sum + Number(row.quotation.totalAmount), 0);
  const expiredValue = rows.filter((row) => row.displayStatus === "EXPIRED").reduce((sum, row) => sum + Number(row.quotation.totalAmount), 0);

  return (
    <AppShell activeSection="quotations" alternateHref={`/${lang === "en" ? "ar" : "en"}/quotations`} dictionary={dictionary} locale={lang}>
      <header className={styles.pageHeader}>
        <div><span className={styles.eyebrow}>{isArabic ? "المبيعات قبل المشروع" : "PRE-SALES PIPELINE"}</span><h1>{isArabic ? "عروض الأسعار" : "Client quotations"}</h1><p>{isArabic ? "أنشئ عروض الأسعار، تابع قبولها، وحوّل العرض المقبول إلى مشروع وفاتورة." : "Create quotations, track acceptance, and convert accepted work into a project and invoice."}</p></div>
        <div className={styles.headerActions}>{canManage ? <Link className={styles.primaryButton} href={`/${lang}/quotations/new`}>{isArabic ? "عرض سعر جديد" : "New quotation"}</Link> : null}<Link className={styles.secondaryButton} href={`/${lang}/invoices`}>{isArabic ? "الفواتير" : "Invoices"}</Link></div>
      </header>

      <FormFeedback error={query.error} success={query.success} />

      <section className={styles.metrics} aria-label="Quotation metrics">
        <article><span>{isArabic ? "مسودات" : "Draft pipeline"}</span><strong>{money(draftValue, lang, user.organization?.baseCurrency || "JOD")}</strong><small>{rows.filter((row) => row.displayStatus === "DRAFT").length} {isArabic ? "عروض" : "quotations"}</small></article>
        <article><span>{isArabic ? "مرسلة" : "Sent pipeline"}</span><strong>{money(sentValue, lang, user.organization?.baseCurrency || "JOD")}</strong><small>{rows.filter((row) => row.displayStatus === "SENT").length} {isArabic ? "بانتظار القرار" : "awaiting decision"}</small></article>
        <article data-tone="positive"><span>{isArabic ? "مقبولة" : "Accepted value"}</span><strong>{money(acceptedValue, lang, user.organization?.baseCurrency || "JOD")}</strong><small>{rows.filter((row) => row.displayStatus === "ACCEPTED").length} {isArabic ? "عروض مقبولة" : "accepted quotations"}</small></article>
        <article data-tone={expiredValue > 0 ? "negative" : undefined}><span>{isArabic ? "منتهية" : "Expired value"}</span><strong>{money(expiredValue, lang, user.organization?.baseCurrency || "JOD")}</strong><small>{rows.filter((row) => row.displayStatus === "EXPIRED").length} {isArabic ? "عروض منتهية" : "expired quotations"}</small></article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><h2>{isArabic ? "سجل عروض الأسعار" : "Quotation register"}</h2><p>{visibleRows.length} {isArabic ? "سجل ظاهر" : "visible records"}</p></div><form className={styles.filterRow}><select aria-label="Quotation status filter" name="status" defaultValue={selectedStatus}>{statusOptions.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select><button className={styles.secondaryButton} type="submit">{isArabic ? "تصفية" : "Filter"}</button></form></div>
        {visibleRows.length ? <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>{isArabic ? "العرض" : "Quotation"}</th><th>{isArabic ? "العميل" : "Client"}</th><th>{isArabic ? "تاريخ الإصدار" : "Issue date"}</th><th>{isArabic ? "صالح لغاية" : "Valid until"}</th><th>{isArabic ? "الإجمالي" : "Total"}</th><th>{isArabic ? "الحالة" : "Status"}</th><th /></tr></thead>
          <tbody>{visibleRows.map(({ quotation, displayStatus }) => <tr key={quotation.id}>
            <td><strong>{quotation.number}</strong><small>{quotation.title}</small></td>
            <td><strong>{quotation.client.name}</strong>{quotation.convertedProject ? <small>{isArabic ? "مشروع" : "Project"}: {quotation.convertedProject.name}</small> : null}</td>
            <td>{formatDate(quotation.issueDate, lang)}</td><td>{formatDate(quotation.validUntil, lang)}</td>
            <td><strong>{money(Number(quotation.totalAmount), lang, quotation.currency)}</strong></td>
            <td><span className={styles.status} data-status={displayStatus}>{displayStatus.replaceAll("_", " ")}</span></td>
            <td><div className={styles.tableActions}><Link className={styles.secondaryButton} href={`/${lang}/quotations/${quotation.id}`}>{isArabic ? "التفاصيل" : "Details"}</Link><a className={styles.documentButton} href={`/api/documents/quotations/${quotation.id}?lang=${lang}`} target="_blank" rel="noreferrer">PDF</a></div></td>
          </tr>)}</tbody>
        </table></div> : <p className={styles.empty}>{isArabic ? "لا توجد عروض أسعار ضمن هذا الفلتر." : "No quotations match this filter."}</p>}
      </section>
    </AppShell>
  );
}
