import { z } from "zod";
import type { HolidayStatus, HolidayTargetKind } from "../../../generated/prisma/client";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { addMonths, fromDbDate, istToday, toDbDate } from "../../lib/dates";
import { badRequest, HttpError } from "../../lib/httpError";
import { rethrowUnique } from "../../lib/prismaErrors";
import { holidaySnapshot } from "./holiday";
import { botHolidaySchema, MAX_PUSH_ITEMS, pushHolidaysSchema, type BotHolidayInput } from "./holidays.schemas";
import { getHolidaySettings } from "./holidays.settings";

// Holidays pushed by the AI bot (docs/decisions/0005-system-masters.md §4), through /api/inbound/holidays.
// - Each item is matched by the bot's externalKey: a new key creates an entry, a known one updates it.
// - New entries are PENDING (warn, don't block) unless the botEntriesNeedReview setting is off.
// - Humans win: once a person has confirmed, edited or removed an entry, pushes for that key change nothing.
// - Each item is checked on its own; invalid items are reported and the valid ones are still saved (in one transaction).

/** How far ahead the bot may announce a holiday. */
const MAX_MONTHS_AHEAD = 24;

export interface CallingClient {
  id: string;
  name: string;
}

type ItemResult =
  | { index: number; externalKey: string | null; result: "created" | "updated" | "unchanged"; holidayId: string | null; status: HolidayStatus }
  | { index: number; externalKey: string; result: "skipped"; reason: "REVIEWED"; holidayId: string; status: HolidayStatus }
  | { index: number; externalKey: string | null; result: "invalid"; issues: Record<string, string[]> };

interface ResolvedTarget {
  kind: HolidayTargetKind;
  countryId: number | null;
  embassyId: number | null;
}

interface Planned {
  index: number;
  item: BotHolidayInput;
  targets: ResolvedTarget[];
}

const externalKeyOf = (raw: unknown) =>
  raw && typeof raw === "object" && typeof (raw as { externalKey?: unknown }).externalKey === "string"
    ? (raw as { externalKey: string }).externalKey.trim()
    : null;

const columnsOf = (item: BotHolidayInput) => ({
  name: item.name,
  repeat: "NONE" as const,
  startDate: toDbDate(item.startDate),
  endDate: toDbDate(item.endDate),
  weekday: null,
  reference: item.reference ?? null,
});

/** The content compared to decide "unchanged" (status is left out: the bot doesn't set it). */
const contentOf = (h: Parameters<typeof holidaySnapshot>[0]) => {
  const { status: _s, ...rest } = holidaySnapshot(h);
  return JSON.stringify({ ...rest, targets: [...rest.targets].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) });
};

