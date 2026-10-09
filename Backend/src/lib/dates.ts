// Date-only values ("2026-10-08") for @db.Date columns. Masti works in India time, so "today" is the IST date.
// YYYY-MM-DD strings compare correctly with < and >.

const IST_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });

/** Today's date in India, as YYYY-MM-DD. */
export function istToday(now: Date = new Date()): string {
  return IST_DATE.format(now);
}

/** "2026-10-08" → the Date Prisma reads and writes for a @db.Date column (UTC midnight). */
export function toDbDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** A @db.Date value → "2026-10-08". */
export function fromDbDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parts(value: string): [number, number, number] {
  const [y, m, d] = value.split("-").map(Number);
  return [y as number, m as number, d as number];
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** "2026-10-08" plus 12 months → "2027-10-08". Month ends clamp: 31 Jan + 1 month → 28/29 Feb. */
export function addMonths(value: string, months: number): string {
  const [y, m, d] = parts(value);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${pad(year, 4)}-${pad(month)}-${pad(Math.min(d, lastDay))}`;
}

/** Completed years from one date to another, e.g. an age. */
export function wholeYearsBetween(from: string, to: string): number {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  const years = ty - fy;
  return tm < fm || (tm === fm && td < fd) ? years - 1 : years;
}

/** "2026-10-08" plus 3 days → "2026-10-11". Negative days go back. */
export function addDays(value: string, days: number): string {
  const [y, m, d] = parts(value);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Days from one date to another, counting both ends: 1 Oct → 7 Oct is 7. */
export function daysInclusive(from: string, to: string): number {
  return Math.round((toDbDate(to).getTime() - toDbDate(from).getTime()) / 86_400_000) + 1;
}

/** ISO weekday of a date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(value: string): number {
  return ((toDbDate(value).getUTCDay() + 6) % 7) + 1;
}

/** A date and an "HH:mm" wall-clock time in India → the instant (UTC Date). IST has no daylight saving. */
export function istDateTimeToUtc(date: string, time: string): Date {
  return new Date(`${date}T${time}:00.000+05:30`);
}
