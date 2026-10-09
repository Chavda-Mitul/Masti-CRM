import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh, staleError } from "../../lib/changes";
import { fromDbDate, istToday, toDbDate } from "../../lib/dates";
import { badRequest, forbidden, HttpError, notFound } from "../../lib/httpError";
import { isHodOfAny } from "../auth/permissions";
import type { Actor, UserWithDepartments } from "../users/user";
import { blockedDays, type BlockTarget } from "./blockedDays";
import { dateLabel, holidayInclude, holidaySnapshot, targetLabel, toHolidayDto, type HolidayRow } from "./holiday";
import {
  holidayShapeSchema,
  targetKey,
  type BlockedQuery,
  type CreateHolidayInput,
  type HolidayShape,
  type HolidayTargetInput,
  type ListHolidaysQuery,
  type UpdateHolidayInput,
  type UpdateHolidaySettingsInput,
} from "./holidays.schemas";
import { getHolidaySettings, HOLIDAY_SETTINGS_KEY } from "./holidays.settings";

// The holiday calendar, for staff (docs/decisions/0005-system-masters.md §1–4, §8).
// Everyone in the office can read it; the Head or any HOD changes it. Removing keeps the row (status REMOVED).

const MAX_LIST = 500;

function assertCanEditHolidays(user: UserWithDepartments) {
  if (!isHodOfAny(user)) throw forbidden("Only the Head or an HOD can change the holiday calendar.");
}

async function getRowOr404(id: string) {
  const row = await prisma.holiday.findUnique({ where: { id }, include: holidayInclude });
  if (!row) throw notFound("Holiday not found.");
  return row;
}

async function toDto(row: HolidayRow) {
  const { newForDays } = await getHolidaySettings();
  return toHolidayDto(row, newForDays);
}

const targetRows = (targets: HolidayTargetInput[]) =>
  targets.map((t) => ({
    kind: t.kind,
    countryId: t.kind === "COUNTRY" ? t.countryId : null,
    embassyId: t.kind === "EMBASSY" ? t.embassyId : null,
  }));

/** Newly picked countries and embassies must exist and be active. Ones already on the holiday may stay. */
async function assertTargetsUsable(targets: HolidayTargetInput[], already: Set<string> = new Set()) {
  const added = targetRows(targets).filter((t) => !already.has(targetKey(t)));
  const countryIds = added.flatMap((t) => (t.countryId ? [t.countryId] : []));
  const embassyIds = added.flatMap((t) => (t.embassyId ? [t.embassyId] : []));
  if (countryIds.length && (await prisma.country.count({ where: { id: { in: countryIds }, isActive: true } })) !== countryIds.length) {
    throw badRequest("Pick an active country.");
  }
  if (embassyIds.length && (await prisma.embassy.count({ where: { id: { in: embassyIds }, isActive: true } })) !== embassyIds.length) {
    throw badRequest("Pick an active embassy.");
  }
}

/**
 * Another live holiday with the same dates and a shared target is usually a mistake, so it's a warning:
 * 409 { code: "DUPLICATE", matches }, then save again with confirmDuplicates (as for clients, 0004).
 */
async function assertNoDuplicate(h: HolidayShape, confirmed: boolean, exceptId?: string) {
  if (confirmed) return;
  const matches = await prisma.holiday.findMany({
    where: {
      ...(exceptId ? { id: { not: exceptId } } : {}),
      status: { not: "REMOVED" },
      repeat: h.repeat,
      startDate: toDbDate(h.startDate),
      endDate: h.endDate ? toDbDate(h.endDate) : null,
      weekday: h.repeat === "WEEKLY" ? (h.weekday ?? null) : null,
      targets: { some: { OR: targetRows(h.targets) } },
    },
    include: holidayInclude,
    take: 5,
  });
  if (matches.length === 0) return;
  throw new HttpError(409, "A holiday with the same dates already applies here. Save again to add it anyway.", {
    code: "DUPLICATE",
    matches: matches.map((m) => ({ id: m.id, name: m.name, label: dateLabel(m), targets: m.targets.map(targetLabel), status: m.status })),
  });
}

