import { beforeEach, describe, expect, it } from "vitest";
import { addDays, addMonths, dayLabel, istDateTimeToUtc, istToday } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { holdCaseLock, maturedCase, saveCase, untilWaitingOnLock, visaStaff, type Agent } from "./visaHelpers";

// Visa Step 3, slice 3 (docs/decisions/0007-visa-file-prep.md Decisions 4, 5 and 6): the case's trip details, each
// traveller's acknowledgement number and appointment, and the visa's "Appointment needed" / "Vendor needed" switches.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface Trip {
  departOn: string | null;
  returnOn: string | null;
  entryType: string | null;
  hotelStay: string | null;
}
interface CaseDto {
  caseNo: string;
  updatedAt: string;
  stage: { code: string };
  travelDate: string | null;
  trip: Trip;
  appointmentNeeded: boolean;
  vendorNeeded: boolean;
  travellers: { id: string; ackNo: string | null; appointmentAt: string | null }[];
}

const neha = () => loginAs("neha@masti.test");
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const saveTrip = (agent: Agent, caseNo: string, body: Record<string, unknown>) => agent.patch(`/api/visa/cases/${caseNo}/trip`).send(body);
const saveApplication = (agent: Agent, caseNo: string, travellerId: string, body: Record<string, unknown>) =>
  agent.patch(`/api/visa/cases/${caseNo}/travellers/${travellerId}/application`).send(body);
const inDays = (days: number) => addDays(istToday(), days);
const stageId = async (code: string) => (await prisma.departmentStage.findFirstOrThrow({ where: { code } })).id;

async function hodAndHead() {
  await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
  await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
  await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
  return { hod: await loginAs("riya@masti.test"), head: await loginAs("vimal@masti.test"), viewer: await loginAs("meena@masti.test") };
}

