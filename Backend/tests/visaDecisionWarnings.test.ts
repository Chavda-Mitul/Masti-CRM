import { beforeEach, describe, expect, it } from "vitest";
import { addDays, dayLabel, istToday } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { prisma, resetDb } from "./helpers";
import { decidedCase, type Agent } from "./visaHelpers";

// What a decision may have wrong (docs/decisions/0012-visa-decision.md, amended 19 Oct 2026; M46): the same sticker or
// e-visa number twice on a case is a typo and refused; a number already on another case, or visa dates that don't cover
// the trip, is a warning: the first save answers 409 WARNING, and saving again with confirmWarnings goes ahead, the
// audit keeping what was confirmed (lib/warnings.ts). Since 23 Oct 2026 (change request 21) recording takes no number
// or dates: they're added with Change, so that's where these are checked.

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

/** "Record the decision" as the dialog sends it, nothing typed: the first traveller approved, the second as `child`. */
async function record(agent: Agent, caseNo: string, adult: string, child: string, childOutcome = "REFUSED") {
  // Read first: a request awaited inside another's .send(...) breaks supertest.
  const updatedAt = await updatedAtOf(caseNo);
  const outcomes = [
    { travellerId: adult, outcome: "APPROVED" },
    { travellerId: child, outcome: childOutcome },
  ];
  const res = await agent.post(`/api/visa/cases/${caseNo}/decision`).send({ outcomes, updatedAt });
  expect(res.status).toBe(200);
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
  it("is refused when a change gives one traveller another's number", async () => {
    const { c, processor, adult, child } = await decidedCase({ decided: false });
    await record(processor, c.caseNo, adult, child, "APPROVED");
    expect((await change(processor, c.caseNo, approved(adult, "0182 4471"))).status).toBe(200);
    const taken = await change(processor, c.caseNo, approved(child, "0182  4471"));
    expect(taken.status).toBe(400);
    expect(taken.body.issues.decision).toEqual(["Rakesh Mehta already has this sticker number: each visa has its own."]);
    expect((await change(processor, c.caseNo, approved(child, "0182 4472"))).status).toBe(200);
  });
});

describe("a number already on another case", () => {
  it("is a warning: saved once confirmed, with the confirmation in the audit", async () => {
    const first = await decidedCase(); // Rakesh approved, with 0182 4471 added
    const { vendorId } = await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: first.c.id }, select: { vendorId: true } });
    const second = await anotherCase(vendorId!);
    // Recording types nothing, so it never warns.
    await record(second.processor, second.c.caseNo, second.adult, second.child);

    const warned = await change(second.processor, second.c.caseNo, approved(second.adult, "0182 4471"));
    expect(warned.status).toBe(409);
    expect(warned.body.details).toEqual({
      code: "WARNING",
      warnings: [{ code: "VISA_NO_ELSEWHERE", message: `Sticker number 0182 4471 is already on ${first.c.caseNo} (Rakesh Mehta).` }],
    });
    expect(warned.body.message).toBe(`Sticker number 0182 4471 is already on ${first.c.caseNo} (Rakesh Mehta). Check, then save again to confirm.`);
    expect(await prisma.auditLog.count({ where: { action: "visa.decision.change", entityId: second.adult } })).toBe(0);

    const saved = await change(second.processor, second.c.caseNo, approved(second.adult, "0182 4471"), true);
    expect(saved.status).toBe(200);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.decision.change", entityId: second.adult } });
    expect(row.after).toMatchObject({ visaNo: "0182 4471", confirmedWarnings: [{ code: "VISA_NO_ELSEWHERE" }] });

    // Changing only the dates doesn't warn about the number again; a new number on another case does.
    expect((await change(second.processor, second.c.caseNo, approved(second.adult, "0182 4471", addDays(FROM, 1)))).status).toBe(200);
    await prisma.visaCaseTraveller.update({ where: { id: first.child }, data: { outcome: "APPROVED", visaNo: "0182 4499", validFrom: new Date(`${FROM}T00:00:00Z`), validTo: new Date(`${TO}T00:00:00Z`) } });
    expect((await change(second.processor, second.c.caseNo, approved(second.adult, "0182 4499"))).status).toBe(409);
  });
});

describe("visa dates that don't cover the trip", () => {
  it("is a warning when the visa starts after departure or ends before the return; saved once confirmed", async () => {
    const { c, processor, adult, child } = await decidedCase({ decided: false });
    await record(processor, c.caseNo, adult, child);
    // The trip: out in 30 days, back in 41.
    const late = addDays(istToday(), 35);
    const early = addDays(istToday(), 38);
    const warned = await change(processor, c.caseNo, approved(adult, "0182 4471", late, early));
    expect(warned.status).toBe(409);
    expect(warned.body.details.warnings).toEqual([
      {
        code: "VISA_STARTS_AFTER_DEPARTURE",
        message: `Rakesh Mehta's visa starts ${dayLabel(late)}, after the trip begins (${dayLabel(addDays(istToday(), 30))}).`,
      },
      { code: "VISA_ENDS_BEFORE_RETURN", message: `Rakesh Mehta's visa ends ${dayLabel(early)}, before the trip ends (${dayLabel(addDays(istToday(), 41))}).` },
    ]);
    expect(warned.body.message).toBe("2 things to check before saving. Check, then save again to confirm.");

    expect((await change(processor, c.caseNo, approved(adult, "0182 4471", late, early), true)).status).toBe(200);
    // Changing only the number doesn't warn about the dates again; moving a date does.
    expect((await change(processor, c.caseNo, approved(adult, "0182 4479", late, early))).status).toBe(200);
    const moved = await change(processor, c.caseNo, approved(adult, "0182 4479", late, addDays(istToday(), 39)));
    expect(moved.status).toBe(409);
    expect(moved.body.details.warnings.map((w: { code: string }) => w.code)).toEqual(["VISA_STARTS_AFTER_DEPARTURE", "VISA_ENDS_BEFORE_RETURN"]);
  });

  it("isn't raised when the visa covers the trip; one date alone is checked on its own", async () => {
    const { c, processor, adult, child } = await decidedCase({ decided: false });
    await record(processor, c.caseNo, adult, child);
    expect((await change(processor, c.caseNo, approved(adult, "0182 4471"))).status).toBe(200);
    // Only the valid-from, after departure: the dates are optional (amended 23 Oct 2026), and the start still warns.
    const late = addDays(istToday(), 35);
    const startOnly = await change(processor, c.caseNo, { travellerId: adult, outcome: "APPROVED", visaNo: "0182 4471", validFrom: late });
    expect(startOnly.status).toBe(409);
    expect(startOnly.body.details.warnings.map((w: { code: string }) => w.code)).toEqual(["VISA_STARTS_AFTER_DEPARTURE"]);
  });
});
