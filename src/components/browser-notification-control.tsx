"use client";

import { useEffect, useState } from "react";

import styles from "./browser-notification-control.module.css";

export function BrowserNotificationControl({ isArabic, userId }: { isArabic: boolean; userId: string }) {
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [enabled, setEnabled] = useState(false);
  const storageKey = `bytech-browser-notifications:${userId}`;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const available = "Notification" in window;
      setSupported(available);
      if (available) {
        setPermission(Notification.permission);
        setEnabled(window.localStorage.getItem(storageKey) === "enabled" && Notification.permission === "granted");
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [storageKey]);

  const enable = async () => {
    const result = await Notification.requestPermission();
    setPermission(result);
    const accepted = result === "granted";
    setEnabled(accepted);
    if (accepted) window.localStorage.setItem(storageKey, "enabled");
  };
  const disable = () => {
    window.localStorage.removeItem(storageKey);
    setEnabled(false);
  };

  if (!supported) return <p className={styles.note}>{isArabic ? "هذا المتصفح لا يدعم تنبيهات النظام." : "This browser does not support system notifications."}</p>;
  return <div className={styles.control}><div><strong>{isArabic ? "تنبيهات المتصفح" : "Browser notifications"}</strong><span>{enabled ? (isArabic ? "مفعّلة أثناء فتح البرنامج" : "Enabled while the app is open") : permission === "denied" ? (isArabic ? "محظورة من إعدادات المتصفح" : "Blocked in browser settings") : (isArabic ? "اختيارية لهذا الجهاز" : "Optional on this device")}</span></div>{enabled ? <button onClick={disable} type="button">{isArabic ? "إيقاف" : "Disable"}</button> : <button disabled={permission === "denied"} onClick={enable} type="button">{isArabic ? "تفعيل" : "Enable"}</button>}</div>;
}
