import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/actions/projects";
import { AppShell } from "@/components/app-shell";
import { FormFeedback } from "@/components/form-feedback";
import { Pagination } from "@/components/pagination";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { permissionKeysFor, requirePagePermission } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PAGE_SIZE, pageNumber } from "@/lib/pagination";

import projectStyles from "../project-management.module.css";
import styles from "../section-page.module.css";

export default async function ClientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ error?: string; page?: string; success?: string }>;
}) {
  const { lang } = await params;
  const feedback = await searchParams;
  if (!isLocale(lang)) notFound();
  const user = await requirePagePermission(lang, "clients.read");
  const dictionary = getDictionary(lang);
  const isArabic = lang === "ar";
  const canWrite = permissionKeysFor(user).has("clients.write");
  const currentPage = pageNumber(feedback.page);
  const clientRows = await prisma.client.findMany({
    where: { organizationId: user.organizationId! },
    select: {
      id: true,
      name: true,
      legalName: true,
      email: true,
      phone: true,
      taxNumber: true,
      isActive: true,
      _count: { select: { projects: true } },
    },
    orderBy: { name: "asc" },
    skip: (currentPage - 1) * DEFAULT_PAGE_SIZE,
    take: DEFAULT_PAGE_SIZE + 1,
  });
  const hasNextPage = clientRows.length > DEFAULT_PAGE_SIZE;
  const clients = clientRows.slice(0, DEFAULT_PAGE_SIZE);

  return (
    <AppShell activeSection="clients" dictionary={dictionary} locale={lang}>
      <div className={styles.headingRow}>
        <div><h1>{isArabic ? "العملاء" : "Clients"}</h1><p className={styles.subtitle}>{isArabic ? "بيانات العملاء والمشاريع المرتبطة بهم" : "Client records and their connected projects"}</p></div>
      </div>
      <FormFeedback error={feedback.error} success={feedback.success} />
      <div className={canWrite ? projectStyles.twoColumn : undefined}>
        <section className={`${styles.panel} ${styles.tableWrap}`}>
          {clients.length ? (
            <table className={styles.table}>
              <thead><tr><th>{isArabic ? "العميل" : "Client"}</th><th>{isArabic ? "التواصل" : "Contact"}</th><th>{isArabic ? "الرقم الضريبي" : "Tax number"}</th><th>{isArabic ? "المشاريع" : "Projects"}</th><th>{isArabic ? "الحالة" : "Status"}</th>{canWrite ? <th>{isArabic ? "الإجراء" : "Action"}</th> : null}</tr></thead>
              <tbody>{clients.map((client) => <tr key={client.id}><td><strong>{client.name}</strong><span className={styles.secondaryText}>{client.legalName ?? "—"}</span></td><td>{client.email ?? client.phone ?? "—"}</td><td>{client.taxNumber ?? "—"}</td><td>{client._count.projects}</td><td><span className={styles.badge}>{client.isActive ? (isArabic ? "نشط" : "Active") : (isArabic ? "غير نشط" : "Inactive")}</span></td>{canWrite ? <td><Link className={styles.secondaryButton} href={`/${lang}/clients/${client.id}`}>{isArabic ? "تعديل" : "Edit"}</Link></td> : null}</tr>)}</tbody>
            </table>
          ) : <p className={projectStyles.empty}>{isArabic ? "لا يوجد عملاء بعد. أضف أول عميل للبدء بمشروع." : "No clients yet. Add the first client to start a project."}</p>}
          <Pagination basePath={`/${lang}/clients`} currentPage={currentPage} hasNextPage={hasNextPage} isArabic={isArabic} />
        </section>
        {canWrite ? <section className={styles.panel}>
          <div className={styles.panelHeader}><h2>{isArabic ? "إضافة عميل" : "Add client"}</h2></div>
          <form action={createClient} className={projectStyles.form}>
            <input name="locale" type="hidden" value={lang} />
            <label><span>{isArabic ? "اسم العميل" : "Client name"}</span><input name="name" maxLength={160} required /></label>
            <label><span>{isArabic ? "الاسم القانوني" : "Legal name"}</span><input name="legalName" maxLength={200} /></label>
            <label><span>{isArabic ? "البريد الإلكتروني" : "Email"}</span><input name="email" type="email" /></label>
            <label><span>{isArabic ? "الهاتف" : "Phone"}</span><input name="phone" maxLength={40} /></label>
            <label><span>{isArabic ? "الرقم الضريبي" : "Tax number"}</span><input name="taxNumber" maxLength={60} /></label>
            <button className={styles.button} type="submit">{isArabic ? "حفظ العميل" : "Save client"}</button>
          </form>
        </section> : null}
      </div>
    </AppShell>
  );
}
