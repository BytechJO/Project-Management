"use client";

import { useRouter } from "next/navigation";

import type { Locale } from "@/i18n/config";
import { authClient } from "@/lib/auth-client";

import styles from "./app-shell.module.css";

export function SignOutButton({ label, locale }: { label: string; locale: Locale }) {
  const router = useRouter();

  return (
    <button
      className={styles.signOut}
      type="button"
      onClick={async () => {
        await authClient.signOut();
        router.replace(`/${locale}/sign-in`);
        router.refresh();
      }}
    >
      {label}
    </button>
  );
}
