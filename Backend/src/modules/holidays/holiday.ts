import type { HolidayTargetKind, Prisma } from "../../../generated/prisma/client";
import { fromDbDate, isoWeekday } from "../../lib/dates";

// The holiday DTO and the wording every screen shows ("1 – 7 Oct 2026", "China embassy & visa centres"),
// built here so the Settings table, the pickers and the dashboard say the same thing.

/**
 * The full read for DTOs. Load it outside transactions: inside one, Prisma 7 runs the relation reads in parallel on the
 * transaction's single connection (pg warns, and it can stall the transaction while it holds its locks). Inside a
 * transaction, include at most one relation, then reload with this after commit.
 */
export const holidayInclude = {
  targets: {
    include: {
      country: { select: { id: true, code: true, name: true } },
      embassy: { select: { id: true, code: true, name: true, countryId: true } },
    },
    orderBy: { id: "asc" },
  },
  addedBy: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
  apiClient: { select: { id: true, name: true } },
} satisfies Prisma.HolidayInclude;

export type HolidayRow = Prisma.HolidayGetPayload<{ include: typeof holidayInclude }>;
type TargetRow = HolidayRow["targets"][number];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function dayParts(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return { year: y as number, month: MONTHS[(m as number) - 1] as string, day: d as number };
}

/** "Fri 2 Oct 2026" */
function longDay(value: string) {
  const { year, month, day } = dayParts(value);
  return `${WEEKDAYS[isoWeekday(value) - 1]!.slice(0, 3)} ${day} ${month} ${year}`;
}

/** "Fri 2 Oct 2026", "1 – 7 Oct 2026", "28 Sep – 3 Oct 2026", "30 Dec 2026 – 2 Jan 2027", "Every Sunday". */
export function dateLabel(h: { repeat: string; startDate: Date; endDate: Date | null; weekday: number | null }) {
  if (h.repeat === "WEEKLY") {
    const every = `Every ${WEEKDAYS[(h.weekday ?? 1) - 1]}`;
    return h.endDate ? `${every} until ${longDay(fromDbDate(h.endDate)).slice(4)}` : every;
  }
  const start = fromDbDate(h.startDate);
  const end = h.endDate ? fromDbDate(h.endDate) : start;
  if (start === end) return longDay(start);
  const a = dayParts(start);
  const b = dayParts(end);
  if (a.year !== b.year) return `${a.day} ${a.month} ${a.year} – ${b.day} ${b.month} ${b.year}`;
  if (a.month !== b.month) return `${a.day} ${a.month} – ${b.day} ${b.month} ${b.year}`;
  return `${a.day} – ${b.day} ${b.month} ${b.year}`;
}

/** The demo's "Embassy / applies to" wording ⚠️. */
export function targetLabel(t: { kind: HolidayTargetKind; country?: { name: string } | null; embassy?: { name: string } | null }) {
  switch (t.kind) {
    case "ALL_EMBASSIES":
      return "All embassies in India";
    case "COUNTRY":
      return `${t.country?.name ?? "?"} embassy & visa centres`;
    case "EMBASSY":
      return t.embassy?.name ?? "?";
    case "MASTI_OFFICE":
      return "Our office, collections & deliveries";
  }
}

function toTargetDto(t: TargetRow) {
  return {
    kind: t.kind,
    ...(t.country ? { country: t.country } : {}),
    ...(t.embassy ? { embassy: t.embassy } : {}),
    label: targetLabel(t),
  };
}

export function toHolidayDto(h: HolidayRow, newForDays: number, now = new Date()) {
  return {
    id: h.id,
    name: h.name,
    repeat: h.repeat,
    startDate: fromDbDate(h.startDate),
    endDate: h.endDate ? fromDbDate(h.endDate) : null,
    weekday: h.weekday,
    label: dateLabel(h),
    targets: h.targets.map(toTargetDto),
    status: h.status,
    source: h.source,
    reference: h.reference,
    isNew: now.getTime() - h.createdAt.getTime() < newForDays * 86_400_000,
    addedBy: h.addedBy,
    apiClient: h.apiClient,
    reviewedBy: h.reviewedBy,
    reviewedAt: h.reviewedAt,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
  };
}

export type HolidayDto = ReturnType<typeof toHolidayDto>;

/** What the audit log keeps of a holiday: its content, dates as YYYY-MM-DD, targets as keys. */
export function holidaySnapshot(h: Pick<HolidayRow, "name" | "repeat" | "startDate" | "endDate" | "weekday" | "status" | "reference"> & {
  targets: { kind: HolidayTargetKind; countryId: number | null; embassyId: number | null }[];
}) {
  return {
    name: h.name,
    repeat: h.repeat,
    startDate: fromDbDate(h.startDate),
    endDate: h.endDate ? fromDbDate(h.endDate) : null,
    weekday: h.weekday,
    status: h.status,
    reference: h.reference,
    targets: h.targets.map((t) => ({ kind: t.kind, countryId: t.countryId, embassyId: t.embassyId })),
  };
}
