INSERT INTO "Permission" ("id", "key", "name", "description")
VALUES ('perm_expenses_own', 'expenses.own', 'Create and manage own expenses', 'Create, edit, and submit personal project expenses')
ON CONFLICT ("key") DO UPDATE SET "name" = EXCLUDED."name", "description" = EXCLUDED."description";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r."name" IN ('Admin', 'Accountant', 'Project Manager', 'Employee')
  AND p."key" = 'expenses.own'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
