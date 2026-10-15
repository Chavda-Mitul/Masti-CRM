import { beforeEach, describe, expect, it } from "vitest";
import { addDays, addMonths, istDateTimeToUtc, istToday, toDbDate } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { dispatchCase, holdCaseLock, makeInvoiceable, mastiReady, readyCase, untilWaitingOnLock, type Agent } from "./visaHelpers";

// Visa Step 4 for e-visas (docs/decisions/0008-visa-docket-dispatch.md Decision 11): a visa whose "Vendor needed" is off
// is "Submitted online", with no docket, once its invoice is raised. It moves to At vendor, due back to check the portal.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface CaseDto {
  updatedAt: string;
  dueAt: string;
  stage: { code: string };
  vendorNeeded: boolean;
  docket: { docketNo: string } | null;
  submittedOnline: { at: string; by: { id: string; name: string } } | null;
}
type Case = Awaited<ReturnType<typeof dispatchCase>>;

const neha = () => loginAs("neha@masti.test");
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const check = (agent: Agent, caseNo: string) => agent.get(`/api/visa/cases/${caseNo}/submit-online/check`);
const reason = async (code: string) => (await prisma.enquiryReason.findUniqueOrThrow({ where: { code } })).id;

/** Presses "Submitted online" with the case's updatedAt as the page has it (or `updatedAt`). */
async function submit(agent: Agent, caseNo: string, updatedAt?: string) {
  // Read first: a request awaited inside another's .send(...) breaks supertest.
  const seen = updatedAt ?? (await load(agent, caseNo)).updatedAt;
  return agent.post(`/api/visa/cases/${caseNo}/submit-online`).send({ updatedAt: seen });
}

async function raise(agent: Agent, c: Case) {
  await makeInvoiceable(agent, c);
  const { quoteUpdatedAt, taxType, gstRatePercent, totalPaise } = (await agent.get(`/api/visa/cases/${c.caseNo}/invoice/check`)).body.preview;
  expect((await agent.post(`/api/visa/cases/${c.caseNo}/invoice`).send({ quoteUpdatedAt, taxType, gstRatePercent, totalPaise })).status).toBe(200);
}

/** Its visa needs no vendor: Vendor needed off on France · Tourist. */
async function vendorNotNeeded(c: { id: string }) {
  const { offeringId } = await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id }, select: { offeringId: true } });
  await prisma.visaOffering.update({ where: { id: offeringId }, data: { vendorNeeded: false } });
}

/** Neha's e-visa at Docket & dispatch, with no vendor picked. `ready` raises its invoice. */
async function eVisa({ ready = true } = {}) {
  await mastiReady();
  const c = await dispatchCase();
  await vendorNotNeeded(c);
  await prisma.visaCase.update({ where: { enquiryId: c.id }, data: { vendorId: null } });
  const processor = await neha();
  if (ready) await raise(processor, c);
  return { c, processor };
}

