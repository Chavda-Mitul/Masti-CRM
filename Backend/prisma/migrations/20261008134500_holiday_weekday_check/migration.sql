-- Holiday_dates let a WEEKLY holiday through with no weekday: NULL BETWEEN 1 AND 7 is unknown, and a CHECK accepts unknown.
ALTER TABLE "Holiday" DROP CONSTRAINT "Holiday_dates";
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_dates" CHECK (
  ("repeat" = 'NONE' AND "endDate" IS NOT NULL AND "endDate" >= "startDate" AND "weekday" IS NULL)
  OR ("repeat" = 'WEEKLY' AND "weekday" IS NOT NULL AND "weekday" BETWEEN 1 AND 7 AND ("endDate" IS NULL OR "endDate" >= "startDate"))
);
