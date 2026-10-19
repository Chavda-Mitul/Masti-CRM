import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, istDateTimeToUtc, istToday } from "../src/lib/dates";
import { nextOpenDay } from "../src/modules/holidays/blockedDays";
import { seedHolidays } from "../src/modules/holidays/holidays.seed";
import { dueBeforeOfficeDay, dueOnOfficeDay } from "../src/modules/visa/visa.settings";
import { prisma, resetDb } from "./helpers";

// A check is never due before it's set (fixed 19 Oct 2026, code review): when the check's time on its day has already
// passed, it's due on the first open office day from today whose time is still to come. Before, passports expected
// today and saved after 11:00 were due at 11:00 that day, late at once.

beforeEach(async () => {
  await resetDb();
  await seedHolidays(prisma);
});
afterEach(() => {
  vi.useRealTimers();
});

const iso = (day: string, time: string) => istDateTimeToUtc(day, time).toISOString();
const openFrom = (day: string) => nextOpenDay(day, { office: true });

/** Pretends it's `time` (IST) on the first open office day from today, and returns that day. */
async function itIs(time: string) {
  const day = await openFrom(istToday());
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(istDateTimeToUtc(day, time));
  return day;
}

describe("due on an office day (dueOnOfficeDay)", () => {
  it("passports expected today, saved after 11:00: due the next open office day at 11:00, not late at once", async () => {
    const today = await itIs("14:00");
    const due = await dueOnOfficeDay({ afterDays: 0, at: "11:00" }, prisma, today);
    expect(due.toISOString()).toBe(iso(await openFrom(addDays(today, 1)), "11:00"));
  });

  it("saved before 11:00, it's due at 11:00 the same day", async () => {
    const today = await itIs("09:30");
    expect((await dueOnOfficeDay({ afterDays: 0, at: "11:00" }, prisma, today)).toISOString()).toBe(iso(today, "11:00"));
  });

  it("a day already gone moves to the first open office day from today", async () => {
    const today = await itIs("09:30");
    expect((await dueOnOfficeDay({ afterDays: 0, at: "11:00" }, prisma, addDays(today, -5))).toISOString()).toBe(iso(today, "11:00"));
  });

  it("the usual case is unchanged: the next open office day after today, at 11:00", async () => {
    const today = await itIs("16:00");
    expect((await dueOnOfficeDay({ afterDays: 1, at: "11:00" }, prisma)).toISOString()).toBe(iso(await openFrom(addDays(today, 1)), "11:00"));
  });
});

describe("due before a date (dueBeforeOfficeDay)", () => {
  it("a collection tomorrow, saved after 11:00 today: due tomorrow at 11:00, not this morning", async () => {
    const today = await itIs("14:00");
    const collection = await openFrom(addDays(today, 1));
    const due = await dueBeforeOfficeDay(collection, { daysBefore: 1, at: "11:00" }, prisma);
    // The office day before the collection is today, and today's 11:00 has gone: the next open day is the collection's.
    expect(due.toISOString()).toBe(iso(collection, "11:00"));
  });

  it("saved early, it's due the office day before at 11:00, as before", async () => {
    const today = await itIs("08:00");
    const collection = await openFrom(addDays(today, 10));
    const due = await dueBeforeOfficeDay(collection, { daysBefore: 1, at: "11:00" }, prisma);
    expect(due.getTime()).toBeLessThan(istDateTimeToUtc(collection, "11:00").getTime());
    expect(due.getTime()).toBeGreaterThan(Date.now());
  });
});
