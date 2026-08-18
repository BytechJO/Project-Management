-- CreateTable
CREATE TABLE "OneDriveConnection" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "connectedById" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "microsoftUserId" TEXT NOT NULL,
  "accountEmail" TEXT NOT NULL,
  "accountDisplayName" TEXT,
  "driveId" TEXT NOT NULL,
  "rootItemId" TEXT NOT NULL,
  "rootFolderName" TEXT NOT NULL DEFAULT 'Bytech Project Management',
  "encryptedRefreshToken" TEXT NOT NULL,
  "grantedScopes" TEXT NOT NULL,
  "accessTokenExpiresAt" TIMESTAMP(3),
  "lastVerifiedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OneDriveConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OneDriveConnection_organizationId_key" ON "OneDriveConnection"("organizationId");

-- CreateIndex
CREATE INDEX "OneDriveConnection_connectedById_idx" ON "OneDriveConnection"("connectedById");

-- AddForeignKey
ALTER TABLE "OneDriveConnection" ADD CONSTRAINT "OneDriveConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneDriveConnection" ADD CONSTRAINT "OneDriveConnection_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add the dedicated integration permission and grant it to existing system administrators.
INSERT INTO "Permission" ("id", "key", "name", "description")
VALUES ('perm_integrations_manage', 'integrations.manage', 'Manage company integrations', 'Connect and manage company storage integrations')
ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" AS role
CROSS JOIN "Permission" AS permission
WHERE role."name" = 'Admin'
  AND role."isSystem" = TRUE
  AND permission."key" = 'integrations.manage'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
