-- CreateEnum
CREATE TYPE "LeaveRequestStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "EmployeeLeave"
ADD COLUMN "status" "LeaveRequestStatus" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN "submittedAt" TIMESTAMP(3),
ADD COLUMN "reviewedById" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "rejectionReason" TEXT;

-- CreateTable
CREATE TABLE "EmployeeLeaveBalance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "annualAllowanceMinutes" INTEGER NOT NULL DEFAULT 0,
    "sickAllowanceMinutes" INTEGER NOT NULL DEFAULT 0,
    "carriedOverAnnualMinutes" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeLeaveBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeLeave_organizationId_status_submittedAt_idx" ON "EmployeeLeave"("organizationId", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "EmployeeLeave_reviewedById_idx" ON "EmployeeLeave"("reviewedById");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeLeaveBalance_userId_year_key" ON "EmployeeLeaveBalance"("userId", "year");

-- CreateIndex
CREATE INDEX "EmployeeLeaveBalance_organizationId_year_idx" ON "EmployeeLeaveBalance"("organizationId", "year");

-- CreateIndex
CREATE INDEX "EmployeeLeaveBalance_updatedById_idx" ON "EmployeeLeaveBalance"("updatedById");

-- AddForeignKey
ALTER TABLE "EmployeeLeave" ADD CONSTRAINT "EmployeeLeave_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeLeaveBalance" ADD CONSTRAINT "EmployeeLeaveBalance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeLeaveBalance" ADD CONSTRAINT "EmployeeLeaveBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeLeaveBalance" ADD CONSTRAINT "EmployeeLeaveBalance_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
