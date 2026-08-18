import Link from "next/link";
import { notFound } from "next/navigation";

import type { Prisma } from "@/generated/prisma/client";
import { AppShell } from "@/components/app-shell";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { auditActionLabel, auditEntityLabel, auditSnapshotRows } from "@/lib/audit-log";
import { requirePagePermission } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

import styles from "./activity.module.css";
import sectionStyles from "../section-page.module.css";

type Query = Record<string, string | string[] | undefined>;

function queryText(query: Query, key: string, maxLength: number) {
  const raw = query[key];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  return value.length <= maxLength ? value : "";
}

function inputDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function recordHref(lang: "en" | "ar", entityType: string, entityId: string, taskProjects: Map<string, string>) {
  const paths: Record<string, string> = {
    Client: `/clients/${entityId}`,
    Department: "/departments",
    EmployeeLeave: "/leave",
    EmployeeLeaveBalance: "/leave",
    Expense: `/expenses/${entityId}`,
    Invoice: `/invoices/${entityId}`,
    Organization: "/profile",
    OrganizationHoliday: "/calendar",
    OneDriveConnection: "/integrations/onedrive",
    Project: `/projects/${entityId}`,
    Quotation: `/quotations/${entityId}`,
    Role: "/roles",
    Subscription: `/subscriptions/${entityId}`,
    Timesheet: "/timesheets",
    User: `/employees/${entityId}`,
  };
  if (entityType === "Task") {
    const projectId = taskProjects.get(entityId);
    return projectId ? `/${lang}/projects/${projectId}/tasks/${entityId}` : null;
  }
  return paths[entityType] ? `/${lang}${paths[entityType]}` : null;
}

