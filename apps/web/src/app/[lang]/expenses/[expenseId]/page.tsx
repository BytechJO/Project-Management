import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { updateExpense } from "@/actions/financial-operations";
import { AppShell } from "@/components/app-shell";
import { FormFeedback } from "@/components/form-feedback";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { permissionKeysFor, requireUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { projectAccessScope } from "@/lib/security-policy";

import styles from "../../operations.module.css";

function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function money(value: number, lang: string) {
  return new Intl.NumberFormat(lang === "ar" ? "ar-JO" : "en-JO", {
    style: "currency",
    currency: "JOD",
    maximumFractionDigits: 2,
  }).format(value);
}

export default async function ExpenseDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; expenseId: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { lang, expenseId } = await params;
  const query = await searchParams;
  if (!isLocale(lang)) notFound();

  const user = await requireUser(lang);
  const dictionary = getDictionary(lang);
  const permissions = permissionKeysFor(user);
  const canUseExpenses = permissions.has("expenses.own") || permissions.has("expenses.approve");
  if (!canUseExpenses) redirect(`/${lang}`);
  const canViewAll = permissions.has("expenses.approve") || permissions.has("financials.read");

  const expense = await prisma.expense.findFirst({
    where: {
      id: expenseId,
      organizationId: user.organizationId!,
      ...(canViewAll ? {} : { submittedById: user.id }),
    },
    include: { project: true, client: true, submittedBy: true, approvedBy: true, subscription: true },
  });
  if (!expense) notFound();

  const [projects, clients] = await Promise.all([
    prisma.project.findMany({
      where: {
        organizationId: user.organizationId!,
        status: { not: "CANCELLED" },
        ...projectAccessScope(user.id, canViewAll ? "all" : "assigned"),
      },
      include: { client: true },
      orderBy: { name: "asc" },
    }),
    canViewAll
      ? prisma.client.findMany({ where: { organizationId: user.organizationId!, isActive: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
  ]);

  const isArabic = lang === "ar";
  const canEdit = ["DRAFT", "REJECTED"].includes(expense.status)
    && (canViewAll || expense.submittedById === user.id)
    && !expense.subscriptionId;
  const total = Number(expense.amount) + Number(expense.taxAmount);

  return (
    <AppShell activeSection="expenses" alternateHref={`/${lang === "en" ? "ar" : "en"}/expenses/${expense.id}`} dictionary={dictionary} locale={lang}>
      <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
        <Link href={`/${lang}/expenses`}>{isArabic ? "المصاريف" : "Expenses"}</Link>
        <span>/</span>
        <span>{expense.description}</span>
      </nav>

      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>{isArabic ? "تفاصيل المصروف" : "EXPENSE DETAILS"}</span>
          <h1>{expense.description}</h1>
          <p>{expense.submittedBy.name} · {money(total, lang)} · {expense.status.replaceAll("_", " ")}</p>
        </div>
        <Link className={styles.secondaryButton} href={`/${lang}/expenses`}>{isArabic ? "العودة للمصاريف" : "Back to expenses"}</Link>
      </header>

      <FormFeedback error={query.error} success={query.success} />

      <div className={styles.layout}>
        <main className={styles.stack}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <h2>{canEdit ? (isArabic ? "تعديل المصروف" : "Edit expense") : (isArabic ? "بيانات المصروف" : "Expense information")}</h2>
                <p>{canEdit ? (isArabic ? "يمكن تعديل المسودة أو المصروف المرفوض فقط." : "Only draft and rejected expenses can be changed.") : (isArabic ? "هذا السجل للعرض فقط في حالته الحالية." : "This record is read-only in its current status.")}</p>
              </div>
              <span className={styles.status} data-status={expense.status}>{expense.status}</span>
            </div>

            {canEdit ? (
              <form action={updateExpense} className={styles.form}>
                <input name="locale" type="hidden" value={lang} />
                <input name="expenseId" type="hidden" value={expense.id} />
                <label>
                  <span>{isArabic ? "المشروع" : "Project"}</span>
                  <select name="projectId" defaultValue={expense.projectId ?? ""} required={!canViewAll}>
                    <option value="">{canViewAll ? (isArabic ? "مصروف عام" : "Overhead expense") : "—"}</option>
                    {projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {project.client.name}</option>)}
                  </select>
                </label>
                {canViewAll ? (
                  <label>
                    <span>{isArabic ? "العميل (للمصروف العام)" : "Client (for overhead)"}</span>
                    <select name="clientId" defaultValue={expense.clientId ?? ""}>
                      <option value="">—</option>
                      {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                    </select>
                  </label>
                ) : null}
                <div className={styles.formGrid}>
                  <label><span>{isArabic ? "المورد" : "Vendor"}</span><input name="vendor" defaultValue={expense.vendor ?? ""} maxLength={160} /></label>
                  <label><span>{isArabic ? "التصنيف" : "Category"}</span><select name="category" defaultValue={expense.category}><option>Software</option><option>Travel</option><option>Office</option><option>Equipment</option><option>Marketing</option><option>Professional services</option><option>Other</option></select></label>
                </div>
                <label><span>{isArabic ? "الوصف" : "Description"}</span><textarea name="description" defaultValue={expense.description} maxLength={1000} required /></label>
                <div className={styles.formGrid}>
                  <label><span>{isArabic ? "التاريخ" : "Expense date"}</span><input name="expenseDate" type="date" defaultValue={dateInputValue(expense.expenseDate)} required /></label>
                  <label><span>{isArabic ? "المبلغ" : "Amount"}</span><input name="amount" type="number" min="0.01" step="0.01" defaultValue={Number(expense.amount)} required /></label>
                  <label><span>{isArabic ? "الضريبة" : "Tax"}</span><input name="taxAmount" type="number" min="0" step="0.01" defaultValue={Number(expense.taxAmount)} required /></label>
                  <label><span>{isArabic ? "رابط الإيصال" : "Receipt URL"}</span><input name="receiptUrl" type="url" defaultValue={expense.receiptUrl ?? ""} placeholder="https://" /></label>
                </div>
                <div className={styles.actionRow}>
                  <button className={styles.secondaryButton} name="intent" value="draft" type="submit">{isArabic ? "حفظ التعديلات" : "Save changes"}</button>
                  <button className={styles.primaryButton} name="intent" value="submit" type="submit">{isArabic ? "حفظ وإرسال" : "Save & submit"}</button>
                </div>
              </form>
            ) : (
              <dl className={styles.infoList}>
                <div><dt>{isArabic ? "المشروع" : "Project"}</dt><dd>{expense.project?.name ?? (isArabic ? "مصروف عام" : "Overhead")}</dd></div>
                <div><dt>{isArabic ? "العميل" : "Client"}</dt><dd>{expense.client?.name ?? "—"}</dd></div>
                <div><dt>{isArabic ? "المورد" : "Vendor"}</dt><dd>{expense.vendor ?? "—"}</dd></div>
                <div><dt>{isArabic ? "التصنيف" : "Category"}</dt><dd>{expense.category}</dd></div>
                <div><dt>{isArabic ? "المبلغ قبل الضريبة" : "Amount before tax"}</dt><dd>{money(Number(expense.amount), lang)}</dd></div>
                <div><dt>{isArabic ? "الضريبة" : "Tax"}</dt><dd>{money(Number(expense.taxAmount), lang)}</dd></div>
                <div><dt>{isArabic ? "المعتمد بواسطة" : "Approved by"}</dt><dd>{expense.approvedBy?.name ?? "—"}</dd></div>
              </dl>
            )}
            {expense.rejectionReason ? <p className={styles.rejection}>{isArabic ? "سبب الرفض: " : "Rejection reason: "}{expense.rejectionReason}</p> : null}
          </section>
        </main>

        <aside className={styles.stack}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>{isArabic ? "المستندات" : "Documents"}</h2><p>{isArabic ? "الإيصال المرتبط بالمصروف" : "Receipt linked to this expense"}</p></div></div>
            {expense.receiptUrl ? <a className={styles.secondaryButton} href={expense.receiptUrl} rel="noreferrer" target="_blank">{isArabic ? "فتح الإيصال" : "Open receipt"}</a> : <p className={styles.empty}>{isArabic ? "لم يتم إرفاق إيصال." : "No receipt was attached."}</p>}
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
