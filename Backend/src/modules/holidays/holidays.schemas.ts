import { z } from "zod";
import { HolidayRepeat, HolidayStatus, HolidayTargetKind } from "../../../generated/prisma/enums";

// Only zod and the generated enums are imported here, so these schemas can later be shared with the frontend.
// Dates are YYYY-MM-DD in India time. See docs/decisions/0005-system-masters.md.

/** A dated holiday covers at most this many days (a sanity limit: China's week-long closure is 7). */
export const MAX_RANGE_DAYS = 60;
export const MAX_TARGETS = 10;
/** The blocked-dates API answers at most this many days at once. */
export const MAX_BLOCKED_RANGE_DAYS = 366;
/** The bot sends at most this many holidays per push. */
export const MAX_PUSH_ITEMS = 200;

const isoDate = z.iso.date("Use a date like 2026-10-08.");
const id = z.number().int().positive();
const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const reference = z.preprocess(blankToNull, z.string().trim().max(300).nullable()).optional();

/** Days from one date to another, counting both ends. */
const daysInclusive = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export const holidayTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal(HolidayTargetKind.ALL_EMBASSIES) }),
  z.object({ kind: z.literal(HolidayTargetKind.COUNTRY), countryId: id }),
  z.object({ kind: z.literal(HolidayTargetKind.EMBASSY), embassyId: id }),
  z.object({ kind: z.literal(HolidayTargetKind.MASTI_OFFICE) }),
]);

export type HolidayTargetInput = z.infer<typeof holidayTargetSchema>;

/** "COUNTRY:3" — one key per distinct target. */
export function targetKey(t: { kind: string; countryId?: number | null; embassyId?: number | null }) {
  return `${t.kind}:${t.countryId ?? ""}:${t.embassyId ?? ""}`;
}

const holidayFields = {
  name: z.string().trim().min(1, "Give the holiday a name.").max(80),
  repeat: z.enum(HolidayRepeat).default("NONE"),
  startDate: isoDate,
  endDate: isoDate.nullable().optional(),
  /** ISO weekday, 1 = Monday … 7 = Sunday. Weekly holidays only. */
  weekday: z.number().int().min(1).max(7).nullable().optional(),
  targets: z.array(holidayTargetSchema).min(1, "Pick what the holiday applies to.").max(MAX_TARGETS),
  reference,
};

interface Shape {
  repeat: HolidayRepeat;
  startDate: string;
  endDate?: string | null | undefined;
  weekday?: number | null | undefined;
  targets: HolidayTargetInput[];
}

/** The cross-field rules (the database checks the same). */
function checkShape(h: Shape, ctx: z.RefinementCtx) {
  const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (h.repeat === "NONE") {
    if (h.weekday != null) issue("weekday", "Only a weekly holiday has a weekday.");
    if (!h.endDate) issue("endDate", "Enter the last day (the same as the first for one day).");
    else if (h.endDate < h.startDate) issue("endDate", "The last day can't be before the first.");
    else if (daysInclusive(h.startDate, h.endDate) > MAX_RANGE_DAYS) issue("endDate", `A holiday can cover at most ${MAX_RANGE_DAYS} days.`);
  } else {
    if (h.weekday == null) issue("weekday", "Pick the day of the week.");
    if (h.endDate && h.endDate < h.startDate) issue("endDate", "The end can't be before the start.");
  }
  if (new Set(h.targets.map(targetKey)).size !== h.targets.length) issue("targets", "Each target can be picked only once.");
}

/** A whole holiday, as created (and as an edit looks once merged with the saved row). */
export const holidayShapeSchema = z.object(holidayFields).superRefine(checkShape);

export const createHolidaySchema = z
  .object({ ...holidayFields, confirmDuplicates: z.boolean().default(false) })
  .superRefine(checkShape);

/** Only the fields sent change; the service merges them with the saved row and checks the whole again. */
export const updateHolidaySchema = z.object({
  name: holidayFields.name.optional(),
  repeat: z.enum(HolidayRepeat).optional(),
  startDate: isoDate.optional(),
  endDate: holidayFields.endDate,
  weekday: holidayFields.weekday,
  targets: holidayFields.targets.optional(),
  reference,
  /** The updatedAt the screen read. A mismatch means someone else saved in between. */
  updatedAt: z.iso.datetime("Reload and try again."),
  confirmDuplicates: z.boolean().default(false),
});

