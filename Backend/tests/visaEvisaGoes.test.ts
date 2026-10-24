import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, addMonths, istDateTimeToUtc, istToday, toDbDate } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { nextOpenDay } from "../src/modules/holidays/blockedDays";
import { VISA_EVISA_READY } from "../src/modules/messages/messages.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { decidedCase, evisaCase, type Agent } from "./visaHelpers";

// E-visas after the decision (docs/decisions/0025-evisa-after-decision.md, amended by change request 21 part 3): each
// approved traveller's e-visa goes to the client as soon as it's uploaded (message 19, keyed by the file, carrying it),
// with no check and no "Send the e-visa". The upload that sends the last approved traveller's moves the case on:
// Delivered and closed, or, with passports held, due for the handover. A Change that leaves no approved traveller
// waiting does the same. A corrected e-visa can still go afterwards. Messages are only queued here: pg-boss runs
// without workers in tests.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface FileDto {
  id: string;
  fileName: string;
}
interface CaseDto {
  updatedAt: string;
  status: string;
  dueAt: string | null;
  stage: { code: string };
  evisaSent: { at: string; by: { name: string } } | null;
  travellers: { id: string; evisa: FileDto | null }[];
}

async function pdf() {
  const doc = await PDFDocument.create();
  doc.addPage();
  return Buffer.from(await doc.save());
}
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const upload = async (agent: Agent, caseNo: string, travellerId: string) =>
  agent.post(`/api/visa/cases/${caseNo}/travellers/${travellerId}/evisa`).set("Content-Type", "application/pdf").send(await pdf());
/** Uploads a traveller's e-visa, expecting it to be taken; returns the case and that traveller's new file. */
async function sendEvisa(agent: Agent, caseNo: string, travellerId: string) {
  const res = await upload(agent, caseNo, travellerId);
  expect(res.status).toBe(200);
  const after = res.body.case as CaseDto;
  return { after, file: after.travellers.find((t) => t.id === travellerId)!.evisa! };
}
/** "Change" on one traveller's row, with the case's updatedAt as it is now (read first: an await inside .send breaks supertest). */
async function change(agent: Agent, caseNo: string, travellerId: string, body: Record<string, unknown>) {
  const { updatedAt } = await prisma.enquiry.findUniqueOrThrow({ where: { caseNo }, select: { updatedAt: true } });
  return agent.put(`/api/visa/cases/${caseNo}/travellers/${travellerId}/decision`).send({ ...body, updatedAt: updatedAt.toISOString() });
}
const messages = () => prisma.outboundMessage.findMany({ where: { template: { code: VISA_EVISA_READY } }, orderBy: { createdAt: "asc" } });
const nextStepOf = async (agent: Agent, caseNo: string) =>
  ((await agent.get("/api/enquiries")).body.enquiries as { caseNo: string; nextStep: string }[]).find((r) => r.caseNo === caseNo)!.nextStep;
const reason = async (code: string) => (await prisma.enquiryReason.findUniqueOrThrow({ where: { code } })).id;

/** The booklets counted in at intake: passports we hold. */
const holdPassports = (enquiryId: string, current = 2) => prisma.visaCase.update({ where: { enquiryId }, data: { bookletsCurrent: current, bookletsOld: 0 } });

/** When a case with passports held comes back due: the next open office day at 11:00 (visa.handoverCheck). */
async function handoverDue() {
  return istDateTimeToUtc(await nextOpenDay(addDays(istToday(), 1), { office: true }), "11:00").toISOString();
}

