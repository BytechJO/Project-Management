import { notFound } from "next/navigation";

import { createDepartment } from "@/actions/organization";
import { AppShell } from "@/components/app-shell";
import { FormFeedback } from "@/components/form-feedback";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { requirePagePermission } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

import managementStyles from "../management.module.css";
import styles from "../section-page.module.css";

export default async function DepartmentsPage({ params, searchParams }: { params: Promise<{ lang: string }>; searchParams: Promise<{ error?: string; success?: string }> }) {
  const { lang } = await params;
  const feedback = await searchParams;
  if (!isLocale(lang)) notFound();
  const user = await requirePagePermission(lang, "departments.read");
  const dictionary = getDictionary(lang);
  const isArabic = lang === "ar";
  const departments = await prisma.department.findMany({
    where: { organizationId: user.organizationId! },
    include: { _count: { select: { employees: true } }, manager: true },
    orderBy: { name: "asc" },
  });

  return (
    <AppShell activeSection="departments" dictionary={dictionary} locale={lang}>
      <div className={styles.headingRow}>
        <div><h1>{isArabic ? "الأقسام" : "Departments"}</h1><p className={styles.subtitle}>{isArabic ? "هيكل فرق شركة بايتك" : "Bytech team structure"}</p></div>
      </div>
      <FormFeedback error={feedback.error} success={feedback.success} />
      <div className={managementStyles.layout}>
        <section className={`${styles.panel} ${styles.tableWrap}`}>
          <table className={styles.table}>
            <thead><tr><th>{isArabic ? "القسم" : "Department"}</th><th>{isArabic ? "الرمز" : "Code"}</th><th>{isArabic ? "المدير" : "Manager"}</th><th>{isArabic ? "الموظفون" : "Employees"}</th></tr></thead>
            <tbody>{departments.map((department) => <tr key={department.id}><td><strong>{department.name}</strong></td><td>{department.code ?? "—"}</td><td>{department.manager?.name ?? "—"}</td><td>{department._count.employees}</td></tr>)}</tbody>
          </table>
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><h2>{isArabic ? "إضافة قسم" : "Add department"}</h2></div>
          <form action={createDepartment} className={managementStyles.form}>
            <input name="locale" type="hidden" value={lang} />
            <label><span>{isArabic ? "اسم القسم" : "Department name"}</span><input name="name" maxLength={120} required /></label>
            <label><span>{isArabic ? "الرمز" : "Code"}</span><input name="code" maxLength={12} placeholder="DEV" required /></label>
            <button className={styles.button} type="submit">{isArabic ? "حفظ القسم" : "Save department"}</button>
          </form>
        </section>
      </div>
    </AppShell>
  );
}
