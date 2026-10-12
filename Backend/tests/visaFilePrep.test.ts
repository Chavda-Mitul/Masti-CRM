import { beforeEach, describe, expect, it } from "vitest";
import { addMonths, istToday } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { holdCaseLock, saveCase, untilWaitingOnLock, visaStaff, type Agent } from "./visaHelpers";

// Visa Step 3, file preparation (docs/decisions/0007-visa-file-prep.md): the processor's check of each paper.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface CaseDoc {
  id: string;
  name: string;
  status: string;
  receivedAs: string | null;
  receivedBy: { name: string } | null;
  check: string | null;
  checkReason: { id: number; name: string } | null;
  checkedAt: string | null;
  checkedBy: { name: string } | null;
}
interface CaseDto {
  caseNo: string;
  updatedAt: string;
  travellers: { documents: CaseDoc[]; checked: number; needsReplacing: number }[];
}

/**
 * A France case (1 adult, 1 child) that matured: every paper in or made, the adult's salary slips not needed, at File
 * preparation, matured by Aarti and given to Neha Joshi (or still waiting for a processor). Set straight in the
 * database; maturity itself is tested in visaDocuments.test.ts.
 */
async function maturedCase({ assigned = true } = {}) {
  const staff = await visaStaff();
  const saved = await saveCase(staff);
  const aarti = await prisma.user.findUniqueOrThrow({ where: { email: "aarti@masti.test" } });
  const neha = await createUser({ name: "Neha Joshi", email: "neha@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
  const now = new Date();
  const docs = await prisma.visaCaseDocument.findMany({ where: { traveller: { caseId: saved.id } } });
  for (const d of docs) {
    const data =
      d.requirement === "ARRANGED_BY_US"
        ? { status: "MADE" as const, receivedAt: now, receivedById: aarti.id }
        : d.name.startsWith("Salary slips")
          ? { status: "NOT_NEEDED" as const }
          : { status: "RECEIVED" as const, receivedAs: d.requirement === "ORIGINAL" ? ("ORIGINAL" as const) : ("XEROX" as const), receivedAt: now, receivedById: aarti.id };
    await prisma.visaCaseDocument.update({ where: { id: d.id }, data });
  }
  const filePrep = await prisma.departmentStage.findFirstOrThrow({ where: { code: "FILE_PREPARATION" } });
  await prisma.enquiry.update({ where: { id: saved.id }, data: { stageId: filePrep.id, ownerId: assigned ? neha.id : null, dueAt: now } });
  await prisma.visaCase.update({ where: { enquiryId: saved.id }, data: { maturedAt: now, maturedById: aarti.id } });
  return { ...saved, staff };
}

const neha = () => loginAs("neha@masti.test");
const docOf = (c: CaseDto, name: string, traveller = 0) => c.travellers[traveller]!.documents.find((d) => d.name === name)!;
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const check = (agent: Agent, caseNo: string, docId: string, body: Record<string, unknown>) =>
  agent.patch(`/api/visa/cases/${caseNo}/documents/${docId}/check`).send(body);
const reasonId = async (code: string) => (await prisma.documentProblemReason.findUniqueOrThrow({ where: { code } })).id;

describe("who checks the papers", () => {
  it("lets the processor, the Visa HOD and the Head check; other staff and view-only users can't", async () => {
    const c = await maturedCase();
    const processor = await neha();
    const before = await load(processor, c.caseNo);
    const passport = docOf(before, "Passport");

    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });

    // Aarti matured it, but it is Neha's now.
    expect((await check(c.staff, c.caseNo, passport.id, { check: "CHECKED" })).status).toBe(403);
    expect((await check(await loginAs("meena@masti.test"), c.caseNo, passport.id, { check: "CHECKED" })).status).toBe(403);

    expect((await check(processor, c.caseNo, passport.id, { check: "CHECKED" })).status).toBe(200);
    expect((await check(await loginAs("riya@masti.test"), c.caseNo, passport.id, { check: null })).status).toBe(200);
    expect((await check(await loginAs("vimal@masti.test"), c.caseNo, passport.id, { check: "CHECKED" })).status).toBe(200);
  });

  it("before a processor is picked, only the HOD and the Head can check", async () => {
    const c = await maturedCase({ assigned: false });
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await loginAs("riya@masti.test");
    const passport = docOf(await load(hod, c.caseNo), "Passport");

    expect((await check(await neha(), c.caseNo, passport.id, { check: "CHECKED" })).status).toBe(403);
    expect((await check(c.staff, c.caseNo, passport.id, { check: "CHECKED" })).status).toBe(403);
    expect((await check(hod, c.caseNo, passport.id, { check: "CHECKED" })).status).toBe(200);
  });

  it("checks only during file preparation: not while documents are collected, not after, not while postponed", async () => {
    const c = await maturedCase();
    const processor = await neha();
    const passport = docOf(await load(processor, c.caseNo), "Passport");
    const stage = async (code: string) => (await prisma.departmentStage.findFirstOrThrow({ where: { code } })).id;

    await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: await stage("DOCUMENTS") } });
    const early = await check(processor, c.caseNo, passport.id, { check: "CHECKED" });
    expect(early.status).toBe(409);
    expect(early.body.message).toMatch(/during file preparation/);

    await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: await stage("DISPATCH") } });
    expect((await check(processor, c.caseNo, passport.id, { check: "CHECKED" })).status).toBe(409);

    const reason = await prisma.enquiryReason.findUniqueOrThrow({ where: { code: "TRAVEL_DATES_MOVED" } });
    await prisma.enquiry.update({
      where: { id: c.id },
      data: {
        stageId: await stage("FILE_PREPARATION"),
        status: "POSTPONED",
        reasonId: reason.id,
        resumeOn: new Date(`${addMonths(istToday(), 1)}T00:00:00Z`),
      },
    });
    const postponed = await check(processor, c.caseNo, passport.id, { check: "CHECKED" });
    expect(postponed.status).toBe(409);
    expect(postponed.body.message).toMatch(/postponed/);
  });
});