describe("an e-visa goes when it's uploaded", () => {
  it("message 19 with the file, keyed by it; the case waits for the last approved one, then is Delivered and closed", async () => {
    const { c, processor, adult, child } = await evisaCase();
    const first = await sendEvisa(processor, c.caseNo, adult);
    expect(first.after).toMatchObject({ status: "OPEN", stage: { code: "DECISION" }, evisaSent: null });
    const [rakesh] = await messages();
    expect(rakesh).toMatchObject({
      idempotencyKey: `${VISA_EVISA_READY}:${first.file.id}`,
      enquiryId: c.id,
      clientId: c.client.id,
      attachmentId: first.file.id,
      status: "QUEUED",
      variables: expect.objectContaining({ traveller_name: "Rakesh Mehta", case_no: c.caseNo }),
    });
    expect(rakesh!.body).toContain(`Good news! The France tourist visa is approved for Rakesh Mehta (${c.caseNo}). The e-visa is attached.`);
    expect(await nextStepOf(processor, c.caseNo)).toBe("Upload the e-visa");

    const last = await sendEvisa(processor, c.caseNo, child);
    expect(last.after).toMatchObject({ status: "CLOSED", dueAt: null, stage: { code: "DELIVERED" }, evisaSent: { by: { name: "Neha Joshi" } } });
    expect((await messages()).map((m) => m.attachmentId)).toEqual([first.file.id, last.file.id]);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.evisa.sent", entityId: c.id } });
    expect(entry).toMatchObject({
      clientId: c.client.id,
      before: { stage: "DECISION", status: "OPEN" },
      after: {
        stage: "DELIVERED",
        status: "CLOSED",
        dueAt: null,
        bookletsHeld: 0,
        travellers: [
          { name: "Rakesh Mehta", fileId: first.file.id },
          { name: "Aarav Mehta", fileId: last.file.id },
        ],
      },
    });
  });

  it("with passports held: the last one leaves it at Decision, open, due for the handover", async () => {
    const { c, processor, adult, child } = await evisaCase();
    await holdPassports(c.id);
    await sendEvisa(processor, c.caseNo, adult);
    const { after } = await sendEvisa(processor, c.caseNo, child);
    expect(after).toMatchObject({ status: "OPEN", stage: { code: "DECISION" }, dueAt: await handoverDue(), evisaSent: { by: { name: "Neha Joshi" } } });
    expect(await nextStepOf(processor, c.caseNo)).toBe("Hand back the passports");
  });

  it("a family with a refusal: the approved traveller's is the last; no e-visa number or dates needed", async () => {
    const { c, processor, adult } = await evisaCase({ outcomes: ["APPROVED", "REFUSED"] });
    // As recorded, before anyone adds them with Change (0012, amended 23 Oct 2026).
    await prisma.visaCaseTraveller.updateMany({ where: { caseId: c.id }, data: { visaNo: null, validFrom: null, validTo: null } });
    const { after } = await sendEvisa(processor, c.caseNo, adult);
    expect(after).toMatchObject({ status: "CLOSED", stage: { code: "DELIVERED" } });
    expect((await messages()).map((m) => m.status)).toEqual(["QUEUED"]);
  });
});

describe("a corrected e-visa", () => {
  it("before the last one: another message with the new file, and the case still waits", async () => {
    const { c, processor, adult } = await evisaCase();
    const first = await sendEvisa(processor, c.caseNo, adult);
    const again = await sendEvisa(processor, c.caseNo, adult);
    expect(again.file.id).not.toBe(first.file.id);
    expect((await messages()).map((m) => m.attachmentId)).toEqual([first.file.id, again.file.id]);
    expect(again.after).toMatchObject({ status: "OPEN", stage: { code: "DECISION" }, evisaSent: null });
  });

  it("after the case is finished: it still goes, and changes nothing else", async () => {
    const { c, processor, adult, child } = await evisaCase();
    await sendEvisa(processor, c.caseNo, adult);
    const done = (await sendEvisa(processor, c.caseNo, child)).after;
    const fixed = await sendEvisa(processor, c.caseNo, adult);
    expect(fixed.after).toMatchObject({ status: "CLOSED", stage: { code: "DELIVERED" }, evisaSent: done.evisaSent });
    expect(await messages()).toHaveLength(3);
    expect(await prisma.auditLog.count({ where: { action: "visa.evisa.sent", entityId: c.id } })).toBe(1);
  });

  it("while the passports we hold wait to go back: it goes, and the due time stays", async () => {
    const { c, processor, adult, child } = await evisaCase();
    await holdPassports(c.id);
    await sendEvisa(processor, c.caseNo, adult);
    const done = (await sendEvisa(processor, c.caseNo, child)).after;
    const fixed = await sendEvisa(processor, c.caseNo, child);
    expect(fixed.after).toMatchObject({ status: "OPEN", stage: { code: "DECISION" }, dueAt: done.dueAt, evisaSent: done.evisaSent });
    expect(await messages()).toHaveLength(3);
  });
});

