import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../config/prisma";
import { z } from "zod";
import { fromDbDate } from "../../lib/dates";
import { badRequest, forbidden } from "../../lib/httpError";
import { can, isHodOf, type DepartmentCode } from "../auth/permissions";
import type { UserWithDepartments } from "../users/user";
import { countTravellers, travellersLabel } from "../visa/visaCase";
import { visaNextStep } from "../visa/visaNextStep";
import { offeringInclude, offeringLabel } from "../visaMasters/visaMasters.service";
import type { ListEnquiriesQuery } from "./enquiries.schemas";
import { toStageRef } from "./enquiry";
import { TO_HAND_BACK, toHandBack, visibleEnquiryWhere } from "./visibility";

// The All enquiries list (§12.2): every department in one list, late first, then by time due (§9).
// Each department adds its own part (VisaCase now; holidays, hotels… in Stage 2) and its own one-line summary.

export const rowInclude = {
  department: { select: { id: true, code: true, name: true } },
  client: { select: { id: true, name: true, mobile: true } },
  source: { select: { code: true, name: true } },
  stage: true,
  owner: { select: { id: true, name: true } },
  reason: { select: { name: true } },
  visa: {
    include: {
      offering: { include: offeringInclude },
      travellers: { select: { isChild: true } },
      // Whether its passports are still to hand back (TO_HAND_BACK).
      docket: { select: { dispatchedAt: true } },
      handover: { select: { enquiryId: true } },
    },
  },
} satisfies Prisma.EnquiryInclude;

type EnquiryRow = Prisma.EnquiryGetPayload<{ include: typeof rowInclude }>;

/** "France (Schengen) · Tourist · 2 adults, 2 children". Stage 2 departments add their own line here. */
export function summaryOf(row: EnquiryRow): string {
  if (row.visa) {
    const { adults, children } = countTravellers(row.visa.travellers);
    return `${offeringLabel(row.visa.offering)} · ${travellersLabel(adults, children)}`;
  }
  return row.department.name;
}

/** Active departments the user may see, in menu order. */
export async function viewableDepartments(user: UserWithDepartments) {
  const departments = await prisma.department.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  return departments.filter((d) => can(user, d.code as DepartmentCode, "VIEW"));
}

/** Case number, client name, or any part of the client's mobile (main or extra). */
function searchWhere(q: string): Prisma.EnquiryWhereInput {
  const or: Prisma.EnquiryWhereInput[] = [
    { caseNo: { contains: q, mode: "insensitive" } },
    { client: { name: { contains: q, mode: "insensitive" } } },
  ];
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 4 && /^[\d\s+\-()]+$/.test(q)) {
    const tail = digits.length > 10 ? digits.slice(-10) : digits;
    or.push({ client: { mobile: { contains: tail } } }, { client: { phones: { some: { mobile: { contains: tail } } } } });
  }
  return { OR: or };
}

// Paging. The list is ordered by dueAt (nulls last), then createdAt, then id. With a nullable sort key, Prisma 7's own
// `cursor` can't express "after this row" in SQL: it drops the LIMIT, reads every remaining row and slices the page in
// memory. So the cursor carries the last row's sort values and the "after it" condition is written out here.

const cursorSchema = z.object({ dueAt: z.iso.datetime().nullable(), createdAt: z.iso.datetime(), id: z.string().min(1).max(64) });
type ListCursor = z.infer<typeof cursorSchema>;

function encodeCursor(row: { dueAt: Date | null; createdAt: Date; id: string }): string {
  const cursor: ListCursor = { dueAt: row.dueAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), id: row.id };
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(raw: string): ListCursor {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
  } catch {
    throw badRequest("This list has changed. Reload it.");
  }
}

/** Rows that come after the cursor in the list order. */
function afterCursor(cursor: ListCursor): Prisma.EnquiryWhereInput {
  const createdAt = new Date(cursor.createdAt);
  const sameDueAtAfter: Prisma.EnquiryWhereInput = { OR: [{ createdAt: { gt: createdAt } }, { createdAt, id: { gt: cursor.id } }] };
  if (cursor.dueAt === null) return { AND: [{ dueAt: null }, sameDueAtAfter] };
  const dueAt = new Date(cursor.dueAt);
  return { OR: [{ dueAt: { gt: dueAt } }, { dueAt: null }, { AND: [{ dueAt }, sameDueAtAfter] }] };
}

