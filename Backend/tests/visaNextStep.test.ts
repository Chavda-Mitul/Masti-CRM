import { beforeEach, describe, expect, it } from "vitest";
import { addDays, istToday } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { nextOpenDay } from "../src/modules/holidays/blockedDays";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { loginAs, prisma, resetDb } from "./helpers";
import { decidedCase, dispatchCase, makeInvoiceable, mastiReady, recalledCase, saveCase, visaStaff, type Agent } from "./visaHelpers";

// The enquiries list's next step follows the case at Steps 6–7, as the case page's header button does (visaNextStep):
// the passports' way back (docs/decisions/0013-visa-passport-back.md Decisions 3–5) and an e-visa, whose passports
// never left the office (Decision 4). Every other step shows the step's own next step.

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

/** "Mark received": as counted, every approved sticker matching. */
async function receive(agent: Agent, caseNo: string) {
  const c = await load(agent, caseNo);
  const stickers = c.travellers.filter((t) => t.decision?.outcome === "APPROVED").map((t) => ({ travellerId: t.id, check: "MATCHES" }));
  const res = await agent.post(`/api/visa/cases/${caseNo}/passports-received`).send({ booklets: { current: 2, old: 0 }, stickers, updatedAt: c.updatedAt });
  expect(res.status).toBe(200);
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

  it("shows the step's own next step everywhere else", async () => {
    const staff = await visaStaff();
    const saved = await saveCase(staff);
    expect(await row(staff, saved.caseNo)).toMatchObject({ stage: { code: "ENQUIRY" }, nextStep: "Start collecting documents" });
  });
});
