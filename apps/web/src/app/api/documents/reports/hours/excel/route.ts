import type { NextRequest } from "next/server";

import { xlsxResponse } from "@/lib/document-access";
import { getHoursReportDocumentData } from "@/lib/hours-report-document-access";
import { buildMonthlyHoursWorkbook } from "@/lib/hours-report-exports";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const result = await getHoursReportDocumentData(request);
  if ("error" in result) return result.error;
  const workbook = await buildMonthlyHoursWorkbook(result.report, result.lang);
  return xlsxResponse(workbook, `${result.filename}.xlsx`);
}
