import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, istDateTimeToUtc, istToday } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { nextOpenDay } from "../src/modules/holidays/blockedDays";
import { VISA_EVISA_READY } from "../src/modules/messages/messages.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { decidedCase, evisaCase, type Agent } from "./visaHelpers";

// E-visas after the decision, part 3 (docs/decisions/0025-evisa-after-decision.md): "Send the e-visa". Once every
// approved traveller's PDF is uploaded and marked Matches, message 19 goes to each, carrying their e-visa; the case then
// moves to Delivered and closes, or, with passports held, stays at Decision, due for the handover. The messages are only
// queued here: pg-boss runs without workers in tests.

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
  travellers: { id: string; evisa: FileDto | null; decision: { outcome: string } | null }[];
}

async function pdf() {
  const doc = await PDFDocument.create();
  doc.addPage();
  return Buffer.from(await doc.save());
}
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const upload = async (agent: Agent, caseNo: string, travellerId: string) =>
  agent.post(`/api/visa/cases/${caseNo}/travellers/${travellerId}/evisa`).set("Content-Type", "application/pdf").send(await pdf());
const setCheck = (agent: Agent, caseNo: string, travellerId: string, fileId: string, check: string | null) =>
  agent.put(`/api/visa/cases/${caseNo}/travellers/${travellerId}/evisa-check`).send({ fileId, check });
const check = (agent: Agent, caseNo: string) => agent.get(`/api/visa/cases/${caseNo}/send-evisa/check`);
/** "Send the e-visa", with the case's updatedAt as it is now (read first: a request awaited inside .send breaks supertest). */
async function send(agent: Agent, caseNo: string) {
  const { updatedAt } = await prisma.enquiry.findUniqueOrThrow({ where: { caseNo }, select: { updatedAt: true } });
  return agent.post(`/api/visa/cases/${caseNo}/send-evisa`).send({ updatedAt: updatedAt.toISOString() });
}

/** Each named traveller's e-visa uploaded and marked as `checks` says (Matches unless told otherwise). Returns the files. */
async function ready(agent: Agent, caseNo: string, travellerIds: string[], checks: (string | null)[] = []) {
  const files: FileDto[] = [];
  for (const [i, id] of travellerIds.entries()) {
    const res = await upload(agent, caseNo, id);
    expect(res.status).toBe(200);
    const file = (res.body.case as CaseDto).travellers.find((t) => t.id === id)!.evisa!;
    const wanted = checks[i] === undefined ? "MATCHES" : checks[i]!;
    if (wanted) expect((await setCheck(agent, caseNo, id, file.id, wanted)).status).toBe(200);
    files.push(file);
  }
  return files;
}

/** The booklets counted in at intake: passports we hold. */
const holdPassports = (enquiryId: string, current = 2) => prisma.visaCase.update({ where: { enquiryId }, data: { bookletsCurrent: current, bookletsOld: 0 } });

/** When a case with passports held comes back due: the next open office day at 11:00 (visa.handoverCheck). */
async function handoverDue() {
  return istDateTimeToUtc(await nextOpenDay(addDays(istToday(), 1), { office: true }), "11:00").toISOString();
}

describe("the check", () => {
  it("names each approved traveller who isn't ready: no PDF, not checked, or doesn't match", async () => {
    const { c, processor, adult, child } = await evisaCase();
    await ready(processor, c.caseNo, [adult], ["MISMATCH"]);
    const first = await check(processor, c.caseNo);
    expect(first.status).toBe(200);
    expect(first.body.blockers).toEqual([
      { kind: "MISMATCH", travellerId: adult, label: "Rakesh Mehta's e-visa doesn't match the passport: get it corrected first." },
      { kind: "NO_PDF", travellerId: child, label: "Upload Aarav Mehta's e-visa." },
    ]);
    await ready(processor, c.caseNo, [child], [null]);
    expect((await check(processor, c.caseNo)).body.blockers).toContainEqual({
      kind: "NOT_CHECKED",
      travellerId: child,
      label: "Check Aarav Mehta's e-visa against the passport.",
    });
  });

  it("when ready: who gets which file, and that the case closes, with no passports held", async () => {
    const { c, processor, adult, child } = await evisaCase();
    await ready(processor, c.caseNo, [adult, child]);
    expect((await check(processor, c.caseNo)).body).toEqual({
      blockers: [],
      travellers: [
        { name: "Rakesh Mehta", fileName: `${c.caseNo}_Rakesh-Mehta_evisa.pdf` },
        { name: "Aarav Mehta", fileName: `${c.caseNo}_Aarav-Mehta_evisa.pdf` },
      ],
      held: 0,
      closes: true,
      dueAt: null,
    });
  });

  it("with passports held: it waits for the handover, due the next open office day at 11:00", async () => {
    const { c, processor, adult, child } = await evisaCase();
    await holdPassports(c.id);
    await ready(processor, c.caseNo, [adult, child]);
    expect((await check(processor, c.caseNo)).body).toMatchObject({ blockers: [], held: 2, closes: false, dueAt: await handoverDue() });
  });
});

