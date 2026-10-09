import type { Prisma } from "../../../generated/prisma/client";
import { prisma, type Db } from "../../config/prisma";
import { addDays, fromDbDate, isoWeekday, toDbDate } from "../../lib/dates";
import { notFound } from "../../lib/httpError";

// The one place that decides whether a date is blocked (docs/decisions/0005-system-masters.md §3).
// The date pickers, the Visa Step 5 save and (later) field-job scheduling all call it, so the screen and the rule can't drift.
//
// Every ACTIVE holiday blocks; REMOVED ones are ignored.
// For an embassy, a holiday counts if any target is ALL_EMBASSIES, COUNTRY (same country) or EMBASSY (same post).
// For our office, only MASTI_OFFICE targets count.

export type BlockTarget = { embassyId: number } | { office: true };

/** A blocked day and the holidays that block it. */
export interface BlockedDay {
  date: string;
  holidays: { id: string; name: string }[];
}

interface DateRule {
  repeat: string;
  startDate: Date;
  endDate: Date | null;
  weekday: number | null;
}

/** The dates in from…to (inclusive, YYYY-MM-DD) that a holiday covers. */
export function datesCovered(h: DateRule, from: string, to: string): string[] {
  const start = fromDbDate(h.startDate);
  const end = h.endDate ? fromDbDate(h.endDate) : to;
  const first = start > from ? start : from;
  const last = end < to ? end : to;
  const dates: string[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) {
    if (h.repeat !== "WEEKLY" || isoWeekday(day) === h.weekday) dates.push(day);
  }
  return dates;
}

async function targetWhere(target: BlockTarget, db: Db): Promise<Prisma.HolidayTargetWhereInput> {
  if ("office" in target) return { kind: "MASTI_OFFICE" };
  const embassy = await db.embassy.findUnique({ where: { id: target.embassyId }, select: { id: true, countryId: true } });
  if (!embassy) throw notFound("Embassy not found.");
  return {
    OR: [{ kind: "ALL_EMBASSIES" }, { kind: "COUNTRY", countryId: embassy.countryId }, { kind: "EMBASSY", embassyId: embassy.id }],
  };
}

/** The blocked days in from…to for this target, in date order. Days without a holiday are left out. */
export async function blockedDays(from: string, to: string, target: BlockTarget, db: Db = prisma): Promise<BlockedDay[]> {
  const holidays = await db.holiday.findMany({
    where: {
      status: "ACTIVE",
      startDate: { lte: toDbDate(to) },
      OR: [{ endDate: null }, { endDate: { gte: toDbDate(from) } }],
      targets: { some: await targetWhere(target, db) },
    },
    select: { id: true, name: true, repeat: true, startDate: true, endDate: true, weekday: true },
    orderBy: [{ startDate: "asc" }, { name: "asc" }],
  });

  const byDate = new Map<string, BlockedDay>();
  for (const h of holidays) {
    for (const date of datesCovered(h, from, to)) {
      const day = byDate.get(date) ?? { date, holidays: [] };
      day.holidays.push({ id: h.id, name: h.name });
      byDate.set(date, day);
    }
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** True if a holiday blocks this date for this target. For server-side checks (e.g. Visa Step 5). */
export async function isDateBlocked(date: string, target: BlockTarget, db: Db = prisma): Promise<boolean> {
  return (await blockedDays(date, date, target, db)).length > 0;
}
