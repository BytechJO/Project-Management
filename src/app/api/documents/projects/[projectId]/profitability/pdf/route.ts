import type { NextRequest } from "next/server";

import { pdfResponse } from "@/lib/document-access";
import { getProfitabilityDocumentData } from "@/lib/profitability-document-access";
import { buildProjectProfitabilityPdf } from "@/lib/profitability-exports";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const result = await getProfitabilityDocumentData(request, projectId);
  if ("error" in result) return result.error;

  const pdf = await buildProjectProfitabilityPdf(result.report, result.lang);
  return pdfResponse(pdf, `${result.filename}.pdf`, request.nextUrl.searchParams.get("download") === "1");
}
