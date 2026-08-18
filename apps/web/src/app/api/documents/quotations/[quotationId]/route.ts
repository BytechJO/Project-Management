import type { NextRequest } from "next/server";

import { getDocumentAccess, pdfResponse } from "@/lib/document-access";
import { buildQuotationPdf } from "@/lib/pdf-documents";
import { prisma } from "@/lib/prisma";
import { projectAccessScope } from "@/lib/security-policy";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ quotationId: string }> }) {
  const access = await getDocumentAccess(request);
  if (!access) return new Response("Authentication required.", { status: 401 });
  if (!access.canReadQuotations) return new Response("Permission denied.", { status: 403 });
  const { quotationId } = await params;
  const quotation = await prisma.quotation.findFirst({
    where: {
      id: quotationId,
      organizationId: access.user.organizationId!,
      ...(access.projectAccessLevel === "all" ? {} : {
        convertedProject: projectAccessScope(
          access.user.id,
          access.projectAccessLevel,
          access.user.clientContact?.clientId,
        ),
      }),
    },
    include: { organization: true, client: true, lineItems: { orderBy: { sortOrder: "asc" } } },
  });
  if (!quotation) return new Response("Quotation not found.", { status: 404 });
  const lang = request.nextUrl.searchParams.get("lang") === "ar" ? "ar" : "en";
  const pdf = await buildQuotationPdf(quotation, lang);
  const filename = `${quotation.number.replace(/[^A-Za-z0-9_-]/g, "-")}-${lang}.pdf`;
  return pdfResponse(pdf, filename, request.nextUrl.searchParams.get("download") === "1");
}