describe("sending", () => {
  it("with no passports held: one message per approved traveller, carrying their e-visa; the case is Delivered and closed", async () => {
    const { c, processor, adult, child } = await evisaCase();
    const [rakesh, aarav] = await ready(processor, c.caseNo, [adult, child]);
    const res = await send(processor, c.caseNo);
    expect(res.status).toBe(200);
    const after = res.body.case as CaseDto;
    expect(after).toMatchObject({ status: "CLOSED", dueAt: null, stage: { code: "DELIVERED" }, evisaSent: { by: { name: "Neha Joshi" } } });

    const messages = await prisma.outboundMessage.findMany({ where: { template: { code: VISA_EVISA_READY } }, orderBy: { idempotencyKey: "asc" } });
    expect(messages).toHaveLength(2);
    const byTraveller = new Map(messages.map((m) => [m.idempotencyKey, m]));
    expect(byTraveller.get(`${VISA_EVISA_READY}:${adult}`)).toMatchObject({
      enquiryId: c.id,
      clientId: c.client.id,
      attachmentId: rakesh!.id,
      status: "QUEUED",
      variables: expect.objectContaining({ traveller_name: "Rakesh Mehta", case_no: c.caseNo }),
    });
    expect(byTraveller.get(`${VISA_EVISA_READY}:${child}`)).toMatchObject({ attachmentId: aarav!.id, variables: expect.objectContaining({ traveller_name: "Aarav Mehta" }) });
    // The number and dates are optional (0012, amended 23 Oct 2026): the words don't carry them; the PDF does.
    expect(byTraveller.get(`${VISA_EVISA_READY}:${adult}`)!.variables).not.toHaveProperty("evisa_no");
    expect(byTraveller.get(`${VISA_EVISA_READY}:${adult}`)!.body).toContain(`Good news! The France tourist visa is approved for Rakesh Mehta (${c.caseNo}). The e-visa is attached.`);

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
          { name: "Rakesh Mehta", fileId: rakesh!.id },
          { name: "Aarav Mehta", fileId: aarav!.id },
        ],
      },
    });
  });

  it("goes with no e-visa number or dates added: they're optional (0012, amended 23 Oct 2026)", async () => {
    const { c, processor, adult, child } = await evisaCase();
    // As recorded, before anyone adds them with Change.
    await prisma.visaCaseTraveller.updateMany({ where: { caseId: c.id }, data: { visaNo: null, validFrom: null, validTo: null } });
    await ready(processor, c.caseNo, [adult, child]);
    expect((await send(processor, c.caseNo)).status).toBe(200);
    const messages = await prisma.outboundMessage.findMany({ where: { template: { code: VISA_EVISA_READY } } });
    expect(messages.map((m) => m.status)).toEqual(["QUEUED", "QUEUED"]);
  });

  it("with passports held: it stays at Decision, open, due for the handover, and the list says so", async () => {
    const { c, processor, adult, child } = await evisaCase();
    await holdPassports(c.id);
    await ready(processor, c.caseNo, [adult, child]);
    const res = await send(processor, c.caseNo);
    expect(res.status).toBe(200);
    expect(res.body.case as CaseDto).toMatchObject({ status: "OPEN", stage: { code: "DECISION" }, dueAt: await handoverDue(), evisaSent: { by: { name: "Neha Joshi" } } });
    expect(await prisma.outboundMessage.count({ where: { template: { code: VISA_EVISA_READY } } })).toBe(2);
    const list = await processor.get("/api/enquiries");
    expect((list.body.enquiries as { caseNo: string; nextStep: string }[]).find((r) => r.caseNo === c.caseNo)!.nextStep).toBe("Hand back the passports");
  });

  it("a family with a refusal: only the approved traveller gets one", async () => {
    const { c, processor, adult } = await evisaCase({ outcomes: ["APPROVED", "REFUSED"] });
    await ready(processor, c.caseNo, [adult]);
    expect((await check(processor, c.caseNo)).body.travellers).toEqual([{ name: "Rakesh Mehta", fileName: `${c.caseNo}_Rakesh-Mehta_evisa.pdf` }]);
    expect((await send(processor, c.caseNo)).status).toBe(200);
    const messages = await prisma.outboundMessage.findMany({ where: { template: { code: VISA_EVISA_READY } } });
    expect(messages.map((m) => m.idempotencyKey)).toEqual([`${VISA_EVISA_READY}:${adult}`]);
  });
});

