import type { Prisma } from "../../../generated/prisma/client";
import { can, isHodOf, type DepartmentCode } from "../auth/permissions";
import type { UserWithDepartments } from "../users/user";

// A notice as the API sends it (docs/decisions/0017-today-dashboard.md Decision 11).

/**
 * Inside a transaction, include at most one relation (Prisma 7 + adapter-pg, as holiday.ts says): write plainly, then
 * reload with this after commit.
 */
export const noticeInclude = {
  department: { select: { code: true, name: true } },
  postedBy: { select: { id: true, name: true } },
} satisfies Prisma.NoticeInclude;

export type NoticeRow = Prisma.NoticeGetPayload<{ include: typeof noticeInclude }>;

/** Its author (while they still work in the department), the department's HOD or the Head may change or remove it. */
export function canChangeNotice(user: UserWithDepartments, notice: { postedById: string; department: { code: string } }) {
  const code = notice.department.code as DepartmentCode;
  return can(user, code, "EDIT") && (notice.postedById === user.id || isHodOf(user, code));
}

export function toNoticeDto(row: NoticeRow, user: UserWithDepartments) {
  return {
    id: row.id,
    department: row.department,
    category: row.category,
    about: row.about,
    title: row.title,
    body: row.body,
    source: row.source,
    status: row.status,
    postedBy: row.postedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    canChange: canChangeNotice(user, row),
    inLoginPopup: row.loginPopupAt !== null,
  };
}

/** What the audit log keeps of a notice. */
export function noticeSnapshot(n: {
  departmentId: number;
  category: string;
  about: string | null;
  title: string;
  body: string | null;
  source: string;
  status: string;
  loginPopupAt: Date | null;
}) {
  return {
    departmentId: n.departmentId,
    category: n.category,
    about: n.about,
    title: n.title,
    body: n.body,
    source: n.source,
    status: n.status,
    loginPopup: n.loginPopupAt !== null,
  };
}
