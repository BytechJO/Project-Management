-- Accountants work with financial records and project financial context, but
-- do not need access to the employee directory or employee profile pages.
DELETE FROM "RolePermission"
WHERE "roleId" IN (
  SELECT "id"
  FROM "Role"
  WHERE "name" = 'Accountant'
)
AND "permissionId" IN (
  SELECT "id"
  FROM "Permission"
  WHERE "key" = 'employees.read'
);