/** The saved row in the shape of a create request, so an edit can be merged in and checked as a whole. */
function shapeOf(row: HolidayRow): HolidayShape {
  return {
    name: row.name,
    repeat: row.repeat,
    startDate: fromDbDate(row.startDate),
    endDate: row.endDate ? fromDbDate(row.endDate) : null,
    weekday: row.weekday,
    targets: row.targets.map((t) =>
      t.kind === "COUNTRY"
        ? { kind: t.kind, countryId: t.countryId! }
        : t.kind === "EMBASSY"
          ? { kind: t.kind, embassyId: t.embassyId! }
          : { kind: t.kind },
    ),
    reference: row.reference,
  };
}

function columnsOf(h: HolidayShape) {
  return {
    name: h.name,
    repeat: h.repeat,
    startDate: toDbDate(h.startDate),
    endDate: h.endDate ? toDbDate(h.endDate) : null,
    weekday: h.repeat === "WEEKLY" ? (h.weekday ?? null) : null,
    reference: h.reference ?? null,
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The Settings table. Defaults: from today (IST), every status except REMOVED. Dated holidays first, then weekly ones. */
export async function listHolidays(query: ListHolidaysQuery) {
  const from = query.from ?? istToday();
  const targetFilter: Prisma.HolidayTargetWhereInput = {
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.countryId ? { countryId: query.countryId } : {}),
    ...(query.embassyId ? { embassyId: query.embassyId } : {}),
  };
  const rows = await prisma.holiday.findMany({
    where: {
      status: query.status ?? { not: "REMOVED" },
      OR: [{ endDate: null }, { endDate: { gte: toDbDate(from) } }],
      ...(query.to ? { startDate: { lte: toDbDate(query.to) } } : {}),
      ...(Object.keys(targetFilter).length ? { targets: { some: targetFilter } } : {}),
    },
    include: holidayInclude,
    orderBy: [{ repeat: "asc" }, { startDate: "asc" }, { name: "asc" }],
    take: MAX_LIST,
  });
  const { newForDays } = await getHolidaySettings();
  const now = new Date();
  return rows.map((row) => toHolidayDto(row, newForDays, now));
}

/** Options for the "Applies to" picker. */
export async function getTargetOptions() {
  const countries = await prisma.country.findMany({
    where: { isActive: true },
    include: { embassies: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return {
    kinds: (["ALL_EMBASSIES", "COUNTRY", "EMBASSY", "MASTI_OFFICE"] as const).map((kind) => ({
      kind,
      label: { ALL_EMBASSIES: "All embassies in India", COUNTRY: "A country's embassy & visa centres", EMBASSY: "One embassy", MASTI_OFFICE: targetLabel({ kind }) }[kind],
    })),
    countries: countries.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      label: targetLabel({ kind: "COUNTRY", country: c }),
      embassies: c.embassies.map((e) => ({ id: e.id, code: e.code, name: e.name, city: e.city })),
    })),
  };
}

export async function listBlockedDays(query: BlockedQuery) {
  const target: BlockTarget = query.office ? { office: true } : { embassyId: query.embassyId! };
  return { from: query.from, to: query.to, days: await blockedDays(query.from, query.to, target) };
}

// ---------------------------------------------------------------------------
// Changing
// ---------------------------------------------------------------------------

export async function createHoliday(input: CreateHolidayInput, actor: Actor) {
  assertCanEditHolidays(actor.user);
  await assertTargetsUsable(input.targets);
  await assertNoDuplicate(input, input.confirmDuplicates);

  const created = await prisma.$transaction(async (tx) => {
    // One relation only inside the transaction (see holidayInclude); the full row is loaded after commit.
    const created = await tx.holiday.create({
      data: { ...columnsOf(input), status: "ACTIVE", addedById: actor.user.id, targets: { create: targetRows(input.targets) } },
      include: { targets: true },
    });
    await audit(
      {
        actorId: actor.user.id,
        action: "holiday.create",
        entityType: "Holiday",
        entityId: created.id,
        after: { ...holidaySnapshot(created), ...(input.confirmDuplicates ? { confirmedDuplicates: true } : {}) },
        ip: actor.ip,
      },
      tx,
    );
    return created;
  });
  return toDto(await getRowOr404(created.id));
}

/** Only the fields sent change. */
export async function updateHoliday(id: string, input: UpdateHolidayInput, actor: Actor) {
  assertCanEditHolidays(actor.user);
  const before = await getRowOr404(id);
  if (before.status === "REMOVED") throw badRequest("This holiday was removed. Add it again instead.");
  assertFresh(before.updatedAt, input.updatedAt, "holiday");

  const current = shapeOf(before);
  const { updatedAt: _u, confirmDuplicates, ...sent } = input;
  const merged = holidayShapeSchema.parse({
    ...current,
    ...Object.fromEntries(Object.entries(sent).filter(([, value]) => value !== undefined)),
  });

  const oldSnapshot = holidaySnapshot(before);
  const newColumns = columnsOf(merged);
  const newTargets = targetRows(merged.targets);
  const newSnapshot = holidaySnapshot({ ...newColumns, status: before.status, targets: newTargets });
  if (JSON.stringify(newSnapshot) === JSON.stringify(oldSnapshot)) return toDto(before);

  const targetsChanged = JSON.stringify(newSnapshot.targets) !== JSON.stringify(oldSnapshot.targets);
  await assertTargetsUsable(merged.targets, new Set(before.targets.map(targetKey)));
  await assertNoDuplicate(merged, confirmDuplicates, id);

  await prisma.$transaction(async (tx) => {
    // The updatedAt condition makes a save that raced past assertFresh fail instead of overwriting.
    const { count } = await tx.holiday.updateMany({
      where: { id, updatedAt: before.updatedAt },
      data: newColumns,
    });
    if (count === 0) throw staleError("holiday");
    if (targetsChanged) {
      await tx.holidayTarget.deleteMany({ where: { holidayId: id } });
      await tx.holidayTarget.createMany({ data: newTargets.map((t) => ({ ...t, holidayId: id })) });
    }
    await audit(
      {
        actorId: actor.user.id,
        action: "holiday.update",
        entityType: "Holiday",
        entityId: id,
        before: oldSnapshot,
        after: { ...newSnapshot, ...(confirmDuplicates ? { confirmedDuplicates: true } : {}) },
        ip: actor.ip,
      },
      tx,
    );
  });
  return toDto(await getRowOr404(id));
}

/** → REMOVED: those dates can be picked again. The row stays for the record. Removing twice changes nothing. */
export async function removeHoliday(id: string, actor: Actor) {
  assertCanEditHolidays(actor.user);
  const before = await getRowOr404(id);
  const removed = await prisma.$transaction(async (tx) => {
    const { count } = await tx.holiday.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "REMOVED" } });
    if (count === 0) return false;
    await audit(
      {
        actorId: actor.user.id,
        action: "holiday.remove",
        entityType: "Holiday",
        entityId: id,
        before: { status: before.status },
        after: { status: "REMOVED" },
        ip: actor.ip,
      },
      tx,
    );
    return true;
  });
  return toDto(removed ? await getRowOr404(id) : before);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSettings() {
  return getHolidaySettings();
}

export async function updateSettings(input: UpdateHolidaySettingsInput, actor: Actor) {
  const before = await getHolidaySettings();
  const after = { ...before, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
  if (JSON.stringify(after) === JSON.stringify(before)) return before;
  await prisma.$transaction(async (tx) => {
    await tx.setting.upsert({ where: { key: HOLIDAY_SETTINGS_KEY }, update: { value: after }, create: { key: HOLIDAY_SETTINGS_KEY, value: after } });
    await audit(
      { actorId: actor.user.id, action: "setting.update", entityType: "Setting", entityId: HOLIDAY_SETTINGS_KEY, before, after, ip: actor.ip },
      tx,
    );
  });
  return getHolidaySettings();
}
