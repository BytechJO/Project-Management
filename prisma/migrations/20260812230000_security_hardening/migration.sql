-- Prevent concurrent requests from creating more than one running timer per employee.
CREATE UNIQUE INDEX "TimeEntry_one_active_timer_per_user"
ON "TimeEntry"("userId")
WHERE "source" = 'TIMER'
  AND "startedAt" IS NOT NULL
  AND "endedAt" IS NULL;