/**
 * The departments whose cases this user gives out: those they are HOD of (the Head: every one). "To assign" lists and
 * counts only these. A view-only user sees the whole department but doesn't assign, so they are refused like staff.
 */
async function assigningDepartments(user: UserWithDepartments) {
  const departments = (await viewableDepartments(user)).filter((d) => isHodOf(user, d.code as DepartmentCode));
  if (departments.length === 0) throw forbidden("Only an HOD or the Head assigns cases.");
  return departments;
}

/**
 * The Open tab: open cases, plus a cancelled visa case whose passports are still to hand back, which stays on its owner's
 * (and the HOD's) list until the handover (docs/decisions/0006-visa-documents.md amendment 15). Today's department bars
 * count the same (docs/decisions/0017-today-dashboard.md Decision 10).
 */
export const OPEN_TAB: Prisma.EnquiryWhereInput = { OR: [{ status: "OPEN" }, { status: "CANCELLED", ...TO_HAND_BACK }] };

export async function listEnquiries(query: ListEnquiriesQuery, user: UserWithDepartments) {
  const departments = query.unassigned ? await assigningDepartments(user) : await viewableDepartments(user);
  let shown = departments;
  if (query.department) {
    shown = departments.filter((d) => d.code === query.department);
    if (shown.length === 0) {
      throw forbidden(query.unassigned ? "Only the department's HOD or the Head assigns its cases." : "You don't have access to this department's enquiries.");
    }
  }

  // "To assign" stays open cases only.
  const statusWhere: Prisma.EnquiryWhereInput = query.status === "OPEN" && !query.unassigned ? OPEN_TAB : { status: query.status };
  // Everything but the department, so the department chips can show their counts. Staff see only their own enquiries,
  // HODs their department's, the Head everything (visibility.ts).
  const base: Prisma.EnquiryWhereInput[] = [
    visibleEnquiryWhere(user, departments),
    statusWhere,
    ...(query.mine ? [{ ownerId: user.id }] : []),
    ...(query.unassigned ? [{ ownerId: null }] : []),
    ...(query.q ? [searchWhere(query.q)] : []),
  ];
  const where: Prisma.EnquiryWhereInput = { AND: [...base, { departmentId: { in: shown.map((d) => d.id) } }] };
  const after = query.cursor ? afterCursor(decodeCursor(query.cursor)) : undefined;

  const [rows, perDepartment, late, stages] = await Promise.all([
    prisma.enquiry.findMany({
      where: after ? { AND: [where, after] } : where,
      include: rowInclude,
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
    }),
    prisma.enquiry.groupBy({ by: ["departmentId"], where: { AND: base }, _count: { _all: true } }),
    prisma.enquiry.count({ where: { AND: [where, { dueAt: { lt: new Date() } }] } }),
    prisma.departmentStage.findMany({
      where: { departmentId: { in: departments.map((d) => d.id) } },
      orderBy: [{ departmentId: "asc" }, { flow: "asc" }, { sortOrder: "asc" }],
      select: { departmentId: true, flow: true, code: true, name: true },
    }),
  ]);

  const stagesOf = (departmentId: number, flow: string) =>
    stages.filter((s) => s.departmentId === departmentId && s.flow === flow).map(({ code, name }) => ({ code, name }));
  /** A department's flows with their steps, for the side panel: each row shows its own flow's steps. */
  const flowsOf = (departmentId: number) =>
    [...new Set(stages.filter((s) => s.departmentId === departmentId).map((s) => s.flow))].map((flow) => ({
      code: flow,
      stages: stagesOf(departmentId, flow),
    }));
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    enquiries: page.map((row) => ({
      id: row.id,
      caseNo: row.caseNo,
      department: { code: row.department.code, name: row.department.name },
      client: row.client,
      summary: summaryOf(row),
      status: row.status,
      /** Why it was postponed or cancelled, and when a postponed one comes back (the Postponed / Cancelled filters). */
      reason: row.reason,
      resumeOn: row.resumeOn ? fromDbDate(row.resumeOn) : null,
      /** A visa case whose passports are still to hand back (a cancelled one stays on the Open tab until then). */
      toHandBack: toHandBack(row),
      stage: toStageRef(row.stage, stagesOf(row.departmentId, row.stage.flow).length),
      /** This case's next step: the step's own, except where a visa case's state decides it (visaNextStep). */
      nextStep: visaNextStep(row.stage, row.visa),
      source: row.source,
      origin: row.origin,
      owner: row.owner,
      dueAt: row.dueAt,
      createdAt: row.createdAt,
    })),
    nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    departments: departments.map((d) => ({
      code: d.code,
      name: d.name,
      count: perDepartment.find((c) => c.departmentId === d.id)?._count._all ?? 0,
      flows: flowsOf(d.id),
    })),
    lateCount: late,
  };
}

