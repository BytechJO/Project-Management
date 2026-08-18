-- Expense management belongs to finance roles. Remove the default permission
-- from employee-facing roles while preserving existing expense records.
DELETE FROM "RolePermission"
WHERE "roleId" IN (
  SELECT "id"
  FROM "Role"
  WHERE "name" IN ('Employee', 'Project Manager')
)
AND "permissionId" IN (
  SELECT "id"
  FROM "Permission"
  WHERE "key" = 'expenses.own'
);
