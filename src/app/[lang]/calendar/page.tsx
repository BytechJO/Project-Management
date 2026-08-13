import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { permissionKeysFor, requirePagePermission } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { getResourcePlan } from "@/lib/resource-planning";
import {
  canOpenLeavePortal,
  canViewAllProjectTasks,
  leaveReviewScope,
  projectAccessLevelFor,
  projectAccessScope,
  resourcePlanningScopeFor,
  taskAccessScope,
} from "@/lib/security-policy";

import moduleStyles from "../module-pages.module.css";
import styles from "../section-page.module.css";

function weekStartFor(date: Date) {
  const start = new Date(date);
  start.setUTCDate(date.getUTCDate() - date.getUTCDay());
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDay(date: Date, lang: string) {
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-JO" : "en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

function leaveTypeLabel(type: string, isArabic: boolean) {
  const labels: Record<string, [string, string]> = {
    ANNUAL: ["Annual", "سنوية"],
    SICK: ["Sick", "مرضية"],
    UNPAID: ["Unpaid", "غير مدفوعة"],
    OTHER: ["Other", "أخرى"],
  };
  return labels[type]?.[isArabic ? 1 : 0] ?? type.replaceAll("_", " ");
}

export default async function CalendarPage({ params }: PageProps<"/[lang]/calendar">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  const user = await requirePagePermission(lang, "dashboard.view");
  const dictionary = getDictionary(lang);
  const page = dictionary.calendar;
  const isArabic = lang === "ar";
  const permissions = permissionKeysFor(user);
  const projectAccessLevel = projectAccessLevelFor(permissions, Boolean(user.clientContact));
  const canViewAllTasks = canViewAllProjectTasks(permissions);
  const canViewLeave = canOpenLeavePortal(permissions);
  const canReviewLeave = permissions.has("timesheets.approve") || permissions.has("employees.write");
  const canViewAllLeave = permissions.has("employees.write");
  const resourcePlanningScope = resourcePlanningScopeFor(permissions);
  const now = new Date();
  const weekStart = weekStartFor(now);
  const calendarEnd = new Date(weekStart);
  calendarEnd.setUTCDate(weekStart.getUTCDate() + 5);
  const days = Array.from({ length: 5 }, (_, index) => {
    const date = new Date(weekStart);
    date.setUTCDate(weekStart.getUTCDate() + index);
    return date;
  });

  const [tasks, milestones, holidays, approvedLeaves, resourcePlan] = await Promise.all([
    prisma.task.findMany({
      where: {
        dueDate: { gte: weekStart, lt: calendarEnd },
        status: { not: "CANCELLED" },
        project: { organizationId: user.organizationId!, status: { not: "CANCELLED" } },
        ...taskAccessScope(user.id, canViewAllTasks),
      },
      include: { project: true },
      orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
    }),
    prisma.milestone.findMany({
      where: {
        dueDate: { gte: weekStart, lt: calendarEnd },
        project: {
          organizationId: user.organizationId!,
          status: { not: "CANCELLED" },
          ...projectAccessScope(user.id, projectAccessLevel, user.clientContact?.clientId),
        },
      },
      include: { project: true },
      orderBy: { dueDate: "asc" },
    }),
    prisma.organizationHoliday.findMany({
      where: {
        organizationId: user.organizationId!,
        date: { gte: weekStart, lt: calendarEnd },
      },
      orderBy: { date: "asc" },
    }),
    canViewLeave
      ? prisma.employeeLeave.findMany({
          where: {
            organizationId: user.organizationId!,
            status: "APPROVED",
            startDate: { lt: calendarEnd },
            endDate: { gte: weekStart },
            ...(canViewAllLeave
              ? {}
              : canReviewLeave
                ? leaveReviewScope(user.id, false)
                : { userId: user.id }),
          },
          select: {
            id: true,
            type: true,
            startDate: true,
            endDate: true,
            minutesPerWorkday: true,
            user: { select: { name: true } },
          },
          orderBy: [{ startDate: "asc" }, { user: { name: "asc" } }],
        })
      : Promise.resolve([]),
    resourcePlanningScope
      ? getResourcePlan({ organizationId: user.organizationId!, actorId: user.id, scope: resourcePlanningScope, weekStart, now })
      : Promise.resolve(null),
  ]);

  const scheduledCount = tasks.length + milestones.length + holidays.length + approvedLeaves.length;

  return (
    <AppShell activeSection="calendar" dictionary={dictionary} locale={lang}>
      <div className={styles.headingRow}>
        <div>
          <h1>{page.title}</h1>
          <p className={styles.subtitle}>{formatDay(days[0], lang)} – {formatDay(days[4], lang)} · {isArabic ? "المهام والمراحل والإجازات والعطل الرسمية" : "Tasks, milestones, leave and official holidays"}</p>
        </div>
        <span className={styles.badge}>{scheduledCount} {isArabic ? "سجل" : "records"}</span>
      </div>
      <section className={moduleStyles.calendar} aria-label={page.title}>
        {days.map((date, index) => {
          const key = dateKey(date);
          const dayTasks = tasks.filter((task) => task.dueDate && dateKey(task.dueDate) === key);
          const dayMilestones = milestones.filter((milestone) => milestone.dueDate && dateKey(milestone.dueDate) === key);
          const dayHolidays = holidays.filter((holiday) => dateKey(holiday.date) === key);
          const dayLeaves = dayHolidays.length
            ? []
            : approvedLeaves.filter((leave) => leave.startDate <= date && leave.endDate >= date);
          const dayPlannedMinutes = resourcePlan?.dailyPlanned.find(({ date: plannedDate }) => plannedDate === key)?.plannedMinutes ?? 0;
          return (
            <article className={`${moduleStyles.day} ${dateKey(now) === key ? moduleStyles.today : ""}`} key={key}>
              <div className={moduleStyles.dayHeader}><strong>{page.days[index]}</strong><span>{formatDay(date, lang)}</span></div>
              {dayPlannedMinutes ? <Link className={moduleStyles.workload} href={`/${lang}/resource-planning?week=${dateKey(weekStart)}`}><strong>{(dayPlannedMinutes / 60).toFixed(1)} h</strong><span>{isArabic ? "حمل مخطط للفريق" : "Team planned load"}</span></Link> : null}
              {dayHolidays.map((holiday) => (
                <div className={moduleStyles.holiday} key={holiday.id}>
                  <strong>{holiday.name}</strong><span>{isArabic ? "عطلة رسمية" : "Official holiday"}</span>
                </div>
              ))}
              {dayLeaves.map((leave) => (
                <Link className={moduleStyles.leave} href={`/${lang}/leave`} key={leave.id}>
                  <strong>{leave.user.name}</strong>
                  <span>{isArabic ? "إجازة معتمدة" : "Approved leave"} · {leaveTypeLabel(leave.type, isArabic)}{leave.minutesPerWorkday ? ` · ${leave.minutesPerWorkday / 60}h` : ""}</span>
                </Link>
              ))}
              {dayMilestones.map((milestone) => (
                <Link className={moduleStyles.event} href={`/${lang}/projects/${milestone.projectId}`} key={milestone.id}>
                  <strong>{milestone.name}</strong><span>{milestone.project.name} · {isArabic ? "مرحلة" : "Milestone"}</span>
                </Link>
              ))}
              {dayTasks.map((task) => (
                <Link className={moduleStyles.deadline} href={`/${lang}/projects/${task.projectId}/tasks/${task.id}`} key={task.id}>
                  <strong>{task.title}</strong><span>{task.project.name} · {task.status.replaceAll("_", " ")}</span>
                </Link>
              ))}
              {!dayTasks.length && !dayMilestones.length && !dayHolidays.length && !dayLeaves.length && !dayPlannedMinutes ? <p className={moduleStyles.emptyDay}>{isArabic ? "لا توجد مواعيد" : "No scheduled items"}</p> : null}
            </article>
          );
        })}
      </section>
    </AppShell>
  );
}
