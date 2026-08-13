import type { NextRequest } from "next/server";

import { xlsxResponse } from "@/lib/document-access";
import { getProfitabilityDocumentData } from "@/lib/profitability-document-access";
import { buildProjectProfitabilityWorkbook } from "@/lib/profitability-exports";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const result = await getProfitabilityDocumentData(request, projectId);
  if ("error" in result) return result.error;

  const workbook = await buildProjectProfitabilityWorkbook(result.report, result.lang);
  return xlsxResponse(workbook, `${result.filename}.xlsx`);
}
