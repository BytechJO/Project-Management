import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createExpense, markExpensePaid, reviewExpense, submitExpense } from "@/actions/financial-operations";
import { AppShell } from "@/components/app-shell";
import { FormFeedback } from "@/components/form-feedback";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { permissionKeysFor, requireUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { projectAccessScope } from "@/lib/security-policy";

import styles from "../operations.module.css";

const statusOptions = ["ALL", "DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "PAID"] as const;

function money(value: number, lang: string) {
  return new Intl.NumberFormat(lang === "ar" ? "ar-JO" : "en-JO", { style: "currency", currency: "JOD", maximumFractionDigits: 2 }).format(value);
}

function formatDate(date: Date, lang: string) {
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-JO" : "en-GB", { dateStyle: "medium" }).format(date);
}

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

export default async function ExpensesPage({
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
  const canCreate = permissions.has("expenses.own") || permissions.has("expenses.approve");
  const canReview = permissions.has("expenses.approve");
  const canViewAll = canReview || permissions.has("financials.read");
  if (!canCreate) redirect(`/${lang}?error=${encodeURIComponent("You do not have permission to open expenses.")}`);
  const isArabic = lang === "ar";
  const selectedStatus = statusOptions.includes(query.status as (typeof statusOptions)[number]) ? query.status! : "ALL";

  const [expenses, projects, clients] = await Promise.all([
    prisma.expense.findMany({
      where: { organizationId: user.organizationId!, ...(canViewAll ? {} : { submittedById: user.id }) },
      include: { project: true, client: true, submittedBy: true, approvedBy: true, subscription: true },
      orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
    }),
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

  const visibleExpenses = selectedStatus === "ALL" ? expenses : expenses.filter((expense) => expense.status === selectedStatus);
  const totals = expenses.reduce((result, expense) => {
    const total = Number(expense.amount) + Number(expense.taxAmount);
    if (expense.status === "SUBMITTED") result.pending += total;
    if (["APPROVED", "PAID"].includes(expense.status)) result.approved += total;
    if (expense.status === "PAID") result.paid += total;
    return result;
  }, { pending: 0, approved: 0, paid: 0 });

  return (
    <AppShell activeSection="expenses" alternateHref={`/${lang === "en" ? "ar" : "en"}/expenses`} dictionary={dictionary} locale={lang}>
      <header className={styles.pageHeader}>
        <div><span className={styles.eyebrow}>{isArabic ? "العمليات المالية" : "FINANCIAL OPERATIONS"}</span><h1>{isArabic ? "المصاريف" : "Expenses"}</h1><p>{isArabic ? "سجّل المصروف وأرسله للموافقة وتابع الدفع." : "Capture, submit, approve, and track every expense payment."}</p></div>
        <div className={styles.headerActions}>{permissions.has("financials.read") ? <Link className={styles.secondaryButton} href={`/${lang}/financials`}>{isArabic ? "لوحة الربحية" : "Profitability"}</Link> : null}{permissions.has("subscriptions.manage") ? <Link className={styles.secondaryButton} href={`/${lang}/subscriptions`}>{isArabic ? "الاشتراكات" : "Subscriptions"}</Link> : null}</div>
      </header>

      <FormFeedback error={query.error} success={query.success} />

      <section className={styles.metrics} aria-label="Expense metrics">
        <article><span>{isArabic ? "كل السجلات" : "All records"}</span><strong>{expenses.length}</strong><small>{isArabic ? "ضمن نطاق صلاحيتك" : "Within your access"}</small></article>
        <article><span>{isArabic ? "بانتظار الموافقة" : "Awaiting approval"}</span><strong>{money(totals.pending, lang)}</strong><small>{expenses.filter((expense) => expense.status === "SUBMITTED").length} {isArabic ? "طلب" : "requests"}</small></article>
        <article><span>{isArabic ? "معتمد" : "Approved"}</span><strong>{money(totals.approved, lang)}</strong><small>{isArabic ? "يدخل في التكلفة الفعلية" : "Included in actual cost"}</small></article>
        <article><span>{isArabic ? "مدفوع" : "Paid"}</span><strong>{money(totals.paid, lang)}</strong><small>{expenses.filter((expense) => expense.status === "PAID").length} {isArabic ? "دفعة" : "payments"}</small></article>
      </section>

      <div className={styles.layout}>
        <main className={styles.stack}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>{isArabic ? "سجل المصاريف" : "Expense register"}</h2><p>{visibleExpenses.length} {isArabic ? "سجل ظاهر" : "visible records"}</p></div><form className={styles.filterRow}><select aria-label="Status filter" name="status" defaultValue={selectedStatus}>{statusOptions.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select><button className={styles.secondaryButton} type="submit">{isArabic ? "تصفية" : "Filter"}</button></form></div>
            {visibleExpenses.length ? <div className={styles.tableWrap}><table className={styles.table}>
              <thead><tr><th>{isArabic ? "المصروف" : "Expense"}</th><th>{isArabic ? "المشروع" : "Project"}</th>{canViewAll ? <th>{isArabic ? "الموظف" : "Employee"}</th> : null}<th>{isArabic ? "التاريخ" : "Date"}</th><th>{isArabic ? "الإجمالي" : "Total"}</th><th>{isArabic ? "الحالة" : "Status"}</th><th>{isArabic ? "الإجراء" : "Action"}</th></tr></thead>
              <tbody>{visibleExpenses.map((expense) => {
                const total = Number(expense.amount) + Number(expense.taxAmount);
                const canEdit = ["DRAFT", "REJECTED"].includes(expense.status) && (canViewAll || expense.submittedById === user.id);
                return <tr key={expense.id}>
                  <td><strong>{expense.description}</strong><small>{expense.vendor ?? "—"} · {expense.category}{expense.subscription ? ` · ${expense.subscription.name}` : ""}</small>{expense.rejectionReason ? <div className={styles.rejection}>{expense.rejectionReason}</div> : null}</td>
                  <td>{expense.project?.name ?? (isArabic ? "مصروف عام" : "Overhead")}</td>
                  {canViewAll ? <td>{expense.submittedBy.name}</td> : null}
                  <td>{formatDate(expense.expenseDate, lang)}</td>
                  <td><strong>{money(total, lang)}</strong><small>{Number(expense.taxAmount) > 0 ? `${isArabic ? "ضريبة" : "Tax"}: ${money(Number(expense.taxAmount), lang)}` : ""}</small></td>
                  <td><span className={styles.status} data-status={expense.status}>{expense.status}</span></td>
                  <td><div className={styles.actionRow}>
                    <Link className={styles.secondaryButton} href={`/${lang}/expenses/${expense.id}`}>{canEdit ? (isArabic ? "تعديل" : "Edit") : (isArabic ? "عرض" : "View")}</Link>
                    {expense.status === "DRAFT" && (canViewAll || expense.submittedById === user.id) ? <form action={submitExpense}><input name="locale" type="hidden" value={lang} /><input name="expenseId" type="hidden" value={expense.id} /><button className={styles.primaryButton} type="submit">{isArabic ? "إرسال" : "Submit"}</button></form> : null}
                    {expense.receiptUrl ? <a className={styles.secondaryButton} href={expense.receiptUrl} rel="noreferrer" target="_blank">{isArabic ? "الإيصال" : "Receipt"}</a> : null}
                    {canReview && expense.status === "SUBMITTED" ? <div className={styles.reviewActions}>
                      <form action={reviewExpense}><input name="locale" type="hidden" value={lang} /><input name="expenseId" type="hidden" value={expense.id} /><button className={styles.approveButton} name="decision" value="APPROVED" type="submit">{isArabic ? "اعتماد" : "Approve"}</button></form>
                      <form action={reviewExpense} className={styles.rejectForm}><input name="locale" type="hidden" value={lang} /><input name="expenseId" type="hidden" value={expense.id} /><input name="rejectionReason" aria-label="Rejection reason" placeholder={isArabic ? "سبب الرفض" : "Rejection reason"} required /><button className={styles.rejectButton} name="decision" value="REJECTED" type="submit">{isArabic ? "رفض" : "Reject"}</button></form>
                    </div> : null}
                    {canReview && expense.status === "APPROVED" ? <form action={markExpensePaid}><input name="locale" type="hidden" value={lang} /><input name="expenseId" type="hidden" value={expense.id} /><button className={styles.paidButton} type="submit">{isArabic ? "تحديد كمدفوع" : "Mark paid"}</button></form> : null}
                  </div></td>
                </tr>;
              })}</tbody>
            </table></div> : <p className={styles.empty}>{isArabic ? "لا توجد مصاريف ضمن هذا الفلتر." : "No expenses match this filter."}</p>}
          </section>
        </main>

        <aside className={styles.stack}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>{isArabic ? "مصروف جديد" : "New expense"}</h2><p>{isArabic ? "احفظه كمسودة أو أرسله مباشرة" : "Save a draft or submit immediately"}</p></div></div>
            <form action={createExpense} className={styles.form}>
              <input name="locale" type="hidden" value={lang} />
              <label><span>{isArabic ? "المشروع" : "Project"}</span><select name="projectId" required={!canViewAll}><option value="">{canViewAll ? (isArabic ? "مصروف عام" : "Overhead expense") : "—"}</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {project.client.name}</option>)}</select></label>
              {canViewAll ? <label><span>{isArabic ? "العميل (للمصروف العام)" : "Client (for overhead)"}</span><select name="clientId"><option value="">—</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label> : null}
              <div className={styles.formGrid}><label><span>{isArabic ? "المورد" : "Vendor"}</span><input name="vendor" maxLength={160} /></label><label><span>{isArabic ? "التصنيف" : "Category"}</span><select name="category" defaultValue="Software"><option>Software</option><option>Travel</option><option>Office</option><option>Equipment</option><option>Marketing</option><option>Professional services</option><option>Other</option></select></label></div>
              <label><span>{isArabic ? "الوصف" : "Description"}</span><textarea name="description" maxLength={1000} required /></label>
              <div className={styles.formGrid}><label><span>{isArabic ? "التاريخ" : "Expense date"}</span><input name="expenseDate" type="date" defaultValue={todayValue()} required /></label><label><span>{isArabic ? "المبلغ" : "Amount"}</span><input name="amount" type="number" min="0.01" step="0.01" required /></label><label><span>{isArabic ? "الضريبة" : "Tax"}</span><input name="taxAmount" type="number" min="0" step="0.01" defaultValue="0" required /></label><label><span>{isArabic ? "رابط الإيصال" : "Receipt URL"}</span><input name="receiptUrl" type="url" placeholder="https://" /></label></div>
              <div className={styles.actionRow}><button className={styles.secondaryButton} name="intent" value="draft" type="submit">{isArabic ? "حفظ مسودة" : "Save draft"}</button><button className={styles.primaryButton} name="intent" value="submit" type="submit">{isArabic ? "حفظ وإرسال" : "Save & submit"}</button></div>
            </form>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
