import { z } from "zod";
import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh, staleError } from "../../lib/changes";
import { badRequest, forbidden, notFound } from "../../lib/httpError";
import { can, isHodOf, type DepartmentCode } from "../auth/permissions";
import { holidayInclude } from "../holidays/holiday";
import { getHolidaySettings } from "../holidays/holidays.settings";
import type { Actor, UserWithDepartments } from "../users/user";
import { holidayItem, newHolidaysWhere, noticeItem } from "./feed";
import { canChangeNotice, noticeInclude, noticeSnapshot, toNoticeDto } from "./notice";
import type { CreateNoticeInput, ListNoticesQuery, LoginPopupSeenInput, UpdateNoticeInput } from "./notices.schemas";

// The notice board (docs/decisions/0017-today-dashboard.md Decision 11, demo screen 27). Everyone in the office reads every
// department's notices. A department's staff (EDIT), its HOD and the Head post to it; the author, the HOD and the Head
// change or remove a notice. Removing keeps the row (status REMOVED), and every change is audited.
// The visa team's login popup (Decision 12): the Head and the Visa HOD pick Visa notices for it; the visa team sees, when
// something is new to them, the picked notices and the holiday-calendar entries still new.

/** The Head or the Visa HOD put a Visa notice in the visa team's login popup ("Vimal picks", §12.18). */
const canPickForPopup = (user: UserWithDepartments) => isHodOf(user, "VISA");

/** The visa team: office staff who work Visa cases (EDIT) and the Visa HOD, not the Head, who picks what goes in. */
const onVisaTeam = (user: UserWithDepartments) => user.type === "OFFICE" && can(user, "VISA", "EDIT");

/** The popup's longest list. */
const POPUP_LIMIT = 20;

/** A notice goes in (or out of) the popup: only a Visa notice, only by the Head or the Visa HOD. */
function assertCanPick(user: UserWithDepartments, departmentCode: string) {
  if (departmentCode !== "VISA") throw badRequest("Only Visa notices go in the visa team's login popup.");
  if (!canPickForPopup(user)) throw forbidden("Only the Head and the Visa HOD choose what goes in the visa team's login popup.");
}

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
  if (input.loginPopup) assertCanPick(actor.user, department.code);

  const created = await prisma.$transaction(async (tx) => {
    const notice = await tx.notice.create({
      data: {
        departmentId: department.id,
        category: input.category,
        about: input.about ?? null,
        title: input.title,
        body: input.body ?? null,
        source: input.source,
        loginPopupAt: input.loginPopup ? new Date() : null,
        loginPopupById: input.loginPopup ? actor.user.id : null,
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

  // In or out of the visa team's popup: only a change of it needs the Head or the Visa HOD, who is then its picker.
  let { loginPopupAt, loginPopupById } = before;
  if (input.loginPopup !== undefined && input.loginPopup !== (before.loginPopupAt !== null)) {
    assertCanPick(actor.user, before.department.code);
    loginPopupAt = input.loginPopup ? new Date() : null;
    loginPopupById = input.loginPopup ? actor.user.id : null;
  }
  const changes = {
    category: input.category ?? before.category,
    about: input.about === undefined ? before.about : input.about,
    title: input.title ?? before.title,
    body: input.body === undefined ? before.body : input.body,
    source: input.source ?? before.source,
    loginPopupAt,
    loginPopupById,
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

/**
 * The visa team's login popup (Decision 12): what's new to this person. The picked Visa notices and the holiday entries
 * still new, arrived (picked, or added to the calendar) after they last dismissed it; what they posted, picked or added
 * themselves isn't news to them. Nothing for anyone outside the visa team.
 *
 * The OLDEST unseen come first, at most POPUP_LIMIT, shown newest first. "Got it" marks seen up to the newest shown, so
 * anything left out is newer than that and comes in the next batch (`more`); taking the newest instead would mark the
 * older ones seen without ever showing them.
 */
export async function loginPopup(user: UserWithDepartments, now: Date = new Date()) {
  if (!onVisaTeam(user)) return { items: [], more: false };
  const seen = user.loginPopupSeenAt;
  const { newForDays } = await getHolidaySettings();
  const [notices, holidays] = await Promise.all([
    prisma.notice.findMany({
      where: {
        status: "ACTIVE",
        department: { code: "VISA" },
        postedById: { not: user.id },
        loginPopupById: { not: user.id },
        loginPopupAt: seen ? { gt: seen } : { not: null },
      },
      include: noticeInclude,
      orderBy: [{ loginPopupAt: "asc" }, { id: "asc" }],
      take: POPUP_LIMIT + 1,
    }),
    prisma.holiday.findMany({
      where: { AND: [newHolidaysWhere(now, newForDays), { addedById: { not: user.id } }, ...(seen ? [{ createdAt: { gt: seen } }] : [])] },
      include: holidayInclude,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: POPUP_LIMIT + 1,
    }),
  ]);
  const unseen = [
    ...notices.map((n) => ({ ...noticeItem(n), at: n.loginPopupAt ?? n.createdAt })),
    ...holidays.map((h) => ({ ...holidayItem(h), at: h.createdAt })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  let batch = unseen.slice(0, POPUP_LIMIT);
  const next = unseen[POPUP_LIMIT];
  // One left out at the same instant as the newest shown would be marked seen with it: hold those back for the next
  // batch too (unless that empties this one, which would never move on).
  if (next) {
    const trimmed = batch.filter((i) => i.at.getTime() < next.at.getTime());
    if (trimmed.length > 0) batch = trimmed;
  }
  return { items: batch.reverse(), more: unseen.length > batch.length };
}

/**
 * "Got it" or "All updates": seen up to the newest item shown (never later than now), so anything that arrived while the
 * popup was open still shows next time. Audited with the items, so it's on record who acknowledged which news.
 */
export async function dismissLoginPopup(input: LoginPopupSeenInput, actor: Actor) {
  if (!onVisaTeam(actor.user)) return { seenAt: actor.user.loginPopupSeenAt };
  const sent = new Date(input.upTo);
  const upTo = sent.getTime() > Date.now() ? new Date() : sent;
  await prisma.$transaction(async (tx) => {
    // Only ever forwards: a second tab dismissing older items doesn't bring back what the first one saw.
    await tx.user.updateMany({
      where: { id: actor.user.id, OR: [{ loginPopupSeenAt: null }, { loginPopupSeenAt: { lt: upTo } }] },
      data: { loginPopupSeenAt: upTo },
    });
    await audit(
      {
        actorId: actor.user.id,
        action: "notice.popup.seen",
        entityType: "User",
        entityId: actor.user.id,
        before: { loginPopupSeenAt: actor.user.loginPopupSeenAt },
        after: { loginPopupSeenAt: upTo, noticeIds: input.noticeIds, holidayIds: input.holidayIds },
        ip: actor.ip,
      },
      tx,
    );
  });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.user.id }, select: { loginPopupSeenAt: true } });
  return { seenAt: user.loginPopupSeenAt };
}
