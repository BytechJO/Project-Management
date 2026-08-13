import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { getProjectProfitabilityReport } = await import("../src/lib/financials");
  const {
    buildProjectProfitabilityPdf,
    buildProjectProfitabilityWorkbook,
    profitabilityExportFilename,
  } = await import("../src/lib/profitability-exports");

  try {
    const organization = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
    if (!organization) throw new Error("No organization is available for export verification.");

    const project = await prisma.project.findFirst({
      where: { organizationId: organization.id, status: { not: "CANCELLED" } },
      orderBy: { updatedAt: "desc" },
    });
    if (!project) throw new Error("No project is available for export verification.");

    const report = await getProjectProfitabilityReport(organization.id, project.id);
    if (!report) throw new Error("The selected project could not be loaded for export verification.");

    const outputDirectory = path.join(process.cwd(), ".tmp", "profitability-export-qa");
    await fs.mkdir(outputDirectory, { recursive: true });
    const baseName = profitabilityExportFilename(report, "en");
    const pdfPath = path.join(outputDirectory, `${baseName}.pdf`);
    const xlsxPath = path.join(outputDirectory, `${baseName}.xlsx`);

    const [pdf, workbook] = await Promise.all([
      buildProjectProfitabilityPdf(report, "en"),
      buildProjectProfitabilityWorkbook(report, "en"),
    ]);
    await Promise.all([
      fs.writeFile(pdfPath, pdf),
      fs.writeFile(xlsxPath, workbook),
    ]);

    console.log(JSON.stringify({
      projectId: project.id,
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
