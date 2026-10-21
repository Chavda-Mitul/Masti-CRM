import { beforeEach, describe, expect, it } from "vitest";
import { addDays, istDateTimeToUtc, istToday } from "../src/lib/dates";
import { nextOpenDay } from "../src/modules/holidays/blockedDays";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { holdCaseLock, readyCase, untilWaitingOnLock, type Agent } from "./visaHelpers";

// Visa Step 3, slice 5 (docs/decisions/0007-visa-file-prep.md Decision 9): "File ready — add to docket" checks that
// Step 3 is complete, then moves the case to Docket & dispatch with its processor.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface CaseDto {
  updatedAt: string;
  stage: { code: string };
  owner: { name: string } | null;
  dueAt: string | null;
  fileReadyAt: string | null;
  fileReadyBy: { name: string } | null;
}

type Ready = Awaited<ReturnType<typeof readyCase>>;

const neha = () => loginAs("neha@masti.test");
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const stageId = async (code: string) => (await prisma.departmentStage.findFirstOrThrow({ where: { code } })).id;

/** Presses "File ready" with the case's updatedAt as the page last saw it. */
async function fileReady(agent: Agent, caseNo: string, updatedAt?: string) {
  const seen = updatedAt ?? (await load(agent, caseNo)).updatedAt;
  return agent.post(`/api/visa/cases/${caseNo}/file-ready`).send({ updatedAt: seen });
}

async function hodHeadViewer() {
  await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
  await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
  await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
  return { hod: await loginAs("riya@masti.test"), head: await loginAs("vimal@masti.test"), viewer: await loginAs("meena@masti.test") };
}

