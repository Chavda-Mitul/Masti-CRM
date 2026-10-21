import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../config/prisma";
import { addDays, fromDbDate, istDateTimeToUtc, istToday } from "../../lib/dates";
import { isHodOfAny } from "../auth/permissions";
import type { UserWithDepartments } from "../users/user";
import { visaNextStep } from "../visa/visaNextStep";
import type { FollowUpBucket, FollowUpDeskQuery, FollowUpScope } from "./enquiries.schemas";
import { rowInclude, summaryOf, viewableDepartments } from "./enquiries.service";
import { visibleEnquiryWhere } from "./visibility";

// The follow-up desk (docs/decisions/0006-visa-documents.md Decision 9, demo screen 21). The desk chases a case until
// its documents are complete; then processing takes over, so a matured visa case leaves the desk.
// Buckets, in India time:
// - Overdue: due before now
// - Today: due before midnight tonight (late ones included, as in the demo)
// - This week: due within the next 7 days (late ones included)
// - Postponed: every postponed case, soonest back first
// A postponed case whose date has come is due like any other, so it also shows under Overdue / Today.

/** Enough for one person's or one department's day. More shows a note to narrow it. */
const DESK_LIMIT = 200;

/** A list row plus each traveller's papers, for "8 of 11 documents pending" (whatFor). */
export const withPapers = {
  ...rowInclude,
  visa: { include: { ...rowInclude.visa.include, travellers: { select: { isChild: true, documents: { select: { status: true } } } } } },
} satisfies Prisma.EnquiryInclude;

const deskInclude = {
  ...withPapers,
  followUps: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1,
    include: { outcome: { select: { name: true } } },
  },
} satisfies Prisma.EnquiryInclude;

/** Not handed to processing yet: every department's cases, except visa cases that have matured. */
const notMatured: Prisma.EnquiryWhereInput = { OR: [{ visa: { is: null } }, { visa: { is: { maturedAt: null } } }] };

function bucketWhere(bucket: FollowUpBucket, now: Date): Prisma.EnquiryWhereInput {
  if (bucket === "POSTPONED") return { status: "POSTPONED" };
  const today = istToday(now);
  const before =
    bucket === "OVERDUE" ? now : istDateTimeToUtc(addDays(today, bucket === "TODAY" ? 1 : 7), "00:00");
  return { status: { in: ["OPEN", "POSTPONED"] }, dueAt: { lt: before } };
}

/**
 * "8 of 11 documents pending" while a visa case collects papers; otherwise its next step (visaNextStep). The desk and
 * Today's Up next (docs/decisions/0017-today-dashboard.md Decision 9) say it the same way.
 */
export function whatFor(row: Prisma.EnquiryGetPayload<{ include: typeof withPapers }>): string {
  const docs = row.visa?.travellers.flatMap((t) => t.documents) ?? [];
  const needed = docs.filter((d) => d.status !== "NOT_NEEDED").length;
  const pending = docs.filter((d) => d.status === "PENDING").length;
  if (row.stage.code === "DOCUMENTS" && pending > 0) return `${pending} of ${needed} documents pending`;
  return visaNextStep(row.stage, row.visa);
}

/** One bucket of the desk for this user: cases they may see, not matured, theirs only with MINE. */
async function deskWhere(user: UserWithDepartments, scope: FollowUpScope, now: Date) {
  const departments = await viewableDepartments(user);
  const base: Prisma.EnquiryWhereInput[] = [
    visibleEnquiryWhere(user, departments),
    notMatured,
    ...(scope === "MINE" ? [{ ownerId: user.id }] : []),
  ];
  return (bucket: FollowUpBucket): Prisma.EnquiryWhereInput => ({ AND: [...base, bucketWhere(bucket, now)] });
}

export async function followUpDesk(query: FollowUpDeskQuery, user: UserWithDepartments) {
  const now = new Date();
  const where = await deskWhere(user, query.scope, now);

  const [rows, overdue, today, week, postponed] = await Promise.all([
    prisma.enquiry.findMany({
      where: where(query.bucket),
      include: deskInclude,
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
      take: DESK_LIMIT + 1,
    }),
    prisma.enquiry.count({ where: where("OVERDUE") }),
    prisma.enquiry.count({ where: where("TODAY") }),
    prisma.enquiry.count({ where: where("WEEK") }),
    prisma.enquiry.count({ where: where("POSTPONED") }),
  ]);

  return {
    rows: rows.slice(0, DESK_LIMIT).map((row) => {
      const last = row.followUps[0];
      return {
        id: row.id,
        caseNo: row.caseNo,
        department: { code: row.department.code, name: row.department.name },
        client: row.client,
        summary: summaryOf(row),
        status: row.status,
        reason: row.reason,
        resumeOn: row.resumeOn ? fromDbDate(row.resumeOn) : null,
        whatFor: whatFor(row),
        matured: !!row.visa?.maturedAt,
        lastContact: last ? { outcome: last.outcome.name, at: last.createdAt } : null,
        owner: row.owner,
        dueAt: row.dueAt,
        updatedAt: row.updatedAt,
      };
    }),
    more: rows.length > DESK_LIMIT,
    counts: { overdue, today, week, postponed },
  };
}

/**
 * The red number beside "Follow-ups" in the sidebar (PROJECT_KNOWLEDGE §9): overdue cases. Staff count their own; an
 * HOD the whole department, the Head everyone (decided 10 Oct 2026). Cross-sell leads join it when they are built.
 */
export async function followUpBadge(user: UserWithDepartments) {
  const scope: FollowUpScope = isHodOfAny(user) ? "ALL" : "MINE";
  const where = await deskWhere(user, scope, new Date());
  return { overdue: await prisma.enquiry.count({ where: where("OVERDUE") }), scope };
}
