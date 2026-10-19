import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../config/prisma";
import { addDays, fromDbDate, istDateTimeToUtc, istToday } from "../../lib/dates";
import { saveSetting } from "../../lib/settings";
import { isHodOf, type DepartmentCode } from "../auth/permissions";
import { OPEN_TAB, summaryOf, viewableDepartments } from "../enquiries/enquiries.service";
import { whatFor, withPapers } from "../enquiries/followUpDesk.service";
import { TO_HAND_BACK, toHandBack } from "../enquiries/visibility";
import { previousOpenDay } from "../holidays/blockedDays";
import { holidayInclude } from "../holidays/holiday";
import { getHolidaySettings } from "../holidays/holidays.settings";
import { holidayItem, newHolidaysWhere, noticeItem } from "../notices/feed";
import { noticeInclude } from "../notices/notice";
import type { Actor, UserWithDepartments } from "../users/user";
import type { UpdateTodaySettingsInput } from "./today.schemas";
import { getTodaySettings, TODAY_SETTINGS_KEY } from "./today.settings";

// The Today page: one person's day (docs/decisions/0017-today-dashboard.md). In India time:
// - Running late: due before now
// - Due today: due from now until midnight tonight; the late ones are counted apart, as in the demo's "8 … and 2 …"
// - New enquiries: created since the cut-off time on the previous office day (Sunday and office holidays skipped)
// Whose cases (Decision 1): the Head's are every department's; an HOD's the whole of each department they lead; anyone
// else's (and an HOD's elsewhere) only the ones they own. View-only staff own none, so their day is empty, like their
// Follow-ups badge.

export type TodayScopeKind = "ALL" | "DEPARTMENTS" | "MINE";

/** Up next's longest list (Decision 9), like the follow-up desk's. More says there are others. */
const UP_NEXT_LIMIT = 200;

/** The notice card's length: the demo's latest 3 (Decision 11). */
const NOTICE_CARD = 3;

/**
 * A case someone has to act on (Decision 2): open or postponed (due again on its resume day), or cancelled with its
 * passports still to hand back (docs/decisions/0006-visa-documents.md amendment 15). Closed cases have no due time.
 */
const needsSomeone: Prisma.EnquiryWhereInput = {
  OR: [{ status: { in: ["OPEN", "POSTPONED"] } }, { status: "CANCELLED", ...TO_HAND_BACK }],
};

/** The cases on this user's Today, and how the page names them. */
async function todayScope(user: UserWithDepartments) {
  const departments = await viewableDepartments(user);
  const led = departments.filter((d) => isHodOf(user, d.code as DepartmentCode));
  const others = departments.filter((d) => !isHodOf(user, d.code as DepartmentCode));
  const or: Prisma.EnquiryWhereInput[] = [];
  if (led.length > 0) or.push({ departmentId: { in: led.map((d) => d.id) } });
  if (others.length > 0) or.push({ departmentId: { in: others.map((d) => d.id) }, ownerId: user.id });
  const kind: TodayScopeKind = user.type === "HEAD" ? "ALL" : led.length > 0 ? "DEPARTMENTS" : "MINE";
  return {
    where: or.length > 0 ? { OR: or } : { id: { in: [] } },
    scope: { kind, departments: led.map((d) => d.name) },
    departments,
  };
}

/** Where "New enquiries" start (Decision 3): the setting's time on the last office day before today. */
async function newSince(now: Date) {
  const { newSinceAt } = await getTodaySettings();
  const day = await previousOpenDay(addDays(istToday(now), -1), { office: true });
  return istDateTimeToUtc(day, newSinceAt);
}

/**
 * The notice card (Decision 11): the latest notices of the person's departments, and the holiday-calendar entries still
 * marked new (as the calendar's "new" chip counts them: added by staff within holidays.newForDays, not over yet), newest
 * first. The demo mixes the two ("Tue 20 Oct · Dussehra" under the notices).
 */
