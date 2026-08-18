-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('ANNUAL', 'SICK', 'UNPAID', 'OTHER');

-- CreateTable
CREATE TABLE "OrganizationHoliday" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeLeave" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "type" "LeaveType" NOT NULL,
    "minutesPerWorkday" INTEGER,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeLeave_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationHoliday_organizationId_date_key" ON "OrganizationHoliday"("organizationId", "date");

-- CreateIndex
CREATE INDEX "OrganizationHoliday_organizationId_date_idx" ON "OrganizationHoliday"("organizationId", "date");

-- CreateIndex
CREATE INDEX "EmployeeLeave_organizationId_startDate_endDate_idx" ON "EmployeeLeave"("organizationId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "EmployeeLeave_userId_startDate_endDate_idx" ON "EmployeeLeave"("userId", "startDate", "endDate");

-- AddForeignKey
ALTER TABLE "OrganizationHoliday" ADD CONSTRAINT "OrganizationHoliday_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationHoliday" ADD CONSTRAINT "OrganizationHoliday_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeLeave" ADD CONSTRAINT "EmployeeLeave_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeLeave" ADD CONSTRAINT "EmployeeLeave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeLeave" ADD CONSTRAINT "EmployeeLeave_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
