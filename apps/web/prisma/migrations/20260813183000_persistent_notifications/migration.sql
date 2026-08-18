-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM (
  'TASK_ASSIGNED',
  'TASK_UPDATED',
  'TASK_OVERDUE',
  'TASK_ESTIMATE_EXCEEDED',
  'WORKLOAD_OVERLOAD',
  'TIMESHEET_SUBMITTED',
  'TIMESHEET_APPROVED',
  'TIMESHEET_REJECTED',
  'LEAVE_SUBMITTED',
  'LEAVE_APPROVED',
  'LEAVE_REJECTED',
  'SYSTEM'
);

-- CreateTable
CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "NotificationKind" NOT NULL,
  "titleEn" TEXT NOT NULL,
  "titleAr" TEXT NOT NULL,
  "bodyEn" TEXT NOT NULL,
  "bodyAr" TEXT NOT NULL,
  "href" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_organizationId_userId_readAt_createdAt_idx" ON "Notification"("organizationId", "userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_kind_entityId_idx" ON "Notification"("userId", "kind", "entityId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