describe("what is refused", () => {
  it("until every approved traveller is ready: the list comes back, and nothing changes", async () => {
    const { c, processor, adult } = await evisaCase();
    await ready(processor, c.caseNo, [adult]);
    const res = await send(processor, c.caseNo);
    expect(res.status).toBe(409);
    expect(res.body.details).toMatchObject({ code: "SEND_BLOCKED", blockers: [expect.objectContaining({ kind: "NO_PDF" })] });
    expect(await prisma.outboundMessage.count({ where: { template: { code: VISA_EVISA_READY } } })).toBe(0);
    expect((await load(processor, c.caseNo)).evisaSent).toBeNull();
  });

  it("a second time, a stale page, and a case where no one was approved", async () => {
    const { c, processor, adult, child } = await evisaCase();
    await holdPassports(c.id);
    await ready(processor, c.caseNo, [adult, child]);
    const { updatedAt } = await load(processor, c.caseNo);
    expect((await send(processor, c.caseNo)).status).toBe(200);
    const stale = await processor.post(`/api/visa/cases/${c.caseNo}/send-evisa`).send({ updatedAt });
    expect(stale.status).toBe(409);
    expect(stale.body.details.code).toBe("STALE");
    const again = await send(processor, c.caseNo);
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/^The e-visa went to the client on /);
    expect(await prisma.outboundMessage.count({ where: { template: { code: VISA_EVISA_READY } } })).toBe(2);

    await resetDb();
    await seedVisaMasters(prisma);
    await seedEnquiryMasters(prisma);
    // With passports held it stays open, for their handover (with none, it closed at once: part 5).
    const refused = await evisaCase({ outcomes: ["REFUSED", "REFUSED"], held: 2 });
    const none = await send(refused.processor, refused.c.caseNo);
    expect(none.status).toBe(409);
    expect(none.body.message).toBe("No one was approved: there's no e-visa to send.");
  });

  it("a paper visa, and an e-visa before its decision", async () => {
    const paper = await decidedCase();
    expect((await send(paper.processor, paper.c.caseNo)).status).toBe(409);

    await resetDb();
    await seedVisaMasters(prisma);
    await seedEnquiryMasters(prisma);
    const early = await evisaCase({ decided: false });
    expect((await send(early.processor, early.c.caseNo)).status).toBe(409);
    expect(await prisma.outboundMessage.count({ where: { template: { code: VISA_EVISA_READY } } })).toBe(0);
  });

  it("other staff can't send it; the Visa HOD can", async () => {
    const { c, processor, adult, child } = await evisaCase();
    await ready(processor, c.caseNo, [adult, child]);
    await createUser({ name: "Kiran", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    expect((await send(await loginAs("kiran@masti.test"), c.caseNo)).status).toBe(403);
    const hod = await send(await loginAs("riya@masti.test"), c.caseNo);
    expect(hod.status).toBe(200);
    expect((hod.body.case as CaseDto).evisaSent).toMatchObject({ by: { name: "Riya" } });
  });
});

describe("after sending", () => {
  it("the PDFs, their checks and the decision can't change: what went to the client stays as it went", async () => {
    const { c, processor, adult, child } = await evisaCase();
    await holdPassports(c.id);
    const [rakesh] = await ready(processor, c.caseNo, [adult, child]);
    expect((await send(processor, c.caseNo)).status).toBe(200);

    const uploaded = await upload(processor, c.caseNo, adult);
    expect(uploaded.status).toBe(409);
    expect(uploaded.body.message).toBe("The e-visa has gone to the client: it can't change now.");
    expect((await setCheck(processor, c.caseNo, adult, rakesh!.id, "MISMATCH")).status).toBe(409);
    const { updatedAt } = await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id }, select: { updatedAt: true } });
    const changed = await processor
      .put(`/api/visa/cases/${c.caseNo}/travellers/${adult}/decision`)
      .send({ outcome: "REFUSED", updatedAt: updatedAt.toISOString() });
    expect(changed.status).toBe(409);
    expect(changed.body.message).toBe("The e-visa has gone to the client: the decision can't change now.");
  });
});

describe("the database", () => {
  it("keeps who sent it together with when", async () => {
    const { c } = await evisaCase();
    await expect(prisma.visaCase.update({ where: { enquiryId: c.id }, data: { evisaSentAt: new Date() } })).rejects.toThrow(/VisaCase_evisa_sent/);
  });

  it("sends only an e-visa this way: a paper visa's passports come back from the vendor", async () => {
    const { c } = await decidedCase();
    const neha = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
    await expect(prisma.visaCase.update({ where: { enquiryId: c.id }, data: { evisaSentAt: new Date(), evisaSentById: neha.id } })).rejects.toThrow(
      /VisaCase_evisa_sent_online/,
    );
  });
});
