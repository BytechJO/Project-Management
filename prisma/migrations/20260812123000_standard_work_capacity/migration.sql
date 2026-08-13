-- Bytech standard schedule: Sunday through Thursday, 9 hours per day.
UPDATE "Organization"
SET "workdayMinutes" = 540,
    "weekStartsOn" = 0,
    "workdays" = ARRAY[0, 1, 2, 3, 4];

-- Full-time employees follow the 45-hour weekly company schedule.
UPDATE "User"
SET "weeklyCapacityMinutes" = 2700
WHERE "employmentType" = 'FULL_TIME';
