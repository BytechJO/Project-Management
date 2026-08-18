import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { AppShell } from "@/components/app-shell";
import { FormFeedback } from "@/components/form-feedback";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { permissionKeysFor, requireUser } from "@/lib/dal";
import { getOrganizationFinancialSummary } from "@/lib/financials";
import { prisma } from "@/lib/prisma";
import { getResourcePlanSummary } from "@/lib/resource-planning";
import {
  canManageAllProjects,
  canViewAllProjectTasks,
  projectAccessLevelFor,
  projectAccessScope,
  resourcePlanningScopeFor,
  taskAccessScope,
  timesheetApprovalScope,
} from "@/lib/security-policy";
import { calendarDaysBetween, nextSubscriptionDueDate } from "@/lib/subscriptions";

import styles from "./dashboard.module.css";
import sectionStyles from "./section-page.module.css";

function weekStartFor(date: Date) {
  const start = new Date(date);
  start.setUTCDate(date.getUTCDate() - date.getUTCDay());
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

function greetingFor(date: Date, isArabic: boolean, timeZone: string) {
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hourCycle: "h23",
    timeZone,
  }).format(date));
  if (hour < 12) return isArabic ? "صباح الخير" : "Good morning";
  if (hour < 18) return isArabic ? "مساء الخير" : "Good afternoon";
  return isArabic ? "مساء الخير" : "Good evening";
}

function formatDate(date: Date, lang: string, timeZone: string) {
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-JO" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(date);
}

