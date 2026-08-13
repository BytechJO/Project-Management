-- CreateEnum
CREATE TYPE "AttachmentStorageProvider" AS ENUM ('EXTERNAL', 'ONEDRIVE');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "oneDriveFolderId" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "oneDriveFolderId" TEXT;

-- AlterTable
ALTER TABLE "TaskAttachment"
ADD COLUMN "storageProvider" "AttachmentStorageProvider" NOT NULL DEFAULT 'EXTERNAL',
ADD COLUMN "oneDriveItemId" TEXT,
ADD COLUMN "mimeType" TEXT,
ADD COLUMN "sizeBytes" INTEGER;

-- CreateTable
CREATE TABLE "ProjectAttachment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "storageProvider" "AttachmentStorageProvider" NOT NULL DEFAULT 'ONEDRIVE',
    "oneDriveItemId" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskAttachment_oneDriveItemId_idx" ON "TaskAttachment"("oneDriveItemId");

-- CreateIndex
CREATE INDEX "ProjectAttachment_projectId_createdAt_idx" ON "ProjectAttachment"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectAttachment_uploadedById_idx" ON "ProjectAttachment"("uploadedById");

-- CreateIndex
CREATE INDEX "ProjectAttachment_oneDriveItemId_idx" ON "ProjectAttachment"("oneDriveItemId");

-- AddForeignKey
ALTER TABLE "ProjectAttachment" ADD CONSTRAINT "ProjectAttachment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAttachment" ADD CONSTRAINT "ProjectAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
