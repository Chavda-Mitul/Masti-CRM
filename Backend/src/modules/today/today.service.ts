import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../config/prisma";
import { addDays, fromDbDate, istDateTimeToUtc, istToday } from "../../lib/dates";
import { can, isHodOf, type DepartmentCode } from "../auth/permissions";
import { OPEN_TAB, summaryOf, viewableDepartments } from "../enquiries/enquiries.service";
import { whatFor, withPapers } from "../enquiries/followUpDesk.service";
import { TO_HAND_BACK, toHandBack } from "../enquiries/visibility";
import { previousOpenDay } from "../holidays/blockedDays";
import { holidayInclude } from "../holidays/holiday";
import { getHolidaySettings } from "../holidays/holidays.settings";
import { holidayItem, newHolidaysWhere, noticeItem } from "../notices/feed";
import { noticeInclude } from "../notices/notice";
import type { UserWithDepartments } from "../users/user";
import { passportStock } from "../visa/passportStock";

// The Today page: one person's day (docs/decisions/0017-today-dashboard.md). In India time:
// - Running late: due before now
// - Due today: due from now until midnight tonight; the late ones are counted apart, as in the demo's "8 … and 2 …"
// - New enquiries: created since 18:00 on the previous office day (Sunday and office holidays skipped)
// Whose cases (Decision 1): the Head's are every department's; an HOD's the whole of each department they lead; anyone
// else's (and an HOD's elsewhere) only the ones they own. View-only staff own none, so their day is empty, like their
// Follow-ups badge.

export type TodayScopeKind = "ALL" | "DEPARTMENTS" | "MINE";

/** Up next's longest list (Decision 9), like the follow-up desk's. More says there are others. */
const UP_NEXT_LIMIT = 200;

/** The notice card's length: the demo's latest 3 (Decision 11). */
const NOTICE_CARD = 3;

/**
 * New enquiries count from this time on the previous office day (Decision 3). Fixed, not a setting: the project lead's
 * choice (amendment 1). Still our guess at the demo's "since yesterday evening" ⚠️.
 */
const NEW_SINCE_AT = "18:00";

/**
 * A case someone has to act on (Decision 2): open or postponed (due again on its resume day), or cancelled with its
 * passports still to hand back (docs/decisions/0006-visa-documents.md amendment 15). Closed cases have no due time.
 */
const needsSomeone: Prisma.EnquiryWhereInput = {
  OR: [{ status: { in: ["OPEN", "POSTPONED"] } }, { status: "CANCELLED", ...TO_HAND_BACK }],
};

/** Business lost's top reasons: the demo's three bars (Decision 5). */
const LOST_REASONS = 3;

/** A case is booked once it has a standing invoice: a main one that no credit note cancelled whole (as liveInvoiceNo). */
const standingInvoice: Prisma.InvoiceWhereInput = { kind: "MAIN", creditNotes: { none: { kind: "WHOLE" } } };

/** The cases on this user's Today, and how the page names them. */
async function todayScope(user: UserWithDepartments) {
  const departments = await viewableDepartments(user);
  const led = departments.filter((d) => isHodOf(user, d.code as DepartmentCode));
  const others = departments.filter((d) => !isHodOf(user, d.code as DepartmentCode));
  const or: Prisma.EnquiryWhereInput[] = [];
  if (led.length > 0) or.push({ departmentId: { in: led.map((d) => d.id) } });
  if (others.length > 0) or.push({ departmentId: { in: others.map((d) => d.id) }, ownerId: user.id });
  const kind: TodayScopeKind = user.type === "HEAD" ? "ALL" : led.length > 0 ? "DEPARTMENTS" : "MINE";
  // An HOD who also works cases in a department they don't lead counts those too, so the line must say so.
  const alsoOwn = kind === "DEPARTMENTS" && others.some((d) => can(user, d.code as DepartmentCode, "EDIT"));
  return {
    where: or.length > 0 ? { OR: or } : { id: { in: [] } },
    scope: { kind, departments: led.map((d) => d.name), alsoOwn },
    departments,
  };
}

/** Where "New enquiries" start (Decision 3): 18:00 on the last office day before today. */
async function newSince(now: Date) {
  const day = await previousOpenDay(addDays(istToday(now), -1), { office: true });
  return istDateTimeToUtc(day, NEW_SINCE_AT);
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
 * Business lost this month — and why (Decision 5, amended 23 Oct 2026): the person's cases that came in this calendar
 * month, each Booked (a standing invoice), Lost (cancelled: the demo's cancel reasons are its lost reasons) or Still
 * open, so the three add up to Queries in; and the lost ones' top reasons, most first (ties in the list's order).
 */
async function businessLost(where: Prisma.EnquiryWhereInput, now: Date) {
  const monthStart = istDateTimeToUtc(`${istToday(now).slice(0, 8)}01`, "00:00");
  const cameIn = (more: Prisma.EnquiryWhereInput): Prisma.EnquiryWhereInput => ({ AND: [where, { createdAt: { gte: monthStart } }, more] });
  const lostWhere = cameIn({ status: "CANCELLED" });
  const [queriesIn, booked, lost, byReason] = await Promise.all([
    prisma.enquiry.count({ where: cameIn({}) }),
    prisma.enquiry.count({ where: cameIn({ status: { not: "CANCELLED" }, invoices: { some: standingInvoice } }) }),
    prisma.enquiry.count({ where: lostWhere }),
    prisma.enquiry.groupBy({ by: ["reasonId"], where: lostWhere, _count: { _all: true } }),
  ]);
  // A cancelled case always has its reason (a CHECK in the database).
  const reasons = await prisma.enquiryReason.findMany({ where: { id: { in: byReason.flatMap((r) => (r.reasonId ? [r.reasonId] : [])) } } });
  const top = reasons
    .map((r) => ({ name: r.name, sortOrder: r.sortOrder, count: byReason.find((b) => b.reasonId === r.id)?._count._all ?? 0 }))
    .sort((a, b) => b.count - a.count || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .slice(0, LOST_REASONS);
  return {
    queriesIn,
    booked,
    lost,
    stillOpen: queriesIn - booked - lost,
    reasons: top.map(({ name, count }) => ({ name, count })),
  };
}

/**
 * The banner's sentence, the tiles, Up next (Decision 9): the cases behind Due today and Running late, in the enquiries
 * list's order (late first, then by time due), each with what it needs; the department bars (Decision 10): each
 * department's cases on the list's Open tab; the notice card (Decision 11); and Business lost (Decision 5).
 */
export async function todaySummary(user: UserWithDepartments, now: Date = new Date()) {
  const [{ where, scope, departments }, since] = await Promise.all([todayScope(user), newSince(now)]);
  const midnight = istDateTimeToUtc(addDays(istToday(now), 1), "00:00");
  const due = (dueAt: { gte?: Date; lt: Date }): Prisma.EnquiryWhereInput => ({ AND: [where, needsSomeone, { dueAt }] });

  const seesStock = user.type === "HEAD" || isHodOf(user, "VISA");
  const [dueToday, late, oldest, newEnquiries, upNext, open, notices, lost, passports] = await Promise.all([
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
    businessLost(where, now),
    seesStock ? passportStock() : null,
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
        matured: !!row.visa?.maturedAt,
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
    businessLost: lost,
    passportStock: passports,
  };
}