describe("checking a paper", () => {
  it("Checked stamps who and when, and leaves Step 2's receipt as it was", async () => {
    const c = await maturedCase();
    const processor = await neha();
    const passport = docOf(await load(processor, c.caseNo), "Passport");

    const res = await check(processor, c.caseNo, passport.id, { check: "CHECKED", reasonId: await reasonId("NOT_SIGNED") });
    expect(res.status).toBe(200);
    const after = res.body.case as CaseDto;
    // The reason is ignored for Checked.
    expect(docOf(after, "Passport")).toMatchObject({
      status: "RECEIVED",
      receivedAs: "ORIGINAL",
      receivedBy: { name: "Aarti Patel" },
      check: "CHECKED",
      checkReason: null,
      checkedBy: { name: "Neha Joshi" },
    });
    expect(Date.now() - Date.parse(docOf(after, "Passport").checkedAt!)).toBeLessThan(60_000);
    expect(after.travellers[0]).toMatchObject({ checked: 1, needsReplacing: 0 });
  });

  it("Needs replacing takes an active reason from the list", async () => {
    const c = await maturedCase();
    const processor = await neha();
    const form = docOf(await load(processor, c.caseNo), "Visa form, signed");

    const none = await check(processor, c.caseNo, form.id, { check: "NEEDS_REPLACING" });
    expect(none.status).toBe(400);
    expect(none.body.issues.reasonId).toBeDefined();

    expect((await check(processor, c.caseNo, form.id, { check: "NEEDS_REPLACING", reasonId: 9999 })).status).toBe(400);

    await prisma.documentProblemReason.update({ where: { code: "EXPIRED" }, data: { isActive: false } });
    const off = await check(processor, c.caseNo, form.id, { check: "NEEDS_REPLACING", reasonId: await reasonId("EXPIRED") });
    expect(off.status).toBe(400);
    expect(off.body.issues.reasonId).toBeDefined();

    const ok = await check(processor, c.caseNo, form.id, { check: "NEEDS_REPLACING", reasonId: await reasonId("NOT_SIGNED") });
    expect(ok.status).toBe(200);
    const after = ok.body.case as CaseDto;
    expect(docOf(after, "Visa form, signed")).toMatchObject({
      check: "NEEDS_REPLACING",
      checkReason: { name: "Not signed" },
      checkedBy: { name: "Neha Joshi" },
    });
    expect(after.travellers[0]).toMatchObject({ checked: 0, needsReplacing: 1 });
  });

  it("marking the replacement Checked clears the reason; null sets the paper back to 'to check'", async () => {
    const c = await maturedCase();
    const processor = await neha();
    const photos = docOf(await load(processor, c.caseNo), "Photos");

    await check(processor, c.caseNo, photos.id, { check: "NEEDS_REPLACING", reasonId: await reasonId("WRONG_PHOTO_SIZE") });
    const fixed = (await check(processor, c.caseNo, photos.id, { check: "CHECKED" })).body.case as CaseDto;
    expect(docOf(fixed, "Photos")).toMatchObject({ check: "CHECKED", checkReason: null });

    const cleared = (await check(processor, c.caseNo, photos.id, { check: null })).body.case as CaseDto;
    expect(docOf(cleared, "Photos")).toMatchObject({ check: null, checkReason: null, checkedAt: null, checkedBy: null });
  });

  it("refuses a paper that wasn't needed, and one from another case", async () => {
    const c = await maturedCase();
    const processor = await neha();
    const slips = docOf(await load(processor, c.caseNo), "Salary slips, last 3 months");
    expect(slips.status).toBe("NOT_NEEDED");

    const res = await check(processor, c.caseNo, slips.id, { check: "CHECKED" });
    expect(res.status).toBe(400);
    expect(res.body.issues.check).toBeDefined();

    expect((await check(processor, c.caseNo, "00000000-0000-0000-0000-000000000000", { check: "CHECKED" })).status).toBe(404);
  });

  it("audits each change once, before and after; re-sending the same check changes nothing", async () => {
    const c = await maturedCase();
    const processor = await neha();
    const form = docOf(await load(processor, c.caseNo), "Visa form, signed");
    const notSigned = await reasonId("NOT_SIGNED");

    const first = (await check(processor, c.caseNo, form.id, { check: "NEEDS_REPLACING", reasonId: notSigned })).body.case as CaseDto;
    const again = (await check(processor, c.caseNo, form.id, { check: "NEEDS_REPLACING", reasonId: notSigned })).body.case as CaseDto;
    expect(docOf(again, "Visa form, signed").checkedAt).toBe(docOf(first, "Visa form, signed").checkedAt);
    await check(processor, c.caseNo, form.id, { check: "CHECKED" });

    const entries = await prisma.auditLog.findMany({ where: { action: "visa.document.check" }, orderBy: { createdAt: "asc" } });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      entityType: "VisaCaseDocument",
      entityId: form.id,
      clientId: c.client.id,
      before: { name: "Visa form, signed", check: null, checkReasonId: null, reason: null, checkedAt: null, checkedById: null },
      after: { check: "NEEDS_REPLACING", checkReasonId: notSigned, reason: "Not signed" },
    });
    expect(entries[1]).toMatchObject({
      before: { check: "NEEDS_REPLACING", reason: "Not signed" },
      after: { check: "CHECKED", checkReasonId: null, reason: null },
    });
  });

  it("doesn't change the case's updatedAt, so other people's open pages stay fresh", async () => {
    const c = await maturedCase();
    const processor = await neha();
    const before = await load(processor, c.caseNo);
    const after = (await check(processor, c.caseNo, docOf(before, "Passport").id, { check: "CHECKED" })).body.case as CaseDto;
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it("waits behind a change holding the case, then sees the case has moved on", async () => {
    const c = await maturedCase();
    const processor = await neha();
    const passport = docOf(await load(processor, c.caseNo), "Passport");
    const dispatch = await prisma.departmentStage.findFirstOrThrow({ where: { code: "DISPATCH" } });

    // Stands in for "File ready" (a later slice) moving the case on while the check waits.
    const fileReady = holdCaseLock(c.id, (tx) => tx.enquiry.update({ where: { id: c.id }, data: { stageId: dispatch.id } }));
    await fileReady.ready;
    const pending = check(processor, c.caseNo, passport.id, { check: "CHECKED" }).then((r) => r);
    try {
      await untilWaitingOnLock();
    } finally {
      fileReady.release();
    }
    await fileReady.done;
    const res = await pending;
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/during file preparation/);
    expect((await prisma.visaCaseDocument.findUniqueOrThrow({ where: { id: passport.id } })).check).toBeNull();
  });
});

