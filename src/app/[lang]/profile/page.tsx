import { notFound } from "next/navigation";

import { updateProfile } from "@/actions/profile";
import { AppShell } from "@/components/app-shell";
import { FormFeedback } from "@/components/form-feedback";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { requireUser } from "@/lib/dal";

import managementStyles from "../management.module.css";
import profileStyles from "./profile.module.css";
import styles from "../section-page.module.css";

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { lang } = await params;
  const feedback = await searchParams;
  if (!isLocale(lang)) notFound();
  const user = await requireUser(lang);
  const dictionary = getDictionary(lang);
  const isArabic = lang === "ar";
  const roles = user.roleAssignments.filter(({ projectId }) => !projectId).map(({ role }) => role.name);

  return (
    <AppShell activeSection="profile" dictionary={dictionary} locale={lang}>
      <div className={styles.headingRow}>
        <div><h1>{isArabic ? "الملف الشخصي" : "My profile"}</h1><p className={styles.subtitle}>{isArabic ? "بيانات الحساب وتفضيلات اللغة" : "Account details and language preference"}</p></div>
      </div>
      <FormFeedback error={feedback.error} success={feedback.success} />

      <div className={managementStyles.layout}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><h2>{isArabic ? "معلومات الحساب" : "Account information"}</h2></div>
          <form action={updateProfile} className={managementStyles.form}>
            <input name="locale" type="hidden" value={lang} />
            <label><span>{isArabic ? "الاسم الكامل" : "Full name"}</span><input name="name" defaultValue={user.name} maxLength={120} required /></label>
            <label><span>{isArabic ? "البريد الإلكتروني" : "Email"}</span><input name="email" type="email" defaultValue={user.email} maxLength={160} required /></label>
            <label><span>{isArabic ? "رقم الهاتف" : "Phone"}</span><input name="phone" type="tel" defaultValue={user.phone ?? ""} maxLength={40} /></label>
            <label><span>{isArabic ? "اللغة المفضلة" : "Preferred language"}</span><select name="preferredLocale" defaultValue={user.locale}><option value="EN">English</option><option value="AR">العربية</option></select></label>
            <button className={styles.button} type="submit">{isArabic ? "حفظ التغييرات" : "Save changes"}</button>
          </form>
        </section>

        <aside className={styles.panel}>
          <div className={profileStyles.identity}>
            <span>{user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
            <div><strong>{user.name}</strong><small>{user.jobTitle ?? (isArabic ? "بدون مسمى وظيفي" : "No job title")}</small></div>
          </div>
          <dl className={profileStyles.details}>
            <div><dt>{isArabic ? "القسم" : "Department"}</dt><dd>{user.department?.name ?? "—"}</dd></div>
            <div><dt>{isArabic ? "الدور" : "Role"}</dt><dd>{roles.join(", ") || "—"}</dd></div>
            <div><dt>{isArabic ? "الحالة" : "Status"}</dt><dd><span className={styles.badge}>{user.status}</span></dd></div>
            <div><dt>{isArabic ? "ساعات العمل الأسبوعية" : "Weekly capacity"}</dt><dd>{user.weeklyCapacityMinutes / 60} h</dd></div>
          </dl>
        </aside>
      </div>
    </AppShell>
  );
}
