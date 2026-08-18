import Link from "next/link";
import { notFound } from "next/navigation";

import { disconnectOneDrive, verifyOneDriveConnection } from "@/actions/onedrive";
import { AppShell } from "@/components/app-shell";
import { FormFeedback } from "@/components/form-feedback";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { requirePagePermission } from "@/lib/dal";
import { oneDriveConfigurationStatus, oneDriveRootFolderName } from "@/lib/onedrive";
import { prisma } from "@/lib/prisma";

import sectionStyles from "../../section-page.module.css";
import styles from "./onedrive.module.css";

export default async function OneDriveIntegrationPage({ params, searchParams }: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const [{ lang }, feedback] = await Promise.all([params, searchParams]);
  if (!isLocale(lang)) notFound();
  const user = await requirePagePermission(lang, "integrations.manage");
  const [connection, configuration] = await Promise.all([
    prisma.oneDriveConnection.findUnique({
      where: { organizationId: user.organizationId! },
      include: { connectedBy: { select: { name: true, email: true } } },
    }),
    Promise.resolve(oneDriveConfigurationStatus()),
  ]);
  const dictionary = getDictionary(lang);
  const isArabic = lang === "ar";
  const formatter = new Intl.DateTimeFormat(isArabic ? "ar-JO" : "en-JO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: user.organization?.timezone ?? "Asia/Amman",
  });
  const expectedCallback = configuration.redirectUri
    || `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/api/integrations/onedrive/callback`;

  return (
    <AppShell activeSection="integrations" dictionary={dictionary} locale={lang}>
      <div className={sectionStyles.headingRow}>
        <div>
          <h1>{isArabic ? "ربط OneDrive" : "OneDrive integration"}</h1>
          <p className={sectionStyles.subtitle}>
            {isArabic
              ? "استخدم حساب الشركة لحفظ ملفات المشاريع بشكل آمن داخل OneDrive for Business."
              : "Use the company account to store project files securely in OneDrive for Business."}
          </p>
        </div>
        <span className={sectionStyles.badge} data-tone={connection ? "success" : "neutral"}>
          {connection ? (isArabic ? "متصل" : "Connected") : (isArabic ? "غير متصل" : "Not connected")}
        </span>
      </div>

      <FormFeedback error={feedback.error} success={feedback.success} />

      <section className={styles.summary} aria-label={isArabic ? "حالة OneDrive" : "OneDrive status"}>
        <article>
          <span>{isArabic ? "حالة إعداد Microsoft" : "Microsoft setup"}</span>
          <strong>{configuration.configured ? (isArabic ? "جاهز" : "Ready") : (isArabic ? "يحتاج إعداد" : "Setup required")}</strong>
        </article>
        <article>
          <span>{isArabic ? "حساب التخزين" : "Storage account"}</span>
          <strong>{connection?.accountEmail ?? "—"}</strong>
        </article>
        <article>
          <span>{isArabic ? "المجلد الرئيسي" : "Root folder"}</span>
          <strong>{connection?.rootFolderName ?? oneDriveRootFolderName}</strong>
        </article>
      </section>

      <div className={styles.layout}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.microsoftMark} aria-hidden="true"><i /><i /><i /><i /></span>
              <div>
                <h2>Microsoft OneDrive</h2>
                <p>{isArabic ? "اتصال واحد آمن لكل شركة" : "One secure connection per organization"}</p>
              </div>
            </div>
            <span className={styles.status} data-connected={Boolean(connection)}>
              {connection ? (isArabic ? "متصل" : "Connected") : (isArabic ? "غير متصل" : "Disconnected")}
            </span>
          </div>

          {connection ? (
            <>
              <dl className={styles.details}>
                <div><dt>{isArabic ? "الحساب" : "Account"}</dt><dd>{connection.accountDisplayName || connection.accountEmail}<small>{connection.accountEmail}</small></dd></div>
                <div><dt>{isArabic ? "تم الربط بواسطة" : "Connected by"}</dt><dd>{connection.connectedBy.name}<small>{connection.connectedBy.email}</small></dd></div>
                <div><dt>{isArabic ? "المجلد" : "Folder"}</dt><dd>{connection.rootFolderName}<small>{isArabic ? "داخل OneDrive الخاص بالحساب" : "Inside the connected account's OneDrive"}</small></dd></div>
                <div><dt>{isArabic ? "آخر تحقق" : "Last verified"}</dt><dd>{connection.lastVerifiedAt ? formatter.format(connection.lastVerifiedAt) : "—"}</dd></div>
              </dl>
              {connection.lastError ? <div className={styles.connectionError}>{connection.lastError}</div> : null}
              <div className={styles.actions}>
                <form action={verifyOneDriveConnection}>
                  <input name="locale" type="hidden" value={lang} />
                  <button type="submit">{isArabic ? "فحص الاتصال" : "Verify connection"}</button>
                </form>
                {configuration.configured ? <Link className={styles.secondaryButton} href={`/api/integrations/onedrive/connect?lang=${lang}`}>{isArabic ? "تغيير الحساب" : "Reconnect account"}</Link> : null}
              </div>
              <details className={styles.disconnect}>
                <summary>{isArabic ? "فصل الاتصال" : "Disconnect OneDrive"}</summary>
                <p>{isArabic ? "سيُحذف رمز الاتصال من النظام، لكن الملفات ستبقى محفوظة في OneDrive." : "The stored connection token will be removed, but existing files will remain in OneDrive."}</p>
                <form action={disconnectOneDrive}>
                  <input name="locale" type="hidden" value={lang} />
                  <button type="submit">{isArabic ? "تأكيد فصل الاتصال" : "Confirm disconnect"}</button>
                </form>
              </details>
            </>
          ) : configuration.configured ? (
            <div className={styles.emptyState}>
              <strong>{isArabic ? "اربط حساب Bytech" : "Connect the Bytech account"}</strong>
              <p>{isArabic ? "ستفتح صفحة Microsoft الرسمية للموافقة على الوصول إلى الملفات، ثم ينشئ النظام مجلد الشركة تلقائيًا." : "Microsoft's official consent page will open. After approval, the company folder will be created automatically."}</p>
              <Link className={styles.primaryButton} href={`/api/integrations/onedrive/connect?lang=${lang}`}>{isArabic ? "ربط OneDrive" : "Connect OneDrive"}</Link>
            </div>
          ) : (
            <div className={styles.emptyState}>
              <strong>{isArabic ? "أكمل إعداد Microsoft Entra أولًا" : "Complete Microsoft Entra setup first"}</strong>
              <p>{isArabic ? "الكود جاهز، لكن بيانات تطبيق Microsoft التالية غير موجودة بعد في إعدادات السيرفر:" : "The integration code is ready, but these Microsoft application settings are still missing from the server:"}</p>
              <ul>{configuration.missing.map((item) => <li key={item}><code>{item}</code></li>)}</ul>
            </div>
          )}
        </section>

        <aside className={styles.panel}>
          <div className={styles.guideHeader}>
            <span>{isArabic ? "إعداد مرة واحدة" : "One-time setup"}</span>
            <h2>{isArabic ? "إعداد تطبيق Microsoft" : "Microsoft app setup"}</h2>
          </div>
          <ol className={styles.steps}>
            <li><span>1</span><div><strong>{isArabic ? "إنشاء App registration" : "Create an app registration"}</strong><p>{isArabic ? "داخل Microsoft Entra الخاص بشركة Bytech." : "Inside the Bytech Microsoft Entra tenant."}</p></div></li>
            <li><span>2</span><div><strong>{isArabic ? "إضافة رابط العودة" : "Add the redirect URI"}</strong><code>{expectedCallback}</code></div></li>
            <li><span>3</span><div><strong>{isArabic ? "إضافة الصلاحيات" : "Add delegated permissions"}</strong><p><code>User.Read</code> + <code>Files.ReadWrite</code></p></div></li>
            <li><span>4</span><div><strong>{isArabic ? "إنشاء Client Secret" : "Create a client secret"}</strong><p>{isArabic ? "يحفظ على السيرفر فقط ولا يظهر للمستخدمين." : "Stored only on the server and never shown to users."}</p></div></li>
          </ol>
          <div className={styles.securityNote}>
            <strong>{isArabic ? "الحماية" : "Security"}</strong>
            <p>{isArabic ? "لا نخزن كلمة مرور Microsoft أو Access Token. يتم تشفير Refresh Token باستخدام AES-256-GCM، وجميع العمليات محمية بصلاحية integrations.manage." : "Microsoft passwords and access tokens are never stored. The refresh token is encrypted with AES-256-GCM, and every operation requires integrations.manage."}</p>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
