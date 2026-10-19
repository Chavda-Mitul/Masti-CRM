import { z } from "zod";
import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh, staleError } from "../../lib/changes";
import { badRequest, forbidden, notFound } from "../../lib/httpError";
import { can, type DepartmentCode } from "../auth/permissions";
import type { Actor, UserWithDepartments } from "../users/user";
import { canChangeNotice, noticeInclude, noticeSnapshot, toNoticeDto } from "./notice";
import type { CreateNoticeInput, ListNoticesQuery, UpdateNoticeInput } from "./notices.schemas";

// The notice board (docs/decisions/0017-today-dashboard.md Decision 11, demo screen 27). Everyone in the office reads every
// department's notices. A department's staff (EDIT), its HOD and the Head post to it; the author, the HOD and the Head
// change or remove a notice. Removing keeps the row (status REMOVED), and every change is audited.

// Paging, newest first. The cursor carries the last row's (createdAt, id), as the enquiries list's does.
const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.string().min(1).max(64) });

function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ createdAt: row.createdAt.toISOString(), id: row.id })).toString("base64url");
}

/** Rows older than the cursor's, in the board's order. */
function afterCursor(raw: string): Prisma.NoticeWhereInput {
  let cursor: z.infer<typeof cursorSchema>;
  try {
    cursor = cursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
  } catch {
    throw badRequest("This list has changed. Reload it.");
  }
  const createdAt = new Date(cursor.createdAt);
  return { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: cursor.id } }] };
}

async function loadOr404(id: string) {
  const row = await prisma.notice.findUnique({ where: { id }, include: noticeInclude });
  if (!row) throw notFound("Notice not found.");
  return row;
}

/** The board: active notices of the active departments, newest first, narrowed by a department tab and a category pill. */
export async function listNotices(query: ListNoticesQuery, user: UserWithDepartments) {
  const where: Prisma.NoticeWhereInput = {
    status: "ACTIVE",
    department: { isActive: true, ...(query.department ? { code: query.department } : {}) },
    ...(query.category ? { category: query.category } : {}),
  };
  const rows = await prisma.notice.findMany({
    where: query.cursor ? { AND: [where, afterCursor(query.cursor)] } : where,
    include: noticeInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
  });
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return {
    notices: page.map((row) => toNoticeDto(row, user)),
    nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
  };
}

/** A department's staff with EDIT, its HOD or the Head posts to its board. */
export async function createNotice(input: CreateNoticeInput, actor: Actor) {
  const department = await prisma.department.findFirst({ where: { code: input.departmentCode, isActive: true } });
  if (!department) throw badRequest(`Unknown department: ${input.departmentCode}`);
  if (!can(actor.user, department.code as DepartmentCode, "EDIT")) {
    throw forbidden("Only the department's staff can post to its notice board.");
  }

  const created = await prisma.$transaction(async (tx) => {
    const notice = await tx.notice.create({
      data: {
        departmentId: department.id,
        category: input.category,
        about: input.about ?? null,
        title: input.title,
        body: input.body ?? null,
        source: input.source,
        postedById: actor.user.id,
      },
    });
    await audit(
      { actorId: actor.user.id, action: "notice.create", entityType: "Notice", entityId: notice.id, after: noticeSnapshot(notice), ip: actor.ip },
      tx,
    );
    return notice;
  });
  return toNoticeDto(await loadOr404(created.id), actor.user);
}

/** The author, the department's HOD or the Head; from the version they opened (updatedAt). Nothing changed: nothing written. */
export async function updateNotice(id: string, input: UpdateNoticeInput, actor: Actor) {
  const before = await loadOr404(id);
  if (before.status === "REMOVED") throw badRequest("This notice was removed.");
  if (!canChangeNotice(actor.user, before)) {
    throw forbidden("Only its author, the department's HOD and the Head can change this notice.");
  }
  assertFresh(before.updatedAt, input.updatedAt, "notice");

  const changes = {
    category: input.category ?? before.category,
    about: input.about === undefined ? before.about : input.about,
    title: input.title ?? before.title,
    body: input.body === undefined ? before.body : input.body,
    source: input.source ?? before.source,
  };
  const oldSnapshot = noticeSnapshot(before);
  const newSnapshot = noticeSnapshot({ ...before, ...changes });
  if (JSON.stringify(newSnapshot) === JSON.stringify(oldSnapshot)) return toNoticeDto(before, actor.user);

  await prisma.$transaction(async (tx) => {
    // The updatedAt condition makes a save that raced past assertFresh fail instead of overwriting.
    const { count } = await tx.notice.updateMany({ where: { id, updatedAt: before.updatedAt }, data: changes });
    if (count === 0) throw staleError("notice");
    await audit(
      { actorId: actor.user.id, action: "notice.update", entityType: "Notice", entityId: id, before: oldSnapshot, after: newSnapshot, ip: actor.ip },
      tx,
    );
  });
  return toNoticeDto(await loadOr404(id), actor.user);
}

/** Off the board, kept for the record. Removing a removed notice changes nothing. */
export async function removeNotice(id: string, actor: Actor) {
  const before = await loadOr404(id);
  if (!canChangeNotice(actor.user, before)) {
    throw forbidden("Only its author, the department's HOD and the Head can remove this notice.");
  }
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.notice.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "REMOVED" } });
    if (count === 0) return;
    await audit(
      { actorId: actor.user.id, action: "notice.remove", entityType: "Notice", entityId: id, before: { status: "ACTIVE" }, after: { status: "REMOVED" }, ip: actor.ip },
      tx,
    );
  });
  return toNoticeDto(await loadOr404(id), actor.user);
}