describe("Submitted online (Decision 11)", () => {
  it("moves the e-visa to At vendor, due the next open office day at 11:00, with who and when", async () => {
    const { c, processor } = await eVisa();
    // Tomorrow is an office holiday, so the portal check moves to the day after.
    const today = istToday();
    await prisma.holiday.create({
      data: { name: "Office closed", startDate: toDbDate(addDays(today, 1)), endDate: toDbDate(addDays(today, 1)), targets: { create: [{ kind: "MASTI_OFFICE" }] } },
    });
    const due = istDateTimeToUtc(addDays(today, 2), "11:00").toISOString();

    const before = await check(processor, c.caseNo);
    expect(before.status).toBe(200);
    expect(before.body).toEqual({ blockers: [], dueAt: due });

    const res = await submit(processor, c.caseNo);
    expect(res.status).toBe(200);
    const after = res.body.case as CaseDto;
    expect(after.stage.code).toBe("AT_VENDOR");
    expect(after.dueAt).toBe(due);
    expect(after.docket).toBeNull();
    expect(after.submittedOnline).toMatchObject({ by: { name: "Neha Joshi" } });
    expect(Date.now() - new Date(after.submittedOnline!.at).getTime()).toBeLessThan(60_000);
    expect(await prisma.docket.count()).toBe(0);

    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.submittedOnline" } });
    expect(row).toMatchObject({ entityType: "Enquiry", entityId: c.id, clientId: c.client.id });
    expect(row.before).toMatchObject({ stage: "DISPATCH" });
    expect(row.after).toMatchObject({ stage: "AT_VENDOR", dueAt: due, invoiceNo: expect.stringMatching(/^MVI/) });
  });

  it("follows its own setting, apart from the vendor confirmation", async () => {
    const { c, processor } = await eVisa();
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await loginAs("riya@masti.test");
    expect((await hod.put("/api/visa/settings").send({ onlineCheck: { afterDays: 3, at: "10:30" } })).status).toBe(200);
    expect((await hod.put("/api/visa/settings").send({ onlineCheck: { afterDays: 1, at: "25:00" } })).status).toBe(400);
    expect((await hod.get("/api/visa/settings")).body.settings.vendorConfirm).toEqual({ afterDays: 1, at: "11:00" });

    const res = await submit(processor, c.caseNo);
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).dueAt).toBe(istDateTimeToUtc(addDays(istToday(), 3), "10:30").toISOString());
  });

  it("leaves Step 4 read-only: no second press, no docket, no quote change", async () => {
    const { c, processor } = await eVisa();
    expect((await submit(processor, c.caseNo)).status).toBe(200);

    expect((await submit(processor, c.caseNo)).body.message).toMatch(/waits for dispatch/);
    const { updatedAt } = await load(processor, c.caseNo);
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/docket`).send({ mode: "GROUP", updatedAt })).status).toBe(409);
    const speed = await prisma.processingSpeed.findUniqueOrThrow({ where: { code: "NORMAL" } });
    const travellers = await prisma.visaCaseTraveller.findMany({ where: { caseId: c.id } });
    const quoteSeen = ((await load(processor, c.caseNo)) as CaseDto & { quote: { updatedAt: string } }).quote.updatedAt;
    const quote = await processor.put(`/api/visa/cases/${c.caseNo}/quote`).send({
      processingSpeedId: speed.id,
      serviceChargePaise: 0,
      lines: travellers.map((t) => ({ travellerId: t.id, form: "LUMP_SUM", lumpSumPaise: 100 })),
      updatedAt: quoteSeen,
    });
    expect(quote.status).toBe(409);
    expect(quote.body.message).toMatch(/gone to the vendor/);
    expect(await prisma.auditLog.count({ where: { action: "visa.submittedOnline" } })).toBe(1);
  });
});

describe("what is refused", () => {
  it("an e-visa without its invoice: 409 SUBMIT_BLOCKED", async () => {
    const { c, processor } = await eVisa({ ready: false });
    expect((await check(processor, c.caseNo)).body.blockers).toEqual([{ kind: "INVOICE", label: expect.stringMatching(/invoice/), items: [] }]);

    const res = await submit(processor, c.caseNo);
    expect(res.status).toBe(409);
    expect(res.body.details.code).toBe("SUBMIT_BLOCKED");
    expect((await load(processor, c.caseNo)).stage.code).toBe("DISPATCH");
    expect(await prisma.auditLog.count({ where: { action: "visa.submittedOnline" } })).toBe(0);
  });

  it("a visa that needs a vendor: it goes in a docket", async () => {
    await mastiReady();
    const c = await dispatchCase();
    const processor = await neha();
    await raise(processor, c);
    const res = await submit(processor, c.caseNo);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/needs a vendor/);
  });

  it("a case already in a docket, when Vendor needed was switched off after it joined", async () => {
    await mastiReady();
    const c = await dispatchCase();
    const processor = await neha();
    const { updatedAt } = await load(processor, c.caseNo);
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/docket`).send({ mode: "GROUP", updatedAt })).status).toBe(200);
    await raise(processor, c);
    await vendorNotNeeded(c);

    const res = await submit(processor, c.caseNo);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Take it out of docket D-\d{4}-0001 first/);
  });

  it("before File ready, when postponed, and on a stale page", async () => {
    await mastiReady();
    const early = await readyCase();
    await vendorNotNeeded(early);
    const processor = await neha();
    expect((await submit(processor, early.caseNo)).body.message).toMatch(/waits for dispatch/);

    const c = await dispatchCase({ vendorId: early.vendor.id, extra: { mobile: "98250 41235", clientName: "Sunil Shah" } });
    await raise(processor, c);
    const seen = (await load(processor, c.caseNo)).updatedAt;
    expect((await submit(processor, c.caseNo, "2026-01-01T00:00:00.000Z")).body.details.code).toBe("STALE");

    await prisma.enquiry.update({
      where: { id: c.id },
      data: { status: "POSTPONED", reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: toDbDate(addMonths(istToday(), 1)) },
    });
    const postponed = await submit(processor, c.caseNo, seen);
    expect(postponed.status).toBe(409);
    expect(postponed.body.message).toMatch(/postponed/);
  });

  it("the database never holds a case both in a docket and submitted online", async () => {
    await mastiReady();
    const c = await dispatchCase();
    const processor = await neha();
    const { updatedAt } = await load(processor, c.caseNo);
    await processor.post(`/api/visa/cases/${c.caseNo}/docket`).send({ mode: "GROUP", updatedAt });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
    await expect(
      prisma.visaCase.update({ where: { enquiryId: c.id }, data: { submittedOnlineAt: new Date(), submittedOnlineById: user.id } }),
    ).rejects.toThrow(/VisaCase_online_or_docket/);
  });
});

describe("who may press it", () => {
  it("its processor, the Visa HOD and the Head; not other staff, view-only users or other departments", async () => {
    const { c } = await eVisa();
    await createUser({ name: "Kiran", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    await createUser({ name: "Hetal", email: "hetal@masti.test", departments: [{ code: "HOLIDAYS", access: "EDIT" }] });
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const seen = (await load(await neha(), c.caseNo)).updatedAt;

    for (const email of ["kiran@masti.test", "meena@masti.test", "hetal@masti.test"]) {
      expect((await submit(await loginAs(email), c.caseNo, seen)).status).toBe(403);
    }
    const hod = await submit(await loginAs("riya@masti.test"), c.caseNo, seen);
    expect(hod.status).toBe(200);
    expect((hod.body.case as CaseDto).submittedOnline!.by.name).toBe("Riya");
  });

  it("the Head may", async () => {
    const { c } = await eVisa();
    const head = await loginAs("vimal@masti.test");
    expect((await submit(head, c.caseNo)).status).toBe(200);
  });
});

describe("races", () => {
  it("a press that waited behind a postpone sees it and is refused", async () => {
    const { c, processor } = await eVisa();
    const seen = (await load(processor, c.caseNo)).updatedAt;
    const reasonId = await reason("TRAVEL_DATES_MOVED");

    const postpone = holdCaseLock(c.id, (tx) =>
      tx.enquiry.update({ where: { id: c.id }, data: { status: "POSTPONED", reasonId, resumeOn: toDbDate(addMonths(istToday(), 1)) } }),
    );
    await postpone.ready;
    const pending = submit(processor, c.caseNo, seen).then((r) => r);
    try {
      await untilWaitingOnLock();
    } finally {
      postpone.release();
    }
    await postpone.done;
    const res = await pending;
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/postponed/);
    expect((await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id } })).submittedOnlineAt).toBeNull();
  });
});
