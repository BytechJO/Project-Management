import type { NextRequest } from "next/server";

import { documentProjectScope, getDocumentAccess, pdfResponse } from "@/lib/document-access";
import { buildInvoicePdf } from "@/lib/pdf-documents";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const access = await getDocumentAccess(request);
  if (!access) return new Response("Authentication required.", { status: 401 });
  if (!access.canRead) return new Response("Permission denied.", { status: 403 });

  const { invoiceId } = await params;
  const invoice = await prisma.invoice.findFirst({
    where: {
      id: invoiceId,
      organizationId: access.user.organizationId!,
      ...documentProjectScope(
        access.user.id,
        access.projectAccessLevel,
        access.user.clientContact?.clientId,
      ),
    },
    include: {
      organization: true,
      client: true,
      project: true,
      payments: { orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!invoice) return new Response("Invoice not found.", { status: 404 });

  const lang = request.nextUrl.searchParams.get("lang") === "ar" ? "ar" : "en";
  const pdf = await buildInvoicePdf(invoice, lang);
  const filename = `${invoice.number.replace(/[^A-Za-z0-9_-]/g, "-")}-${lang}.pdf`;
  return pdfResponse(pdf, filename, request.nextUrl.searchParams.get("download") === "1");
}
