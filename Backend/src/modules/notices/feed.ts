import type { Prisma } from "../../../generated/prisma/client";
import { istToday, toDbDate } from "../../lib/dates";
import { dateLabel, targetLabel, type HolidayRow } from "../holidays/holiday";
import type { NoticeRow } from "./notice";

// The lines of a notice feed: Today's notice card (docs/decisions/0017-today-dashboard.md Decision 11) and the visa team's
// login popup (Decision 12). Each is a notice, or a holiday-calendar entry still new.

/**
 * Holiday-calendar entries still new, as the calendar's own "new" chip counts them (toHolidayDto): active, added by staff
 * within holidays.newForDays, and not over yet. The seeded Sunday off has nobody's name on it, so it never counts.
 */
export function newHolidaysWhere(now: Date, newForDays: number): Prisma.HolidayWhereInput {
  return {
    status: "ACTIVE",
    addedById: { not: null },
    createdAt: { gt: new Date(now.getTime() - newForDays * 86_400_000) },
    OR: [{ endDate: null }, { endDate: { gte: toDbDate(istToday(now)) } }],
  };
}

export function noticeItem(n: NoticeRow) {
  return {
    kind: "NOTICE" as const,
    id: n.id,
    department: n.department,
    category: n.category,
    about: n.about,
    title: n.title,
    body: n.body,
    source: n.source,
    postedBy: n.postedBy,
    createdAt: n.createdAt,
  };
}

/** "Tue 20 Oct 2026 · Dussehra", with whom it applies to ("French embassy, Mumbai"). */
export function holidayItem(h: HolidayRow) {
  return {
    kind: "HOLIDAY" as const,
    id: h.id,
    name: h.name,
    label: dateLabel(h),
    targets: h.targets.map(targetLabel),
    addedBy: h.addedBy,
    createdAt: h.createdAt,
  };
}
