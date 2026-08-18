import Link from "next/link";
import { notFound } from "next/navigation";

import { createSubscription } from "@/actions/financial-operations";
import { AppShell } from "@/components/app-shell";
import { FormFeedback } from "@/components/form-feedback";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { requirePagePermission } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { calendarDaysBetween, monthlySubscriptionAmount, nextSubscriptionDueDate } from "@/lib/subscriptions";

import styles from "../operations.module.css";

function money(value: number, lang: string) {
  return new Intl.NumberFormat(lang === "ar" ? "ar-JO" : "en-JO", {
    style: "currency",
    currency: "JOD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(date: Date | null, lang: string) {
  if (!date) return "—";
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-JO" : "en-GB", { dateStyle: "medium" }).format(date);
}

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

export default async function SubscriptionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { lang } = await params;
  const query = await searchParams;
  if (!isLocale(lang)) notFound();
  const user = await requirePagePermission(lang, "subscriptions.manage");
  const dictionary = getDictionary(lang);
  const isArabic = lang === "ar";

  const subscriptions = await prisma.subscription.findMany({
    where: { organizationId: user.organizationId! },
    include: {
      allocations: true,
      expenses: { where: { status: "PAID" }, orderBy: { expenseDate: "desc" }, take: 1 },
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  const today = new Date();
  const active = subscriptions.filter((subscription) => subscription.isActive);
  const monthlyTotal = active.reduce((sum, subscription) => sum + monthlySubscriptionAmount(Number(subscription.amount), subscription.frequency), 0);
  const dueSoon = active.filter((subscription) => {
    const due = nextSubscriptionDueDate(subscription, today);
    if (!due) return false;
    const days = calendarDaysBetween(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())), due);
    return days >= 0 && days <= 7;
  }).length;
  const allocatedMonthly = active.reduce((sum, subscription) => {
    const percent = subscription.allocations.reduce((allocationSum, allocation) => allocationSum + Number(allocation.allocationPercent), 0);
    return sum + monthlySubscriptionAmount(Number(subscription.amount), subscription.frequency) * Math.min(percent, 100) / 100;
  }, 0);

  return (
    <AppShell activeSection="subscriptions" alternateHref={`/${lang === "en" ? "ar" : "en"}/subscriptions`} dictionary={dictionary} locale={lang}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>{isArabic ? "التكاليف المتكررة" : "RECURRING COSTS"}</span>
          <h1>{isArabic ? "الاشتراكات" : "Subscriptions"}</h1>
          <p>{isArabic ? "تابع الاستحقاقات، سجّل الدفعات، ووزّع تكلفة الاشتراكات على المشاريع." : "Track due dates, record payments, and allocate subscription cost to projects."}</p>
        </div>
        <div className={styles.headerActions}>
          <Link className={styles.secondaryButton} href={`/${lang}/financials`}>{isArabic ? "لوحة الربحية" : "Profitability"}</Link>
          <Link className={styles.secondaryButton} href={`/${lang}/expenses`}>{isArabic ? "المصاريف" : "Expenses"}</Link>
        </div>
      </header>

      <FormFeedback error={query.error} success={query.success} />

      <section className={styles.metrics} aria-label="Subscription metrics">
        <article><span>{isArabic ? "اشتراكات نشطة" : "Active subscriptions"}</span><strong>{active.length}</strong><small>{subscriptions.length} {isArabic ? "سجل إجمالي" : "total records"}</small></article>
        <article><span>{isArabic ? "المكافئ الشهري" : "Monthly equivalent"}</span><strong>{money(monthlyTotal, lang)}</strong><small>{isArabic ? "تكلفة شهرية محسوبة" : "Normalized monthly cost"}</small></article>
        <article><span>{isArabic ? "مستحقة خلال 7 أيام" : "Due within 7 days"}</span><strong>{dueSoon}</strong><small>{isArabic ? "تحتاج متابعة" : "Need attention"}</small></article>
        <article><span>{isArabic ? "موزّع على المشاريع" : "Allocated to projects"}</span><strong>{money(allocatedMonthly, lang)}</strong><small>{money(Math.max(monthlyTotal - allocatedMonthly, 0), lang)} {isArabic ? "عام" : "overhead"}</small></article>
      </section>

      <div className={styles.layout}>
        <main className={styles.stack}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>{isArabic ? "سجل الاشتراكات" : "Subscription register"}</h2><p>{isArabic ? "افتح أي سجل لتعديل البيانات والتوزيع والدفعات." : "Open a record to manage details, allocations, and payments."}</p></div></div>
            {subscriptions.length ? (
              <div className={styles.cardList}>
                {subscriptions.map((subscription) => {
                  const nextDue = subscription.isActive ? nextSubscriptionDueDate(subscription, today) : null;
                  const allocationPercent = subscription.allocations.reduce((sum, allocation) => sum + Number(allocation.allocationPercent), 0);
                  const monthly = monthlySubscriptionAmount(Number(subscription.amount), subscription.frequency);
                  return (
                    <Link className={styles.subscriptionCard} href={`/${lang}/subscriptions/${subscription.id}`} key={subscription.id}>
                      <div><strong>{subscription.name}</strong><small>{subscription.vendor} · {subscription.category}</small></div>
                      <div><strong>{subscription.frequency === "ONE_TIME" ? money(Number(subscription.amount), lang) : money(monthly, lang)}</strong><small>{subscription.frequency === "ONE_TIME" ? (isArabic ? "مرة واحدة" : "one time") : (isArabic ? "شهرياً" : "monthly equivalent")}</small></div>
                      <div><strong>{formatDate(nextDue, lang)}</strong><small>{isArabic ? "الاستحقاق القادم" : "next due"}</small></div>
                      <div><span className={styles.status} data-status={subscription.isActive ? "ACTIVE" : "INACTIVE"}>{subscription.isActive ? "ACTIVE" : "INACTIVE"}</span><small>{allocationPercent.toFixed(0)}% {isArabic ? "موزّع" : "allocated"}</small></div>
                    </Link>
                  );
                })}
              </div>
            ) : <p className={styles.empty}>{isArabic ? "لا توجد اشتراكات بعد." : "No subscriptions yet."}</p>}
          </section>
        </main>

        <aside className={styles.stack}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>{isArabic ? "اشتراك جديد" : "New subscription"}</h2><p>{isArabic ? "أضف التكلفة وموعد بدايتها." : "Add the cost and its billing schedule."}</p></div></div>
            <form action={createSubscription} className={styles.form}>
              <input name="locale" type="hidden" value={lang} />
              <div className={styles.formGrid}>
                <label><span>{isArabic ? "اسم الاشتراك" : "Subscription name"}</span><input name="name" maxLength={160} required /></label>
                <label><span>{isArabic ? "المورد" : "Vendor"}</span><input name="vendor" maxLength={160} required /></label>
                <label><span>{isArabic ? "التصنيف" : "Category"}</span><select name="category" defaultValue="Software"><option>Software</option><option>Hosting</option><option>Communications</option><option>Office</option><option>Marketing</option><option>Professional services</option><option>Other</option></select></label>
                <label><span>{isArabic ? "المبلغ" : "Amount"}</span><input name="amount" type="number" min="0.01" step="0.01" required /></label>
                <label><span>{isArabic ? "التكرار" : "Frequency"}</span><select name="frequency" defaultValue="MONTHLY"><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option><option value="SEMI_ANNUAL">Semi-annual</option><option value="ANNUAL">Annual</option><option value="ONE_TIME">One time</option></select></label>
                <label><span>{isArabic ? "يوم الاستحقاق" : "Due day"}</span><input name="dueDay" type="number" min="1" max="31" placeholder="1-31" /></label>
                <label><span>{isArabic ? "تاريخ البداية" : "Start date"}</span><input name="startsOn" type="date" defaultValue={todayValue()} required /></label>
                <label><span>{isArabic ? "تاريخ النهاية" : "End date"}</span><input name="endsOn" type="date" /></label>
              </div>
              <label className={styles.checkbox}><input name="autoRenew" type="checkbox" /><span>{isArabic ? "يتجدد تلقائياً" : "Auto-renews"}</span></label>
              <button className={styles.primaryButton} type="submit">{isArabic ? "إضافة الاشتراك" : "Add subscription"}</button>
            </form>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
