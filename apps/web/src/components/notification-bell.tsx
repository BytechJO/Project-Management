"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { BellIcon } from "./app-icons";
import styles from "./app-shell.module.css";

type PollResult = {
  unreadCount: number;
  latest: null | { id: string; title: string; body: string; href: string; version: string };
};

export function NotificationBell({ href, initialUnreadCount, label, locale, userId }: {
  href: string;
  initialUnreadCount: number;
  label: string;
  locale: "en" | "ar";
  userId: string;
}) {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const initialized = useRef(false);

  useEffect(() => {
    let active = true;
    const latestKey = `bytech-notification-version:${userId}`;
    const enabledKey = `bytech-browser-notifications:${userId}`;
    const poll = async () => {
      try {
        const response = await fetch(`/api/notifications?lang=${locale}`, { cache: "no-store" });
        if (!response.ok || !active) return;
        const result = await response.json() as PollResult;
        setUnreadCount(result.unreadCount);
        if (!result.latest) {
          initialized.current = true;
          return;
        }
        const previousVersion = window.localStorage.getItem(latestKey);
        const changed = initialized.current && previousVersion !== result.latest.version;
        if (
          changed
          && window.localStorage.getItem(enabledKey) === "enabled"
          && "Notification" in window
          && Notification.permission === "granted"
        ) {
          const notice = new Notification(result.latest.title, { body: result.latest.body, icon: "/bytech-logo.png", tag: result.latest.id });
          notice.onclick = () => { window.location.href = result.latest!.href; };
        }
        if (changed) {
          router.refresh();
        }
        window.localStorage.setItem(latestKey, result.latest.version);
        initialized.current = true;
      } catch {
        // The badge keeps its last known value while the app is temporarily offline.
      }
    };
    void poll();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, 15_000);
    const handleFocus = () => { void poll(); };
    window.addEventListener("focus", handleFocus);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [locale, router, userId]);

  return <Link className={styles.notificationButton} data-has-unread={unreadCount > 0} href={href} aria-label={`${label}: ${unreadCount}`} title={label}><span className={styles.notificationIcon}><BellIcon /></span>{unreadCount ? <strong aria-live="polite">{unreadCount > 99 ? "99+" : unreadCount}</strong> : null}</Link>;
}
