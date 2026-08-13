"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import type { Locale } from "@/i18n/config";
import { authClient } from "@/lib/auth-client";

import styles from "./sign-in-form.module.css";

export function SignInForm({ locale }: { locale: Locale }) {
  const isArabic = locale === "ar";
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);

    const formData = new FormData(event.currentTarget);
    const result = await authClient.signIn.email({
      email: String(formData.get("email") ?? "").trim().toLowerCase(),
      password: String(formData.get("password") ?? ""),
      rememberMe: true,
    });

    if (result.error) {
      const tooManyAttempts = result.error.status === 429;
      setError(
        tooManyAttempts
          ? isArabic
            ? "محاولات كثيرة. يرجى الانتظار دقيقة ثم المحاولة مجددًا."
            : "Too many attempts. Wait one minute and try again."
          : isArabic
            ? "البريد الإلكتروني أو كلمة المرور غير صحيحة."
            : "The email address or password is incorrect.",
      );
      setPending(false);
      return;
    }

    router.replace(`/${locale}`);
    router.refresh();
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <label>
        <span>{isArabic ? "البريد الإلكتروني" : "Email address"}</span>
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        <span>{isArabic ? "كلمة المرور" : "Password"}</span>
        <input name="password" type="password" autoComplete="current-password" minLength={12} required />
      </label>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <button disabled={pending} type="submit">
        {pending ? (isArabic ? "جاري تسجيل الدخول…" : "Signing in…") : (isArabic ? "تسجيل الدخول" : "Sign in")}
      </button>
    </form>
  );
}
