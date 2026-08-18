import "server-only";

import type { NextRequest } from "next/server";

import { getDocumentAccess } from "@/lib/document-access";
import { getProjectProfitabilityReport } from "@/lib/financials";
import { profitabilityExportFilename } from "@/lib/profitability-exports";
import { parseProjectReportRange } from "@/lib/report-range";

export async function getProfitabilityDocumentData(request: NextRequest, projectId: string) {
  const access = await getDocumentAccess(request);
  if (!access) return { error: new Response("Authentication required.", { status: 401 }) } as const;
  if (!access.canReadFinancials) return { error: new Response("Permission denied.", { status: 403 }) } as const;

  const lang = request.nextUrl.searchParams.get("lang") === "ar" ? "ar" : "en";
  const parsedRange = parseProjectReportRange(
    request.nextUrl.searchParams.get("from"),
    request.nextUrl.searchParams.get("to"),
  );
  if (parsedRange.invalid) {
    return { error: new Response("Invalid report period.", { status: 400 }) } as const;
  }

  const report = await getProjectProfitabilityReport(
    access.user.organizationId!,
    projectId,
    { from: parsedRange.from, to: parsedRange.to },
  );
  if (!report) return { error: new Response("Project not found.", { status: 404 }) } as const;

  return {
    report,
    lang,
    filename: profitabilityExportFilename(report, lang),
  } as const;
}
