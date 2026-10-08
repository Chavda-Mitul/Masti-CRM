import { beforeEach, describe, expect, it } from "vitest";
import { addDays, istToday, toDbDate } from "../src/lib/dates";
import { blockedDays, datesCovered, isDateBlocked } from "../src/modules/holidays/blockedDays";
import { dateLabel } from "../src/modules/holidays/holiday";
import { seedHolidays } from "../src/modules/holidays/holidays.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
});

type Agent = Awaited<ReturnType<typeof loginAs>>;

async function headAgent() {
  await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
  return loginAs("vimal@masti.test");
}

async function ids() {
  const fr = await prisma.country.findUniqueOrThrow({ where: { code: "FR" } });
  const cn = await prisma.country.findUniqueOrThrow({ where: { code: "CN" } });
  const frMum = await prisma.embassy.findUniqueOrThrow({ where: { code: "FR-MUM" } });
  const cnDel = await prisma.embassy.create({ data: { code: "CN-DEL", countryId: cn.id, name: "Chinese embassy, Delhi", city: "Delhi" } });
  return { fr: fr.id, cn: cn.id, frMum: frMum.id, cnDel: cnDel.id };
}

const day = (n: number) => addDays(istToday(), n);

async function addHoliday(agent: Agent, body: Record<string, unknown>) {
  const res = await agent.post("/api/holidays").send(body);
  if (res.status !== 201) throw new Error(`create failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.holiday;
}

/** A holiday row written directly, e.g. a PENDING bot entry, without going through the bot API. */
async function insertHoliday(data: {
  name: string;
  startDate: string;
  endDate?: string | null;
  repeat?: "NONE" | "WEEKLY";
  weekday?: number | null;
  status?: "PENDING" | "ACTIVE" | "REMOVED";
  targets: { kind: "ALL_EMBASSIES" | "COUNTRY" | "EMBASSY" | "MASTI_OFFICE"; countryId?: number; embassyId?: number }[];
}) {
  return prisma.holiday.create({
    data: {
      name: data.name,
      repeat: data.repeat ?? "NONE",
      startDate: toDbDate(data.startDate),
      endDate: data.endDate === undefined ? toDbDate(data.startDate) : data.endDate && toDbDate(data.endDate),
      weekday: data.weekday ?? null,
      status: data.status ?? "ACTIVE",
      targets: { create: data.targets },
    },
  });
}

describe("which dates a holiday covers", () => {
  const rule = (r: { repeat?: string; start: string; end: string | null; weekday?: number }) => ({
    repeat: r.repeat ?? "NONE",
    startDate: toDbDate(r.start),
    endDate: r.end ? toDbDate(r.end) : null,
    weekday: r.weekday ?? null,
  });

  it("covers a range inclusively, clipped to the window", () => {
    expect(datesCovered(rule({ start: "2026-10-01", end: "2026-10-07" }), "2026-10-05", "2026-10-31")).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
    ]);
    expect(datesCovered(rule({ start: "2026-10-02", end: "2026-10-02" }), "2026-10-01", "2026-10-31")).toEqual(["2026-10-02"]);
    expect(datesCovered(rule({ start: "2026-09-01", end: "2026-09-02" }), "2026-10-01", "2026-10-31")).toEqual([]);
  });

  it("covers every given weekday from the start, until the end if there is one", () => {
    // October 2026: Sundays are 4, 11, 18, 25.
    expect(datesCovered(rule({ repeat: "WEEKLY", start: "2026-10-05", end: null, weekday: 7 }), "2026-10-01", "2026-10-31")).toEqual([
      "2026-10-11",
      "2026-10-18",
      "2026-10-25",
    ]);
    expect(datesCovered(rule({ repeat: "WEEKLY", start: "2026-01-01", end: "2026-10-20", weekday: 7 }), "2026-10-01", "2026-10-31")).toEqual([
      "2026-10-04",
      "2026-10-11",
      "2026-10-18",
    ]);
  });

  it("labels dates the way the demo shows them", () => {
    expect(dateLabel(rule({ start: "2026-10-02", end: "2026-10-02" }))).toBe("Fri 2 Oct 2026");
    expect(dateLabel(rule({ start: "2026-10-01", end: "2026-10-07" }))).toBe("1 – 7 Oct 2026");
    expect(dateLabel(rule({ start: "2026-09-28", end: "2026-10-03" }))).toBe("28 Sep – 3 Oct 2026");
    expect(dateLabel(rule({ start: "2026-12-30", end: "2027-01-02" }))).toBe("30 Dec 2026 – 2 Jan 2027");
    expect(dateLabel(rule({ repeat: "WEEKLY", start: "2026-01-01", end: null, weekday: 7 }))).toBe("Every Sunday");
    expect(dateLabel(rule({ repeat: "WEEKLY", start: "2026-01-01", end: "2026-12-31", weekday: 6 }))).toBe("Every Saturday until 31 Dec 2026");
  });
});

describe("blocked dates", () => {
  it("matches all embassies, a country, one embassy, and our office separately", async () => {
    const t = await ids();
    await insertHoliday({ name: "Gandhi Jayanti", startDate: "2026-10-02", targets: [{ kind: "ALL_EMBASSIES" }, { kind: "MASTI_OFFICE" }] });
    await insertHoliday({ name: "National Day week", startDate: "2026-10-01", endDate: "2026-10-07", targets: [{ kind: "COUNTRY", countryId: t.cn }] });
    await insertHoliday({ name: "Dussehra", startDate: "2026-10-20", targets: [{ kind: "EMBASSY", embassyId: t.frMum }] });
    await insertHoliday({ name: "Diwali office closure", startDate: "2026-11-09", targets: [{ kind: "MASTI_OFFICE" }] });

    const dates = async (target: { embassyId: number } | { office: true }) =>
      (await blockedDays("2026-10-01", "2026-11-30", target)).map((d) => d.date);

    expect(await dates({ embassyId: t.frMum })).toEqual(["2026-10-02", "2026-10-20"]);
    expect(await dates({ embassyId: t.cnDel })).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
    ]);
    expect(await dates({ office: true })).toEqual(["2026-10-02", "2026-11-09"]);

    const [both] = await blockedDays("2026-10-02", "2026-10-02", { embassyId: t.cnDel });
    expect(both?.holidays.map((h) => h.name).sort()).toEqual(["Gandhi Jayanti", "National Day week"]);
  });

  it("warns about a PENDING holiday without blocking, and ignores a REMOVED one", async () => {
    const t = await ids();
    await insertHoliday({ name: "Possible closure", startDate: "2026-10-23", status: "PENDING", targets: [{ kind: "ALL_EMBASSIES" }] });
    await insertHoliday({ name: "Withdrawn", startDate: "2026-10-26", status: "REMOVED", targets: [{ kind: "ALL_EMBASSIES" }] });

    const days = await blockedDays("2026-10-01", "2026-10-31", { embassyId: t.frMum });
    expect(days).toEqual([{ date: "2026-10-23", blocked: false, holidays: [expect.objectContaining({ name: "Possible closure", status: "PENDING" })] }]);
    expect(await isDateBlocked("2026-10-23", { embassyId: t.frMum })).toBe(false);
    expect(await isDateBlocked("2026-10-26", { embassyId: t.frMum })).toBe(false);
  });

  it("blocks the seeded weekly Sunday for embassies and our office", async () => {
    const t = await ids();
    await seedHolidays(prisma);
    await seedHolidays(prisma); // safe to run again
    expect(await prisma.holiday.count()).toBe(1);

    let sunday = day(1);
    while (new Date(`${sunday}T00:00:00Z`).getUTCDay() !== 0) sunday = addDays(sunday, 1);
    expect(await isDateBlocked(sunday, { embassyId: t.frMum })).toBe(true);
    expect(await isDateBlocked(sunday, { office: true })).toBe(true);
    expect(await isDateBlocked(addDays(sunday, 1), { office: true })).toBe(false);
  });

  it("is served to the date pickers, and checks its query", async () => {
    const t = await ids();
    const head = await headAgent();
    await insertHoliday({ name: "Dussehra", startDate: "2026-10-20", targets: [{ kind: "EMBASSY", embassyId: t.frMum }] });

    const res = await head.get(`/api/holidays/blocked?from=2026-10-01&to=2026-10-31&embassyId=${t.frMum}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
      days: [{ date: "2026-10-20", blocked: true, holidays: [expect.objectContaining({ name: "Dussehra", status: "ACTIVE" })] }],
    });

    expect((await head.get("/api/holidays/blocked?from=2026-10-01&to=2026-10-31")).status).toBe(400);
    expect((await head.get(`/api/holidays/blocked?from=2026-10-01&to=2026-10-31&embassyId=${t.frMum}&office=true`)).status).toBe(400);
    expect((await head.get(`/api/holidays/blocked?from=2026-10-01&to=2028-10-31&embassyId=${t.frMum}`)).status).toBe(400);
    expect((await head.get("/api/holidays/blocked?from=2026-10-01&to=2026-10-31&embassyId=999")).status).toBe(404);
  });
});

