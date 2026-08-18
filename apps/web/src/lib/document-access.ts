import "server-only";

import { auth } from "@/lib/auth";
import { permissionKeysFor } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { projectAccessLevelFor, safeDownloadFilename } from "@/lib/security-policy";

export { documentProjectScope } from "@/lib/security-policy";

export async function getDocumentAccess(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user.id) return null;

  const user = await prisma.user.findFirst({
    where: { id: session.user.id, status: "ACTIVE" },
    include: {
      roleAssignments: {
        include: {
          role: {
            include: { permissions: { include: { permission: true } } },
          },
        },
      },
      clientContact: true,
    },
  });
  if (!user?.organizationId) return null;

  const permissions = permissionKeysFor(user);
  const canManage = permissions.has("invoices.manage");
  const canRead = canManage || permissions.has("invoices.read");
  const canManageQuotations = permissions.has("quotations.manage");
  const canReadQuotations = canManageQuotations || permissions.has("quotations.read");
  const canReadFinancials = permissions.has("financials.read");
  const projectAccessLevel = projectAccessLevelFor(permissions, Boolean(user.clientContact));

  return {
    user,
    canManage,
    canRead,
    canManageQuotations,
    canReadQuotations,
    canReadFinancials,
    projectAccessLevel,
  };
}

export function pdfResponse(
  pdf: Uint8Array,
  filename: string,
  download: boolean,
) {
  const safeFilename = safeDownloadFilename(filename);

  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeFilename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function xlsxResponse(workbook: Uint8Array, filename: string) {
  const safeFilename = safeDownloadFilename(filename);

  return new Response(workbook as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
