-- Support paginated employee lists ordered within one organization.
CREATE INDEX "User_organizationId_name_idx" ON "User"("organizationId", "name");

-- Support project pagination and dashboard status/date summaries.
CREATE INDEX "Project_organizationId_createdAt_idx" ON "Project"("organizationId", "createdAt");
CREATE INDEX "Project_organizationId_status_targetDate_idx" ON "Project"("organizationId", "status", "targetDate");

-- Support scoped task status and due-date metrics.
CREATE INDEX "Task_projectId_status_dueDate_idx" ON "Task"("projectId", "status", "dueDate");

-- Support expense registers and status summaries without scanning the organization table slice.
CREATE INDEX "Expense_organizationId_status_expenseDate_idx" ON "Expense"("organizationId", "status", "expenseDate");

-- Support employee-scoped expense registers and summaries.
CREATE INDEX "Expense_submittedById_status_expenseDate_idx" ON "Expense"("submittedById", "status", "expenseDate");

-- Support activity feeds and recent-activity counts.
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");
