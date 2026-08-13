import Link from "next/link";
import { notFound } from "next/navigation";

import { recordSubscriptionPayment, updateSubscription, updateSubscriptionAllocations } from "@/actions/financial-operations";
import { AppShell } from "@/components/app-shell";
import { FormFeedback } from "@/components/form-feedback";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { requirePagePermission } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { monthlySubscriptionAmount, nextSubscriptionDueDate } from "@/lib/subscriptions";

import styles from "../../operations.module.css";

function money(value: number, lang: string) {
  return new Intl.NumberFormat(lang === "ar" ? "ar-JO" : "en-JO", { style: "currency", currency: "JOD", maximumFractionDigits: 2 }).format(value);
}

function formatDate(date: Date | null, lang: string) {
  if (!date) return "—";
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-JO" : "en-GB", { dateStyle: "medium" }).format(date);
}

function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default async function SubscriptionDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; subscriptionId: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { lang, subscriptionId } = await params;
  const query = await searchParams;
  if (!isLocale(lang)) notFound();
  const user = await requirePagePermission(lang, "subscriptions.manage");
  const dictionary = getDictionary(lang);
  const isArabic = lang === "ar";

  const [subscription, projects] = await Promise.all([
    prisma.subscription.findFirst({
      where: { id: subscriptionId, organizationId: user.organizationId! },
      include: {
        allocations: { include: { project: { include: { client: true } } } },
        expenses: { orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }] },
      },
    }),
    prisma.project.findMany({
      where: { organizationId: user.organizationId!, status: { not: "CANCELLED" } },
      include: { client: true },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!subscription) notFound();

  const allocationByProject = new Map(subscription.allocations.map((allocation) => [allocation.projectId, Number(allocation.allocationPercent)]));
  const allocationTotal = subscription.allocations.reduce((sum, allocation) => sum + Number(allocation.allocationPercent), 0);
  const monthly = monthlySubscriptionAmount(Number(subscription.amount), subscription.frequency);
  const nextDue = subscription.isActive ? nextSubscriptionDueDate(subscription) : null;
  const totalPaid = subscription.expenses.reduce((sum, expense) => sum + Number(expense.amount) + Number(expense.taxAmount), 0);

  return (
    <AppShell activeSection="subscriptions" alternateHref={`/${lang === "en" ? "ar" : "en"}/subscriptions/${subscription.id}`} dictionary={dictionary} locale={lang}>
      <nav className={styles.breadcrumbs} aria-label="Breadcrumb"><Link href={`/${lang}/subscriptions`}>{isArabic ? "الاشتراكات" : "Subscriptions"}</Link><span>/</span><span>{subscription.name}</span></nav>
      <header className={styles.pageHeader}>
        <div><span className={styles.eyebrow}>{isArabic ? "تفاصيل الاشتراك" : "SUBSCRIPTION DETAILS"}</span><h1>{subscription.name}</h1><p>{subscription.vendor} · {subscription.frequency.replaceAll("_", " ")} · {subscription.isActive ? (isArabic ? "نشط" : "Active") : (isArabic ? "غير نشط" : "Inactive")}</p></div>
        <div className={styles.headerActions}><Link className={styles.secondaryButton} href={`/${lang}/subscriptions`}>{isArabic ? "العودة" : "Back"}</Link><Link className={styles.secondaryButton} href={`/${lang}/financials`}>{isArabic ? "الربحية" : "Profitability"}</Link></div>
      </header>

      <FormFeedback error={query.error} success={query.success} />

      <section className={styles.metrics} aria-label="Subscription summary">
        <article><span>{isArabic ? "قيمة الفاتورة" : "Billing amount"}</span><strong>{money(Number(subscription.amount), lang)}</strong><small>{subscription.frequency.replaceAll("_", " ")}</small></article>
        <article><span>{isArabic ? "المكافئ الشهري" : "Monthly equivalent"}</span><strong>{money(monthly, lang)}</strong><small>{isArabic ? "يدخل في توقعات التكلفة" : "Used in cost forecasts"}</small></article>
        <article><span>{isArabic ? "الاستحقاق القادم" : "Next due"}</span><strong>{formatDate(nextDue, lang)}</strong><small>{subscription.autoRenew ? (isArabic ? "تجديد تلقائي" : "Auto-renews") : (isArabic ? "تجديد يدوي" : "Manual renewal")}</small></article>
        <article><span>{isArabic ? "إجمالي المدفوعات" : "Recorded payments"}</span><strong>{money(totalPaid, lang)}</strong><small>{subscription.expenses.length} {isArabic ? "دفعة" : "payments"}</small></article>
      </section>

      <div className={styles.layout}>
        <main className={styles.stack}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>{isArabic ? "بيانات الاشتراك" : "Subscription settings"}</h2><p>{isArabic ? "عدّل دورة الفوترة وحالة الاشتراك." : "Edit the billing cycle and active status."}</p></div><span className={styles.status} data-status={subscription.isActive ? "ACTIVE" : "INACTIVE"}>{subscription.isActive ? "ACTIVE" : "INACTIVE"}</span></div>
            <form action={updateSubscription} className={styles.form}>
              <input name="locale" type="hidden" value={lang} /><input name="subscriptionId" type="hidden" value={subscription.id} />
              <div className={styles.formGrid}>
                <label><span>{isArabic ? "اسم الاشتراك" : "Subscription name"}</span><input name="name" defaultValue={subscription.name} maxLength={160} required /></label>
                <label><span>{isArabic ? "المورد" : "Vendor"}</span><input name="vendor" defaultValue={subscription.vendor} maxLength={160} required /></label>
                <label><span>{isArabic ? "التصنيف" : "Category"}</span><select name="category" defaultValue={subscription.category}><option>Software</option><option>Hosting</option><option>Communications</option><option>Office</option><option>Marketing</option><option>Professional services</option><option>Other</option></select></label>
                <label><span>{isArabic ? "المبلغ" : "Amount"}</span><input name="amount" type="number" min="0.01" step="0.01" defaultValue={Number(subscription.amount)} required /></label>
                <label><span>{isArabic ? "التكرار" : "Frequency"}</span><select name="frequency" defaultValue={subscription.frequency}><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option><option value="SEMI_ANNUAL">Semi-annual</option><option value="ANNUAL">Annual</option><option value="ONE_TIME">One time</option></select></label>
                <label><span>{isArabic ? "يوم الاستحقاق" : "Due day"}</span><input name="dueDay" type="number" min="1" max="31" defaultValue={subscription.dueDay ?? ""} /></label>
                <label><span>{isArabic ? "تاريخ البداية" : "Start date"}</span><input name="startsOn" type="date" defaultValue={dateInputValue(subscription.startsOn)} required /></label>
                <label><span>{isArabic ? "تاريخ النهاية" : "End date"}</span><input name="endsOn" type="date" defaultValue={subscription.endsOn ? dateInputValue(subscription.endsOn) : ""} /></label>
              </div>
              <div className={styles.actionRow}><label className={styles.checkbox}><input name="autoRenew" type="checkbox" defaultChecked={subscription.autoRenew} /><span>{isArabic ? "يتجدد تلقائياً" : "Auto-renews"}</span></label><label className={styles.checkbox}><input name="isActive" type="checkbox" defaultChecked={subscription.isActive} /><span>{isArabic ? "اشتراك نشط" : "Active subscription"}</span></label></div>
              <button className={styles.primaryButton} type="submit">{isArabic ? "حفظ البيانات" : "Save settings"}</button>
            </form>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>{isArabic ? "توزيع التكلفة" : "Project allocation"}</h2><p>{isArabic ? "وزّع حتى 100%، وأي نسبة متبقية تُحسب كمصاريف عامة." : "Allocate up to 100%; the remainder stays as overhead."}</p></div></div>
            <form action={updateSubscriptionAllocations} className={styles.form}>
              <input name="locale" type="hidden" value={lang} /><input name="subscriptionId" type="hidden" value={subscription.id} />
              {projects.length ? projects.map((project) => (
                <label className={styles.allocationRow} key={project.id}><span>{project.name}<small>{project.client.name}</small></span><input aria-label={`${project.name} allocation`} name={`allocation_${project.id}`} type="number" min="0" max="100" step="0.01" defaultValue={allocationByProject.get(project.id) ?? 0} /></label>
              )) : <p className={styles.empty}>{isArabic ? "لا توجد مشاريع متاحة للتوزيع." : "No projects are available for allocation."}</p>}
              <div className={styles.allocationTotal}><span>{isArabic ? "التوزيع الحالي" : "Current allocation"}</span><strong>{allocationTotal.toFixed(2)}% · {Math.max(100 - allocationTotal, 0).toFixed(2)}% {isArabic ? "عام" : "overhead"}</strong></div>
              <button className={styles.primaryButton} type="submit">{isArabic ? "حفظ التوزيع" : "Save allocation"}</button>
            </form>
          </section>
        </main>

        <aside className={styles.stack}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>{isArabic ? "تسجيل دفعة" : "Record payment"}</h2><p>{isArabic ? "تُحفظ كعملية مدفوعة مرتبطة بالاشتراك." : "Creates a paid expense linked to this subscription."}</p></div></div>
            <form action={recordSubscriptionPayment} className={styles.form}>
              <input name="locale" type="hidden" value={lang} /><input name="subscriptionId" type="hidden" value={subscription.id} />
              <label><span>{isArabic ? "تاريخ الدفع" : "Payment date"}</span><input name="expenseDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
              <div className={styles.formGrid}><label><span>{isArabic ? "المبلغ" : "Amount"}</span><input name="amount" type="number" min="0.01" step="0.01" defaultValue={Number(subscription.amount)} required /></label><label><span>{isArabic ? "الضريبة" : "Tax"}</span><input name="taxAmount" type="number" min="0" step="0.01" defaultValue="0" required /></label></div>
              <label><span>{isArabic ? "رابط الإيصال" : "Receipt URL"}</span><input name="receiptUrl" type="url" placeholder="https://" /></label>
              <button className={styles.paidButton} type="submit">{isArabic ? "تسجيل كمدفوع" : "Record as paid"}</button>
            </form>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>{isArabic ? "سجل الدفعات" : "Payment history"}</h2><p>{subscription.expenses.length} {isArabic ? "دفعة مسجلة" : "recorded payments"}</p></div></div>
            {subscription.expenses.length ? <dl className={styles.infoList}>{subscription.expenses.map((expense) => <div key={expense.id}><dt>{formatDate(expense.expenseDate, lang)}<small>{expense.receiptUrl ? (isArabic ? " · إيصال" : " · Receipt") : ""}</small></dt><dd>{money(Number(expense.amount) + Number(expense.taxAmount), lang)}</dd></div>)}</dl> : <p className={styles.empty}>{isArabic ? "لا توجد دفعات مسجلة." : "No payments have been recorded."}</p>}
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
