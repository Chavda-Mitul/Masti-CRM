import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../config/prisma";
import { forbidden } from "../../lib/httpError";
import { can, type DepartmentCode } from "../auth/permissions";
import type { UserWithDepartments } from "../users/user";
import { countTravellers, travellersLabel } from "../visa/visaCase";
import { offeringInclude, offeringLabel } from "../visaMasters/visaMasters.service";
import type { ListEnquiriesQuery } from "./enquiries.schemas";
import { toStageRef } from "./enquiry";

// The All enquiries list (§12.2): every department in one list, late first, then by time due (§9).
// Each department adds its own part (VisaCase now; holidays, hotels… in Stage 2) and its own one-line summary.

const rowInclude = {
  department: { select: { id: true, code: true, name: true } },
  client: { select: { id: true, name: true, mobile: true } },
  source: { select: { code: true, name: true } },
  stage: true,
  owner: { select: { id: true, name: true } },
  visa: { include: { offering: { include: offeringInclude }, travellers: { select: { isChild: true } } } },
} satisfies Prisma.EnquiryInclude;

type EnquiryRow = Prisma.EnquiryGetPayload<{ include: typeof rowInclude }>;

/** "France (Schengen) · Tourist · 2 adults, 2 children". Stage 2 departments add their own line here. */
function summaryOf(row: EnquiryRow): string {
  if (row.visa) {
    const { adults, children } = countTravellers(row.visa.travellers);
    return `${offeringLabel(row.visa.offering)} · ${travellersLabel(adults, children)}`;
  }
  return row.department.name;
}

/** Active departments the user may see, in menu order. */
async function viewableDepartments(user: UserWithDepartments) {
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

export async function listEnquiries(query: ListEnquiriesQuery, user: UserWithDepartments) {
  const departments = await viewableDepartments(user);
  let shown = departments;
  if (query.department) {
    shown = departments.filter((d) => d.code === query.department);
    if (shown.length === 0) throw forbidden("You don't have access to this department's enquiries.");
  }

  // Everything but the department, so the department chips can show their counts.
  const base: Prisma.EnquiryWhereInput[] = [
    { departmentId: { in: departments.map((d) => d.id) } },
    { status: query.status },
    ...(query.mine ? [{ ownerId: user.id }] : []),
    ...(query.q ? [searchWhere(query.q)] : []),
  ];
  const where: Prisma.EnquiryWhereInput = { AND: [...base, { departmentId: { in: shown.map((d) => d.id) } }] };

  const [rows, perDepartment, late, stages] = await Promise.all([
    prisma.enquiry.findMany({
      where,
      include: rowInclude,
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    }),
    prisma.enquiry.groupBy({ by: ["departmentId"], where: { AND: base }, _count: { _all: true } }),
    prisma.enquiry.count({ where: { AND: [where, { dueAt: { lt: new Date() } }] } }),
    prisma.departmentStage.findMany({
      where: { departmentId: { in: departments.map((d) => d.id) } },
      orderBy: [{ departmentId: "asc" }, { sortOrder: "asc" }],
      select: { departmentId: true, code: true, name: true },
    }),
  ]);

  const stagesOf = (departmentId: number) => stages.filter((s) => s.departmentId === departmentId).map(({ code, name }) => ({ code, name }));
  const page = rows.slice(0, query.limit);
  return {
    enquiries: page.map((row) => ({
      id: row.id,
      caseNo: row.caseNo,
      department: { code: row.department.code, name: row.department.name },
      client: row.client,
      summary: summaryOf(row),
      status: row.status,
      stage: toStageRef(row.stage, stagesOf(row.departmentId).length),
      source: row.source,
      origin: row.origin,
      owner: row.owner,
      dueAt: row.dueAt,
      createdAt: row.createdAt,
    })),
    nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
    departments: departments.map((d) => ({
      code: d.code,
      name: d.name,
      count: perDepartment.find((c) => c.departmentId === d.id)?._count._all ?? 0,
      stages: stagesOf(d.id),
    })),
    lateCount: late,
  };
}

/** Not finished yet: a postponed case is still the client's case if they come back. */
const OPEN_STATUSES = ["OPEN", "POSTPONED"] as const;

/**
 * The client's unfinished cases in the departments the user can view, newest first. The New enquiry form shows them so
 * staff can spot an existing case before making a duplicate; it warns but doesn't block, since a family can plan two
 * trips (0003, GET /api/clients/lookup).
 */
export async function listOpenEnquiriesOfClient(clientId: string, user: UserWithDepartments) {
  const departments = await viewableDepartments(user);
  const rows = await prisma.enquiry.findMany({
    where: { clientId, status: { in: [...OPEN_STATUSES] }, departmentId: { in: departments.map((d) => d.id) } },
    include: rowInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map((row) => ({ caseNo: row.caseNo, department: row.department.code, summary: summaryOf(row), stage: row.stage.name }));
}

/** "Came in through" on the New enquiry form: active sources staff may pick. */
export async function listStaffSources() {
  return prisma.enquirySource.findMany({
    where: { isActive: true, staffSelectable: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, code: true, name: true },
  });
}
