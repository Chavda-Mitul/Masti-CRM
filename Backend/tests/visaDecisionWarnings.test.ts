import { beforeEach, describe, expect, it } from "vitest";
import { addDays, istToday } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { prisma, resetDb } from "./helpers";
import { decidedCase, type Agent } from "./visaHelpers";

// What a decision may have wrong (docs/decisions/0012-visa-decision.md, amended 19 Oct 2026; M46): the same sticker or
// e-visa number twice on a case is a typo and refused; a number already on another case, or visa dates that don't cover
// the trip, is a warning: the first save answers 409 WARNING, and saving again with confirmWarnings goes ahead, the
// audit keeping what was confirmed (lib/warnings.ts).

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

// The case's trip (visaHelpers' readyCase): out in 30 days, back in 41.
const FROM = addDays(istToday(), 20);
const TO = addDays(istToday(), 60);

type Outcome = { travellerId: string; outcome: string; visaNo?: string; validFrom?: string; validTo?: string };
const approved = (travellerId: string, visaNo: string, validFrom = FROM, validTo = TO): Outcome => ({ travellerId, outcome: "APPROVED", visaNo, validFrom, validTo });

const updatedAtOf = async (caseNo: string) =>
  (await prisma.enquiry.findUniqueOrThrow({ where: { caseNo }, select: { updatedAt: true } })).updatedAt.toISOString();

/** "Record the decision", with the case's updatedAt as it is now. */
async function record(agent: Agent, caseNo: string, outcomes: Outcome[], confirmWarnings?: boolean) {
  // Read first: a request awaited inside another's .send(...) breaks supertest.
  const updatedAt = await updatedAtOf(caseNo);
  return agent.post(`/api/visa/cases/${caseNo}/decision`).send({ outcomes, updatedAt, ...(confirmWarnings ? { confirmWarnings } : {}) });
}

/** "Change" on one traveller's row, with the case's updatedAt as it is now. */
async function change(agent: Agent, caseNo: string, o: Outcome, confirmWarnings?: boolean) {
  const updatedAt = await updatedAtOf(caseNo);
  const { travellerId, ...body } = o;
  return agent.put(`/api/visa/cases/${caseNo}/travellers/${travellerId}/decision`).send({ ...body, updatedAt, ...(confirmWarnings ? { confirmWarnings } : {}) });
}

/** A second family's file (Sunil Shah), with the same vendor, submitted and waiting for its decision. */
async function anotherCase(vendorId: number) {
  return decidedCase({ decided: false, vendorId, extra: { mobile: "98250 41238", clientName: "Sunil Shah" } });
}

describe("the same number twice on a case", () => {
  it("is refused when the decision is recorded, and when a change gives one traveller another's number", async () => {
    const { c, processor, adult, child } = await decidedCase({ decided: false });
    const twice = await record(processor, c.caseNo, [approved(adult, "0182 4471"), approved(child, "0182  4471")]);
    expect(twice.status).toBe(400);
    expect(twice.body.issues.outcomes).toEqual(["Rakesh Mehta and Aarav Mehta have the same sticker number: each visa has its own."]);

    expect((await record(processor, c.caseNo, [approved(adult, "0182 4471"), approved(child, "0182 4472")])).status).toBe(200);
    const taken = await change(processor, c.caseNo, approved(child, "0182 4471"));
    expect(taken.status).toBe(400);
    expect(taken.body.issues.decision).toEqual(["Rakesh Mehta already has this sticker number: each visa has its own."]);
  });
});

describe("a number already on another case", () => {
  it("is a warning: saved once confirmed, with the confirmation in the audit", async () => {
    const first = await decidedCase(); // Rakesh approved with 0182 4471
    const { vendorId } = await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: first.c.id }, select: { vendorId: true } });
    const second = await anotherCase(vendorId!);

    const outcomes = [approved(second.adult, "0182 4471"), { travellerId: second.child, outcome: "REFUSED" }];
    const warned = await record(second.processor, second.c.caseNo, outcomes);
    expect(warned.status).toBe(409);
    expect(warned.body.details).toEqual({
      code: "WARNING",
      warnings: [{ code: "VISA_NO_ELSEWHERE", message: `Sticker number 0182 4471 is already on ${first.c.caseNo} (Rakesh Mehta).` }],
    });
    expect(warned.body.message).toBe(`Sticker number 0182 4471 is already on ${first.c.caseNo} (Rakesh Mehta). Check, then save again to confirm.`);
    expect(await prisma.auditLog.count({ where: { action: "visa.decision.record", entityId: second.c.id } })).toBe(0);

    const saved = await record(second.processor, second.c.caseNo, outcomes, true);
    expect(saved.status).toBe(200);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.decision.record", entityId: second.c.id } });
    expect(row.after).toMatchObject({ confirmedWarnings: [{ code: "VISA_NO_ELSEWHERE" }] });

    // Changing only the dates doesn't warn about the number again; a new number on another case does.
    expect((await change(second.processor, second.c.caseNo, approved(second.adult, "0182 4471", addDays(FROM, 1)))).status).toBe(200);
    await prisma.visaCaseTraveller.update({ where: { id: first.child }, data: { outcome: "APPROVED", visaNo: "0182 4499", validFrom: new Date(`${FROM}T00:00:00Z`), validTo: new Date(`${TO}T00:00:00Z`) } });
    expect((await change(second.processor, second.c.caseNo, approved(second.adult, "0182 4499"))).status).toBe(409);
  });
});
