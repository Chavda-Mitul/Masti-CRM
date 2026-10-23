import { beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "../generated/prisma/client";
import { addDays, istDateTimeToUtc, istToday, isoWeekday, toDbDate } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedHolidays } from "../src/modules/holidays/holidays.seed";
import { todaySummary } from "../src/modules/today/today.service";
import { withDepartments } from "../src/modules/users/user";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";
import { saveCase, visaStaff, type Agent } from "./visaHelpers";

// The Today page's banner and tiles (docs/decisions/0017-today-dashboard.md, component 1).

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

const reason = async (code: string) => (await prisma.enquiryReason.findUniqueOrThrow({ where: { code } })).id;
const userOf = (email: string) => prisma.user.findUniqueOrThrow({ where: { email }, include: withDepartments });

/** A France case saved by `agent` for a client of its own, then changed straight in the database. */
async function caseWith(agent: Agent, mobile: string, data: Prisma.EnquiryUncheckedUpdateInput) {
  const saved = await saveCase(agent, { mobile });
  await prisma.enquiry.update({ where: { id: saved.id }, data });
  return saved;
}

/** A Hotels enquiry made by hand: the department has no intake yet (as in enquiries.test.ts). */
async function hotelsEnquiry(dueAt: Date) {
  const hotels = await prisma.department.findUniqueOrThrow({ where: { code: "HOTELS" } });
  const stage = await prisma.departmentStage.create({
    data: { departmentId: hotels.id, flow: "HOTELS", code: "ENQUIRY", name: "Enquiry", sortOrder: 1, statusLabel: "New", nextStepLabel: "Check rates" },
  });
  const cycle = await prisma.billingCycle.findFirstOrThrow({ where: { isDefault: true } });
  const client = await prisma.client.create({ data: { mobile: "+919825000099", name: "Hotel Guest", billingCycleId: cycle.id } });
  const source = await prisma.enquirySource.findUniqueOrThrow({ where: { code: "LANDLINE" } });
  return prisma.enquiry.create({
    data: { caseNo: "HOT-2026-0001", departmentId: hotels.id, clientId: client.id, sourceId: source.id, stageId: stage.id, dueAt },
  });
}

async function today(agent: Agent) {
  const res = await agent.get("/api/today");
  expect(res.status).toBe(200);
  return res.body;
}

/** One department's bar on "Open enquiries" (0017 Decision 10). */
const bar = (day: { openByDepartment: { code: string }[] }, code: string) => day.openByDepartment.find((d) => d.code === code);

