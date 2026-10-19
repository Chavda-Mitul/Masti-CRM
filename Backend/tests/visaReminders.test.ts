import { beforeEach, describe, expect, it } from "vitest";
import { addDays, istDateTimeToUtc, istToday, toDbDate } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { nextOpenDay } from "../src/modules/holidays/blockedDays";
import { seedHolidays } from "../src/modules/holidays/holidays.seed";
import { DOCUMENT_REMINDERS_KEY, nextReminderAt } from "../src/modules/visa/visa.settings";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { maturedCase, saveCase, visaStaff, type Agent } from "./visaHelpers";

// The Step 2 Reminders card (docs/decisions/0006-visa-documents.md amendment 19): when the next pending-document
// reminder goes out, the case's On/Off, and the setting. Nothing is sent yet.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
  await seedHolidays(prisma); // the weekly Sunday off
});

const iso = (day: string, time: string) => istDateTimeToUtc(day, time).toISOString();
const EVERY_2 = { everyDays: 2, sendAt: "11:00" };

/** The next reminder for a list sent on `listDay`, at `time` (IST) on `day`. */
async function nextAt(listDay: string, day: string, time: string, setting = EVERY_2) {
  return (await nextReminderAt(listDay, setting, prisma, istDateTimeToUtc(day, time)))?.toISOString();
}

// March 2027: Monday the 1st, Sunday the 7th. After the weekly off starts (today), so it applies.
describe("when the next reminder goes out (nextReminderAt)", () => {
  it("is the interval after the list, at the set time", async () => {
    expect(await nextAt("2027-03-01", "2027-03-01", "15:00")).toBe(iso("2027-03-03", "11:00"));
  });

  it("goes the same day while its time is still to come, then moves a cycle on", async () => {
    expect(await nextAt("2027-03-01", "2027-03-03", "10:00")).toBe(iso("2027-03-03", "11:00"));
    expect(await nextAt("2027-03-01", "2027-03-03", "12:00")).toBe(iso("2027-03-05", "11:00"));
  });

  it("moves off a Sunday to Monday, and the next one still counts from the planned day", async () => {
    // Planned Sun 7 Mar → Mon 8 Mar; the one after is Tue 9 Mar (7 + 2), not Wed 10 Mar (8 + 2).
    expect(await nextAt("2027-03-01", "2027-03-05", "12:00")).toBe(iso("2027-03-08", "11:00"));
    expect(await nextAt("2027-03-01", "2027-03-08", "12:00")).toBe(iso("2027-03-09", "11:00"));
  });

  it("moves off an office holiday", async () => {
    await prisma.holiday.create({
      data: { name: "Office closed", startDate: toDbDate("2027-03-09"), endDate: toDbDate("2027-03-09"), targets: { create: [{ kind: "MASTI_OFFICE" }] } },
    });
    expect(await nextAt("2027-03-01", "2027-03-08", "12:00")).toBe(iso("2027-03-10", "11:00"));
    expect(await nextAt("2027-03-01", "2027-03-10", "12:00")).toBe(iso("2027-03-11", "11:00"));
  });

  it("every day, skipping the Sunday", async () => {
    const daily = { everyDays: 1, sendAt: "09:30" };
    expect(await nextAt("2027-03-05", "2027-03-05", "15:00", daily)).toBe(iso("2027-03-06", "09:30"));
    expect(await nextAt("2027-03-05", "2027-03-06", "10:00", daily)).toBe(iso("2027-03-08", "09:30"));
  });

  it("counts on from a list sent long ago", async () => {
    // 1 Mar + 2 × 10 = 21 Mar, a Sunday → Mon 22 Mar.
    expect(await nextAt("2027-03-01", "2027-03-20", "12:00")).toBe(iso("2027-03-22", "11:00"));
  });
});

type Reminders = { on: boolean; enabled: boolean; everyDays: number; sendAt: string; channel: string; nextAt: string | null };

async function remindersOf(agent: Agent, caseNo: string) {
  const res = await agent.get(`/api/visa/cases/${caseNo}`);
  expect(res.status).toBe(200);
  return res.body.case.reminders as Reminders;
}

/** The first reminder of a case saved today: two days on, at 11:00, on the next open office day. */
async function firstReminder() {
  return iso(await nextOpenDay(addDays(istToday(), 2), { office: true }), "11:00");
}

const setReminders = (agent: Agent, caseNo: string, body: object) => agent.put(`/api/visa/cases/${caseNo}/reminders`).send(body);