const optionalId = z.coerce.number().int().positive().optional();

export const listHolidaysQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  /** Omitted: everything except REMOVED. */
  status: z.enum(HolidayStatus).optional(),
  kind: z.enum(HolidayTargetKind).optional(),
  countryId: optionalId,
  embassyId: optionalId,
});

export const blockedQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    embassyId: optionalId,
    office: z.enum(["true"]).optional(),
  })
  .superRefine((q, ctx) => {
    if ((q.embassyId === undefined) === (q.office === undefined)) {
      ctx.addIssue({ code: "custom", path: ["embassyId"], message: "Ask for one embassy (embassyId) or for our office (office=true)." });
    }
    if (q.to < q.from) ctx.addIssue({ code: "custom", path: ["to"], message: "'to' can't be before 'from'." });
    else if (daysInclusive(q.from, q.to) > MAX_BLOCKED_RANGE_DAYS) {
      ctx.addIssue({ code: "custom", path: ["to"], message: `Ask for at most ${MAX_BLOCKED_RANGE_DAYS} days at a time.` });
    }
  });

/** The "holidays" Setting row. See holidays.settings.ts. */
export const holidaySettingsSchema = z.object({
  /** How long a new entry shows the "new" chip. */
  newForDays: z.number().int().min(1).max(90),
  /** Bot entries wait as PENDING for a person to confirm them. */
  botEntriesNeedReview: z.boolean(),
});

export const updateHolidaySettingsSchema = holidaySettingsSchema.partial();

// ---------------------------------------------------------------------------
// The AI bot (machine-to-machine)
// ---------------------------------------------------------------------------

/** The bot names countries and embassies by code. It pushes embassy holidays only (no MASTI_OFFICE). */
export const botTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal(HolidayTargetKind.ALL_EMBASSIES) }),
  z.object({ kind: z.literal(HolidayTargetKind.COUNTRY), countryCode: z.string().trim().toUpperCase().max(2) }),
  z.object({ kind: z.literal(HolidayTargetKind.EMBASSY), embassyCode: z.string().trim().toUpperCase().max(20) }),
]);

export const botHolidaySchema = z
  .object({
    /** The bot's own stable id for this announcement. Pushing it again updates the same entry. */
    externalKey: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9._:-]+$/, "Use letters, digits and . _ : - only."),
    name: holidayFields.name,
    startDate: isoDate,
    endDate: isoDate,
    targets: z.array(botTargetSchema).min(1).max(MAX_TARGETS),
    reference,
  })
  .superRefine((h, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (h.endDate < h.startDate) issue("endDate", "The last day can't be before the first.");
    else if (daysInclusive(h.startDate, h.endDate) > MAX_RANGE_DAYS) issue("endDate", `A holiday can cover at most ${MAX_RANGE_DAYS} days.`);
    const keys = h.targets.map((t) => `${t.kind}:${"countryCode" in t ? t.countryCode : ""}:${"embassyCode" in t ? t.embassyCode : ""}`);
    if (new Set(keys).size !== keys.length) issue("targets", "Each target can be sent only once.");
  });

/** Items are checked one by one in the service, so one bad item doesn't refuse the batch. */
export const pushHolidaysSchema = z.object({
  dryRun: z.boolean().default(false),
  holidays: z.array(z.unknown()),
});

export const botListQuerySchema = z.object({
  updatedSince: z.iso.datetime("Use an ISO date-time, e.g. 2026-10-08T00:00:00Z.").optional(),
});

export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;
export type UpdateHolidayInput = z.infer<typeof updateHolidaySchema>;
export type HolidayShape = z.infer<typeof holidayShapeSchema>;
export type ListHolidaysQuery = z.infer<typeof listHolidaysQuerySchema>;
export type BlockedQuery = z.infer<typeof blockedQuerySchema>;
export type HolidaySettings = z.infer<typeof holidaySettingsSchema>;
export type UpdateHolidaySettingsInput = z.infer<typeof updateHolidaySettingsSchema>;
export type BotHolidayInput = z.infer<typeof botHolidaySchema>;
export type BotTargetInput = z.infer<typeof botTargetSchema>;
