import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";

import { SignInForm } from "@/components/sign-in-form";
import { isLocale } from "@/i18n/config";
import { auth } from "@/lib/auth";

import styles from "./sign-in.module.css";

export default async function SignInPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect(`/${lang}`);

  const isArabic = lang === "ar";

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brand}>
          <Image alt="Bytech" className={styles.brandLogo} height={48} priority src="/bytech-logo-dark.png" width={182} />
        </div>
        <div>
          <h1>{isArabic ? "مرحبًا بعودتك" : "Welcome back"}</h1>
          <p>{isArabic ? "سجّل الدخول إلى مساحة إدارة المشاريع." : "Sign in to the project management workspace."}</p>
        </div>
        <SignInForm locale={lang} />
        <Link className={styles.language} href={`/${isArabic ? "en" : "ar"}/sign-in`}>
          {isArabic ? "English" : "العربية"}
        </Link>
      </section>
    </main>
  );
}
