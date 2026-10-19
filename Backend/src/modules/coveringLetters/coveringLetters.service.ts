import type { Prisma } from "../../../generated/prisma/client";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh, definedOnly, onlyChanged, pick, staleError } from "../../lib/changes";
import { addMonths, dayLabel, fromDbDate, istToday, toDbDate } from "../../lib/dates";
import { conflict, fieldError, notFound } from "../../lib/httpError";
import { activeFilter, assertCountriesUsable } from "../../lib/masters";
import { rethrowUnique } from "../../lib/prismaErrors";
import type { Actor } from "../users/user";
import { assertCanEditVisaMasters } from "../visaMasters/access";
import { formatInclude, inForce, snapshot, toFormatDto, toFormatSummary, type FormatRow } from "./coveringLetter";
import type {
  AddWordingInput,
  CoveringLetterListQuery,
  CreateCoveringLetterInput,
  RemoveWordingInput,
  UpdateCoveringLetterInput,
} from "./coveringLetters.schemas";

// The covering-letter formats (docs/decisions/0019-covering-letters.md): one fixed letter per visa type, set of countries
// and who travels. Only the Visa HOD or the Head adds or changes one; Visa staff read them. Switched off, never deleted.
// The details change at once; the wording is dated: a new wording is added with the day it's used from, a started one is
// never changed or removed (the database refuses too), and one still to come can be changed or removed.
// Every write sends the format's updatedAt and moves it on, so two people can't overwrite each other. Audited under the
// format, so one history covers its details and its wordings.

const rethrowName = rethrowUnique("A covering letter with this name already exists.");

const STARTED = (day: string) =>
  `This wording has been in use since ${dayLabel(day)}, so it stays on record. Add a new wording instead.`;

