import type { NextRequest } from "next/server";

import { documentProjectScope, getDocumentAccess, pdfResponse } from "@/lib/document-access";
import { buildReceiptPdf } from "@/lib/pdf-documents";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const access = await getDocumentAccess(request);
  if (!access) return new Response("Authentication required.", { status: 401 });
  if (!access.canRead) return new Response("Permission denied.", { status: 403 });

  const { paymentId } = await params;
  const payment = await prisma.invoicePayment.findFirst({
    where: {
      id: paymentId,
      invoice: {
        organizationId: access.user.organizationId!,
        ...documentProjectScope(
          access.user.id,
          access.projectAccessLevel,
          access.user.clientContact?.clientId,
        ),
      },
    },
    include: {
      recordedBy: true,
      invoice: {
        include: {
          organization: true,
          client: true,
          project: true,
          payments: { include: { recordedBy: true }, orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }] },
        },
      },
    },
  });
  if (!payment) return new Response("Payment not found.", { status: 404 });

  const lang = request.nextUrl.searchParams.get("lang") === "ar" ? "ar" : "en";
  const pdf = await buildReceiptPdf(payment.invoice, payment, lang);
  const filename = `receipt-${payment.invoice.number.replace(/[^A-Za-z0-9_-]/g, "-")}-${payment.id.slice(-8)}-${lang}.pdf`;
  return pdfResponse(pdf, filename, request.nextUrl.searchParams.get("download") === "1");
}