describe("trip details (Decision 4)", () => {
  it("are filled in while documents come in; the first save starts Documents, and only changes are audited", async () => {
    const staff = await visaStaff();
    const c = await saveCase(staff);

    const res = await saveTrip(staff, c.caseNo, {
      departOn: inDays(30),
      returnOn: inDays(41),
      entryType: "MULTIPLE",
      hotelStay: "  Hotel Lutetia, Paris  ",
    });
    expect(res.status).toBe(200);
    expect(res.body.case.trip).toEqual({ departOn: inDays(30), returnOn: inDays(41), entryType: "MULTIPLE", hotelStay: "Hotel Lutetia, Paris" });
    expect(res.body.case.stage.code).toBe("DOCUMENTS");
    expect(await prisma.auditLog.count({ where: { action: "enquiry.stage", entityId: c.id } })).toBe(1);

    // The same values again change nothing.
    expect((await saveTrip(staff, c.caseNo, { departOn: inDays(30), entryType: "MULTIPLE" })).status).toBe(200);
    // A blank hotel stay clears it.
    const cleared = await saveTrip(staff, c.caseNo, { hotelStay: "   " });
    expect(cleared.status).toBe(200);
    expect(cleared.body.case.trip.hotelStay).toBeNull();

    const entries = await prisma.auditLog.findMany({ where: { action: "visa.trip.update" }, orderBy: { createdAt: "asc" } });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      entityType: "VisaCase",
      entityId: c.id,
      clientId: c.client.id,
      before: { departOn: null, returnOn: null, entryType: null, hotelStay: null },
      after: { departOn: inDays(30), returnOn: inDays(41), entryType: "MULTIPLE", hotelStay: "Hotel Lutetia, Paris" },
    });
    expect(entries[1]!.before).toEqual({ hotelStay: "Hotel Lutetia, Paris" });
    expect(entries[1]!.after).toEqual({ hotelStay: null });
  });

  it("refuses travelling out in the past, and coming back before travelling out (also against the stored date)", async () => {
    const staff = await visaStaff();
    const c = await saveCase(staff);

    const past = await saveTrip(staff, c.caseNo, { departOn: inDays(-1) });
    expect(past.status).toBe(400);
    expect(past.body.issues.departOn[0]).toMatch(/can't be in the past/);

    const backwards = await saveTrip(staff, c.caseNo, { departOn: inDays(10), returnOn: inDays(9) });
    expect(backwards.status).toBe(400);
    expect(backwards.body.issues.returnOn[0]).toMatch(/before travelling out/);

    expect((await saveTrip(staff, c.caseNo, { departOn: inDays(10) })).status).toBe(200);
    expect((await saveTrip(staff, c.caseNo, { returnOn: inDays(5) })).body.issues.returnOn).toBeDefined();
    // Out and back the same day is allowed.
    expect((await saveTrip(staff, c.caseNo, { returnOn: inDays(10) })).status).toBe(200);
    expect((await saveTrip(staff, c.caseNo, { departOn: inDays(12) })).body.issues.returnOn).toBeDefined();

    const long = await saveTrip(staff, c.caseNo, { hotelStay: "x".repeat(201) });
    expect(long.status).toBe(400);
    expect(long.body.issues.hotelStay).toBeDefined();
    expect((await saveTrip(staff, c.caseNo, { entryType: "TRIPLE" })).status).toBe(400);
    expect((await saveTrip(staff, c.caseNo, {})).status).toBe(400);

    expect((await load(staff, c.caseNo)).trip).toEqual({ departOn: inDays(10), returnOn: inDays(10), entryType: null, hotelStay: null });
  });

  it("starts travelling out from the intake's exact travel date", async () => {
    const staff = await visaStaff();
    const month = addMonths(istToday(), 2).slice(0, 7);
    const c = await saveCase(staff, { travelMonth: month, travelDate: `${month}-15` });
    const loaded = await load(staff, c.caseNo);
    expect(loaded.travelDate).toBe(`${month}-15`);
    expect(loaded.trip.departOn).toBe(`${month}-15`);
  });

  it("are corrected during file preparation by the processor, the HOD or the Head only", async () => {
    const c = await maturedCase();
    const { hod, head, viewer } = await hodAndHead();

    expect((await saveTrip(await neha(), c.caseNo, { entryType: "SINGLE" })).status).toBe(200);
    expect((await saveTrip(hod, c.caseNo, { entryType: "DOUBLE" })).status).toBe(200);
    expect((await saveTrip(head, c.caseNo, { hotelStay: "Ibis, Nice" })).status).toBe(200);
    // Aarti matured the case: it is Neha's now.
    expect((await saveTrip(c.staff, c.caseNo, { entryType: "SINGLE" })).status).toBe(403);
    expect((await saveTrip(viewer, c.caseNo, { entryType: "SINGLE" })).status).toBe(403);
    expect((await load(hod, c.caseNo)).trip).toMatchObject({ entryType: "DOUBLE", hotelStay: "Ibis, Nice" });
  });

  it("can't change once the file is ready, and don't make anyone's open page stale", async () => {
    const c = await maturedCase();
    const processor = await neha();
    const before = await load(processor, c.caseNo);
    expect((await saveTrip(processor, c.caseNo, { departOn: inDays(20) })).status).toBe(200);
    expect((await load(processor, c.caseNo)).updatedAt).toBe(before.updatedAt);

    await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: await stageId("DISPATCH") } });
    const late = await saveTrip(processor, c.caseNo, { departOn: inDays(21) });
    expect(late.status).toBe(409);
    expect(late.body.message).toMatch(/once the file is ready/);
  });
});

