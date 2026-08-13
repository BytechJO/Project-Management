import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { getMonthlyHoursReport } = await import("../src/lib/hours-report");
  const { buildMonthlyHoursPdf, buildMonthlyHoursWorkbook } = await import("../src/lib/hours-report-exports");

  try {
    const organization = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
    if (!organization) throw new Error("No organization is available for export verification.");
    const user = await prisma.user.findFirst({
      where: { organizationId: organization.id, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
    });
    if (!user) throw new Error("No active employee is available for export verification.");

    const report = await getMonthlyHoursReport({
      organizationId: organization.id,
      userId: user.id,
      scope: "all",
      canViewCosts: true,
      canManageCalendar: true,
    }, {});
    if (!report) throw new Error("The hours report could not be loaded for export verification.");

    const outputDirectory = path.join(process.cwd(), ".tmp", "hours-report-export-qa");
    await fs.mkdir(outputDirectory, { recursive: true });
    const baseName = `bytech-hours-${report.range.month}`;
    const pdfPath = path.join(outputDirectory, `${baseName}.pdf`);
    const xlsxPath = path.join(outputDirectory, `${baseName}.xlsx`);
    const [pdf, workbook] = await Promise.all([
      buildMonthlyHoursPdf(report, "en"),
      buildMonthlyHoursWorkbook(report, "en"),
    ]);
    await Promise.all([fs.writeFile(pdfPath, pdf), fs.writeFile(xlsxPath, workbook)]);
    console.log(JSON.stringify({
      month: report.range.month,
      employees: report.employees.length,
      pdfPath,
      pdfBytes: pdf.byteLength,
      xlsxPath,
      xlsxBytes: workbook.byteLength,
    }));
  } finally {
    await prisma.$disconnect();
  }
}

void main();
