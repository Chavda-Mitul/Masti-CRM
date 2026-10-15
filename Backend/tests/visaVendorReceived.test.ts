import { beforeEach, describe, expect, it } from "vitest";
import { addDays, addMonths, istDateTimeToUtc, istToday, toDbDate } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { dispatchCase, holdCaseLock, makeInvoiceable, mastiReady, untilWaitingOnLock, type Agent } from "./visaHelpers";

// Visa Step 5, "Vendor got it, papers checked" (docs/decisions/0011-visa-at-vendor.md Decision 2): confirmed per file. The
// file then comes back due at the earliest appointment still to come, or the next open office day at 11:00 ⚠️.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface CaseDto {
  updatedAt: string;
  dueAt: string;
  stage: { code: string };
  vendorReceived: { at: string; by: { id: string; name: string } | null } | null;
}
type Case = Awaited<ReturnType<typeof dispatchCase>>;

const neha = () => loginAs("neha@masti.test");
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const check = (agent: Agent, caseNo: string) => agent.get(`/api/visa/cases/${caseNo}/vendor-received/check`);
const reason = async (code: string) => (await prisma.enquiryReason.findUniqueOrThrow({ where: { code } })).id;

/** Presses "Vendor got it" with the case's updatedAt as the page has it (or `updatedAt`). */
async function received(agent: Agent, caseNo: string, updatedAt?: string) {
  // Read first: a request awaited inside another's .send(...) breaks supertest.
  const seen = updatedAt ?? (await load(agent, caseNo)).updatedAt;
  return agent.post(`/api/visa/cases/${caseNo}/vendor-received`).send({ updatedAt: seen });
}

async function raise(agent: Agent, c: Case, clientName = "Rakesh Mehta") {
  await makeInvoiceable(agent, c, { clientName });
  const { quoteUpdatedAt, taxType, gstRatePercent, totalPaise } = (await agent.get(`/api/visa/cases/${c.caseNo}/invoice/check`)).body.preview;
  expect((await agent.post(`/api/visa/cases/${c.caseNo}/invoice`).send({ quoteUpdatedAt, taxType, gstRatePercent, totalPaise })).status).toBe(200);
}

async function add(agent: Agent, caseNo: string) {
  const { updatedAt } = await load(agent, caseNo);
  expect((await agent.post(`/api/visa/cases/${caseNo}/docket`).send({ mode: "GROUP", updatedAt })).status).toBe(200);
}

/** Mehta and Shah, both Neha's, in one docket, dispatched by Blue Dart: both at Step 5. */
async function dispatchedTwo() {
  await mastiReady();
  const mehta = await dispatchCase();
  const shah = await dispatchCase({ vendorId: mehta.vendor.id, extra: { mobile: "98250 41235", clientName: "Sunil Shah" } });
  const processor = await neha();
  for (const [c, name] of [[mehta, "Rakesh Mehta"], [shah, "Sunil Shah"]] as const) {
    await add(processor, c.caseNo);
    await raise(processor, c, name);
  }
  const courier = await prisma.courier.findUniqueOrThrow({ where: { code: "BLUE_DART" } });
  const sent = await processor.post(`/api/visa/cases/${mehta.caseNo}/dispatch`).send({ courierId: courier.id, awbNo: "12345678", caseNos: [mehta.caseNo, shah.caseNo] });
  expect(sent.status).toBe(200);
  return { mehta, shah, processor };
}

/** Sets each traveller's appointment, in order (null for none). */
async function appointments(c: { id: string }, at: (Date | null)[]) {
  const travellers = await prisma.visaCaseTraveller.findMany({ where: { caseId: c.id }, orderBy: { position: "asc" } });
  for (const [i, t] of travellers.entries()) await prisma.visaCaseTraveller.update({ where: { id: t.id }, data: { appointmentAt: at[i] ?? null } });
}

describe("Vendor got it, papers checked (Decision 2)", () => {
  it("is recorded on this file only, due back at the earliest appointment still to come", async () => {
    const { mehta, shah, processor } = await dispatchedTwo();
    const soonest = istDateTimeToUtc(addDays(istToday(), 3), "14:00");
    await appointments(mehta, [istDateTimeToUtc(addDays(istToday(), -1), "10:00"), soonest]);
    const shahBefore = await load(processor, shah.caseNo);

    expect((await check(processor, mehta.caseNo)).body).toEqual({ dueAt: soonest.toISOString(), dueReason: "APPOINTMENT" });
    const res = await received(processor, mehta.caseNo);
    expect(res.status).toBe(200);
    const after = res.body.case as CaseDto;
    expect(after.stage.code).toBe("AT_VENDOR");
    expect(after.dueAt).toBe(soonest.toISOString());
    expect(after.vendorReceived).toMatchObject({ by: { name: "Neha Joshi" } });

    const other = await load(processor, shah.caseNo);
    expect([other.vendorReceived, other.dueAt]).toEqual([null, shahBefore.dueAt]);

    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.vendorReceived" } });
    expect(row).toMatchObject({ entityType: "Enquiry", entityId: mehta.id, clientId: mehta.client.id });
    expect(row.after).toMatchObject({ dueAt: soonest.toISOString(), dueReason: "APPOINTMENT", docketNo: expect.stringMatching(/^D-/) });
  });

  it("with no appointment to come, the next open office day at the setting's time, skipping an office holiday", async () => {
    const { mehta, processor } = await dispatchedTwo();
    await appointments(mehta, [null, istDateTimeToUtc(addDays(istToday(), -2), "10:00")]);
    const today = istToday();
    await prisma.holiday.create({
      data: { name: "Office closed", startDate: toDbDate(addDays(today, 1)), endDate: toDbDate(addDays(today, 1)), targets: { create: [{ kind: "MASTI_OFFICE" }] } },
    });
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await loginAs("riya@masti.test");
    expect((await hod.put("/api/visa/settings").send({ submissionCheck: { afterDays: 1, at: "10:00" } })).status).toBe(200);
    expect((await hod.put("/api/visa/settings").send({ submissionCheck: { afterDays: 1, at: "24:00" } })).status).toBe(400);
    const due = istDateTimeToUtc(addDays(today, 2), "10:00").toISOString();

    expect((await check(processor, mehta.caseNo)).body).toEqual({ dueAt: due, dueReason: "NEXT_DAY" });
    const res = await received(processor, mehta.caseNo);
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).dueAt).toBe(due);
  });
});