/**
 * The sidebar's "To assign" count: open cases with no owner (matured, waiting for a processor) in the departments this
 * user is HOD of; the Head counts every department. Cases should never sit idle without a processor (10 Oct 2026).
 */
export async function toAssignCount(user: UserWithDepartments) {
  const departments = await assigningDepartments(user);
  const count = await prisma.enquiry.count({
    where: { status: "OPEN", ownerId: null, departmentId: { in: departments.map((d) => d.id) } },
  });
  return { count };
}

/** Not finished yet: a postponed case is still the client's case if they come back. */
const OPEN_STATUSES = ["OPEN", "POSTPONED"] as const;

/**
 * The New enquiry lookup: the client's unfinished cases, newest first, with whose they are. Every case in the departments
 * the user can view, colleagues' too, so staff spot an existing case before making a duplicate. It warns but doesn't
 * block, since a family can plan two trips (0003).
 */
export async function listOpenEnquiriesOfClient(clientId: string, user: UserWithDepartments) {
  const departments = await viewableDepartments(user);
  const rows = await prisma.enquiry.findMany({
    where: { clientId, status: { in: [...OPEN_STATUSES] }, departmentId: { in: departments.map((d) => d.id) } },
    include: rowInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map((row) => ({
    caseNo: row.caseNo,
    department: row.department.code,
    summary: summaryOf(row),
    stage: row.stage.name,
    owner: row.owner,
  }));
}

/**
 * "Everything we've done for this family" on the client profile: all of the client's cases this user may open
 * (visibility.ts), finished ones too, and the family's other unfinished cases in the departments the user can view, the
 * ones the New enquiry lookup already shows. Those come with `canOpen: false` and show without a link. A matured visa
 * case waits for the HOD with no owner, and the staff member who matured it saw the family as having nothing open
 * (fixed 19 Oct 2026, review finding 5; 0006 amendment 17). Unfinished first, then finished; newest first in each.
 */
export async function listCasesOfClient(clientId: string, user: UserWithDepartments) {
  const departments = await viewableDepartments(user);
  const visible = visibleEnquiryWhere(user, departments);
  const unfinishedHere: Prisma.EnquiryWhereInput = { status: { in: [...OPEN_STATUSES] }, departmentId: { in: departments.map((d) => d.id) } };
  const [rows, openable] = await Promise.all([
    prisma.enquiry.findMany({
      where: { AND: [{ clientId }, { OR: [visible, unfinishedHere] }] },
      include: rowInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    prisma.enquiry.findMany({ where: { AND: [{ clientId }, visible] }, select: { id: true } }),
  ]);
  const canOpen = new Set(openable.map((row) => row.id));
  const unfinished = (row: EnquiryRow) => (OPEN_STATUSES as readonly string[]).includes(row.status);
  return [...rows.filter(unfinished), ...rows.filter((row) => !unfinished(row))].map((row) => ({
    caseNo: row.caseNo,
    department: row.department.code,
    summary: summaryOf(row),
    status: row.status,
    stage: { name: row.stage.name, statusLabel: row.stage.statusLabel },
    reason: row.reason,
    resumeOn: row.resumeOn ? fromDbDate(row.resumeOn) : null,
    /** A cancelled visa case whose passports are still to hand back (0006 amendment 15). */
    toHandBack: toHandBack(row),
    owner: row.owner,
    /** Whether this user may open it: a colleague's case, or one waiting for the HOD, is listed but not opened. */
    canOpen: canOpen.has(row.id),
  }));
}

/** "Came in through" on the New enquiry form: active sources staff may pick. */
export async function listStaffSources() {
  return prisma.enquirySource.findMany({
    where: { isActive: true, staffSelectable: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, code: true, name: true },
  });
}
