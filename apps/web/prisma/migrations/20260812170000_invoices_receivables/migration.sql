CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CASH', 'CHEQUE', 'CARD', 'OTHER');

CREATE TABLE "Invoice" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "issueDate" DATE NOT NULL,
  "dueDate" DATE NOT NULL,
  "subtotal" DECIMAL(14,2) NOT NULL,
  "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "totalAmount" DECIMAL(14,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'JOD',
  "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "sentAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvoicePayment" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "recordedById" TEXT NOT NULL,
  "paymentDate" DATE NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "method" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
  "reference" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoicePayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Invoice_organizationId_number_key" ON "Invoice"("organizationId", "number");
CREATE INDEX "Invoice_organizationId_status_idx" ON "Invoice"("organizationId", "status");
CREATE INDEX "Invoice_clientId_idx" ON "Invoice"("clientId");
CREATE INDEX "Invoice_projectId_idx" ON "Invoice"("projectId");
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");
CREATE INDEX "InvoicePayment_invoiceId_paymentDate_idx" ON "InvoicePayment"("invoiceId", "paymentDate");
CREATE INDEX "InvoicePayment_recordedById_idx" ON "InvoicePayment"("recordedById");

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Permission" ("id", "key", "name", "description")
VALUES
  ('perm_invoices_read', 'invoices.read', 'View client invoices and collections', 'View invoices, balances, and payment history'),
  ('perm_invoices_manage', 'invoices.manage', 'Manage client invoices and collections', 'Create invoices, send them, and record client payments')
ON CONFLICT ("key") DO UPDATE SET "name" = EXCLUDED."name", "description" = EXCLUDED."description";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."name" IN ('Admin', 'Accountant', 'Project Manager')
  AND p."key" = 'invoices.read'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."name" IN ('Admin', 'Accountant')
  AND p."key" = 'invoices.manage'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