describe("holiday calendar access", () => {
  it("lets office staff read, and only the Head or an HOD change it", async () => {
    expect((await request(app).get("/api/holidays")).status).toBe(401);
    await createUser({ name: "Ravi", mobile: "+919876500001", type: "FIELD" });
    expect((await (await loginAs("9876500001")).get("/api/holidays")).status).toBe(403);

    await createUser({ email: "aarti@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    const staff = await loginAs("aarti@masti.test");
    expect((await staff.get("/api/holidays")).status).toBe(200);
    const body = { name: "Dussehra", startDate: day(10), endDate: day(10), targets: [{ kind: "ALL_EMBASSIES" }] };
    expect((await staff.post("/api/holidays").send(body)).status).toBe(403);

    await createUser({ email: "tickets-hod@masti.test", departments: [{ code: "TICKETS", role: "HOD" }] });
    const ticketsHod = await loginAs("tickets-hod@masti.test");
    expect((await ticketsHod.post("/api/holidays").send(body)).status).toBe(201);
  });
});

describe("adding and editing holidays", () => {
  it("adds a manual, active holiday with labels, and audits it", async () => {
    const t = await ids();
    const head = await headAgent();
    const holiday = await addHoliday(head, {
      name: "National Day week",
      startDate: day(5),
      endDate: day(11),
      targets: [{ kind: "COUNTRY", countryId: t.cn }],
      reference: "IVS",
    });
    expect(holiday).toMatchObject({
      repeat: "NONE",
      status: "ACTIVE",
      source: "MANUAL",
      reference: "IVS",
      isNew: true,
      addedBy: { name: "Vimal" },
      apiClient: null,
      targets: [{ kind: "COUNTRY", country: { code: "CN" }, label: "China embassy & visa centres" }],
    });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "holiday.create" } });
    expect(entry.entityId).toBe(holiday.id);
    expect(entry.after).toMatchObject({ name: "National Day week", startDate: day(5), endDate: day(11) });
  });

  it("checks the dates and targets", async () => {
    const t = await ids();
    const head = await headAgent();
    const base = { name: "Closure", targets: [{ kind: "ALL_EMBASSIES" }] };
    const status = async (body: Record<string, unknown>) => (await head.post("/api/holidays").send({ ...base, ...body })).status;

    expect(await status({ startDate: day(5), endDate: day(4) })).toBe(400);
    expect(await status({ startDate: day(5) })).toBe(400);
    expect(await status({ startDate: day(1), endDate: day(61) })).toBe(400);
    expect(await status({ startDate: day(1), endDate: day(60) })).toBe(201);
    expect(await status({ repeat: "WEEKLY", startDate: day(1) })).toBe(400);
    expect(await status({ startDate: day(1), endDate: day(1), weekday: 3 })).toBe(400);
    expect(await status({ startDate: day(1), endDate: day(1), targets: [] })).toBe(400);
    expect(await status({ startDate: day(2), endDate: day(2), targets: [{ kind: "MASTI_OFFICE" }, { kind: "MASTI_OFFICE" }] })).toBe(400);
    expect(await status({ startDate: day(3), endDate: day(3), targets: [{ kind: "COUNTRY", countryId: 999 }] })).toBe(400);

    await prisma.embassy.update({ where: { id: t.cnDel }, data: { isActive: false } });
    expect(await status({ startDate: day(4), endDate: day(4), targets: [{ kind: "EMBASSY", embassyId: t.cnDel }] })).toBe(400);
  });

  it("warns about a duplicate, and saves it once confirmed", async () => {
    const t = await ids();
    const head = await headAgent();
    const body = { name: "Dussehra", startDate: day(12), endDate: day(12), targets: [{ kind: "EMBASSY", embassyId: t.frMum }] };
    await addHoliday(head, body);

    const again = await head.post("/api/holidays").send({ ...body, name: "Vijayadashami", targets: [...body.targets, { kind: "MASTI_OFFICE" }] });
    expect(again.status).toBe(409);
    expect(again.body.details).toMatchObject({ code: "DUPLICATE", matches: [{ name: "Dussehra", targets: ["French embassy, Mumbai"] }] });

    // A different embassy on the same date isn't a duplicate.
    expect((await head.post("/api/holidays").send({ ...body, targets: [{ kind: "EMBASSY", embassyId: t.cnDel }] })).status).toBe(201);

    const confirmed = await head.post("/api/holidays").send({ ...body, name: "Vijayadashami", confirmDuplicates: true });
    expect(confirmed.status).toBe(201);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "holiday.create", entityId: confirmed.body.holiday.id } });
    expect(entry.after).toMatchObject({ confirmedDuplicates: true });
  });

  it("edits only what is sent, with optimistic locking, and counts as a review", async () => {
    const t = await ids();
    const head = await headAgent();
    const holiday = await addHoliday(head, { name: "Dussehra", startDate: day(12), endDate: day(12), targets: [{ kind: "EMBASSY", embassyId: t.frMum }] });

    const res = await head.patch(`/api/holidays/${holiday.id}`).send({ updatedAt: holiday.updatedAt, endDate: day(13), targets: [{ kind: "ALL_EMBASSIES" }] });
    expect(res.status).toBe(200);
    expect(res.body.holiday).toMatchObject({ name: "Dussehra", startDate: day(12), endDate: day(13), reviewedBy: { name: "Vimal" } });
    expect(res.body.holiday.targets.map((x: { kind: string }) => x.kind)).toEqual(["ALL_EMBASSIES"]);

    const stale = await head.patch(`/api/holidays/${holiday.id}`).send({ updatedAt: holiday.updatedAt, name: "Dasara" });
    expect(stale.status).toBe(409);
    expect(stale.body.details).toEqual({ code: "STALE" });

    // The merged result is checked as a whole.
    const backwards = await head.patch(`/api/holidays/${holiday.id}`).send({ updatedAt: res.body.holiday.updatedAt, endDate: day(1) });
    expect(backwards.status).toBe(400);

    // Nothing changed: nothing written.
    const same = await head.patch(`/api/holidays/${holiday.id}`).send({ updatedAt: res.body.holiday.updatedAt, name: "Dussehra" });
    expect(same.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "holiday.update" } })).toBe(1);

    // Switching to weekly needs a weekday and no fixed end.
    const weekly = await head
      .patch(`/api/holidays/${holiday.id}`)
      .send({ updatedAt: res.body.holiday.updatedAt, repeat: "WEEKLY", weekday: 6, endDate: null });
    expect(weekly.status).toBe(200);
    expect(weekly.body.holiday.label).toBe("Every Saturday");
  });

  it("confirms only pending entries, removes once, and keeps removed ones out of the list", async () => {
    const t = await ids();
    const head = await headAgent();
    const pending = await insertHoliday({ name: "Possible closure", startDate: day(3), status: "PENDING", targets: [{ kind: "COUNTRY", countryId: t.cn }] });

    expect(await isDateBlocked(day(3), { embassyId: t.cnDel })).toBe(false);
    const confirmed = await head.post(`/api/holidays/${pending.id}/confirm`).send({});
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.holiday).toMatchObject({ status: "ACTIVE", reviewedBy: { name: "Vimal" } });
    expect(await isDateBlocked(day(3), { embassyId: t.cnDel })).toBe(true);
    expect((await head.post(`/api/holidays/${pending.id}/confirm`).send({})).status).toBe(409);

    const removed = await head.post(`/api/holidays/${pending.id}/remove`).send({});
    expect(removed.body.holiday.status).toBe("REMOVED");
    expect(await isDateBlocked(day(3), { embassyId: t.cnDel })).toBe(false);
    expect((await head.post(`/api/holidays/${pending.id}/remove`).send({})).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "holiday.remove" } })).toBe(1);
    expect((await head.patch(`/api/holidays/${pending.id}`).send({ updatedAt: removed.body.holiday.updatedAt, name: "X" })).status).toBe(400);

    expect((await head.get("/api/holidays")).body.holidays).toHaveLength(0);
    expect((await head.get("/api/holidays?status=REMOVED")).body.holidays).toHaveLength(1);
  });

  it("lists from today, dated holidays first, and filters by target", async () => {
    const t = await ids();
    const head = await headAgent();
    await insertHoliday({ name: "Past", startDate: day(-10), targets: [{ kind: "ALL_EMBASSIES" }] });
    await insertHoliday({ name: "Weekly off", startDate: day(-100), endDate: null, repeat: "WEEKLY", weekday: 7, targets: [{ kind: "MASTI_OFFICE" }] });
    await insertHoliday({ name: "Later", startDate: day(20), targets: [{ kind: "EMBASSY", embassyId: t.frMum }] });
    await insertHoliday({ name: "Sooner", startDate: day(2), targets: [{ kind: "COUNTRY", countryId: t.cn }] });

    const all = await head.get("/api/holidays");
    expect(all.body.holidays.map((h: { name: string }) => h.name)).toEqual(["Sooner", "Later", "Weekly off"]);
    const china = await head.get(`/api/holidays?countryId=${t.cn}`);
    expect(china.body.holidays.map((h: { name: string }) => h.name)).toEqual(["Sooner"]);
    const office = await head.get("/api/holidays?kind=MASTI_OFFICE");
    expect(office.body.holidays.map((h: { name: string }) => h.name)).toEqual(["Weekly off"]);
  });

  it("offers the active countries and embassies as targets", async () => {
    await ids();
    const head = await headAgent();
    const res = await head.get("/api/holidays/targets");
    expect(res.body.kinds.map((k: { kind: string }) => k.kind)).toEqual(["ALL_EMBASSIES", "COUNTRY", "EMBASSY", "MASTI_OFFICE"]);
    expect(res.body.countries.map((c: { code: string; embassies: { code: string }[] }) => [c.code, c.embassies.map((e) => e.code)])).toEqual([
      ["FR", ["FR-MUM"]],
      ["CN", ["CN-DEL"]],
    ]);
  });
});

