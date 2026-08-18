import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import type { Dictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/config";
import { permissionKeysFor, requireUser } from "@/lib/dal";

import { NavigationIcon } from "./app-icons";
import { NavigationFeedback } from "./navigation-feedback";
import { NotificationBell } from "./notification-bell";
import { SignOutButton } from "./sign-out-button";

import styles from "./app-shell.module.css";

type AppSection =
  | "dashboard"
  | "clients"
  | "projects"
  | "timesheets"
  | "reports"
  | "resources"
  | "leave"
  | "calendar"
  | "financials"
  | "expenses"
  | "subscriptions"
  | "invoices"
  | "quotations"
  | "departments"
  | "employees"
  | "roles"
  | "activity"
  | "integrations"
  | "notifications"
  | "profile";

type NavigationSection = Exclude<AppSection, "notifications" | "profile">;

const navigation: Array<{ section: NavigationSection; symbol: string; anyPermission: string[] }> = [
  { section: "dashboard", symbol: "▦", anyPermission: ["dashboard.view"] },
  { section: "clients", symbol: "C", anyPermission: ["clients.read"] },
  { section: "projects", symbol: "▱", anyPermission: ["projects.read"] },
  { section: "timesheets", symbol: "◷", anyPermission: ["time_entries.own", "timesheets.approve"] },
  { section: "reports", symbol: "H", anyPermission: ["time_entries.own", "timesheets.approve", "financials.read"] },
  { section: "resources", symbol: "W", anyPermission: ["time_entries.own", "tasks.write", "employees.read"] },
  { section: "leave", symbol: "L", anyPermission: ["time_entries.own", "timesheets.approve", "employees.write"] },
  { section: "calendar", symbol: "□", anyPermission: ["dashboard.view"] },
  { section: "financials", symbol: "⌁", anyPermission: ["financials.read"] },
  { section: "expenses", symbol: "$", anyPermission: ["expenses.own", "expenses.approve"] },
  { section: "subscriptions", symbol: "S", anyPermission: ["subscriptions.manage"] },
  { section: "invoices", symbol: "I", anyPermission: ["invoices.read", "invoices.manage"] },
  { section: "quotations", symbol: "Q", anyPermission: ["quotations.read", "quotations.manage"] },
  { section: "departments", symbol: "D", anyPermission: ["departments.read"] },
  { section: "employees", symbol: "E", anyPermission: ["employees.read"] },
  { section: "roles", symbol: "R", anyPermission: ["roles.read"] },
  { section: "activity", symbol: "A", anyPermission: ["audit.read"] },
  { section: "integrations", symbol: "O", anyPermission: ["integrations.manage"] },
];

function sectionPath(section: AppSection) {
  if (section === "dashboard") return "";
  if (section === "reports") return "/reports/hours";
  if (section === "resources") return "/resource-planning";
  if (section === "integrations") return "/integrations/onedrive";
  return `/${section}`;
}

type AppShellProps = {
  activeSection: AppSection;
  alternateHref?: string;
  children: ReactNode;
  dictionary: Dictionary;
  locale: Locale;
};

export async function AppShell({
  activeSection,
  alternateHref,
  children,
  dictionary,
  locale,
}: AppShellProps) {
  const user = await requireUser(locale);
  const permissions = permissionKeysFor(user);
  const visibleNavigation = navigation.filter(({ anyPermission }) =>
    anyPermission.some((permission) => permissions.has(permission)),
  );
  const alternateLocale = locale === "en" ? "ar" : "en";
  const languageHref = alternateHref ?? `/${alternateLocale}${sectionPath(activeSection)}`;

  return (
    <div className={styles.shell}>
      <NavigationFeedback />
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href={`/${locale}`} aria-label="Bytech">
          <Image
            alt="Bytech"
            className={styles.brandLogo}
            height={45}
            priority
            src="/bytech-logo-light.png"
            width={160}
          />
        </Link>

        <nav className={styles.navigation} aria-label={dictionary.shell.navigation}>
          {visibleNavigation.map(({ section }) => (
            <Link
              key={section}
              className={styles.navLink}
              data-active={activeSection === section}
              href={`/${locale}${sectionPath(section)}`}
              aria-current={activeSection === section ? "page" : undefined}
            >
              <span className={styles.navSymbol} aria-hidden="true">
                <NavigationIcon name={section} />
              </span>
              <span>{section === "quotations" ? (locale === "ar" ? "عروض الأسعار" : "Quotations") : dictionary.nav[section]}</span>
            </Link>
          ))}
        </nav>

        <div className={styles.account}>
          <span>{dictionary.shell.signedInAs}</span>
          <strong>{user.name}</strong>
          <div className={styles.accountActions}>
            <Link className={styles.accountLink} href={`/${locale}/profile`}>{dictionary.shell.profile}</Link>
            <SignOutButton label={dictionary.shell.signOut} locale={locale} />
          </div>
        </div>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <div>
            <strong>{user.organization?.name ?? "Bytech"} Workspace</strong>
            <span>{dictionary.shell.subtitle}</span>
          </div>
          <div className={styles.topbarActions}>
            <Link className={styles.languageLink} href={languageHref}>
              {dictionary.shell.language}
            </Link>
            <NotificationBell
              href={`/${locale}/notifications`}
              initialUnreadCount={0}
              label={dictionary.shell.notifications}
              locale={locale}
              userId={user.id}
            />
          </div>
        </header>

        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