describe("each traveller's portal details (Decision 5)", () => {
  it("stores the acknowledgement number cleaned up and the appointment as that moment in India, audited", async () => {
    const c = await maturedCase();
    const processor = await neha();
    const [adult, child] = (await load(processor, c.caseNo)).travellers;
    const on = inDays(7);

    const res = await saveApplication(processor, c.caseNo, adult!.id, { ackNo: " fra1 mu2026 0648 ", appointment: { on, at: "10:30" } });
    expect(res.status).toBe(200);
    const saved = (res.body.case as CaseDto).travellers;
    expect(saved[0]).toMatchObject({ ackNo: "FRA1MU20260648", appointmentAt: istDateTimeToUtc(on, "10:30").toISOString() });
    expect(saved[1]).toMatchObject({ ackNo: null, appointmentAt: null });

    // The same again changes nothing; null clears both.
    expect((await saveApplication(processor, c.caseNo, adult!.id, { ackNo: "FRA1MU20260648" })).status).toBe(200);
    const cleared = await saveApplication(processor, c.caseNo, adult!.id, { ackNo: null, appointment: null });
    expect((cleared.body.case as CaseDto).travellers[0]).toMatchObject({ ackNo: null, appointmentAt: null });
    expect((await saveApplication(processor, c.caseNo, child!.id, { ackNo: "FRA1MU20260649" })).status).toBe(200);

    const entries = await prisma.auditLog.findMany({ where: { action: "visa.traveller.application" }, orderBy: { createdAt: "asc" } });
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      entityType: "VisaCaseTraveller",
      entityId: adult!.id,
      clientId: c.client.id,
      before: { ackNo: null, appointmentAt: null },
      after: { ackNo: "FRA1MU20260648", appointmentAt: istDateTimeToUtc(on, "10:30").toISOString() },
    });
    expect(entries[1]!.after).toMatchObject({ ackNo: null, appointmentAt: null });
  });

  it("warns about an appointment on or after the departure day; saved once confirmed (19 Oct 2026)", async () => {
    const c = await maturedCase();
    const processor = await neha();
    await prisma.visaCase.update({ where: { enquiryId: c.id }, data: { departOn: new Date(`${inDays(10)}T00:00:00Z`) } });
    const [adult] = (await load(processor, c.caseNo)).travellers;
    await prisma.visaCaseTraveller.update({ where: { id: adult!.id }, data: { name: "Rakesh Mehta" } });

    const late = await saveApplication(processor, c.caseNo, adult!.id, { appointment: { on: inDays(12), at: "10:30" } });
    expect(late.status).toBe(409);
    expect(late.body.details.warnings).toEqual([
      { code: "APPOINTMENT_ON_OR_AFTER_DEPARTURE", message: `Rakesh Mehta's appointment (${dayLabel(inDays(12))}) is on or after the day the trip begins (${dayLabel(inDays(10))}).` },
    ]);
    expect((await load(processor, c.caseNo)).travellers[0]!.appointmentAt).toBeNull();

    const saved = await saveApplication(processor, c.caseNo, adult!.id, { appointment: { on: inDays(12), at: "10:30" }, confirmWarnings: true });
    expect(saved.status).toBe(200);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.traveller.application" } });
    expect(entry.after).toMatchObject({ confirmedWarnings: [{ code: "APPOINTMENT_ON_OR_AFTER_DEPARTURE" }] });

    // Before the departure day: no warning. Nothing to change is still refused, confirmWarnings or not.
    expect((await saveApplication(processor, c.caseNo, adult!.id, { appointment: { on: inDays(5), at: "11:00" } })).status).toBe(200);
    expect((await saveApplication(processor, c.caseNo, adult!.id, { confirmWarnings: true })).status).toBe(400);
  });

  it("refuses a badly formed number, a past appointment and half an appointment", async () => {
    const c = await maturedCase();
    const processor = await neha();
    const [adult] = (await load(processor, c.caseNo)).travellers;
    const send = (body: Record<string, unknown>) => saveApplication(processor, c.caseNo, adult!.id, body);

    for (const ackNo of ["AB1", "FRA-1234", "X".repeat(41)]) {
      const res = await send({ ackNo });
      expect(res.status).toBe(400);
      expect(res.body.issues.ackNo).toBeDefined();
    }
    const past = await send({ appointment: { on: inDays(-1), at: "10:00" } });
    expect(past.status).toBe(400);
    expect(past.body.issues.appointment[0]).toMatch(/later than now/);
    expect((await send({ appointment: { at: "10:30" } })).body.issues.appointment).toBeDefined();
    expect((await send({ appointment: { on: inDays(3), at: "25:00" } })).body.issues.appointment).toBeDefined();
    expect((await send({})).status).toBe(400);

    expect((await load(processor, c.caseNo)).travellers[0]).toMatchObject({ ackNo: null, appointmentAt: null });
  });

  it("is for file preparation only, by the processor, the HOD or the Head, on this case's travellers", async () => {
    const c = await maturedCase();
    const { hod, viewer } = await hodAndHead();
    const [adult] = (await load(hod, c.caseNo)).travellers;
    const body = { ackNo: "FRA1MU20261006481" };

    expect((await saveApplication(c.staff, c.caseNo, adult!.id, body)).status).toBe(403);
    expect((await saveApplication(viewer, c.caseNo, adult!.id, body)).status).toBe(403);
    expect((await saveApplication(hod, c.caseNo, adult!.id, body)).status).toBe(200);

    // Another client's case: its traveller isn't on this one.
    const other = await saveCase(c.staff, { mobile: "98250 99999", clientName: "Kiran Desai" });
    const otherTraveller = await prisma.visaCaseTraveller.findFirstOrThrow({ where: { caseId: other.id } });
    expect((await saveApplication(hod, c.caseNo, otherTraveller.id, body)).status).toBe(404);
    // Still collecting documents: too early.
    const early = await saveApplication(c.staff, other.caseNo, otherTraveller.id, body);
    expect(early.status).toBe(409);
    expect(early.body.message).toMatch(/during file preparation/);

    await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: await stageId("DISPATCH") } });
    expect((await saveApplication(hod, c.caseNo, adult!.id, { ackNo: "FRA1MU20261006482" })).status).toBe(409);
  });

  it("waits for a change that moves the case on, then is refused and saves nothing", async () => {
    const c = await maturedCase();
    const processor = await neha();
    const [adult] = (await load(processor, c.caseNo)).travellers;
    const dispatch = await stageId("DISPATCH");

    const fileReady = holdCaseLock(c.id, (tx) => tx.enquiry.update({ where: { id: c.id }, data: { stageId: dispatch } }));
    await fileReady.ready;
    const pending = saveApplication(processor, c.caseNo, adult!.id, { ackNo: "FRA1MU20261006481" }).then((r) => r);
    try {
      await untilWaitingOnLock();
    } finally {
      fileReady.release();
    }
    await fileReady.done;
    const res = await pending;
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/during file preparation/);
    expect((await prisma.visaCaseTraveller.findUniqueOrThrow({ where: { id: adult!.id } })).ackNo).toBeNull();
  });
});