async function noticeCard(departmentIds: number[], now: Date) {
  const { newForDays } = await getHolidaySettings();
  const [notices, holidays] = await Promise.all([
    prisma.notice.findMany({
      where: { status: "ACTIVE", departmentId: { in: departmentIds } },
      include: noticeInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: NOTICE_CARD,
    }),
    prisma.holiday.findMany({
      where: newHolidaysWhere(now, newForDays),
      include: holidayInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: NOTICE_CARD,
    }),
  ]);
  return [...notices.map(noticeItem), ...holidays.map(holidayItem)]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, NOTICE_CARD);
}

/**
 * The banner's sentence, the tiles, Up next (Decision 9): the cases behind Due today and Running late, in the enquiries
 * list's order (late first, then by time due), each with what it needs; the department bars (Decision 10): each
 * department's cases on the list's Open tab; and the notice card (Decision 11).
 */
export async function todaySummary(user: UserWithDepartments, now: Date = new Date()) {
  const [{ where, scope, departments }, since] = await Promise.all([todayScope(user), newSince(now)]);
  const midnight = istDateTimeToUtc(addDays(istToday(now), 1), "00:00");
  const due = (dueAt: { gte?: Date; lt: Date }): Prisma.EnquiryWhereInput => ({ AND: [where, needsSomeone, { dueAt }] });

  const [dueToday, late, oldest, newEnquiries, upNext, open, notices] = await Promise.all([
    prisma.enquiry.count({ where: due({ gte: now, lt: midnight }) }),
    prisma.enquiry.count({ where: due({ lt: now }) }),
    prisma.enquiry.aggregate({ where: due({ lt: now }), _min: { dueAt: true } }),
    // Whatever happened to them since: "new" is what came in.
    prisma.enquiry.count({ where: { AND: [where, { createdAt: { gte: since } }] } }),
    prisma.enquiry.findMany({
      where: due({ lt: midnight }),
      include: withPapers,
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: UP_NEXT_LIMIT + 1,
    }),
    prisma.enquiry.groupBy({ by: ["departmentId"], where: { AND: [where, OPEN_TAB] }, _count: { _all: true } }),
    noticeCard(
      departments.map((d) => d.id),
      now,
    ),
  ]);
  return {
    scope,
    dueToday,
    late,
    oldestLateAt: oldest._min.dueAt,
    newEnquiries,
    newSince: since,
    upNext: {
      rows: upNext.slice(0, UP_NEXT_LIMIT).map((row) => ({
        id: row.id,
        caseNo: row.caseNo,
        department: { code: row.department.code, name: row.department.name },
        client: { id: row.client.id, name: row.client.name },
        summary: summaryOf(row),
        status: row.status,
        reason: row.reason,
        resumeOn: row.resumeOn ? fromDbDate(row.resumeOn) : null,
        toHandBack: toHandBack(row),
        whatFor: whatFor(row),
        owner: row.owner,
        dueAt: row.dueAt,
      })),
      more: upNext.length > UP_NEXT_LIMIT,
    },
    // Every department the user can see; "mine": only their own cases there, so the list opens with Only mine ticked.
    openByDepartment: departments.map((d) => ({
      code: d.code,
      name: d.name,
      count: open.find((c) => c.departmentId === d.id)?._count._all ?? 0,
      mine: !isHodOf(user, d.code as DepartmentCode),
    })),
    notices,
  };
}

export async function getSettings() {
  return getTodaySettings();
}

/** The Head changes the cut-off (the route checks). One audited change, as setting.update. */
export async function updateSettings(input: UpdateTodaySettingsInput, actor: Actor) {
  const before = await getTodaySettings();
  const after = { ...before, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
  if (JSON.stringify(after) === JSON.stringify(before)) return before;
  await prisma.$transaction((tx) => saveSetting(tx, { key: TODAY_SETTINGS_KEY, before, after, actorId: actor.user.id, ip: actor.ip }));
  return getTodaySettings();
}