function formatShortDate(date: Date | null, lang: string) {
  if (!date) return lang === "ar" ? "بدون موعد" : "No target date";
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-JO" : "en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

type DashboardInsightPromise = Promise<{
  financialSummary: Awaited<ReturnType<typeof getOrganizationFinancialSummary>> | null;
  resourceSummary: Awaited<ReturnType<typeof getResourcePlanSummary>>;
}>;

async function DashboardMetrics({
  canViewFinancials,
  canViewTeamProjects,
  dueThisMonth,
  dueThisWeek,
  insights,
  isArabic,
  openProjectCount,
  openTasks,
  ownMinutes,
  ownTimesheetStatus,
  pendingApprovals,
  pendingExpenses,
  pendingTimesheets,
  weeklyCapacityMinutes,
}: {
  canViewFinancials: boolean;
  canViewTeamProjects: boolean;
  dueThisMonth: number;
  dueThisWeek: number;
  insights: DashboardInsightPromise;
  isArabic: boolean;
  openProjectCount: number;
  openTasks: number;
  ownMinutes: number;
  ownTimesheetStatus: string | null;
  pendingApprovals: number;
  pendingExpenses: number;
  pendingTimesheets: number;
  weeklyCapacityMinutes: number;
}) {
  const { financialSummary, resourceSummary } = await insights;
  const trackedMinutes = resourceSummary?.totalActualMinutes ?? 0;
  const capacityMinutes = resourceSummary?.totalCapacityMinutes ?? weeklyCapacityMinutes;
  const plannedMinutes = resourceSummary?.totalPlannedMinutes ?? 0;
  const plannedLoad = resourceSummary?.plannedLoadPercent ?? 0;
  const portfolioMargin = financialSummary?.plannedMargin ?? 0;
  const metrics = canViewTeamProjects
    ? [
        { label: isArabic ? "المشاريع المفتوحة" : "Open projects", value: String(openProjectCount), note: isArabic ? `${dueThisMonth} مستحق هذا الشهر` : `${dueThisMonth} due this month` },
        { label: isArabic ? "الحمل المخطط للفريق" : "Team planned load", value: `${plannedLoad.toFixed(0)}%`, note: isArabic ? `${(plannedMinutes / 60).toFixed(1)} مخطط · ${(trackedMinutes / 60).toFixed(1)} فعلي` : `${(plannedMinutes / 60).toFixed(1)} planned · ${(trackedMinutes / 60).toFixed(1)} actual`, tone: plannedLoad > 110 ? "accent" : "info" },
        { label: isArabic ? "الموافقات المعلقة" : "Pending approvals", value: String(pendingApprovals), note: isArabic ? `${pendingTimesheets} ساعات · ${pendingExpenses} مصاريف` : `${pendingTimesheets} timesheets · ${pendingExpenses} expenses`, tone: "accent" },
        canViewFinancials
          ? { label: isArabic ? "هامش المشاريع المخطط" : "Planned portfolio margin", value: `${portfolioMargin.toFixed(1)}%`, note: isArabic ? "حسب قيمة العقود والميزانيات" : "From contract values and planned budgets" }
          : { label: isArabic ? "المهام المفتوحة" : "Open tasks", value: String(openTasks), note: isArabic ? `${dueThisWeek} مستحقة هذا الأسبوع` : `${dueThisWeek} due this week` },
      ]
    : [
        { label: isArabic ? "مشاريعي المفتوحة" : "My open projects", value: String(openProjectCount), note: isArabic ? "المشاريع المسندة إليّ" : "Projects assigned to me" },
        { label: isArabic ? "حملي المخطط" : "My planned load", value: `${plannedLoad.toFixed(0)}%`, note: isArabic ? `${(plannedMinutes / 60).toFixed(1)} من ${(capacityMinutes / 60).toFixed(1)} ساعة متاحة` : `${(plannedMinutes / 60).toFixed(1)} of ${(capacityMinutes / 60).toFixed(1)} available hours`, tone: plannedLoad > 110 ? "accent" : "info" },
        { label: isArabic ? "ساعاتي هذا الأسبوع" : "My hours this week", value: (ownMinutes / 60).toFixed(1), note: ownTimesheetStatus?.replaceAll("_", " ") ?? (isArabic ? "لم يبدأ السجل" : "Timesheet not started"), tone: "accent" },
        { label: isArabic ? "مهامي المفتوحة" : "My open tasks", value: String(openTasks), note: isArabic ? `${dueThisWeek} مستحقة هذا الأسبوع` : `${dueThisWeek} due this week` },
      ];

  return (
    <section className={sectionStyles.metrics} aria-label={isArabic ? "مؤشرات العمل" : "Workspace metrics"}>
      {metrics.map((metric) => (
        <article className={sectionStyles.metric} key={metric.label}>
          <div className={sectionStyles.metricLabel}>{metric.label}</div>
          <div className={sectionStyles.metricValue} data-tone={metric.tone}>{metric.value}</div>
          <div className={sectionStyles.metricNote}>{metric.note}</div>
        </article>
      ))}
    </section>
  );
}

function DashboardMetricsFallback() {
  return (
    <section className={sectionStyles.metrics} aria-label="Loading metrics">
      {[0, 1, 2, 3].map((item) => <article className={`${sectionStyles.metric} ${styles.skeletonCard}`} key={item}><i /><b /><i /></article>)}
    </section>
  );
}

async function DashboardAttention({
  canApproveTimesheets,
  canViewSubscriptions,
  insights,
  isArabic,
  lang,
  overdueTasks,
  ownMinutes,
  ownTimesheetStatus,
  pendingTimesheets,
  subscriptionsDueSoon,
  subscriptionsHref,
  dueThisWeek,
}: {
  canApproveTimesheets: boolean;
  canViewSubscriptions: boolean;
  insights: DashboardInsightPromise;
  isArabic: boolean;
  lang: "en" | "ar";
  overdueTasks: number;
  ownMinutes: number;
  ownTimesheetStatus: string | null;
  pendingTimesheets: number;
  subscriptionsDueSoon: number;
  subscriptionsHref: string;
  dueThisWeek: number;
}) {
  const { resourceSummary } = await insights;

  return (
    <section className={sectionStyles.panel}>
      <div className={sectionStyles.panelHeader}><h2>{isArabic ? "تحتاج إلى انتباه" : "Needs attention"}</h2></div>
      <div className={styles.attentionList}>
        <Link href={`/${lang}/resource-planning`}>
          <div><strong>{isArabic ? "ضغط العمل" : "Workload"}</strong><span>{isArabic ? "حمل زائد وتجاوزات التقدير" : "Overload and estimate overruns"}</span></div>
          <span className={resourceSummary?.overloadedEmployees || resourceSummary?.overEstimateTasks ? sectionStyles.warningBadge : sectionStyles.badge}>{(resourceSummary?.overloadedEmployees ?? 0) + (resourceSummary?.overEstimateTasks ?? 0)}</span>
        </Link>
        <Link href={`/${lang}/timesheets`}>
          <div><strong>{isArabic ? "سجلات الوقت" : "Timesheets"}</strong><span>{canApproveTimesheets ? (isArabic ? "بانتظار الموافقة" : "Waiting for approval") : (ownTimesheetStatus?.replaceAll("_", " ") ?? (isArabic ? "لم يبدأ" : "Not started"))}</span></div>
          <span className={pendingTimesheets || ownTimesheetStatus === "REJECTED" ? sectionStyles.warningBadge : sectionStyles.badge}>{canApproveTimesheets ? pendingTimesheets : `${(ownMinutes / 60).toFixed(1)} h`}</span>
        </Link>
        <Link href={`/${lang}/projects`}>
          <div><strong>{isArabic ? "المهام المتأخرة" : "Overdue tasks"}</strong><span>{isArabic ? "غير مكتملة بعد الموعد" : "Incomplete after due date"}</span></div>
          <span className={overdueTasks ? sectionStyles.warningBadge : sectionStyles.badge}>{overdueTasks}</span>
        </Link>
        <Link href={subscriptionsHref}>
          <div><strong>{canViewSubscriptions ? (isArabic ? "الاشتراكات" : "Subscriptions") : (isArabic ? "مهام هذا الأسبوع" : "Tasks this week")}</strong><span>{canViewSubscriptions ? (isArabic ? "مستحقة خلال 7 أيام" : "Due in the next 7 days") : (isArabic ? "موعدها هذا الأسبوع" : "Due this week")}</span></div>
          <span className={sectionStyles.badge}>{canViewSubscriptions ? subscriptionsDueSoon : dueThisWeek}</span>
        </Link>
      </div>
    </section>
  );
}

function DashboardAttentionFallback() {
  return <section className={`${sectionStyles.panel} ${styles.attentionSkeleton}`} aria-label="Loading attention items"><i /><i /><i /><i /></section>;
}

export default async function DashboardPage({ params, searchParams }: PageProps<"/[lang]">) {
  const { lang } = await params;
  const feedback = await searchParams;
  if (!isLocale(lang)) notFound();

  const user = await requireUser(lang);
  const dictionary = getDictionary(lang);
  const isArabic = lang === "ar";
  const permissions = permissionKeysFor(user);
  if (!permissions.has("dashboard.view")) {
    if (permissions.has("projects.read")) redirect(`/${lang}/projects`);
    if (permissions.has("invoices.read") || permissions.has("invoices.manage")) redirect(`/${lang}/invoices`);
    redirect(`/${lang}/profile`);
  }
  const projectAccessLevel = projectAccessLevelFor(permissions, Boolean(user.clientContact));
  const canCreateProjects = permissions.has("projects.write") && canManageAllProjects(permissions);
  const canApproveTimesheets = permissions.has("timesheets.approve");
  const canApproveAllTimesheets = permissions.has("financials.write");
  const canApproveExpenses = permissions.has("expenses.approve");
  const canViewFinancials = permissions.has("financials.read");
  const canViewSubscriptions = permissions.has("subscriptions.manage") || canViewFinancials;
  const canViewTeamProjects = projectAccessLevel === "all" || projectAccessLevel === "managed";
  const canViewAllTasks = canViewAllProjectTasks(permissions);
  const resourcePlanningScope = resourcePlanningScopeFor(permissions);
  const timeZone = user.organization?.timezone ?? "Asia/Amman";
  const now = new Date();
  const weekStart = weekStartFor(now);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 7);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const taskScope = {
    project: {
      organizationId: user.organizationId!,
      ...projectAccessScope(user.id, projectAccessLevel, user.clientContact?.clientId),
    },
    ...taskAccessScope(user.id, canViewAllTasks),
  };

  const [
    openProjectSummary,
    featuredProjects,
    pendingTimesheets,
    pendingExpenses,
    overdueTasks,
    dueThisWeek,
    openTasks,
    ownTimesheet,
    activeSubscriptions,
  ] = await Promise.all([
    prisma.project.findMany({
      where: {
        organizationId: user.organizationId!,
        status: { in: ["ACTIVE", "PLANNED", "ON_HOLD"] },
        ...projectAccessScope(user.id, projectAccessLevel, user.clientContact?.clientId),
      },
      select: { targetDate: true },
    }),
    prisma.project.findMany({
      where: {
        organizationId: user.organizationId!,
        status: { in: ["ACTIVE", "PLANNED", "ON_HOLD"] },
        ...projectAccessScope(user.id, projectAccessLevel, user.clientContact?.clientId),
      },
      select: {
        id: true,
        name: true,
        targetDate: true,
        progressPercent: true,
        client: { select: { name: true } },
        tasks: {
          where: taskAccessScope(user.id, canViewAllTasks),
          select: { status: true, dueDate: true },
        },
      },
      orderBy: [{ targetDate: "asc" }, { updatedAt: "desc" }],
      take: 5,
    }),
    canApproveTimesheets
      ? prisma.timesheet.count({
          where: {
            status: "SUBMITTED",
            userId: { not: user.id },
            user: { organizationId: user.organizationId! },
            ...timesheetApprovalScope(user.id, canApproveAllTimesheets),
          },
        })
      : Promise.resolve(0),
    canApproveExpenses
      ? prisma.expense.count({ where: { organizationId: user.organizationId!, status: "SUBMITTED" } })
      : Promise.resolve(0),
    prisma.task.count({
      where: { ...taskScope, dueDate: { lt: now }, status: { notIn: ["DONE", "CANCELLED"] } },
    }),
    prisma.task.count({
      where: { ...taskScope, dueDate: { gte: weekStart, lt: weekEnd }, status: { notIn: ["DONE", "CANCELLED"] } },
    }),
    prisma.task.count({ where: { ...taskScope, status: { notIn: ["DONE", "CANCELLED"] } } }),
    prisma.timesheet.findUnique({
      where: { userId_weekStart: { userId: user.id, weekStart } },
      include: { entries: { select: { durationMinutes: true } } },
    }),
    canViewSubscriptions
      ? prisma.subscription.findMany({
          where: { organizationId: user.organizationId!, isActive: true },
          select: { dueDay: true, frequency: true, startsOn: true, endsOn: true },
        })
      : Promise.resolve([]),
  ]);

  const openProjectCount = openProjectSummary.length;
  const dueThisMonth = openProjectSummary.filter(({ targetDate }) => targetDate && targetDate >= monthStart && targetDate < monthEnd).length;
  const pendingApprovals = pendingTimesheets + pendingExpenses;
  const ownMinutes = ownTimesheet?.entries.reduce((total, entry) => total + entry.durationMinutes, 0) ?? 0;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const subscriptionsDueSoon = activeSubscriptions.filter((subscription) => {
    const due = nextSubscriptionDueDate(subscription, now);
    if (!due) return false;
    const days = calendarDaysBetween(today, due);
    return days >= 0 && days <= 7;
  }).length;
  const firstName = user.firstName?.trim() || user.name.trim().split(/\s+/)[0];
  const insights = Promise.all([
    canViewFinancials ? getOrganizationFinancialSummary(user.organizationId!) : Promise.resolve(null),
    resourcePlanningScope
      ? getResourcePlanSummary({ organizationId: user.organizationId!, actorId: user.id, scope: resourcePlanningScope, weekStart, now })
      : Promise.resolve(null),
  ]).then(([financialSummary, resourceSummary]) => ({ financialSummary, resourceSummary }));

  return (
    <AppShell activeSection="dashboard" dictionary={dictionary} locale={lang}>
      <div className={sectionStyles.headingRow}>
        <div>
          <h1>{greetingFor(now, isArabic, timeZone)}, {firstName}</h1>
          <p className={sectionStyles.subtitle}>{formatDate(now, lang, timeZone)} · {isArabic ? "ملخص مباشر من قاعدة البيانات" : "Live workspace overview"}</p>
        </div>
        {canCreateProjects ? <Link className={sectionStyles.button} href={`/${lang}/projects#create-project`}>{isArabic ? "مشروع جديد" : "New project"}</Link> : null}
      </div>

      <FormFeedback
        error={typeof feedback.error === "string" ? feedback.error : undefined}
        success={typeof feedback.success === "string" ? feedback.success : undefined}
      />

      <Suspense fallback={<DashboardMetricsFallback />}>
        <DashboardMetrics canViewFinancials={canViewFinancials} canViewTeamProjects={canViewTeamProjects} dueThisMonth={dueThisMonth} dueThisWeek={dueThisWeek} insights={insights} isArabic={isArabic} openProjectCount={openProjectCount} openTasks={openTasks} ownMinutes={ownMinutes} ownTimesheetStatus={ownTimesheet?.status ?? null} pendingApprovals={pendingApprovals} pendingExpenses={pendingExpenses} pendingTimesheets={pendingTimesheets} weeklyCapacityMinutes={user.weeklyCapacityMinutes} />
      </Suspense>

      <div className={styles.dashboardGrid}>
        <section className={sectionStyles.panel}>
          <div className={sectionStyles.panelHeader}>
            <h2>{isArabic ? "حالة المشاريع" : "Project health"}</h2>
            <span className={sectionStyles.badge}>{openProjectCount} {isArabic ? "مفتوح" : "open"}</span>
          </div>
          {featuredProjects.length ? (
            <div className={styles.projectList}>
              {featuredProjects.map((project) => {
                const completedTasks = project.tasks.filter(({ status }) => status === "DONE").length;
                const progress = project.tasks.length ? (completedTasks / project.tasks.length) * 100 : Number(project.progressPercent);
                const hasOverdueTask = project.tasks.some(({ dueDate, status }) => dueDate && dueDate < now && !["DONE", "CANCELLED"].includes(status));
                return (
                  <Link className={styles.projectRow} href={`/${lang}/projects/${project.id}`} key={project.id}>
                    <div><strong>{project.name}</strong><span>{project.client.name} · {formatShortDate(project.targetDate, lang)}</span></div>
                    <div className={styles.progressTrack} aria-hidden="true"><div className={hasOverdueTask ? styles.warningProgress : styles.progress} style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} /></div>
                    <strong>{progress.toFixed(0)}%</strong>
                  </Link>
                );
              })}
            </div>
          ) : <p className={styles.emptyState}>{isArabic ? "لا توجد مشاريع مفتوحة ضمن صلاحياتك." : "No open projects are available in your scope."}</p>}
        </section>

        <Suspense fallback={<DashboardAttentionFallback />}>
          <DashboardAttention canApproveTimesheets={canApproveTimesheets} canViewSubscriptions={canViewSubscriptions} dueThisWeek={dueThisWeek} insights={insights} isArabic={isArabic} lang={lang} overdueTasks={overdueTasks} ownMinutes={ownMinutes} ownTimesheetStatus={ownTimesheet?.status ?? null} pendingTimesheets={pendingTimesheets} subscriptionsDueSoon={subscriptionsDueSoon} subscriptionsHref={permissions.has("subscriptions.manage") ? `/${lang}/subscriptions` : canViewSubscriptions ? `/${lang}/financials` : `/${lang}/projects`} />
        </Suspense>
      </div>
    </AppShell>
  );
}