describe("Change", () => {
  it("leaving no approved traveller waiting finishes the case, after a warning when that closes it", async () => {
    const { c, processor, adult, child } = await evisaCase();
    await sendEvisa(processor, c.caseNo, adult);
    const warned = await change(processor, c.caseNo, child, { outcome: "REFUSED" });
    expect(warned.status).toBe(409);
    expect(warned.body.details.warnings).toEqual([
      {
        code: "CASE_CLOSES",
        message: "Every approved traveller's e-visa has gone and we hold no passports: saving closes the case, and a closed case can't be changed.",
      },
    ]);
    expect((await load(processor, c.caseNo)).status).toBe("OPEN");

    const { updatedAt } = await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id }, select: { updatedAt: true } });
    const saved = await processor
      .put(`/api/visa/cases/${c.caseNo}/travellers/${child}/decision`)
      .send({ outcome: "REFUSED", updatedAt: updatedAt.toISOString(), confirmWarnings: true });
    expect(saved.status).toBe(200);
    expect(saved.body.case as CaseDto).toMatchObject({ status: "CLOSED", stage: { code: "DELIVERED" }, evisaSent: { by: { name: "Neha Joshi" } } });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.decision.change", entityId: child } });
    expect(row.after).toMatchObject({ outcome: "REFUSED", caseClosed: { stage: "DELIVERED", status: "CLOSED" } });
    // No second message: Rakesh's went when uploaded.
    expect(await messages()).toHaveLength(1);
  });

  it("with passports held: no warning, and it's due for the handover", async () => {
    const { c, processor, adult, child } = await evisaCase();
    await holdPassports(c.id);
    await sendEvisa(processor, c.caseNo, adult);
    const res = await change(processor, c.caseNo, child, { outcome: "REFUSED" });
    expect(res.status).toBe(200);
    expect(res.body.case as CaseDto).toMatchObject({ status: "OPEN", stage: { code: "DECISION" }, dueAt: await handoverDue(), evisaSent: { by: { name: "Neha Joshi" } } });
  });

  it("once every approved e-visa has gone, the decision can't change", async () => {
    const { c, processor, adult, child } = await evisaCase();
    await holdPassports(c.id);
    await sendEvisa(processor, c.caseNo, adult);
    await sendEvisa(processor, c.caseNo, child);
    const res = await change(processor, c.caseNo, adult, { outcome: "REFUSED" });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("The e-visa has gone to the client: the decision can't change now.");
  });
});

describe("what is refused", () => {
  it("a paper visa, a refused traveller, and an e-visa before its decision", async () => {
    const paper = await decidedCase();
    const sticker = await upload(paper.processor, paper.c.caseNo, paper.adult);
    expect(sticker.status).toBe(409);
    expect(sticker.body.message).toBe("This visa has a sticker, not an e-visa: it's checked when the passports come back.");

    await resetDb();
    await seedVisaMasters(prisma);
    await seedEnquiryMasters(prisma);
    const family = await evisaCase({ outcomes: ["APPROVED", "REFUSED"], held: 2 });
    const refused = await upload(family.processor, family.c.caseNo, family.child);
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe("Aarav Mehta wasn't approved, so there's no e-visa to add.");

    await resetDb();
    await seedVisaMasters(prisma);
    await seedEnquiryMasters(prisma);
    const early = await evisaCase({ decided: false });
    const before = await upload(early.processor, early.c.caseNo, early.adult);
    expect(before.status).toBe(409);
    expect(before.body.message).toBe("The e-visa is added once the decision is recorded.");
    expect(await messages()).toHaveLength(0);
  });

  it("a postponed case, until every approved e-visa has gone", async () => {
    const { c, processor, adult } = await evisaCase();
    await prisma.enquiry.update({
      where: { id: c.id },
      data: { status: "POSTPONED", reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: toDbDate(addMonths(istToday(), 1)) },
    });
    const res = await upload(processor, c.caseNo, adult);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("This case is postponed. Resume it first.");
    expect(await messages()).toHaveLength(0);
  });

  it("other staff can't upload it; the Visa HOD can", async () => {
    const { c, adult, child } = await evisaCase();
    await createUser({ name: "Kiran", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    expect((await upload(await loginAs("kiran@masti.test"), c.caseNo, adult)).status).toBe(403);
    const riya = await loginAs("riya@masti.test");
    await sendEvisa(riya, c.caseNo, adult);
    const { after } = await sendEvisa(riya, c.caseNo, child);
    expect(after.evisaSent).toMatchObject({ by: { name: "Riya" } });
  });

  it("the old check and Send the e-visa: gone", async () => {
    const { c, processor, adult } = await evisaCase();
    const { file } = await sendEvisa(processor, c.caseNo, adult);
    const { updatedAt } = await load(processor, c.caseNo);
    expect((await processor.get(`/api/visa/cases/${c.caseNo}/send-evisa/check`)).status).toBe(404);
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/send-evisa`).send({ updatedAt })).status).toBe(404);
    expect((await processor.put(`/api/visa/cases/${c.caseNo}/travellers/${adult}/evisa-check`).send({ fileId: file.id, check: "MATCHES" })).status).toBe(404);
  });
});

describe("the database", () => {
  it("keeps who sent the e-visas together with when", async () => {
    const { c } = await evisaCase();
    await expect(prisma.visaCase.update({ where: { enquiryId: c.id }, data: { evisaSentAt: new Date() } })).rejects.toThrow(/VisaCase_evisa_sent/);
  });

  it("only on an e-visa: a paper visa's passports come back from the vendor", async () => {
    const { c } = await decidedCase();
    const neha = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
    await expect(prisma.visaCase.update({ where: { enquiryId: c.id }, data: { evisaSentAt: new Date(), evisaSentById: neha.id } })).rejects.toThrow(
      /VisaCase_evisa_sent_online/,
    );
  });
});
