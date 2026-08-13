import Link from "next/link";
import { notFound } from "next/navigation";

import { updateBillingSettings } from "@/actions/organization";
import { AppShell } from "@/components/app-shell";
import { FormFeedback } from "@/components/form-feedback";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { requirePagePermission } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

import styles from "../../operations.module.css";

export default async function BillingSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { lang } = await params;
  const feedback = await searchParams;
  if (!isLocale(lang)) notFound();
  const user = await requirePagePermission(lang, "invoices.manage");
  const dictionary = getDictionary(lang);
  const isArabic = lang === "ar";
  const organization = await prisma.organization.findUnique({ where: { id: user.organizationId! } });
  if (!organization) notFound();

  return (
    <AppShell activeSection="invoices" alternateHref={`/${lang === "en" ? "ar" : "en"}/invoices/settings`} dictionary={dictionary} locale={lang}>
      <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href={`/${lang}/invoices`}>{isArabic ? "الفواتير" : "Invoices"}</Link><span>/</span><span>{isArabic ? "إعدادات الفوترة" : "Billing settings"}</span></nav>
      <header className={styles.pageHeader}>
        <div><span className={styles.eyebrow}>{isArabic ? "إعداد المستندات" : "DOCUMENT SETUP"}</span><h1>{isArabic ? "بيانات Bytech للفوترة" : "Bytech billing details"}</h1><p>{isArabic ? "تظهر هذه البيانات تلقائيًا في الفواتير والإيصالات وكشوف الحساب." : "These details appear automatically on invoices, receipts, and client statements."}</p></div>
        <Link className={styles.secondaryButton} href={`/${lang}/invoices`}>{isArabic ? "العودة للفواتير" : "Back to invoices"}</Link>
      </header>
      <FormFeedback error={feedback.error} success={feedback.success} />

      <section className={styles.panel}>
        <form action={updateBillingSettings} className={styles.form}>
          <input name="locale" type="hidden" value={lang} />
          <div className={styles.documentSettingsSection}>
            <div><h2>{isArabic ? "بيانات الشركة" : "Company information"}</h2><p>{isArabic ? "المعلومات القانونية ومعلومات التواصل التي تظهر في رأس المستند." : "Legal and contact information shown in the document header."}</p></div>
            <div className={styles.formGrid}>
              <label><span>{isArabic ? "الاسم القانوني" : "Legal name"}</span><input name="billingLegalName" defaultValue={organization.billingLegalName ?? organization.name} maxLength={200} /></label>
              <label><span>{isArabic ? "الرقم الضريبي" : "Tax number"}</span><input name="taxNumber" defaultValue={organization.taxNumber ?? ""} maxLength={80} /></label>
              <label><span>{isArabic ? "البريد المالي" : "Billing email"}</span><input name="billingEmail" type="email" defaultValue={organization.billingEmail ?? "info@bytechjo.com"} maxLength={180} /></label>
              <label><span>{isArabic ? "رقم الهاتف" : "Phone"}</span><input name="billingPhone" defaultValue={organization.billingPhone ?? "+962 77 995 1000"} maxLength={60} /></label>
              <label><span>{isArabic ? "الموقع الإلكتروني" : "Website"}</span><input name="website" defaultValue={organization.website ?? "www.bytechjo.com"} maxLength={180} /></label>
              <label className={styles.wide}><span>{isArabic ? "العنوان" : "Address"}</span><textarea name="billingAddress" defaultValue={organization.billingAddress ?? "Amman | 8th Circle\nPrince Rashid Suburb\nBuilding #78"} maxLength={500} /></label>
            </div>
          </div>

          <div className={styles.documentSettingsSection}>
            <div><h2>{isArabic ? "البيانات البنكية" : "Bank details"}</h2><p>{isArabic ? "تظهر على الفاتورة ليسدد العميل من خلالها." : "Shown on invoices so clients know where to pay."}</p></div>
            <div className={styles.formGrid}>
              <label><span>{isArabic ? "اسم البنك" : "Bank name"}</span><input name="bankName" defaultValue={organization.bankName ?? ""} maxLength={160} /></label>
              <label><span>{isArabic ? "اسم الحساب" : "Account name"}</span><input name="bankAccountName" defaultValue={organization.bankAccountName ?? ""} maxLength={200} /></label>
              <label><span>{isArabic ? "رقم الحساب" : "Account number"}</span><input name="bankAccountNumber" defaultValue={organization.bankAccountNumber ?? ""} maxLength={100} /></label>
              <label><span>IBAN</span><input name="bankIban" defaultValue={organization.bankIban ?? ""} maxLength={100} /></label>
              <label><span>SWIFT / BIC</span><input name="bankSwift" defaultValue={organization.bankSwift ?? ""} maxLength={40} /></label>
              <label className={styles.wide}><span>{isArabic ? "شروط الدفع الافتراضية" : "Default payment terms"}</span><textarea name="paymentTerms" defaultValue={organization.paymentTerms ?? "Payment is due by the date shown on the invoice. Please include the invoice number with your transfer."} maxLength={1200} /></label>
            </div>
          </div>

          <button className={styles.primaryButton} type="submit">{isArabic ? "حفظ بيانات الفوترة" : "Save billing details"}</button>
        </form>
      </section>
    </AppShell>
  );
}

