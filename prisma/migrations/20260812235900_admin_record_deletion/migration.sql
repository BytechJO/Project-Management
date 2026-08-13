INSERT INTO "Permission" ("id", "key", "name", "description")
VALUES (
  'perm_records_delete',
  'records.delete',
  'Permanently delete records',
  'Permanently delete unused projects, tasks, employees, and clients'
)
ON CONFLICT ("key") DO UPDATE
SET "name" = EXCLUDED."name", "description" = EXCLUDED."description";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."name" = 'Admin'
  AND p."key" = 'records.delete'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