describe("holiday settings", () => {
  it("are read by office staff and changed by the Head only, audited", async () => {
    const head = await headAgent();
    await createUser({ email: "hod@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await loginAs("hod@masti.test");

    expect((await hod.get("/api/holidays/settings")).body.settings).toEqual({ newForDays: 7, botEntriesNeedReview: true });
    expect((await hod.put("/api/holidays/settings").send({ botEntriesNeedReview: false })).status).toBe(403);

    const res = await head.put("/api/holidays/settings").send({ newForDays: 3 });
    expect(res.body.settings).toEqual({ newForDays: 3, botEntriesNeedReview: true });
    expect((await head.put("/api/holidays/settings").send({ newForDays: 0 })).status).toBe(400);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "setting.update", entityId: "holidays" } });
    expect(entry.after).toEqual({ newForDays: 3, botEntriesNeedReview: true });
  });
});

describe("the database", () => {
  it("refuses impossible holidays and targets", async () => {
    const t = await ids();
    await expect(insertHoliday({ name: "Backwards", startDate: "2026-10-05", endDate: "2026-10-01", targets: [{ kind: "ALL_EMBASSIES" }] })).rejects.toThrow();
    await expect(insertHoliday({ name: "No weekday", startDate: "2026-10-05", endDate: null, repeat: "WEEKLY", targets: [{ kind: "ALL_EMBASSIES" }] })).rejects.toThrow();
    await expect(insertHoliday({ name: "Kindless", startDate: "2026-10-05", targets: [{ kind: "COUNTRY" }] })).rejects.toThrow();
    await expect(insertHoliday({ name: "Mixed", startDate: "2026-10-05", targets: [{ kind: "ALL_EMBASSIES", countryId: t.cn }] })).rejects.toThrow();
    await expect(
      insertHoliday({ name: "Twice", startDate: "2026-10-05", targets: [{ kind: "MASTI_OFFICE" }, { kind: "MASTI_OFFICE" }] }),
    ).rejects.toThrow();
    // A bot entry needs its machine account and key.
    await expect(
      prisma.holiday.create({ data: { name: "Bot", startDate: toDbDate("2026-10-05"), endDate: toDbDate("2026-10-05"), source: "AI_BOT" } }),
    ).rejects.toThrow();
  });
});
