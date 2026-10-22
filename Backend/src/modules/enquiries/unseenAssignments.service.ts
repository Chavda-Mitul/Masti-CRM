import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import type { Actor, UserWithDepartments } from "../users/user";
import { UNFINISHED } from "./visibility";

// The red dot on a department in the sidebar: cases the HOD or the Head gave to this person that they haven't seen yet
// (docs/decisions/0006-visa-documents.md amendment 22). Clicking the department clears its dot.

/** In reassign's transaction: the case is new to whoever got it, unless they gave it to themselves. */
export async function markGiven(tx: Db, enquiryId: string, toUserId: string, byUserId: string) {
  await tx.unseenAssignment.deleteMany({ where: { enquiryId } });
  if (toUserId !== byUserId) await tx.unseenAssignment.create({ data: { enquiryId, userId: toUserId } });
}

/** Cases still theirs and unfinished: one taken back since, or closed, doesn't keep the dot. */
const stillTheirs = (user: UserWithDepartments) => ({ userId: user.id, enquiry: { AND: [UNFINISHED, { ownerId: user.id }] } });

/** How many cases per department code, for the dots. Departments with none are left out. */
export async function unseenCounts(user: UserWithDepartments) {
  const rows = await prisma.unseenAssignment.findMany({
    where: stillTheirs(user),
    select: { enquiry: { select: { department: { select: { code: true } } } } },
  });
  const departments: Record<string, number> = {};
  for (const { enquiry } of rows) departments[enquiry.department.code] = (departments[enquiry.department.code] ?? 0) + 1;
  return { departments };
}

/** Clicked the department: its dot goes. Audited with the cases, so it's on record when they saw what they were given. */
export async function markSeen(department: string, actor: Actor) {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.unseenAssignment.findMany({
      where: { userId: actor.user.id, enquiry: { department: { code: department } } },
      select: { enquiryId: true, enquiry: { select: { caseNo: true } } },
    });
    if (rows.length === 0) return;
    await tx.unseenAssignment.deleteMany({ where: { enquiryId: { in: rows.map((r) => r.enquiryId) }, userId: actor.user.id } });
    await audit(
      {
        actorId: actor.user.id,
        action: "enquiry.assignment.seen",
        entityType: "User",
        entityId: actor.user.id,
        after: { department, caseNos: rows.map((r) => r.enquiry.caseNo) },
        ip: actor.ip,
      },
      tx,
    );
  });
}