describe("what is refused", () => {
  it("before dispatch", async () => {
    await mastiReady();
    const waiting = await dispatchCase();
    const res = await received(await neha(), waiting.caseNo);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/with the vendor/);
  });

  it("an e-visa: it went in online, with no vendor", async () => {
    await mastiReady();
    const c = await dispatchCase();
    const { offeringId } = await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id }, select: { offeringId: true } });
    await prisma.visaOffering.update({ where: { id: offeringId }, data: { vendorNeeded: false } });
    await prisma.visaCase.update({ where: { enquiryId: c.id }, data: { vendorId: null } });
    const processor = await neha();
    await raise(processor, c);
    const { updatedAt } = await load(processor, c.caseNo);
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/submit-online`).send({ updatedAt })).status).toBe(200);

    const res = await received(processor, c.caseNo);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/went in online/);
  });

  it("a second press, a stale page and a postponed case", async () => {
    const { mehta, shah, processor } = await dispatchedTwo();
    expect((await received(processor, mehta.caseNo)).status).toBe(200);
    expect((await received(processor, mehta.caseNo)).body.message).toMatch(/already/);

    const seen = (await load(processor, shah.caseNo)).updatedAt;
    expect((await received(processor, shah.caseNo, "2026-01-01T00:00:00.000Z")).body.details.code).toBe("STALE");
    await prisma.enquiry.update({
      where: { id: shah.id },
      data: { status: "POSTPONED", reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: toDbDate(addMonths(istToday(), 1)) },
    });
    expect((await received(processor, shah.caseNo, seen)).body.message).toMatch(/postponed/);
    expect(await prisma.auditLog.count({ where: { action: "visa.vendorReceived" } })).toBe(1);
  });

  it("the database never records a vendor's receipt for a file with no docket", async () => {
    await mastiReady();
    const c = await dispatchCase();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
    await expect(
      prisma.visaCase.update({ where: { enquiryId: c.id }, data: { vendorReceivedAt: new Date(), vendorReceivedById: user.id } }),
    ).rejects.toThrow(/VisaCase_vendor_received_docket/);
  });
});

describe("who may confirm it", () => {
  it("its processor, the Visa HOD and the Head; not other staff, view-only users or other departments", async () => {
    const { mehta, shah } = await dispatchedTwo();
    await createUser({ name: "Kiran", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    await createUser({ name: "Hetal", email: "hetal@masti.test", departments: [{ code: "HOLIDAYS", access: "EDIT" }] });
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const seen = (await load(await neha(), mehta.caseNo)).updatedAt;

    for (const email of ["kiran@masti.test", "meena@masti.test", "hetal@masti.test"]) {
      expect((await received(await loginAs(email), mehta.caseNo, seen)).status).toBe(403);
    }
    const hod = await received(await loginAs("riya@masti.test"), mehta.caseNo, seen);
    expect(hod.status).toBe(200);
    expect((hod.body.case as CaseDto).vendorReceived!.by!.name).toBe("Riya");
    expect((await received(await loginAs("vimal@masti.test"), shah.caseNo)).status).toBe(200);
  });
});

describe("races", () => {
  it("a press that waited behind a postpone sees it and is refused", async () => {
    const { mehta, processor } = await dispatchedTwo();
    const seen = (await load(processor, mehta.caseNo)).updatedAt;
    const reasonId = await reason("TRAVEL_DATES_MOVED");

    const postpone = holdCaseLock(mehta.id, (tx) =>
      tx.enquiry.update({ where: { id: mehta.id }, data: { status: "POSTPONED", reasonId, resumeOn: toDbDate(addMonths(istToday(), 1)) } }),
    );
    await postpone.ready;
    const pending = received(processor, mehta.caseNo, seen).then((r) => r);
    try {
      await untilWaitingOnLock();
    } finally {
      postpone.release();
    }
    await postpone.done;
    const res = await pending;
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/postponed/);
    expect((await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: mehta.id } })).vendorReceivedAt).toBeNull();
  });
});
