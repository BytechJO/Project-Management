import type { NextRequest } from "next/server";

import { documentProjectScope, getDocumentAccess, pdfResponse } from "@/lib/document-access";
import { buildStatementPdf } from "@/lib/pdf-documents";
import { prisma } from "@/lib/prisma";
import { projectAccessScope } from "@/lib/security-policy";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const access = await getDocumentAccess(request);
  if (!access) return new Response("Authentication required.", { status: 401 });
  if (!access.canRead) return new Response("Permission denied.", { status: 403 });

  const { clientId } = await params;
  const client = await prisma.client.findFirst({
    where: {
      id: clientId,
      organizationId: access.user.organizationId!,
      ...(access.projectAccessLevel === "all" ? {} : {
        projects: {
          some: projectAccessScope(
            access.user.id,
            access.projectAccessLevel,
            access.user.clientContact?.clientId,
          ),
        },
      }),
    },
  });
  if (!client) return new Response("Client not found.", { status: 404 });

  const invoices = await prisma.invoice.findMany({
    where: {
      clientId,
      organizationId: access.user.organizationId!,
      status: { notIn: ["DRAFT", "CANCELLED"] },
      ...documentProjectScope(
        access.user.id,
        access.projectAccessLevel,
        access.user.clientContact?.clientId,
      ),
    },
    include: {
      project: true,
      payments: { orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }] },
    },
    orderBy: [{ issueDate: "asc" }, { createdAt: "asc" }],
  });
  const organization = await prisma.organization.findUnique({ where: { id: access.user.organizationId! } });
  if (!organization) return new Response("Organization not found.", { status: 404 });

  const lang = request.nextUrl.searchParams.get("lang") === "ar" ? "ar" : "en";
  const pdf = await buildStatementPdf({ organization, client, invoices }, lang);
  const clientName = client.name.replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-");
  return pdfResponse(pdf, `statement-${clientName || "client"}-${lang}.pdf`, request.nextUrl.searchParams.get("download") === "1");
}