export async function listFormats(query: CoveringLetterListQuery) {
  const rows = await prisma.coveringLetterFormat.findMany({
    where: activeFilter(query.active),
    include: formatInclude,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const today = istToday();
  return rows.map((row) => toFormatSummary(row, today));
}

async function loadFormat(id: number): Promise<FormatRow> {
  const row = await prisma.coveringLetterFormat.findUnique({ where: { id }, include: formatInclude });
  if (!row) throw notFound("Covering letter not found.");
  return row;
}

export async function getFormat(id: number) {
  return toFormatDto(await loadFormat(id), istToday());
}

/** "Use from" is a day in India, from today to a year ahead. */
function assertUseFrom(day: string, today: string) {
  if (day < today) throw fieldError("effectiveFrom", "Pick today or a later day.");
  if (day > addMonths(today, 12)) throw fieldError("effectiveFrom", "Pick a day within a year.");
}

async function assertVisaTypeUsable(visaTypeId: number) {
  const visaType = await prisma.visaType.findUnique({ where: { id: visaTypeId } });
  if (!visaType?.isActive) throw fieldError("visaTypeId", "Pick an active visa type.");
}

/**
 * One format per name, whatever the capitals. Compared with lower() exactly as the unique index
 * ("CoveringLetterFormat_name_unique") does, so the friendly check and the database never disagree.
 */
async function assertNameFree(name: string, exceptId?: number) {
  const [twin] = await prisma.$queryRaw<{ name: string; isActive: boolean }[]>`
    SELECT "name", "isActive" FROM "CoveringLetterFormat"
    WHERE lower("name") = lower(${name}) AND "id" <> ${exceptId ?? 0}
    LIMIT 1`;
  if (!twin) return;
  throw fieldError(
    "name",
    twin.isActive
      ? `“${twin.name}” is already a covering letter.`
      : `“${twin.name}” is already a covering letter, switched off. Switch it back on instead.`,
  );
}

/** Moves the format's updatedAt on, but only from the one the screen read: a save that raced past assertFresh fails. */
async function bump(tx: Db, row: FormatRow, data: Prisma.CoveringLetterFormatUpdateManyMutationInput = {}) {
  const { count } = await tx.coveringLetterFormat.updateMany({
    where: { id: row.id, updatedAt: row.updatedAt },
    data: { ...data, updatedAt: new Date() },
  });
  if (count === 0) throw staleError("covering letter");
}

const detailsOf = (row: FormatRow) => snapshot({ ...row, countryIds: row.countries.map((c) => c.countryId) });

/** A new format and its first wording. */
export async function createFormat(input: CreateCoveringLetterInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  assertUseFrom(input.effectiveFrom, istToday());
  await assertVisaTypeUsable(input.visaTypeId);
  await assertCountriesUsable(input.countryIds);
  await assertNameFree(input.name);

  const id = await prisma
    .$transaction(async (tx) => {
      const format = await tx.coveringLetterFormat.create({
        data: {
          name: input.name,
          visaTypeId: input.visaTypeId,
          party: input.party,
          sortOrder: input.sortOrder,
          countries: { create: input.countryIds.map((countryId) => ({ countryId })) },
        },
      });
      const version = await tx.coveringLetterVersion.create({
        data: { formatId: format.id, effectiveFrom: toDbDate(input.effectiveFrom), body: input.body, addedById: actor.user.id },
      });
      await audit(
        {
          actorId: actor.user.id,
          action: "coveringLetter.create",
          entityType: "CoveringLetterFormat",
          entityId: String(format.id),
          after: {
            ...snapshot({ ...format, countryIds: input.countryIds }),
            wording: { versionId: version.id, effectiveFrom: input.effectiveFrom, body: input.body },
          },
          ip: actor.ip,
        },
        tx,
      );
      return format.id;
    })
    .catch(rethrowName);
  return getFormat(id);
}

/** Changes only what was sent and differs. New countries replace the old set. Switching off is always allowed. */
export async function updateFormat(id: number, input: UpdateCoveringLetterInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  const row = await loadFormat(id);
  assertFresh(row.updatedAt, input.updatedAt, "covering letter");
  const before = detailsOf(row);

  const { updatedAt: _sent, ...fields } = input;
  const sent = definedOnly({ ...fields, countryIds: fields.countryIds && [...fields.countryIds].sort((a, b) => a - b) });
  const changes = onlyChanged(sent, before);
  const keys = Object.keys(changes);
  if (keys.length === 0) return toFormatDto(row, istToday());

  const { countryIds, ...columns } = changes;
  // A visa type or country it already has may stay, even if switched off since; a new one must be active.
  if (columns.visaTypeId !== undefined) await assertVisaTypeUsable(columns.visaTypeId);
  if (countryIds) await assertCountriesUsable(countryIds, before.countryIds);
  if (columns.name !== undefined) await assertNameFree(columns.name, id);

  await prisma
    .$transaction(async (tx) => {
      await bump(tx, row, columns);
      if (countryIds) {
        await tx.coveringLetterCountry.deleteMany({ where: { formatId: id } });
        await tx.coveringLetterCountry.createMany({ data: countryIds.map((countryId) => ({ formatId: id, countryId })) });
      }
      await audit(
        {
          actorId: actor.user.id,
          action: "coveringLetter.update",
          entityType: "CoveringLetterFormat",
          entityId: String(id),
          before: pick(before, keys),
          after: pick({ ...before, ...changes }, keys),
          ip: actor.ip,
        },
        tx,
      );
    })
    .catch(rethrowName);
  return getFormat(id);
}

/**
 * A new wording, used from its day. With replacesId it changes a wording whose day hasn't come yet: the old one is removed
 * and the new one added together. At most one wording per day still to come; today can take another, which is how a
 * wording in use is corrected (the one added last wins).
 */
export async function addVersion(id: number, input: AddWordingInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  const row = await loadFormat(id);
  assertFresh(row.updatedAt, input.updatedAt, "covering letter");
  const today = istToday();
  assertUseFrom(input.effectiveFrom, today);

  const versions = row.versions.map((v) => ({ id: v.id, effectiveFrom: fromDbDate(v.effectiveFrom), body: v.body }));
  const replaced = input.replacesId === undefined ? null : versions.find((v) => v.id === input.replacesId);
  if (replaced === undefined) throw notFound("That wording isn't on this covering letter.");
  if (replaced && replaced.effectiveFrom <= today) throw conflict(STARTED(replaced.effectiveFrom));
  if (replaced && replaced.effectiveFrom === input.effectiveFrom && replaced.body === input.body) {
    throw fieldError("body", "Nothing has changed.");
  }

  const others = versions.filter((v) => v.id !== replaced?.id);
  if (input.effectiveFrom > today && others.some((v) => v.effectiveFrom === input.effectiveFrom)) {
    throw fieldError("effectiveFrom", `A wording already starts on ${dayLabel(input.effectiveFrom)}. Change that one instead.`);
  }
  if (inForce(others, input.effectiveFrom)?.body === input.body) {
    throw fieldError("body", "That's the wording already in use from that day. Change something first.");
  }

  await prisma.$transaction(async (tx) => {
    await bump(tx, row);
    if (replaced) {
      // Only while its day is still to come: the database refuses the rest too.
      const { count } = await tx.coveringLetterVersion.deleteMany({ where: { id: replaced.id, effectiveFrom: { gt: toDbDate(today) } } });
      if (count !== 1) throw conflict(STARTED(replaced.effectiveFrom));
    }
    const version = await tx.coveringLetterVersion.create({
      data: { formatId: id, effectiveFrom: toDbDate(input.effectiveFrom), body: input.body, addedById: actor.user.id },
    });
    await audit(
      {
        actorId: actor.user.id,
        action: "coveringLetter.version.add",
        entityType: "CoveringLetterFormat",
        entityId: String(id),
        ...(replaced && { before: { replaced: { versionId: replaced.id, effectiveFrom: replaced.effectiveFrom, body: replaced.body } } }),
        after: { versionId: version.id, effectiveFrom: input.effectiveFrom, body: input.body },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getFormat(id);
}

/** Removes a wording whose day hasn't come yet. A format always keeps at least one. */
export async function removeVersion(id: number, versionId: number, input: RemoveWordingInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  const row = await loadFormat(id);
  assertFresh(row.updatedAt, input.updatedAt, "covering letter");
  const version = row.versions.find((v) => v.id === versionId);
  if (!version) throw notFound("That wording isn't on this covering letter.");
  const today = istToday();
  const day = fromDbDate(version.effectiveFrom);
  if (day <= today) throw conflict(STARTED(day));
  if (row.versions.length === 1) throw conflict("A covering letter needs a wording. Add the new one first, or switch the letter off.");

  await prisma.$transaction(async (tx) => {
    await bump(tx, row);
    const { count } = await tx.coveringLetterVersion.deleteMany({ where: { id: versionId, effectiveFrom: { gt: toDbDate(today) } } });
    if (count !== 1) throw conflict(STARTED(day));
    await audit(
      {
        actorId: actor.user.id,
        action: "coveringLetter.version.remove",
        entityType: "CoveringLetterFormat",
        entityId: String(id),
        before: { versionId, effectiveFrom: day, body: version.body },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getFormat(id);
}
