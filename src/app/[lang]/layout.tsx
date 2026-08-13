import type { Metadata } from "next";
import localFont from "next/font/local";
import { notFound } from "next/navigation";

import { directionFor, isLocale, locales } from "@/i18n/config";

import "../globals.css";

const balooBhaijaan = localFont({
  src: "../../../public/fonts/baloo-bhaijaan-2-semibold.ttf",
  variable: "--font-baloo-bhaijaan",
  display: "swap",
  weight: "600",
});

export const metadata: Metadata = {
  title: {
    default: "Bytech Project Management",
    template: "%s · Bytech",
  },
  description: "Internal project operations and profitability platform for Bytech.",
};

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[lang]">) {
  const { lang } = await params;

  if (!isLocale(lang)) {
    notFound();
  }

  return (
    <html lang={lang} dir={directionFor(lang)} className={balooBhaijaan.variable}>
      <body>{children}</body>
    </html>
  );
}