describe("the case's Reminders card", () => {
  it("a new case shows the setting and its first reminder", async () => {
    const staff = await visaStaff();
    const c = await saveCase(staff);
    expect(await remindersOf(staff, c.caseNo)).toEqual({
      on: true,
      enabled: true,
      everyDays: 2,
      sendAt: "11:00",
      channel: "WHATSAPP",
      nextAt: await firstReminder(),
    });
  });

  it("the owner switches it off and on, audited; an unchanged switch writes nothing", async () => {
    const staff = await visaStaff();
    const c = await saveCase(staff);

    const off = await setReminders(staff, c.caseNo, { on: false });
    expect(off.status).toBe(200);
    expect(off.body.case.reminders).toMatchObject({ on: false, nextAt: null });
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.reminders.update" } })).toMatchObject({
      entityId: c.id,
      clientId: c.client.id,
      before: { remindersOn: true },
      after: { remindersOn: false },
    });

    expect((await setReminders(staff, c.caseNo, { on: false })).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "visa.reminders.update" } })).toBe(1);

    const on = await setReminders(staff, c.caseNo, { on: true });
    expect(on.body.case.reminders).toMatchObject({ on: true, nextAt: await firstReminder() });
    expect(await prisma.auditLog.count({ where: { action: "visa.reminders.update" } })).toBe(2);
  });

  it("only the owner, the Visa HOD and the Head switch it; a bad body is a 400", async () => {
    const staff = await visaStaff();
    const c = await saveCase(staff);
    expect((await setReminders(staff, c.caseNo, { on: "no" })).status).toBe(400);
    expect((await setReminders(staff, c.caseNo, {})).status).toBe(400);

    await createUser({ name: "Neha", email: "neha@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    expect((await setReminders(await loginAs("neha@masti.test"), c.caseNo, { on: false })).status).toBe(403);
    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    expect((await setReminders(await loginAs("meena@masti.test"), c.caseNo, { on: false })).status).toBe(403);

    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    expect((await setReminders(await loginAs("riya@masti.test"), c.caseNo, { on: false })).status).toBe(200);
  });

  it("is refused once the documents are complete", async () => {
    const c = await maturedCase();
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    expect((await setReminders(await loginAs("riya@masti.test"), c.caseNo, { on: false })).status).toBe(409);
    expect((await remindersOf(await loginAs("riya@masti.test"), c.caseNo)).nextAt).toBeNull();
  });

  it("has no next reminder while the case is postponed, with nothing missing, or with reminders off in Settings", async () => {
    const staff = await visaStaff();
    const c = await saveCase(staff);

    // Nothing missing: every paper in, made or not needed.
    const docs = await prisma.visaCaseDocument.findMany({ where: { traveller: { caseId: c.id } } });
    await prisma.visaCaseDocument.updateMany({ where: { id: { in: docs.map((d) => d.id) } }, data: { status: "NOT_NEEDED" } });
    expect((await remindersOf(staff, c.caseNo)).nextAt).toBeNull();
    await prisma.visaCaseDocument.update({ where: { id: docs[0]!.id }, data: { status: "PENDING" } });
    expect((await remindersOf(staff, c.caseNo)).nextAt).toBe(await firstReminder());

    // Off for every case in Settings.
    await prisma.setting.upsert({
      where: { key: DOCUMENT_REMINDERS_KEY },
      update: { value: { enabled: false, everyDays: 2, sendAt: "11:00", channel: "WHATSAPP" } },
      create: { key: DOCUMENT_REMINDERS_KEY, value: { enabled: false, everyDays: 2, sendAt: "11:00", channel: "WHATSAPP" } },
    });
    expect(await remindersOf(staff, c.caseNo)).toMatchObject({ on: true, enabled: false, nextAt: null });
    await prisma.setting.delete({ where: { key: DOCUMENT_REMINDERS_KEY } });

    // Postponed.
    const reasonId = (await prisma.enquiryReason.findUniqueOrThrow({ where: { code: "WAITING_LEAVE_APPROVAL" } })).id;
    const updatedAt = (await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id } })).updatedAt.toISOString();
    const resumeOn = await nextOpenDay(addDays(istToday(), 10), { office: true });
    expect((await staff.post(`/api/enquiries/${c.caseNo}/postpone`).send({ reasonId, resumeOn, updatedAt })).status).toBe(200);
    expect((await remindersOf(staff, c.caseNo)).nextAt).toBeNull();
    // A postponed case can't be switched: it's for an open case.
    expect((await setReminders(staff, c.caseNo, { on: false })).status).toBe(409);
  });
});

describe("the setting visa.documentReminders", () => {
  it("only the Head or the Visa HOD changes it, checked and audited, and open cases follow at once", async () => {
    const staff = await visaStaff();
    const c = await saveCase(staff);
    const change = { documentReminders: { enabled: true, everyDays: 3, sendAt: "10:00", channel: "SMS" } };
    expect((await staff.put("/api/visa/settings").send(change)).status).toBe(403);

    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await loginAs("riya@masti.test");
    for (const bad of [{ everyDays: 0 }, { everyDays: 31 }, { channel: "EMAIL" }, { sendAt: "25:00" }]) {
      expect((await hod.put("/api/visa/settings").send({ documentReminders: { ...change.documentReminders, ...bad } })).status).toBe(400);
    }
    const res = await hod.put("/api/visa/settings").send(change);
    expect(res.status).toBe(200);
    expect(res.body.settings.documentReminders).toEqual(change.documentReminders);
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "setting.update", entityId: DOCUMENT_REMINDERS_KEY } })).toMatchObject({
      before: { enabled: true, everyDays: 2, sendAt: "11:00", channel: "WHATSAPP" },
      after: change.documentReminders,
    });

    expect(await remindersOf(staff, c.caseNo)).toMatchObject({
      everyDays: 3,
      sendAt: "10:00",
      channel: "SMS",
      nextAt: iso(await nextOpenDay(addDays(istToday(), 3), { office: true }), "10:00"),
    });
  });
});