describe('"File ready — add to docket" (Decision 9)', () => {
  it("moves a complete case to Docket & dispatch, still the processor's, due the next office day, stamped and audited", async () => {
    const c = await readyCase();
    const processor = await neha();
    const before = Date.now();

    const res = await fileReady(processor, c.caseNo);
    expect(res.status).toBe(200);
    const after = res.body.case as CaseDto;
    expect(after).toMatchObject({ stage: { code: "DISPATCH" }, owner: { name: "Neha Joshi" }, fileReadyBy: { name: "Neha Joshi" } });
    expect(new Date(after.fileReadyAt!).getTime()).toBeGreaterThanOrEqual(before - 1000);
    // Due for the docket the next open office day at 11:00 ⚠️ (visa.dispatchCheck), not late the moment it's ready.
    expect(after.dueAt).toBe(istDateTimeToUtc(await nextOpenDay(addDays(istToday(), 1), { office: true }), "11:00").toISOString());

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.file.ready" } });
    expect(entry).toMatchObject({
      entityType: "Enquiry",
      entityId: c.id,
      clientId: c.client.id,
      before: { stage: "FILE_PREPARATION" },
      after: { stage: "DISPATCH", fileReadyById: entry.actorId, vendorId: c.vendor.id, finalFileId: c.file.id },
    });

    // Pressed again: the case has moved on.
    const again = await fileReady(processor, c.caseNo);
    expect(again.status).toBe(409);
    expect(await prisma.auditLog.count({ where: { action: "visa.file.ready" } })).toBe(1);
  });

  const gaps: { what: string; make: (c: Ready) => Promise<unknown>; expected: Record<string, unknown>; message: RegExp }[] = [
    {
      what: "a paper not checked yet",
      make: async (c) => {
        const doc = await prisma.visaCaseDocument.findFirstOrThrow({ where: { traveller: { caseId: c.id, position: 1 }, name: "Passport" } });
        await prisma.visaCaseDocument.update({ where: { id: doc.id }, data: { check: null, checkedAt: null, checkedById: null } });
      },
      expected: { papers: [{ toCheck: ["Passport"], needsReplacing: [] }] },
      message: /Passport still to check/,
    },
    {
      what: "a paper that needs replacing",
      make: async (c) => {
        const doc = await prisma.visaCaseDocument.findFirstOrThrow({ where: { traveller: { caseId: c.id, position: 1 }, name: "Passport" } });
        const reason = await prisma.documentProblemReason.findFirstOrThrow({ where: { isActive: true } });
        await prisma.visaCaseDocument.update({ where: { id: doc.id }, data: { check: "NEEDS_REPLACING", checkReasonId: reason.id } });
      },
      expected: { papers: [{ toCheck: [], needsReplacing: ["Passport"] }] },
      message: /Passport needs replacing/,
    },
    {
      what: "an acknowledgement number",
      make: (c) => prisma.visaCaseTraveller.update({ where: { id: c.travellers[1]!.id }, data: { ackNo: null } }),
      expected: { ackNo: ["Child 1"] },
      message: /acknowledgement no\. for Child 1/,
    },
    {
      what: "an appointment",
      make: (c) => prisma.visaCaseTraveller.update({ where: { id: c.travellers[0]!.id }, data: { appointmentAt: null } }),
      expected: { appointment: ["Adult 1"] },
      message: /appointment for Adult 1/,
    },
    {
      what: "the saved file",
      make: (c) => prisma.caseFile.deleteMany({ where: { enquiryId: c.id } }),
      expected: { finalFile: true },
      message: /the saved file/,
    },
    {
      what: "a vendor",
      make: (c) => prisma.visaCase.update({ where: { enquiryId: c.id }, data: { vendorId: null } }),
      expected: { vendor: "NONE" },
      message: /a vendor/,
    },
    {
      what: "an active vendor (the one picked was switched off)",
      make: (c) => prisma.vendor.update({ where: { id: c.vendor.id }, data: { isActive: false } }),
      expected: { vendor: "SWITCHED_OFF" },
      message: /an active vendor/,
    },
    {
      what: "a vendor covering the country (France was taken off the one picked)",
      make: async (c) => {
        const cn = await prisma.country.findUniqueOrThrow({ where: { code: "CN" } });
        await prisma.vendorCountry.deleteMany({ where: { vendorId: c.vendor.id } });
        await prisma.vendorCountry.create({ data: { vendorId: c.vendor.id, countryId: cn.id } });
      },
      expected: { vendor: "NOT_COVERING" },
      message: /a vendor that covers France \(the one picked no longer does\)/,
    },
    {
      what: "an active vendor, when the one picked is both switched off and no longer covers the country",
      make: async (c) => {
        await prisma.vendorCountry.deleteMany({ where: { vendorId: c.vendor.id } });
        await prisma.vendor.update({ where: { id: c.vendor.id }, data: { isActive: false } });
      },
      expected: { vendor: "SWITCHED_OFF" },
      message: /an active vendor/,
    },
    {
      what: "travelling out",
      make: (c) => prisma.visaCase.update({ where: { enquiryId: c.id }, data: { departOn: null } }),
      expected: { trip: ["departOn"] },
      message: /trip details \(travelling out\)/,
    },
    {
      what: "coming back",
      make: (c) => prisma.visaCase.update({ where: { enquiryId: c.id }, data: { returnOn: null } }),
      expected: { trip: ["returnOn"] },
      message: /trip details \(coming back\)/,
    },
    {
      what: "the entry type",
      make: (c) => prisma.visaCase.update({ where: { enquiryId: c.id }, data: { entryType: null } }),
      expected: { trip: ["entryType"] },
      message: /trip details \(entry\)/,
    },
  ];

  it.each(gaps)("is refused without $what, and says so", async ({ make, expected, message }) => {
    const c = await readyCase();
    await make(c);
    const processor = await neha();

    const res = await fileReady(processor, c.caseNo);
    expect(res.status).toBe(409);
    expect(res.body.details.code).toBe("NOT_READY");
    expect(res.body.message).toMatch(message);
    // Only that piece is missing.
    expect(res.body.details.missing).toEqual({ papers: [], ackNo: [], appointment: [], finalFile: false, vendor: null, trip: [], ...withTraveller(expected) });
    expect(await load(processor, c.caseNo)).toMatchObject({ stage: { code: "FILE_PREPARATION" }, fileReadyAt: null });
  });

  it("doesn't ask for an appointment or a vendor when the visa doesn't need them", async () => {
    const c = await readyCase();
    await prisma.visaCaseTraveller.updateMany({ where: { caseId: c.id }, data: { appointmentAt: null } });
    await prisma.visaCase.update({ where: { enquiryId: c.id }, data: { vendorId: null } });
    const visa = await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id } });
    await prisma.visaOffering.update({ where: { id: visa.offeringId }, data: { appointmentNeeded: false, vendorNeeded: false } });

    const res = await fileReady(await neha(), c.caseNo);
    expect(res.status).toBe(200);
    expect(res.body.case.stage.code).toBe("DISPATCH");
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.file.ready" } })).after).toMatchObject({ vendorId: null });
  });

  it("is for the processor, the HOD or the Head, on an open case with a processor, at File preparation", async () => {
    const c = await readyCase();
    const { hod, head, viewer } = await hodHeadViewer();

    // Aarti matured the case: it is Neha's now.
    expect((await fileReady(c.staff, c.caseNo, (await load(hod, c.caseNo)).updatedAt)).status).toBe(403);
    expect((await fileReady(viewer, c.caseNo)).status).toBe(403);

    // A page loaded before someone else changed the case.
    const seen = (await load(hod, c.caseNo)).updatedAt;
    await prisma.enquiry.update({ where: { id: c.id }, data: { dueAt: new Date() } });
    const stale = await fileReady(hod, c.caseNo, seen);
    expect(stale.status).toBe(409);
    expect(stale.body.details.code).toBe("STALE");

    // Nobody owns it: Step 4 is the processor's work.
    await prisma.enquiry.update({ where: { id: c.id }, data: { ownerId: null } });
    const unowned = await fileReady(hod, c.caseNo);
    expect(unowned.status).toBe(409);
    expect(unowned.body.message).toMatch(/processor first/);

    // Still collecting documents: too early.
    const processor = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
    await prisma.enquiry.update({ where: { id: c.id }, data: { ownerId: processor.id, stageId: await stageId("DOCUMENTS") } });
    expect((await fileReady(hod, c.caseNo)).status).toBe(409);

    await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: await stageId("FILE_PREPARATION") } });
    expect((await fileReady(head, c.caseNo)).status).toBe(200);
    expect((await load(hod, c.caseNo)).fileReadyBy).toEqual({ id: expect.any(String), name: "Vimal" });
  });

  it("leaves Step 3 read-only: checks, portal details, the vendor, the file and the trip are refused", async () => {
    const c = await readyCase();
    const processor = await neha();
    expect((await fileReady(processor, c.caseNo)).status).toBe(200);
    const base = `/api/visa/cases/${c.caseNo}`;
    const doc = await prisma.visaCaseDocument.findFirstOrThrow({ where: { traveller: { caseId: c.id }, check: "CHECKED" } });

    const refused = [
      await processor.patch(`${base}/documents/${doc.id}/check`).send({ check: null }),
      await processor.patch(`${base}/travellers/${c.travellers[0]!.id}/application`).send({ ackNo: "FRA1MU20269999999" }),
      await processor.put(`${base}/vendor`).send({ vendorId: null }),
      await processor.post(`${base}/files/final`).set("Content-Type", "application/pdf").send(Buffer.from("%PDF-1.4\n")),
      await processor.patch(`${base}/trip`).send({ entryType: "MULTIPLE" }),
    ];
    for (const res of refused) expect(res.status).toBe(409);
    expect((await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id } })).vendorId).toBe(c.vendor.id);
  });

  it("waits for a check made at the same moment, sees it, and is refused", async () => {
    const c = await readyCase();
    const processor = await neha();
    const seen = (await load(processor, c.caseNo)).updatedAt;
    const doc = await prisma.visaCaseDocument.findFirstOrThrow({ where: { traveller: { caseId: c.id, position: 1 }, name: "Passport" } });
    const reason = await prisma.documentProblemReason.findFirstOrThrow({ where: { isActive: true } });

    // The flag holds the case's lock, as a Step 3 write does, while "File ready" is pressed.
    const flag = holdCaseLock(c.id, (tx) => tx.visaCaseDocument.update({ where: { id: doc.id }, data: { check: "NEEDS_REPLACING", checkReasonId: reason.id } }));
    await flag.ready;
    const pending = fileReady(processor, c.caseNo, seen).then((r) => r);
    try {
      await untilWaitingOnLock();
    } finally {
      flag.release();
    }
    await flag.done;
    const res = await pending;
    expect(res.status).toBe(409);
    expect(res.body.details).toMatchObject({ code: "NOT_READY", missing: { papers: [{ needsReplacing: ["Passport"] }] } });
    expect(await load(processor, c.caseNo)).toMatchObject({ stage: { code: "FILE_PREPARATION" }, fileReadyAt: null });
  });

  it("is stamped with who and when together, or not at all (database check)", async () => {
    const c = await readyCase();
    await expect(prisma.visaCase.update({ where: { enquiryId: c.id }, data: { fileReadyAt: new Date() } })).rejects.toThrow();
  });
});

/** The papers entry names its traveller: the case's first one, "Adult 1". */
function withTraveller(expected: Record<string, unknown>) {
  const papers = expected.papers as { toCheck: string[]; needsReplacing: string[] }[] | undefined;
  return papers ? { ...expected, papers: papers.map((p) => ({ traveller: "Adult 1", ...p })) } : expected;
}
