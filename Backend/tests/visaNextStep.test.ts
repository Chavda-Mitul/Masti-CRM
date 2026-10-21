import { beforeEach, describe, expect, it } from "vitest";
import { addDays, istToday } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { nextOpenDay } from "../src/modules/holidays/blockedDays";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { loginAs, prisma, resetDb } from "./helpers";
import { appointmentsHeld, aWednesday, decidedCase, dispatchCase, makeInvoiceable, mastiReady, recalledCase, saveCase, visaStaff, type Agent } from "./visaHelpers";

// The enquiries list's next step follows the case at Steps 6–7, as the case page's header button does (visaNextStep):
// the passports' way back (docs/decisions/0013-visa-passport-back.md Decisions 3–5), an e-visa, whose passports
// never left the office (Decision 4), and a short return, held until the rest come in or the shortfall is cleared
// (Decision 5, amended). Every other step shows the step's own next step.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface CaseDto {
  updatedAt: string;
  travellers: { id: string; decision: { outcome: string } | null }[];
}
interface Row {
  caseNo: string;
  nextStep: string;
  stage: { code: string; nextStepLabel: string };
}

const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;

/** The case's row in the enquiries list, as its owner sees it. */
async function row(agent: Agent, caseNo: string) {
  const res = await agent.get("/api/enquiries");
  expect(res.status).toBe(200);
  return (res.body.enquiries as Row[]).find((r) => r.caseNo === caseNo)!;
}

/** "Passports on the way back": collected today, expected two days out (or the first open office day after). */
async function sendBack(agent: Agent, caseNo: string) {
  const updatedAt = (await load(agent, caseNo)).updatedAt;
  const expectedOn = await nextOpenDay(addDays(istToday(), 2), { office: true });
  expect((await agent.post(`/api/visa/cases/${caseNo}/passports-back`).send({ collectedOn: istToday(), expectedOn, updatedAt })).status).toBe(200);
}

type Booklets = { current: number; old: number };

/** "Mark received": `booklets` counted (all 2 + 0 that went out, unless said), every approved sticker matching. */
async function receive(agent: Agent, caseNo: string, booklets: Booklets = { current: 2, old: 0 }) {
  const c = await load(agent, caseNo);
  const stickers = c.travellers.filter((t) => t.decision?.outcome === "APPROVED").map((t) => ({ travellerId: t.id, check: "MATCHES" }));
  const res = await agent.post(`/api/visa/cases/${caseNo}/passports-received`).send({ booklets, stickers, updatedAt: c.updatedAt });
  expect(res.status).toBe(200);
}

/** "It came": the late booklets added to our stock. As in visaShortfall.test.ts. */
async function receiveRest(agent: Agent, caseNo: string, booklets: Booklets) {
  const { updatedAt } = await load(agent, caseNo);
  expect((await agent.post(`/api/visa/cases/${caseNo}/passports-received/rest`).send({ booklets, updatedAt })).status).toBe(200);
}

/** "It won't come back": the shortfall cleared with "Embassy kept it". As in visaShortfall.test.ts. */
async function clearShortfall(agent: Agent, caseNo: string) {
  const { updatedAt } = await load(agent, caseNo);
  const { id: reasonId } = await prisma.missingPassportReason.findUniqueOrThrow({ where: { code: "EMBASSY_KEPT" } });
  expect((await agent.post(`/api/visa/cases/${caseNo}/passports-received/clear`).send({ reasonId, updatedAt })).status).toBe(200);
}

/** An e-visa (Vendor needed off), Neha's, invoiced, "Submitted online" and decided: at Decision. As in visaPassportsBack.test.ts. */
async function eVisaDecided() {
  await mastiReady();
  const c = await dispatchCase({ extra: { mobile: "98250 41299", clientName: "Asha Desai" } });
  const { offeringId } = await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id }, select: { offeringId: true } });
  await prisma.visaOffering.update({ where: { id: offeringId }, data: { vendorNeeded: false } });
  await prisma.visaCase.update({ where: { enquiryId: c.id }, data: { vendorId: null } });
  const processor = await loginAs("neha@masti.test");
  const { travellers } = await makeInvoiceable(processor, c, { clientName: "Asha Desai" });
  const { quoteUpdatedAt, taxType, gstRatePercent, totalPaise } = (await processor.get(`/api/visa/cases/${c.caseNo}/invoice/check`)).body.preview;
  expect((await processor.post(`/api/visa/cases/${c.caseNo}/invoice`).send({ quoteUpdatedAt, taxType, gstRatePercent, totalPaise })).status).toBe(200);
  // Read first: a request awaited inside another's .send(...) breaks supertest.
  const seen = (await load(processor, c.caseNo)).updatedAt;
  expect((await processor.post(`/api/visa/cases/${c.caseNo}/submit-online`).send({ updatedAt: seen })).status).toBe(200);
  const outcomes = travellers.map((t) => ({ travellerId: t.id, outcome: "REFUSED" }));
  const decidedAt = (await load(processor, c.caseNo)).updatedAt;
  expect((await processor.post(`/api/visa/cases/${c.caseNo}/decision`).send({ outcomes, updatedAt: decidedAt })).status).toBe(200);
  return { c, processor };
}