function pageHref(lang: "en" | "ar", query: Query, page: number) {
  const params = new URLSearchParams();
  for (const key of ["q", "actor", "entity", "action", "from", "to"]) {
    const value = queryText(query, key, key === "q" ? 100 : 128);
    if (value) params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return `/${lang}/activity${suffix ? `?${suffix}` : ""}`;
}

export default async function ActivityPage({ params, searchParams }: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<Query>;
}) {
  const [{ lang }, query] = await Promise.all([params, searchParams]);
  if (!isLocale(lang)) notFound();
  const user = await requirePagePermission(lang, "audit.read");
  const dictionary = getDictionary(lang);
  const isArabic = lang === "ar";
  const search = queryText(query, "q", 100);
  const actorId = queryText(query, "actor", 128);
  const entityType = queryText(query, "entity", 80);
  const action = queryText(query, "action", 120);
  const fromValue = queryText(query, "from", 10);
  const toValue = queryText(query, "to", 10);
  const from = inputDate(fromValue);
  const to = inputDate(toValue);
  const toExclusive = to ? new Date(to.getTime() + 86_400_000) : null;
  const requestedPage = Number(queryText(query, "page", 8) || "1");
  const currentPage = Number.isInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 10_000) : 1;
  const pageSize = 40;

  const where: Prisma.AuditLogWhereInput = {
    organizationId: user.organizationId!,
    ...(actorId ? { actorId } : {}),
    ...(entityType ? { entityType } : {}),
    ...(action ? { action } : {}),
    ...(from || toExclusive ? { createdAt: { ...(from ? { gte: from } : {}), ...(toExclusive ? { lt: toExclusive } : {}) } } : {}),
    ...(search ? {
      OR: [
        { action: { contains: search, mode: "insensitive" } },
        { entityType: { contains: search, mode: "insensitive" } },
        { entityId: { contains: search, mode: "insensitive" } },
        { actor: { is: { OR: [
          { name: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ] } } },
      ],
    } : {}),
  };
  const last24Hours = new Date();
  last24Hours.setUTCHours(last24Hours.getUTCHours() - 24);

  const [records, total, employees, actionRows, entityRows, recentCount, actorRows] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { id: true, name: true, email: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
    prisma.user.findMany({
      where: { organizationId: user.organizationId!, status: { not: "ARCHIVED" } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    prisma.auditLog.findMany({
      where: { organizationId: user.organizationId! },
      distinct: ["action"],
      select: { action: true, entityType: true },
      orderBy: { action: "asc" },
    }),
    prisma.auditLog.findMany({
      where: { organizationId: user.organizationId! },
      distinct: ["entityType"],
      select: { entityType: true },
      orderBy: { entityType: "asc" },
    }),
    prisma.auditLog.count({ where: { organizationId: user.organizationId!, createdAt: { gte: last24Hours } } }),
    prisma.auditLog.groupBy({ by: ["actorId"], where }),
  ]);

  const taskIds = records.filter(({ entityType, action: recordAction }) => entityType === "Task" && !recordAction.endsWith(".deleted")).map(({ entityId }) => entityId);
  const tasks = taskIds.length ? await prisma.task.findMany({
    where: { id: { in: taskIds }, project: { organizationId: user.organizationId! } },
    select: { id: true, projectId: true },
  }) : [];
  const taskProjects = new Map(tasks.map(({ id, projectId }) => [id, projectId]));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const formatter = new Intl.DateTimeFormat(isArabic ? "ar-JO" : "en-JO", { dateStyle: "medium", timeStyle: "short", timeZone: user.organization?.timezone ?? "Asia/Amman" });

  return (
    <AppShell activeSection="activity" dictionary={dictionary} locale={lang}>
      <div className={sectionStyles.headingRow}>
        <div>
          <h1>{isArabic ? "سجل النشاطات" : "Activity log"}</h1>
          <p className={sectionStyles.subtitle}>{isArabic ? "سجل إداري محمي لكل العمليات المهمة داخل الشركة." : "A protected administrative trail of important company operations."}</p>
        </div>
        <span className={sectionStyles.badge}>{total} {isArabic ? "نتيجة" : total === 1 ? "result" : "results"}</span>
      </div>

      <section className={styles.summary} aria-label={isArabic ? "ملخص النشاط" : "Activity summary"}>
        <article><span>{isArabic ? "كل النتائج" : "Matching records"}</span><strong>{total}</strong></article>
        <article><span>{isArabic ? "آخر 24 ساعة" : "Last 24 hours"}</span><strong>{recentCount}</strong></article>
        <article><span>{isArabic ? "منفذو العمليات" : "Actors in results"}</span><strong>{actorRows.length}</strong></article>
      </section>

      <form className={styles.filters} method="get">
        <label className={styles.searchField}>
          <span>{isArabic ? "بحث" : "Search"}</span>
          <input defaultValue={search} maxLength={100} name="q" placeholder={isArabic ? "عملية، نوع، اسم أو رقم..." : "Action, type, name, or ID..."} />
        </label>
        <label><span>{isArabic ? "المستخدم" : "User"}</span><select defaultValue={actorId} name="actor"><option value="">{isArabic ? "الكل" : "All users"}</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.email}</option>)}</select></label>
        <label><span>{isArabic ? "نوع السجل" : "Record type"}</span><select defaultValue={entityType} name="entity"><option value="">{isArabic ? "الكل" : "All types"}</option>{entityRows.map((row) => <option key={row.entityType} value={row.entityType}>{auditEntityLabel(row.entityType, lang)}</option>)}</select></label>
        <label><span>{isArabic ? "العملية" : "Action"}</span><select defaultValue={action} name="action"><option value="">{isArabic ? "الكل" : "All actions"}</option>{actionRows.map((row) => <option key={row.action} value={row.action}>{auditActionLabel(row.action, row.entityType, lang)}</option>)}</select></label>
        <label><span>{isArabic ? "من تاريخ" : "From"}</span><input defaultValue={fromValue} name="from" type="date" /></label>
        <label><span>{isArabic ? "إلى تاريخ" : "To"}</span><input defaultValue={toValue} name="to" type="date" /></label>
        <div className={styles.filterActions}><button type="submit">{isArabic ? "تطبيق الفلاتر" : "Apply filters"}</button><Link href={`/${lang}/activity`}>{isArabic ? "إعادة ضبط" : "Reset"}</Link></div>
      </form>

      <section className={styles.timeline}>
        {records.length ? records.map((record) => {
          const before = auditSnapshotRows(record.before);
          const after = auditSnapshotRows(record.after);
          const href = record.action.endsWith(".deleted") ? null : recordHref(lang, record.entityType, record.entityId, taskProjects);
          const tone = /deleted|rejected|returned|cancelled/.test(record.action) ? "danger" : /created|approved|paid|submitted/.test(record.action) ? "success" : "info";
          return (
            <article className={styles.record} key={record.id}>
              <div className={styles.avatar} aria-hidden="true">{record.actor?.name.slice(0, 1).toUpperCase() ?? "S"}</div>
              <div className={styles.recordBody}>
                <div className={styles.recordHeading}>
                  <div><strong>{record.actor?.name ?? (isArabic ? "النظام" : "System")}</strong><span>{record.actor?.email ?? (isArabic ? "عملية نظام" : "System action")}</span></div>
                  <time dateTime={record.createdAt.toISOString()}>{formatter.format(record.createdAt)}</time>
                </div>
                <div className={styles.recordMeta}>
                  <span className={styles.actionBadge} data-tone={tone}>{auditActionLabel(record.action, record.entityType, lang)}</span>
                  {href ? <Link href={href}>{isArabic ? "فتح السجل" : "Open record"} →</Link> : <span className={styles.entityId}>{record.entityId}</span>}
                </div>
                {before.length || after.length ? (
                  <details className={styles.changes}>
                    <summary>{isArabic ? "عرض تفاصيل التغيير" : "View change details"}</summary>
                    <div className={styles.changeGrid}>
                      {before.length ? <div><h3>{isArabic ? "قبل" : "Before"}</h3>{before.map((row) => <div className={styles.changeRow} key={row.key}><span>{row.key}</span><code>{row.value}</code></div>)}</div> : null}
                      {after.length ? <div><h3>{isArabic ? "بعد" : "After"}</h3>{after.map((row) => <div className={styles.changeRow} key={row.key}><span>{row.key}</span><code>{row.value}</code></div>)}</div> : null}
                    </div>
                  </details>
                ) : null}
                {record.ipAddress ? <small>{isArabic ? "عنوان الشبكة" : "IP address"}: {record.ipAddress}</small> : null}
              </div>
            </article>
          );
        }) : <div className={styles.empty}><strong>{isArabic ? "لا توجد نتائج" : "No activity found"}</strong><p>{isArabic ? "غيّر الفلاتر أو أزلها لعرض سجلات أخرى." : "Change or reset the filters to see other records."}</p></div>}
      </section>

      {totalPages > 1 ? <nav className={styles.pagination} aria-label={isArabic ? "صفحات السجل" : "Activity pages"}>
        {currentPage > 1 ? <Link href={pageHref(lang, query, currentPage - 1)}>← {isArabic ? "السابق" : "Previous"}</Link> : <span />}
        <strong>{isArabic ? "صفحة" : "Page"} {currentPage} / {totalPages}</strong>
        {currentPage < totalPages ? <Link href={pageHref(lang, query, currentPage + 1)}>{isArabic ? "التالي" : "Next"} →</Link> : <span />}
      </nav> : null}
    </AppShell>
  );
}