describe("the database", () => {
  async function paper(name: string) {
    const c = await maturedCase();
    return prisma.visaCaseDocument.findFirstOrThrow({ where: { name, traveller: { caseId: c.id } } });
  }

  it("refuses Needs replacing without a reason, and Checked with one", async () => {
    const doc = await paper("Passport");
    const by = (await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } })).id;
    const stamp = { checkedAt: new Date(), checkedById: by };
    await expect(prisma.visaCaseDocument.update({ where: { id: doc.id }, data: { check: "NEEDS_REPLACING", ...stamp } })).rejects.toThrow();
    await expect(
      prisma.visaCaseDocument.update({ where: { id: doc.id }, data: { check: "CHECKED", checkReasonId: await reasonId("EXPIRED"), ...stamp } }),
    ).rejects.toThrow();
    await expect(prisma.visaCaseDocument.update({ where: { id: doc.id }, data: { checkReasonId: await reasonId("EXPIRED") } })).rejects.toThrow();
  });

  it("refuses a check without who and when, and a check on a paper that wasn't needed", async () => {
    const doc = await paper("Passport");
    const by = (await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } })).id;
    await expect(prisma.visaCaseDocument.update({ where: { id: doc.id }, data: { check: "CHECKED" } })).rejects.toThrow();
    await expect(prisma.visaCaseDocument.update({ where: { id: doc.id }, data: { check: "CHECKED", checkedAt: new Date() } })).rejects.toThrow();

    const slips = await prisma.visaCaseDocument.findFirstOrThrow({ where: { name: { startsWith: "Salary slips" }, status: "NOT_NEEDED" } });
    await expect(
      prisma.visaCaseDocument.update({ where: { id: slips.id }, data: { check: "CHECKED", checkedAt: new Date(), checkedById: by } }),
    ).rejects.toThrow();
  });
});