describe("the enquiries list's next step at Steps 6–7", () => {
  it("follows a paper visa's passports: on the way back, then Mark received, then the handover", async () => {
    const { c, processor } = await decidedCase();
    expect(await row(processor, c.caseNo)).toMatchObject({ stage: { code: "DECISION" }, nextStep: "Passports on the way back" });

    await sendBack(processor, c.caseNo);
    // In transit: the step's own "Hand over to the client" isn't true yet.
    expect(await row(processor, c.caseNo)).toMatchObject({
      stage: { code: "PASSPORT_BACK", nextStepLabel: "Hand over to the client" },
      nextStep: "Mark received",
    });

    await receive(processor, c.caseNo);
    expect((await row(processor, c.caseNo)).nextStep).toBe("Hand over to the client");
  });

  it("asks to find the missing passport while a short return holds the case, then the handover once it comes", async () => {
    const { c, processor } = await decidedCase();
    await sendBack(processor, c.caseNo);
    // 2 + 0 went out; 1 + 0 came back.
    await receive(processor, c.caseNo, { current: 1, old: 0 });
    expect((await row(processor, c.caseNo)).nextStep).toBe("Find the missing passport");

    await receiveRest(processor, c.caseNo, { current: 1, old: 0 });
    expect((await row(processor, c.caseNo)).nextStep).toBe("Hand over to the client");
  });

  it("asks to find the missing passports (plural), then the handover once the shortfall is cleared", async () => {
    const { c, processor } = await decidedCase();
    await prisma.visaCase.update({ where: { enquiryId: c.id }, data: { bookletsCurrent: 2, bookletsOld: 1 } });
    await sendBack(processor, c.caseNo);
    // 2 + 1 went out; 1 + 0 came back: 1 current and 1 old are missing.
    await receive(processor, c.caseNo, { current: 1, old: 0 });
    expect((await row(processor, c.caseNo)).nextStep).toBe("Find the missing passports");

    await clearShortfall(processor, c.caseNo);
    expect((await row(processor, c.caseNo)).nextStep).toBe("Hand over to the client");
  });

  it("asks for the passports on the way back for a recalled file, then Mark received", async () => {
    const { c, processor } = await recalledCase();
    expect(await row(processor, c.caseNo)).toMatchObject({ stage: { code: "PASSPORT_BACK" }, nextStep: "Passports on the way back" });

    await sendBack(processor, c.caseNo);
    expect((await row(processor, c.caseNo)).nextStep).toBe("Mark received");
  });

  it("says an e-visa at Decision has no passports to bring back", async () => {
    const { c, processor } = await eVisaDecided();
    expect(await row(processor, c.caseNo)).toMatchObject({
      stage: { code: "DECISION", nextStepLabel: "Passports on the way back" },
      nextStep: "No passports to bring back (e-visa)",
    });
  });

  it("follows a paper file through Steps 4 and 5: into a docket, dispatched, received, its file number, then the decision", async () => {
    await mastiReady();
    const c = await dispatchCase();
    const processor = await loginAs("neha@masti.test");
    expect((await row(processor, c.caseNo)).nextStep).toBe("Add to docket");

    const seen = (await load(processor, c.caseNo)).updatedAt;
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/docket`).send({ mode: "OWN", updatedAt: seen })).status).toBe(200);
    expect((await row(processor, c.caseNo)).nextStep).toBe("Dispatch the docket");

    await makeInvoiceable(processor, c);
    const { quoteUpdatedAt, taxType, gstRatePercent, totalPaise } = (await processor.get(`/api/visa/cases/${c.caseNo}/invoice/check`)).body.preview;
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/invoice`).send({ quoteUpdatedAt, taxType, gstRatePercent, totalPaise })).status).toBe(200);
    const courier = await prisma.courier.findUniqueOrThrow({ where: { code: "BY_HAND" } });
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/dispatch`).send({ courierId: courier.id, awbNo: null, caseNos: [c.caseNo] })).status).toBe(200);
    expect(await row(processor, c.caseNo)).toMatchObject({ stage: { code: "AT_VENDOR" }, nextStep: "Confirm vendor got it" });

    const sent = (await load(processor, c.caseNo)).updatedAt;
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/vendor-received`).send({ updatedAt: sent })).status).toBe(200);
    expect((await row(processor, c.caseNo)).nextStep).toBe("Get the file number");

    await appointmentsHeld(c.id);
    const embassy = await prisma.embassy.findUniqueOrThrow({ where: { code: "FR-MUM" } });
    const received = (await load(processor, c.caseNo)).updatedAt;
    const submission = { vendorFileNo: "FR-MUM88421", embassyId: embassy.id, collectionOn: aWednesday(), updatedAt: received };
    expect((await processor.put(`/api/visa/cases/${c.caseNo}/submission`).send(submission)).status).toBe(200);
    expect((await row(processor, c.caseNo)).nextStep).toBe("Record the decision");
  });

  it("asks for an e-visa to be submitted online at Step 4", async () => {
    await mastiReady();
    const c = await dispatchCase({ extra: { mobile: "98250 41299", clientName: "Asha Desai" } });
    const { offeringId } = await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id }, select: { offeringId: true } });
    await prisma.visaOffering.update({ where: { id: offeringId }, data: { vendorNeeded: false } });
    expect((await row(await loginAs("neha@masti.test"), c.caseNo)).nextStep).toBe("Submit it online");
  });

  it("shows the step's own next step everywhere else", async () => {
    const staff = await visaStaff();
    const saved = await saveCase(staff);
    expect(await row(staff, saved.caseNo)).toMatchObject({ stage: { code: "ENQUIRY" }, nextStep: "Start collecting documents" });
  });
});