describe("GET /api/today", () => {
  it("counts each person's day: staff their own cases, an HOD the whole department, the Head everything", async () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    const aarti = await visaStaff();
    await caseWith(aarti, "9825000001", { dueAt: yesterday });
    await caseWith(aarti, "9825000002", { dueAt: yesterday });
    await createUser({ name: "Neha Joshi", email: "neha@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    const neha = await loginAs("neha@masti.test");
    await caseWith(neha, "9825000003", { dueAt: yesterday });
    // Matured and waiting for a processor: nobody's yet, so only the HOD and the Head have it.
    await caseWith(aarti, "9825000004", { dueAt: yesterday, ownerId: null });
    await hotelsEnquiry(yesterday);

    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    await createUser({
      name: "Kiran",
      email: "kiran@masti.test",
      departments: [
        { code: "VISA", role: "HOD" },
        { code: "HOTELS", access: "VIEW" },
      ],
    });
    await createUser({ name: "Mona", email: "mona@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    const of = async (email: string) => today(await loginAs(email));

    // Every case here is late and came in just now, so "late", "new" and Up next all count the person's cases.
    const mine = await today(aarti);
    expect(mine).toMatchObject({ scope: { kind: "MINE", departments: [] }, late: 2, dueToday: 0, newEnquiries: 2, upNext: { more: false } });
    expect(mine.upNext.rows).toHaveLength(2);
    // The department bars count the same cases; "mine" sends the click to the list with Only mine ticked.
    expect(bar(mine, "VISA")).toEqual({ code: "VISA", name: "Visa", count: 2, mine: true });
    expect(await today(neha)).toMatchObject({ scope: { kind: "MINE" }, late: 1, newEnquiries: 1 });
    const hods = await of("riya@masti.test");
    expect(hods).toMatchObject({ scope: { kind: "DEPARTMENTS", departments: ["Visa"] }, late: 4, newEnquiries: 4 });
    expect(hods.upNext.rows).toHaveLength(4);
    expect(bar(hods, "VISA")).toMatchObject({ count: 4, mine: false });
    // A department they only view isn't theirs to work: the HOD's Hotels view adds nothing.
    const kiran = await of("kiran@masti.test");
    expect(kiran).toMatchObject({ scope: { kind: "DEPARTMENTS", departments: ["Visa"], alsoOwn: false }, late: 4, newEnquiries: 4 });
    expect(bar(kiran, "VISA")).toMatchObject({ count: 4, mine: false });
    expect(bar(kiran, "HOTELS")).toMatchObject({ count: 0, mine: true });
    // An HOD who also works Hotels cases counts their own one there too, and the line says so (alsoOwn).
    await createUser({
      name: "Sanjay",
      email: "sanjay@masti.test",
      departments: [
        { code: "VISA", role: "HOD" },
        { code: "HOTELS", access: "EDIT" },
      ],
    });
    const sanjayId = (await prisma.user.findUniqueOrThrow({ where: { email: "sanjay@masti.test" } })).id;
    expect(await of("sanjay@masti.test")).toMatchObject({ scope: { kind: "DEPARTMENTS", departments: ["Visa"], alsoOwn: true }, late: 4 });
    await prisma.enquiry.update({ where: { caseNo: "HOT-2026-0001" }, data: { ownerId: sanjayId } });
    const sanjay = await of("sanjay@masti.test");
    expect(sanjay).toMatchObject({ scope: { alsoOwn: true }, late: 5 });
    expect(bar(sanjay, "HOTELS")).toMatchObject({ count: 1, mine: true });
    await prisma.enquiry.update({ where: { caseNo: "HOT-2026-0001" }, data: { ownerId: null } });
    // View-only staff own no cases, so their day is empty, like their Follow-ups badge.
    const mona = await of("mona@masti.test");
    expect(mona).toMatchObject({ scope: { kind: "MINE" }, late: 0, newEnquiries: 0, oldestLateAt: null, upNext: { rows: [] } });
    expect(bar(mona, "VISA")).toMatchObject({ count: 0, mine: true });
    const head = await of("vimal@masti.test");
    expect(head).toMatchObject({ scope: { kind: "ALL" }, late: 5, newEnquiries: 5, oldestLateAt: yesterday.toISOString() });
    expect(head.upNext.rows).toHaveLength(5);
    expect(bar(head, "VISA")).toMatchObject({ count: 4, mine: false });
    expect(bar(head, "HOTELS")).toMatchObject({ count: 1, mine: false });
    expect(head.openByDepartment.map((d: { code: string }) => d.code)).toEqual(
      expect.arrayContaining(["VISA", "HOLIDAYS", "HOTELS", "INSURANCE", "TICKETS", "ACCOUNTS"]),
    );
    expect(head.scope.departments).toEqual(expect.arrayContaining(["Visa", "Hotels"]));

    // Field staff have their run on /tasks; nobody signed out gets anything.
    await createUser({ name: "Ravi", mobile: "+919876500001", type: "FIELD" });
    expect((await (await loginAs("9876500001")).get("/api/today")).status).toBe(403);
    expect((await request(app).get("/api/today")).status).toBe(401);
  });
});

describe("todaySummary", () => {
  it("counts late and due-today cases apart, only those someone has to act on, with the oldest late one", async () => {
    const aarti = await visaStaff();
    const day = istToday();
    const now = istDateTimeToUtc(day, "12:00");
    const oldest = istDateTimeToUtc(addDays(day, -2), "11:00");
    await caseWith(aarti, "9825000001", { dueAt: oldest });
    await caseWith(aarti, "9825000002", { dueAt: istDateTimeToUtc(day, "11:00") }); // earlier today: late already
    await caseWith(aarti, "9825000003", { dueAt: istDateTimeToUtc(day, "23:59") });
    await caseWith(aarti, "9825000004", { dueAt: istDateTimeToUtc(addDays(day, 1), "00:00") }); // tomorrow
    // Postponed and back today: due like any other. One away for a while isn't.
    const postponed = { status: "POSTPONED" as const, reasonId: await reason("TRAVEL_DATES_MOVED") };
    await caseWith(aarti, "9825000005", { dueAt: istDateTimeToUtc(day, "15:00"), resumeOn: toDbDate(day), ...postponed });
    await caseWith(aarti, "9825000006", { dueAt: istDateTimeToUtc(addDays(day, 20), "11:00"), resumeOn: toDbDate(addDays(day, 20)), ...postponed });
    // Cancelled with its passports still at our office: due to be handed back. A plain cancelled one needs nobody.
    const cancelled = { status: "CANCELLED" as const, reasonId: await reason("TRIP_CANCELLED") };
    const held = await caseWith(aarti, "9825000007", { dueAt: istDateTimeToUtc(day, "16:00"), ...cancelled });
    await prisma.visaCase.update({ where: { enquiryId: held.id }, data: { bookletsCurrent: 1 } });
    await caseWith(aarti, "9825000008", { dueAt: istDateTimeToUtc(addDays(day, -1), "11:00"), ...cancelled });

    const summary = await todaySummary(await userOf("aarti@masti.test"), now);
    expect(summary).toMatchObject({ late: 2, dueToday: 3, oldestLateAt: oldest });
    // The Open tab's count: the four open cases and the cancelled one still to hand back; not the postponed ones.
    expect(bar(summary, "VISA")).toMatchObject({ count: 5, mine: true });
  });

  it("counts new enquiries from 18:00 on the previous office day: on a Monday, from Saturday", async () => {
    await seedHolidays(prisma); // the weekly Sunday off, from today on
    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    const vimal = await userOf("vimal@masti.test");
    const aarti = await visaStaff();
    let monday = addDays(istToday(), 1);
    while (isoWeekday(monday) !== 1) monday = addDays(monday, 1);
    const saturday = addDays(monday, -2);
    await caseWith(aarti, "9825000001", { createdAt: istDateTimeToUtc(saturday, "17:59") });
    await caseWith(aarti, "9825000002", { createdAt: istDateTimeToUtc(saturday, "18:00") });
    await caseWith(aarti, "9825000003", { createdAt: istDateTimeToUtc(addDays(monday, -1), "12:00") });
    await caseWith(aarti, "9825000004", { createdAt: istDateTimeToUtc(monday, "09:00") });

    const mondayMorning = istDateTimeToUtc(monday, "10:00");
    expect(await todaySummary(vimal, mondayMorning)).toMatchObject({ newEnquiries: 3, newSince: istDateTimeToUtc(saturday, "18:00") });
    // Tuesday counts from Monday evening.
    expect((await todaySummary(vimal, istDateTimeToUtc(addDays(monday, 1), "10:00"))).newSince).toEqual(istDateTimeToUtc(monday, "18:00"));
  });
});

describe("Up next", () => {
  it("lists the late and due-today cases in the list's order, each with what it needs", async () => {
    const aarti = await visaStaff();
    const day = istToday();
    const now = istDateTimeToUtc(day, "12:00");
    const late = await caseWith(aarti, "9825000001", { dueAt: istDateTimeToUtc(addDays(day, -1), "11:00") });
    const laterToday = await caseWith(aarti, "9825000002", { dueAt: istDateTimeToUtc(day, "17:00") });
    await caseWith(aarti, "9825000003", { dueAt: istDateTimeToUtc(addDays(day, 1), "11:00") }); // tomorrow: not yet
    // Collecting papers: how many are still pending, as on the follow-up desk.
    const collecting = await saveCase(aarti, { mobile: "9825000004" });
    expect((await aarti.post(`/api/visa/cases/${collecting.caseNo}/start`).set("Content-Type", "application/json")).status).toBe(200);
    await prisma.enquiry.update({ where: { id: collecting.id }, data: { dueAt: istDateTimeToUtc(day, "11:30") } });
    const papers = await prisma.visaCaseDocument.findMany({ where: { traveller: { caseId: collecting.id } }, select: { status: true } });
    const pending = papers.filter((p) => p.status === "PENDING").length;
    const needed = papers.filter((p) => p.status !== "NOT_NEEDED").length;
    expect(pending).toBeGreaterThan(0);
    // Postponed and back today; cancelled with its passports still at our office. A plain cancelled one needs nobody.
    const travelDatesMoved = await reason("TRAVEL_DATES_MOVED");
    const postponed = await caseWith(aarti, "9825000005", {
      dueAt: istDateTimeToUtc(day, "15:00"),
      status: "POSTPONED",
      reasonId: travelDatesMoved,
      resumeOn: toDbDate(day),
    });
    const tripCancelled = await reason("TRIP_CANCELLED");
    const handBack = await caseWith(aarti, "9825000006", { dueAt: istDateTimeToUtc(day, "16:00"), status: "CANCELLED", reasonId: tripCancelled });
    await prisma.visaCase.update({ where: { enquiryId: handBack.id }, data: { bookletsCurrent: 1 } });
    await caseWith(aarti, "9825000007", { dueAt: istDateTimeToUtc(addDays(day, -1), "10:00"), status: "CANCELLED", reasonId: tripCancelled });

    const { upNext } = await todaySummary(await userOf("aarti@masti.test"), now);
    expect(upNext.more).toBe(false);
    expect(upNext.rows.map((r) => r.caseNo)).toEqual([late.caseNo, collecting.caseNo, postponed.caseNo, handBack.caseNo, laterToday.caseNo]);
    const row = (caseNo: string) => upNext.rows.find((r) => r.caseNo === caseNo);
    expect(row(late.caseNo)).toMatchObject({
      whatFor: "Start collecting documents",
      status: "OPEN",
      toHandBack: false,
      department: { code: "VISA", name: "Visa" },
      client: { name: "Rakesh Mehta" },
      owner: { name: "Aarti Patel" },
      summary: expect.stringContaining("1 adult"),
    });
    expect(row(collecting.caseNo)).toMatchObject({ whatFor: `${pending} of ${needed} documents pending` });
    expect(row(postponed.caseNo)).toMatchObject({ status: "POSTPONED", reason: { name: expect.any(String) }, resumeOn: day });
    expect(row(handBack.caseNo)).toMatchObject({ status: "CANCELLED", toHandBack: true });
  });
});

describe("the notice card", () => {
  it("shows the latest 3 of the person's departments' notices and the holiday entries still new", async () => {
    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    await createUser({ name: "Aarti Patel", email: "aarti@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    const vimal = await userOf("vimal@masti.test");
    const aarti = await userOf("aarti@masti.test");
    const visa = await prisma.department.findUniqueOrThrow({ where: { code: "VISA" } });
    const tickets = await prisma.department.findUniqueOrThrow({ where: { code: "TICKETS" } });
    const now = new Date();
    const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
    const notice = (title: string, departmentId: number, minutesAgo: number, status: "ACTIVE" | "REMOVED" = "ACTIVE") =>
      prisma.notice.create({ data: { departmentId, category: "GENERAL", title, postedById: vimal.id, createdAt: ago(minutesAgo), status } });
    await notice("Visa, an hour ago", visa.id, 60);
    await notice("Tickets, just now", tickets.id, 1);
    await notice("Visa, removed", visa.id, 2, "REMOVED");
    await notice("Visa, two days ago", visa.id, 2 * 24 * 60);

    // New: added by staff within the calendar's 7 days and not over yet. The seeded Sunday off has nobody's name on it.
    const day = istToday();
    const holiday = (name: string, addedById: string | null, minutesAgo: number, start: string, end: string | null) =>
      prisma.holiday.create({
        data: {
          name,
          repeat: end ? "NONE" : "WEEKLY",
          startDate: toDbDate(start),
          endDate: end ? toDbDate(end) : null,
          weekday: end ? null : 7,
          addedById,
          createdAt: ago(minutesAgo),
          targets: { create: [{ kind: "ALL_EMBASSIES" }] },
        },
      });
    await holiday("Dussehra", vimal.id, 30, addDays(day, 3), addDays(day, 3));
    await holiday("Added ten days ago", vimal.id, 10 * 24 * 60, addDays(day, 5), addDays(day, 5));
    await holiday("Weekly off", null, 5, day, null);
    await holiday("Over already", vimal.id, 10, addDays(day, -3), addDays(day, -2));

    const titles = (card: { kind: string; title?: string; name?: string }[]) => card.map((n) => n.title ?? n.name);
    const staff = (await todaySummary(aarti, now)).notices;
    expect(titles(staff)).toEqual(["Dussehra", "Visa, an hour ago", "Visa, two days ago"]);
    expect(staff[0]).toMatchObject({ kind: "HOLIDAY", targets: ["All embassies in India"], addedBy: { name: "Vimal" } });
    expect(staff[1]).toMatchObject({ kind: "NOTICE", department: { code: "VISA", name: "Visa" }, postedBy: { name: "Vimal" }, source: "TEAM" });
    // The Head's departments are all of them.
    expect(titles((await todaySummary(vimal, now)).notices)).toEqual(["Tickets, just now", "Dussehra", "Visa, an hour ago"]);
  });
});

describe("Business lost this month", () => {
  // 0017 Decision 5, amendment 2: the cases that came in this month, booked (a standing invoice), lost (cancelled) or
  // still open; and the top reasons the lost ones went.
  const monthStart = () => istDateTimeToUtc(`${istToday().slice(0, 8)}01`, "00:00");

  /** A document row for an invoice or a credit note, which each need their own. */
  async function caseFile(enquiryId: string, kind: "INVOICE" | "CREDIT_NOTE", name: string) {
    const by = await prisma.user.findUniqueOrThrow({ where: { email: "aarti@masti.test" } });
    return prisma.caseFile.create({
      data: { enquiryId, kind, storageKey: `cases/${enquiryId}/${name}.pdf`, fileName: `${name}.pdf`, sizeBytes: 1024, pageCount: 1, uploadedById: by.id },
    });
  }

  /** An invoice written straight in the database (raising one is tested in visaInvoice.test.ts). */
  async function invoiceFor(enquiryId: string, invoiceNo: string, replacesId?: string) {
    const by = await prisma.user.findUniqueOrThrow({ where: { email: "aarti@masti.test" } });
    const file = await caseFile(enquiryId, "INVOICE", invoiceNo);
    return prisma.invoice.create({
      data: {
        invoiceNo,
        enquiryId,
        replacesId: replacesId ?? null,
        issuedOn: toDbDate(istToday()),
        issuedById: by.id,
        client: {},
        company: {},
        terms: {},
        placeOfSupply: "24",
        taxType: "INTRA_STATE",
        sac: "998555",
        gstRateBp: 1800,
        processingSpeed: "Normal",
        grossPaise: 100_000,
        serviceChargePaise: 0,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
        totalPaise: 100_000,
        fileId: file.id,
      },
    });
  }

  /** A credit note that cancels the whole invoice (issuing one is tested in visaCreditNote.test.ts). */
  async function cancelInvoice(invoice: { id: string; enquiryId: string; invoiceNo: string }) {
    const by = await prisma.user.findUniqueOrThrow({ where: { email: "aarti@masti.test" } });
    const file = await caseFile(invoice.enquiryId, "CREDIT_NOTE", `cn-${invoice.invoiceNo}`);
    const reason = await prisma.creditNoteReason.findUniqueOrThrow({ where: { code: "WRONG_AMOUNT" } });
    await prisma.creditNote.create({
      data: {
        creditNoteNo: `CN-${invoice.invoiceNo}`,
        invoiceId: invoice.id,
        enquiryId: invoice.enquiryId,
        kind: "WHOLE",
        reasonId: reason.id,
        issuedOn: toDbDate(istToday()),
        issuedById: by.id,
        client: {},
        company: {},
        grossPaise: 100_000,
        serviceChargePaise: 0,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
        totalPaise: 100_000,
        fileId: file.id,
      },
    });
  }

  it("sorts this month's cases into booked, lost and still open, which add up, with the top 3 reasons", async () => {
    const aarti = await visaStaff();
    const start = monthStart();
    const cancelled = async (code: string) => ({ status: "CANCELLED" as const, reasonId: await reason(code) });

    // Still open: open from the month's first minute, postponed, and one whose only invoice a credit note cancelled.
    await caseWith(aarti, "9825000001", { createdAt: start });
    await caseWith(aarti, "9825000002", { status: "POSTPONED", reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: toDbDate(addDays(istToday(), 10)) });
    const creditNoted = await caseWith(aarti, "9825000003", {});
    await cancelInvoice(await invoiceFor(creditNoted.id, "MVI00000003"));
    // Booked: an invoice raised, a closed case, and one whose cancelled invoice was replaced.
    await invoiceFor((await caseWith(aarti, "9825000004", {})).id, "MVI00000004");
    const closed = await caseWith(aarti, "9825000005", { status: "CLOSED", dueAt: null });
    await invoiceFor(closed.id, "MVI00000005");
    const replaced = await caseWith(aarti, "9825000006", {});
    const wrong = await invoiceFor(replaced.id, "MVI00000006");
    await cancelInvoice(wrong);
    await invoiceFor(replaced.id, "MVI00000007", wrong.id);
    // Lost: every cancelled case, with or without an invoice, and also one whose passports are still to hand back.
    const afterInvoice = await caseWith(aarti, "9825000007", {});
    await invoiceFor(afterInvoice.id, "MVI00000008");
    await prisma.enquiry.update({ where: { id: afterInvoice.id }, data: { ...(await cancelled("TRIP_CANCELLED")), dueAt: null } });
    await caseWith(aarti, "9825000008", await cancelled("PRICE_HIGHER"));
    await caseWith(aarti, "9825000009", await cancelled("PRICE_HIGHER"));
    await caseWith(aarti, "9825000010", await cancelled("NO_REPLY"));
    const handBack = await caseWith(aarti, "9825000011", await cancelled("NO_REPLY"));
    await prisma.visaCase.update({ where: { enquiryId: handBack.id }, data: { bookletsCurrent: 1 } });
    await caseWith(aarti, "9825000012", await cancelled("WENT_WITH_ANOTHER_AGENT"));
    // Came in last month: not this month's, whatever happened to it since.
    await caseWith(aarti, "9825000013", { createdAt: new Date(start.getTime() - 60_000), ...(await cancelled("PRICE_HIGHER")) });

    const { businessLost } = await todaySummary(await userOf("aarti@masti.test"));
    expect(businessLost).toEqual({
      queriesIn: 12,
      booked: 3,
      lost: 6,
      stillOpen: 3,
      // Most first; a tie goes in the list's order: Price higher (5) before No reply (8), Went with another agent (3)
      // before Trip cancelled (4).
      reasons: [
        { name: "Price higher", count: 2 },
        { name: "No reply", count: 2 },
        { name: "Went with another agent", count: 1 },
      ],
    });
  });

  it("counts staff's own cases, an HOD's department and the Head's everything, like the rest of Today", async () => {
    const aarti = await visaStaff();
    await createUser({ name: "Neha Joshi", email: "neha@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    const neha = await loginAs("neha@masti.test");
    await caseWith(aarti, "9825000001", {});
    await caseWith(neha, "9825000002", { status: "CANCELLED", reasonId: await reason("NO_REPLY") });
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });

    const lostOf = async (email: string) => (await todaySummary(await userOf(email))).businessLost;
    expect(await lostOf("aarti@masti.test")).toEqual({ queriesIn: 1, booked: 0, lost: 0, stillOpen: 1, reasons: [] });
    expect(await lostOf("neha@masti.test")).toEqual({ queriesIn: 1, booked: 0, lost: 1, stillOpen: 0, reasons: [{ name: "No reply", count: 1 }] });
    const everyone = { queriesIn: 2, booked: 0, lost: 1, stillOpen: 1, reasons: [{ name: "No reply", count: 1 }] };
    expect(await lostOf("riya@masti.test")).toEqual(everyone);
    expect(await lostOf("vimal@masti.test")).toEqual(everyone);
    // And on the page's request.
    expect((await today(aarti)).businessLost).toMatchObject({ queriesIn: 1, stillOpen: 1 });
  });
});
