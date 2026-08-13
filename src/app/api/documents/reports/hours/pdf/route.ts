import type { NextRequest } from "next/server";

import { pdfResponse } from "@/lib/document-access";
import { getHoursReportDocumentData } from "@/lib/hours-report-document-access";
import { buildMonthlyHoursPdf } from "@/lib/hours-report-exports";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const result = await getHoursReportDocumentData(request);
  if ("error" in result) return result.error;
  const pdf = await buildMonthlyHoursPdf(result.report, result.lang);
  return pdfResponse(pdf, `${result.filename}.pdf`, true);
}
