import Link from "next/link";
import { notFound } from "next/navigation";

import { markAllNotificationsRead, markNotificationRead } from "@/actions/notifications";
import { AppShell } from "@/components/app-shell";
import { BrowserNotificationControl } from "@/components/browser-notification-control";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { requireUser } from "@/lib/dal";
import { syncOperationalNotifications } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

import notificationStyles from "./notifications.module.css";
import styles from "../section-page.module.css";

type NotificationsPageProps = {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ status?: string }>;
};

export default async function NotificationsPage({ params, searchParams }: NotificationsPageProps) {
  const [{ lang }, query] = await Promise.all([params, searchParams]);
  if (!isLocale(lang)) notFound();
  const user = await requireUser(lang);
  const dictionary = getDictionary(lang);
  const isArabic = lang === "ar";
  const unreadOnly = query.status === "unread";

  await syncOperationalNotifications({ ...user, organizationId: user.organizationId! });
  const where = {
    organizationId: user.organizationId!,
    userId: user.id,
    ...(unreadOnly ? { readAt: null } : {}),
  };
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.notification.count({
      where: { organizationId: user.organizationId!, userId: user.id, readAt: null },
    }),
  ]);
  const formatter = new Intl.DateTimeFormat(isArabic ? "ar-JO" : "en-JO", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <AppShell activeSection="notifications" dictionary={dictionary} locale={lang}>
      <div className={styles.headingRow}>
        <div>
          <h1>{isArabic ? "الإشعارات" : "Notifications"}</h1>
          <p className={styles.subtitle}>
            {isArabic ? "تحديثات التاسكات والموافقات والتنبيهات التشغيلية الخاصة بحسابك." : "Task updates, approvals, and operational alerts for your account."}
          </p>
        </div>
        <div className={notificationStyles.headingActions}>
          <span className={unreadCount ? styles.warningBadge : styles.badge}>
            {unreadCount} {isArabic ? "غير مقروء" : "unread"}
          </span>
          {unreadCount ? (
            <form action={markAllNotificationsRead}>
              <input name="locale" type="hidden" value={lang} />
              <button className={notificationStyles.secondaryButton} type="submit">
                {isArabic ? "تعليم الكل كمقروء" : "Mark all as read"}
              </button>
            </form>
          ) : null}
        </div>
      </div>

      <BrowserNotificationControl isArabic={isArabic} userId={user.id} />

      <nav className={notificationStyles.filters} aria-label={isArabic ? "فلترة الإشعارات" : "Notification filters"}>
        <Link aria-current={!unreadOnly ? "page" : undefined} href={`/${lang}/notifications`}>
          {isArabic ? "الكل" : "All"}
        </Link>
        <Link aria-current={unreadOnly ? "page" : undefined} href={`/${lang}/notifications?status=unread`}>
          {isArabic ? "غير المقروء" : "Unread"}
        </Link>
      </nav>

      <section className={notificationStyles.list}>
        {notifications.length ? notifications.map((notification) => {
          const title = isArabic ? notification.titleAr : notification.titleEn;
          const body = isArabic ? notification.bodyAr : notification.bodyEn;
          return (
            <article className={notificationStyles.item} data-unread={!notification.readAt} key={notification.id}>
              <span className={notificationStyles.marker} aria-hidden="true">●</span>
              <Link className={notificationStyles.itemLink} href={`/${lang}/notifications/${notification.id}/open`}>
                <strong>{title}</strong>
                <p>{body}</p>
                <time dateTime={notification.createdAt.toISOString()}>{formatter.format(notification.createdAt)}</time>
              </Link>
              {!notification.readAt ? (
                <form action={markNotificationRead}>
                  <input name="locale" type="hidden" value={lang} />
                  <input name="notificationId" type="hidden" value={notification.id} />
                  <button className={notificationStyles.readButton} type="submit" title={isArabic ? "تعليم كمقروء" : "Mark as read"}>
                    {isArabic ? "تمت القراءة" : "Mark read"}
                  </button>
                </form>
              ) : null}
            </article>
          );
        }) : (
          <div className={notificationStyles.empty}>
            <strong>{isArabic ? "لا توجد إشعارات هنا" : "No notifications here"}</strong>
            <p>{isArabic ? "ستظهر التحديثات الجديدة تلقائياً عند حدوثها." : "New updates will appear automatically when they happen."}</p>
          </div>
        )}
      </section>
    </AppShell>
  );
}
