import "server-only";

import { auth } from "@/lib/auth";
import { permissionKeysFor } from "@/lib/dal";
import { getMonthlyHoursReport, hoursReportScopeFor } from "@/lib/hours-report";
import { prisma } from "@/lib/prisma";

export async function getHoursReportDocumentData(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user.id) return { error: new Response("Authentication required.", { status: 401 }) };

  const user = await prisma.user.findFirst({
    where: { id: session.user.id, status: "ACTIVE" },
    include: {
      roleAssignments: {
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
        },
      },
    },
  });
  if (!user?.organizationId) return { error: new Response("Authentication required.", { status: 401 }) };

  const permissions = permissionKeysFor(user);
  const scope = hoursReportScopeFor(permissions);
  if (!scope) return { error: new Response("Forbidden", { status: 403 }) };

  const url = new URL(request.url);
  const lang = url.searchParams.get("lang") === "ar" ? "ar" : "en";
  const report = await getMonthlyHoursReport({
    organizationId: user.organizationId,
    userId: user.id,
    scope,
    canViewCosts: permissions.has("financials.read"),
    canManageCalendar: permissions.has("employees.write"),
  }, {
    month: url.searchParams.get("month"),
    employeeId: url.searchParams.get("employeeId"),
    departmentId: url.searchParams.get("departmentId"),
  });
  if (!report) return { error: new Response("Report not found", { status: 404 }) };

  const employeeSuffix = report.employees.length === 1
    ? `-${report.employees[0].name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "employee"}`
    : "";
  return {
    report,
    lang,
    filename: `bytech-hours-${report.range.month}${employeeSuffix}`,
  } as const;
}