describe("the visa's switches on the case (Decision 6)", () => {
  it("are on by default, and a change on the visa shows on open cases straight away", async () => {
    const c = await maturedCase();
    const { hod } = await hodAndHead();
    expect(await load(hod, c.caseNo)).toMatchObject({ appointmentNeeded: true, vendorNeeded: true });

    const offering = await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id } });
    expect((await hod.patch(`/api/masters/visa-offerings/${offering.offeringId}`).send({ appointmentNeeded: false })).status).toBe(200);
    expect(await load(hod, c.caseNo)).toMatchObject({ appointmentNeeded: false, vendorNeeded: true });
  });
});

describe("the database", () => {
  it("refuses coming back before travelling out, a blank or long hotel stay, and a badly formed number", async () => {
    const staff = await visaStaff();
    const c = await saveCase(staff);
    const day = (offset: number) => new Date(`${inDays(offset)}T00:00:00Z`);
    const where = { enquiryId: c.id };
    await expect(prisma.visaCase.update({ where, data: { departOn: day(10), returnOn: day(9) } })).rejects.toThrow();
    await expect(prisma.visaCase.update({ where, data: { hotelStay: "   " } })).rejects.toThrow();
    await expect(prisma.visaCase.update({ where, data: { hotelStay: "x".repeat(201) } })).rejects.toThrow();

    const traveller = await prisma.visaCaseTraveller.findFirstOrThrow({ where: { caseId: c.id } });
    for (const ackNo of ["fra1mu2026", "AB1", "FRA 1234"]) {
      await expect(prisma.visaCaseTraveller.update({ where: { id: traveller.id }, data: { ackNo } })).rejects.toThrow();
    }
  });
});

describe("the appointment warning for a traveller not named yet", () => {
  it("names them as the case does, \"Adult 1\"", async () => {
    const c = await maturedCase();
    const processor = await neha();
    await prisma.visaCase.update({ where: { enquiryId: c.id }, data: { departOn: new Date(`${inDays(10)}T00:00:00Z`) } });
    const [adult] = await prisma.visaCaseTraveller.findMany({ where: { caseId: c.id }, orderBy: { position: "asc" } });
    await prisma.visaCaseTraveller.update({ where: { id: adult!.id }, data: { name: null } });
    const res = await saveApplication(processor, c.caseNo, adult!.id, { appointment: { on: inDays(12), at: "10:30" } });
    expect(res.status).toBe(409);
    expect(res.body.details.warnings[0].message).toMatch(/^Adult 1's appointment/);
  });
});
