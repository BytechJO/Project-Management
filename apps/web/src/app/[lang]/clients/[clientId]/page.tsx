import Link from "next/link";
import { notFound } from "next/navigation";

import { deleteClient } from "@/actions/deletions";
import { updateClient } from "@/actions/projects";
import { AppShell } from "@/components/app-shell";
import { DeleteRecordForm } from "@/components/delete-record-form";
import { FormFeedback } from "@/components/form-feedback";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { permissionKeysFor, requirePagePermission } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { canDeleteRecords } from "@/lib/security-policy";

import projectStyles from "../../project-management.module.css";
import styles from "../../section-page.module.css";

export default async function EditClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; clientId: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { lang, clientId } = await params;
  const feedback = await searchParams;
  if (!isLocale(lang)) notFound();
  const user = await requirePagePermission(lang, "clients.write");
  const dictionary = getDictionary(lang);
  const isArabic = lang === "ar";
  const canDelete = canDeleteRecords(permissionKeysFor(user));
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: user.organizationId! },
  });
  if (!client) notFound();

  return (
    <AppShell
      activeSection="clients"
      alternateHref={`/${lang === "en" ? "ar" : "en"}/clients/${client.id}`}
      dictionary={dictionary}
      locale={lang}
    >
      <div className={styles.headingRow}>
        <div>
          <Link className={projectStyles.backLink} href={`/${lang}/clients`}>← {isArabic ? "كل العملاء" : "All clients"}</Link>
          <h1>{isArabic ? "تعديل العميل" : "Edit client"}</h1>
          <p className={styles.subtitle}>{client.name}</p>
        </div>
      </div>
      <FormFeedback error={feedback.error} success={feedback.success} />
      <section className={styles.panel}>
        <form action={updateClient} className={projectStyles.form}>
          <input name="locale" type="hidden" value={lang} />
          <input name="clientId" type="hidden" value={client.id} />
          <div className={projectStyles.formGrid}>
            <label><span>{isArabic ? "اسم العميل" : "Client name"}</span><input name="name" defaultValue={client.name} maxLength={160} required /></label>
            <label><span>{isArabic ? "الاسم القانوني" : "Legal name"}</span><input name="legalName" defaultValue={client.legalName ?? ""} maxLength={200} /></label>
            <label><span>{isArabic ? "البريد الإلكتروني" : "Email"}</span><input name="email" defaultValue={client.email ?? ""} type="email" /></label>
            <label><span>{isArabic ? "الهاتف" : "Phone"}</span><input name="phone" defaultValue={client.phone ?? ""} maxLength={40} /></label>
            <label><span>{isArabic ? "الرقم الضريبي" : "Tax number"}</span><input name="taxNumber" defaultValue={client.taxNumber ?? ""} maxLength={60} /></label>
            <label><span>{isArabic ? "الحالة" : "Status"}</span><select name="status" defaultValue={client.isActive ? "ACTIVE" : "INACTIVE"}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label>
          </div>
          <button className={styles.button} type="submit">{isArabic ? "حفظ التعديلات" : "Save changes"}</button>
        </form>
      </section>
      {canDelete ? <DeleteRecordForm
        action={deleteClient}
        buttonLabel={isArabic ? "حذف الشركة نهائيًا" : "Delete client company permanently"}
        confirmationLabel={isArabic ? `أفهم أن حذف شركة ${client.name} نهائي ولا يمكن التراجع عنه.` : `I understand that deleting ${client.name} is permanent and cannot be undone.`}
        description={isArabic ? "لا يمكن حذف الشركة إذا كانت مرتبطة بمشاريع أو فواتير أو عروض أسعار أو مصاريف أو حساب عميل." : "A client company connected to projects, invoices, quotations, expenses, or a portal account cannot be deleted."}
        idField="clientId"
        idValue={client.id}
        locale={lang}
        pendingLabel={isArabic ? "جاري الحذف..." : "Deleting..."}
        title={isArabic ? "منطقة الخطر" : "Danger zone"}
      /> : null}
    </AppShell>
  );
}
