import { notFound } from "next/navigation";

import { createRole } from "@/actions/organization";
import { AppShell } from "@/components/app-shell";
import { FormFeedback } from "@/components/form-feedback";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { requirePagePermission } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

import managementStyles from "../management.module.css";
import styles from "../section-page.module.css";

export default async function RolesPage({ params, searchParams }: { params: Promise<{ lang: string }>; searchParams: Promise<{ error?: string; success?: string }> }) {
  const { lang } = await params;
  const feedback = await searchParams;
  if (!isLocale(lang)) notFound();
  const user = await requirePagePermission(lang, "roles.read");
  const dictionary = getDictionary(lang);
  const isArabic = lang === "ar";
  const [roles, permissions] = await Promise.all([
    prisma.role.findMany({
      where: { organizationId: user.organizationId! },
      include: { permissions: { include: { permission: true } }, _count: { select: { assignments: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.permission.findMany({ orderBy: { key: "asc" } }),
  ]);

  return (
    <AppShell activeSection="roles" dictionary={dictionary} locale={lang}>
      <div className={styles.headingRow}>
        <div><h1>{isArabic ? "الأدوار والصلاحيات" : "Roles & permissions"}</h1><p className={styles.subtitle}>{isArabic ? "التحكم بما يستطيع كل مستخدم رؤيته وتنفيذه" : "Control what each user can view and manage"}</p></div>
      </div>
      <FormFeedback error={feedback.error} success={feedback.success} />
      <div className={managementStyles.layout}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><h2>{isArabic ? "الأدوار الحالية" : "Current roles"}</h2></div>
          <div className={managementStyles.roleList}>{roles.map((role) => <article className={managementStyles.roleCard} key={role.id}><strong>{role.name} {role.isSystem ? "· System" : ""}</strong><span>{role._count.assignments} {isArabic ? "مستخدم" : "users"} · {role.permissions.length} {isArabic ? "صلاحية" : "permissions"}</span><span>{role.permissions.map(({ permission }) => permission.name).join(" · ")}</span></article>)}</div>
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><h2>{isArabic ? "إنشاء دور" : "Create role"}</h2></div>
          <form action={createRole} className={managementStyles.form}>
            <input name="locale" type="hidden" value={lang} />
            <label><span>{isArabic ? "اسم الدور" : "Role name"}</span><input name="name" maxLength={120} required /></label>
            <label><span>{isArabic ? "الوصف" : "Description"}</span><textarea name="description" maxLength={300} /></label>
            <div className={managementStyles.fieldGroup}><span>{isArabic ? "الصلاحيات" : "Permissions"}</span><div className={managementStyles.checkboxes}>{permissions.map((permission) => <label key={permission.id}><input name="permissionId" type="checkbox" value={permission.id} /><span>{permission.name}</span></label>)}</div></div>
            <button className={styles.button} type="submit">{isArabic ? "حفظ الدور" : "Save role"}</button>
          </form>
        </section>
      </div>
    </AppShell>
  );
}
