import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { FormFeedback } from "@/components/form-feedback";
import { QuotationForm } from "@/components/quotation-form";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { requirePagePermission } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

import styles from "../../operations.module.css";

function dateInputValue(date: Date) { return date.toISOString().slice(0, 10); }
function addDays(date: Date, days: number) { const result = new Date(date); result.setUTCDate(result.getUTCDate() + days); return result; }

export default async function NewQuotationPage({ params, searchParams }: { params: Promise<{ lang: string }>; searchParams: Promise<{ error?: string; success?: string }> }) {
  const { lang } = await params;
  const query = await searchParams;
  if (!isLocale(lang)) notFound();
  const user = await requirePagePermission(lang, "quotations.manage");
  const dictionary = getDictionary(lang);
  const isArabic = lang === "ar";
  const [clients, count] = await Promise.all([
    prisma.client.findMany({ where: { organizationId: user.organizationId!, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.quotation.count({ where: { organizationId: user.organizationId! } }),
  ]);
  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const suggestedNumber = `QUO-${today.getUTCFullYear()}-${String(count + 1).padStart(3, "0")}`;

  return (
    <AppShell activeSection="quotations" alternateHref={`/${lang === "en" ? "ar" : "en"}/quotations/new`} dictionary={dictionary} locale={lang}>
      <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href={`/${lang}/quotations`}>{isArabic ? "عروض الأسعار" : "Quotations"}</Link><span>/</span><span>{isArabic ? "جديد" : "New"}</span></nav>
      <header className={styles.pageHeader}><div><span className={styles.eyebrow}>{isArabic ? "عرض جديد" : "NEW QUOTATION"}</span><h1>{isArabic ? "إنشاء عرض سعر" : "Create a client quotation"}</h1><p>{isArabic ? "سيُحفظ كمسودة ويمكن تعديله قبل الإرسال." : "It will be saved as a draft and can be edited before sending."}</p></div><Link className={styles.secondaryButton} href={`/${lang}/quotations`}>{isArabic ? "العودة" : "Back"}</Link></header>
      <FormFeedback error={query.error} success={query.success} />
      <section className={styles.panel}>
        {clients.length ? <QuotationForm clients={clients} currency={user.organization?.baseCurrency || "JOD"} locale={lang} suggestedIssueDate={dateInputValue(today)} suggestedNumber={suggestedNumber} suggestedValidUntil={dateInputValue(addDays(today, 30))} /> : <p className={styles.empty}>{isArabic ? "أضف عميلاً أولاً قبل إنشاء عرض السعر." : "Add a client before creating a quotation."} <Link href={`/${lang}/clients`}>{isArabic ? "فتح العملاء" : "Open clients"}</Link></p>}
      </section>
    </AppShell>
  );
}