export async function pushBotHolidays(raw: unknown, client: CallingClient, ip: string | null) {
  const { dryRun, holidays: items } = pushHolidaysSchema.parse(raw);
  if (items.length === 0) throw badRequest("Send at least one holiday.");
  if (items.length > MAX_PUSH_ITEMS) throw new HttpError(413, `Send at most ${MAX_PUSH_ITEMS} holidays at a time.`);

  const today = istToday();
  const latestStart = addMonths(today, MAX_MONTHS_AHEAD);
  const [countries, embassies, settings] = await Promise.all([
    prisma.country.findMany({ where: { isActive: true }, select: { id: true, code: true } }),
    prisma.embassy.findMany({ where: { isActive: true }, select: { id: true, code: true } }),
    getHolidaySettings(),
  ]);
  const countryByCode = new Map(countries.map((c) => [c.code, c.id]));
  const embassyByCode = new Map(embassies.map((e) => [e.code, e.id]));

  const results: ItemResult[] = [];
  const valid: Planned[] = [];
  const seen = new Set<string>();

  // 1. Check each item on its own.
  items.forEach((rawItem, index) => {
    const parsed = botHolidaySchema.safeParse(rawItem);
    if (!parsed.success) {
      results[index] = { index, externalKey: externalKeyOf(rawItem), result: "invalid", issues: z.flattenError(parsed.error).fieldErrors };
      return;
    }
    const item = parsed.data;
    const issues: Record<string, string[]> = {};
    const add = (field: string, message: string) => (issues[field] ??= []).push(message);

    if (seen.has(item.externalKey)) add("externalKey", "This key is sent twice in this push.");
    seen.add(item.externalKey);
    if (item.endDate < today) add("endDate", "This holiday is already over.");
    if (item.startDate > latestStart) add("startDate", `Holidays more than ${MAX_MONTHS_AHEAD} months ahead aren't accepted.`);

    const targets: ResolvedTarget[] = [];
    for (const t of item.targets) {
      if (t.kind === "COUNTRY") {
        const countryId = countryByCode.get(t.countryCode);
        if (countryId) targets.push({ kind: t.kind, countryId, embassyId: null });
        else add("targets", `Unknown or inactive country code: ${t.countryCode}.`);
      } else if (t.kind === "EMBASSY") {
        const embassyId = embassyByCode.get(t.embassyCode);
        if (embassyId) targets.push({ kind: t.kind, countryId: null, embassyId });
        else add("targets", `Unknown or inactive embassy code: ${t.embassyCode}.`);
      } else {
        targets.push({ kind: t.kind, countryId: null, embassyId: null });
      }
    }

    if (Object.keys(issues).length > 0) results[index] = { index, externalKey: item.externalKey, result: "invalid", issues };
    else valid.push({ index, item, targets });
  });

  // 2. Decide what each valid item does.
  const existing = await prisma.holiday.findMany({
    where: { externalKey: { in: valid.map((v) => v.item.externalKey) } },
    include: { targets: true },
  });
  const byKey = new Map(existing.map((h) => [h.externalKey, h]));
  const toCreate: Planned[] = [];
  const toUpdate: (Planned & { id: string; status: HolidayStatus })[] = [];
  const newStatus: HolidayStatus = settings.botEntriesNeedReview ? "PENDING" : "ACTIVE";

  for (const plan of valid) {
    const { index, item } = plan;
    const row = byKey.get(item.externalKey);
    if (!row) {
      toCreate.push(plan);
      results[index] = { index, externalKey: item.externalKey, result: "created", holidayId: null, status: newStatus };
    } else if (row.apiClientId !== client.id) {
      results[index] = { index, externalKey: item.externalKey, result: "invalid", issues: { externalKey: ["This key belongs to another machine account."] } };
    } else if (row.reviewedAt !== null || row.status === "REMOVED") {
      results[index] = { index, externalKey: item.externalKey, result: "skipped", reason: "REVIEWED", holidayId: row.id, status: row.status };
    } else if (contentOf(row) === contentOf({ ...columnsOf(item), status: row.status, targets: plan.targets })) {
      results[index] = { index, externalKey: item.externalKey, result: "unchanged", holidayId: row.id, status: row.status };
    } else {
      toUpdate.push({ ...plan, id: row.id, status: row.status });
      results[index] = { index, externalKey: item.externalKey, result: "updated", holidayId: row.id, status: row.status };
    }
  }

  // 3. Save (unless this is a dry run).
  if (!dryRun && toCreate.length + toUpdate.length > 0) {
    await prisma
      .$transaction(async (tx) => {
        for (const { index, item, targets } of toCreate) {
          const created = await tx.holiday.create({
            data: {
              ...columnsOf(item),
              status: newStatus,
              source: "AI_BOT",
              externalKey: item.externalKey,
              apiClientId: client.id,
              targets: { create: targets },
            },
            include: { targets: true },
          });
          await audit(
            { apiClientId: client.id, action: "holiday.create", entityType: "Holiday", entityId: created.id, after: holidaySnapshot(created), ip },
            tx,
          );
          const result = results[index];
          if (result?.result === "created") result.holidayId = created.id;
        }

        for (const { index, item, targets, id } of toUpdate) {
          // A person may have reviewed it since step 2: then leave it alone.
          const before = await tx.holiday.findUniqueOrThrow({ where: { id }, include: { targets: true } });
          const { count } = await tx.holiday.updateMany({ where: { id, reviewedAt: null, status: { not: "REMOVED" } }, data: columnsOf(item) });
          if (count === 0) {
            results[index] = { index, externalKey: item.externalKey, result: "skipped", reason: "REVIEWED", holidayId: id, status: before.status };
            continue;
          }
          await tx.holidayTarget.deleteMany({ where: { holidayId: id } });
          await tx.holidayTarget.createMany({ data: targets.map((t) => ({ ...t, holidayId: id })) });
          await audit(
            {
              apiClientId: client.id,
              action: "holiday.update",
              entityType: "Holiday",
              entityId: id,
              before: holidaySnapshot(before),
              after: holidaySnapshot({ ...columnsOf(item), status: before.status, targets }),
              ip,
            },
            tx,
          );
        }
      })
      .catch(rethrowUnique("Another push with the same key was saved at the same moment. Send it again."));
  }

  const summary = { created: 0, updated: 0, unchanged: 0, skipped: 0, invalid: 0 };
  for (const r of results) summary[r.result] += 1;
  return { dryRun, results, summary };
}

/** This machine account's own entries and their status, so the bot can see what people reviewed. */
export async function listBotHolidays(client: CallingClient, updatedSince?: string) {
  const rows = await prisma.holiday.findMany({
    where: { apiClientId: client.id, ...(updatedSince ? { updatedAt: { gte: new Date(updatedSince) } } : {}) },
    include: { targets: { include: { country: { select: { code: true } }, embassy: { select: { code: true } } }, orderBy: { id: "asc" } } },
    orderBy: { updatedAt: "asc" },
    take: 1000,
  });
  return rows.map((h) => ({
    id: h.id,
    externalKey: h.externalKey,
    name: h.name,
    startDate: fromDbDate(h.startDate),
    endDate: h.endDate ? fromDbDate(h.endDate) : null,
    targets: h.targets.map((t) => ({
      kind: t.kind,
      ...(t.country ? { countryCode: t.country.code } : {}),
      ...(t.embassy ? { embassyCode: t.embassy.code } : {}),
    })),
    reference: h.reference,
    status: h.status,
    reviewed: h.reviewedAt !== null,
    updatedAt: h.updatedAt,
  }));
}

/** The active countries and embassies by code, so the bot can map what it scrapes. */
export async function getBotTargets() {
  const countries = await prisma.country.findMany({
    where: { isActive: true },
    include: { embassies: { where: { isActive: true }, orderBy: { code: "asc" } } },
    orderBy: { code: "asc" },
  });
  return {
    kinds: ["ALL_EMBASSIES", "COUNTRY", "EMBASSY"],
    countries: countries.map((c) => ({
      code: c.code,
      name: c.name,
      embassies: c.embassies.map((e) => ({ code: e.code, name: e.name, city: e.city })),
    })),
  };
}
