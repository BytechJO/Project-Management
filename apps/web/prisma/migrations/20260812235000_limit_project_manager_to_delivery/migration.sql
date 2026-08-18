-- Project managers operate only within projects they directly manage. The
-- project pages expose the relevant client and assigned team context there.
DELETE FROM "RolePermission"
WHERE "roleId" IN (
  SELECT "id"
  FROM "Role"
  WHERE "name" = 'Project Manager'
)
AND "permissionId" IN (
  SELECT "id"
  FROM "Permission"
  WHERE "key" IN (
    'departments.read',
    'employees.read',
    'clients.read',
    'invoices.read',
    'quotations.read'
  )
);
