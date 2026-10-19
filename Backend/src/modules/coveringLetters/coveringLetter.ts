import type { Prisma } from "../../../generated/prisma/client";
import { fromDbDate } from "../../lib/dates";

// The covering-letter DTOs and the rule for which wording is in use on a day (docs/decisions/0019-covering-letters.md
// Decision 5). No queries here, so the Settings screens and the case's letter read a format the same way.

/**
 * The full read for DTOs. Load it outside transactions: inside one, Prisma 7 runs the relation reads in parallel on the
 * transaction's single connection (see holidays/holiday.ts). Writes reload with it after commit.
 */
export const formatInclude = {
  visaType: { select: { id: true, code: true, name: true, isActive: true } },
  countries: { include: { country: { select: { id: true, code: true, name: true, zone: true, isActive: true } } } },
  versions: {
    include: { addedBy: { select: { id: true, name: true } } },
    orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
  },
} satisfies Prisma.CoveringLetterFormatInclude;

export type FormatRow = Prisma.CoveringLetterFormatGetPayload<{ include: typeof formatInclude }>;

/**
 * The wording in use on a day (YYYY-MM-DD, India): the latest whose day has come; of two from the same day, the one added
 * last (the higher id). Null before the first one starts.
 */
export function inForce<V extends { id: number; effectiveFrom: string }>(versions: readonly V[], day: string): V | null {
  let found: V | null = null;
  for (const v of versions) {
    if (v.effectiveFrom > day) continue;
    if (!found || v.effectiveFrom > found.effectiveFrom || (v.effectiveFrom === found.effectiveFrom && v.id > found.id)) found = v;
  }
  return found;
}

/** In use today, still to come, or replaced by a later one. Worked out on the server, so a browser's clock never decides. */
export type WordingStatus = "IN_USE" | "SCHEDULED" | "EARLIER";

function versionsOf(row: FormatRow) {
  return row.versions.map((v) => ({
    id: v.id,
    effectiveFrom: fromDbDate(v.effectiveFrom),
    body: v.body,
    /** Null for a sample wording, set up with the system. */
    addedBy: v.addedBy,
    createdAt: v.createdAt,
  }));
}

/** A format for the list: its details, the wording in use today and the next one to start, without the texts. */
export function toFormatSummary(row: FormatRow, today: string) {
  const versions = versionsOf(row);
  const inUse = inForce(versions, today);
  const next = versions.filter((v) => v.effectiveFrom > today).at(-1) ?? null;
  return {
    id: row.id,
    name: row.name,
    visaType: row.visaType,
    party: row.party,
    /** By name: "China", "France". */
    countries: row.countries.map((c) => c.country).sort((a, b) => a.name.localeCompare(b.name)),
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    inUse: inUse && { id: inUse.id, effectiveFrom: inUse.effectiveFrom, addedBy: inUse.addedBy },
    next: next && { id: next.id, effectiveFrom: next.effectiveFrom },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** One format with every wording, newest day first. */
export function toFormatDto(row: FormatRow, today: string) {
  const versions = versionsOf(row);
  const inUse = inForce(versions, today);
  const status = (v: { id: number; effectiveFrom: string }): WordingStatus =>
    v.id === inUse?.id ? "IN_USE" : v.effectiveFrom > today ? "SCHEDULED" : "EARLIER";
  return { ...toFormatSummary(row, today), versions: versions.map((v) => ({ ...v, status: status(v) })) };
}

export type CoveringLetterSummary = ReturnType<typeof toFormatSummary>;
export type CoveringLetterDto = ReturnType<typeof toFormatDto>;

const sortedIds = (ids: number[]) => [...ids].sort((a, b) => a - b);

/** What the audit log keeps of a format's details, and what an edit is compared against: countries as sorted ids. */
export function snapshot(row: Pick<FormatRow, "name" | "visaTypeId" | "party" | "sortOrder" | "isActive"> & { countryIds: number[] }) {
  return {
    name: row.name,
    visaTypeId: row.visaTypeId,
    party: row.party,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    countryIds: sortedIds(row.countryIds),
  };
}
