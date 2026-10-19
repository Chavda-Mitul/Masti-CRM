import { beforeEach, describe, expect, it } from "vitest";
import { addDays, istToday } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { receivedCase, recalledCase, type Agent } from "./visaHelpers";

// A sticker that doesn't match can be put right before the handover (docs/decisions/0012-visa-decision.md Decision 6 and
// 0013-visa-passport-back.md Decision 5, amended 19 Oct 2026; review finding 3): "Change" on a traveller's decision
// works at Passport back too, and once the passports are received it checks the sticker again.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

const FROM = addDays(istToday(), 20);
const TO = addDays(istToday(), 60);

interface CaseDto {
  stage: { code: string };
  travellers: { decision: { outcome: string; visaNo: string | null } | null; stickerCheck: string | null }[];
}

/** "Change" on a traveller's row, with the case's updatedAt as it is now. */
async function change(agent: Agent, caseNo: string, travellerId: string, body: Record<string, unknown>) {
  // Read first: a request awaited inside another's .send(...) breaks supertest.
  const { updatedAt } = await prisma.enquiry.findUniqueOrThrow({ where: { caseNo }, select: { updatedAt: true } });
  return agent.put(`/api/visa/cases/${caseNo}/travellers/${travellerId}/decision`).send({ ...body, updatedAt: updatedAt.toISOString() });
}

/** Mehta's file received into our stock (receivedCase), with Rakesh's sticker found not to match at Mark received. */
async function mismatched() {
  const d = await receivedCase();
  await prisma.visaCaseTraveller.update({ where: { id: d.adult }, data: { stickerCheck: "MISMATCH" } });
  return d;
}

describe("correcting a sticker that doesn't match", () => {
  it("at Passport back: fixes the number and marks the sticker as matching; the case stays put, the audit keeps both", async () => {
    const { c, processor, adult } = await mismatched();
    const res = await change(processor, c.caseNo, adult, { outcome: "APPROVED", visaNo: "0182 4479", validFrom: FROM, validTo: TO, stickerCheck: "MATCHES" });
    expect(res.status).toBe(200);
    const after = res.body.case as CaseDto;
    expect(after.stage.code).toBe("PASSPORT_BACK");
    expect(after.travellers[0]).toMatchObject({ decision: { outcome: "APPROVED", visaNo: "0182 4479" }, stickerCheck: "MATCHES" });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.decision.change" } });
    expect(row.before).toMatchObject({ name: "Rakesh Mehta", visaNo: "0182 4471", stickerCheck: "MISMATCH" });
    expect(row.after).toMatchObject({ name: "Rakesh Mehta", visaNo: "0182 4479", stickerCheck: "MATCHES" });

    // Just the check, the number as it was: a change too. The same again writes nothing.
    const recheck = await change(processor, c.caseNo, adult, { outcome: "APPROVED", visaNo: "0182 4479", validFrom: FROM, validTo: TO, stickerCheck: "MISMATCH" });
    expect((recheck.body.case as CaseDto).travellers[0]!.stickerCheck).toBe("MISMATCH");
    expect((await change(processor, c.caseNo, adult, { outcome: "APPROVED", visaNo: "0182 4479", validFrom: FROM, validTo: TO, stickerCheck: "MISMATCH" })).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "visa.decision.change" } })).toBe(2);
  });

  it("once received, an approved traveller's change needs the sticker check; a refused one has none, and refusing clears it", async () => {
    const { c, processor, adult, child } = await mismatched();
    const missing = await change(processor, c.caseNo, adult, { outcome: "APPROVED", visaNo: "0182 4479", validFrom: FROM, validTo: TO });
    expect(missing.status).toBe(400);
    expect(missing.body.issues.decision).toEqual(["Check Rakesh Mehta's sticker against the passport: Matches or Doesn't match."]);
    const refusedWithCheck = await change(processor, c.caseNo, child, { outcome: "REFUSED", stickerCheck: "MATCHES" });
    expect(refusedWithCheck.status).toBe(400);
    expect(refusedWithCheck.body.issues.decision).toEqual(["Aarav Mehta was refused: there's no sticker to check."]);

    expect((await change(processor, c.caseNo, adult, { outcome: "REFUSED" })).status).toBe(200);
    expect((await prisma.visaCaseTraveller.findUniqueOrThrow({ where: { id: adult } })).stickerCheck).toBeNull();
    // Refused → Approved again, once received: the new sticker is checked.
    const back = await change(processor, c.caseNo, adult, { outcome: "APPROVED", visaNo: "0182 4480", validFrom: FROM, validTo: TO, stickerCheck: "MATCHES" });
    expect((back.body.case as CaseDto).travellers[0]!.stickerCheck).toBe("MATCHES");
  });

  it("is for its processor, the Visa HOD and the Head, not a desk colleague who sees the passports in our stock", async () => {
    const { c, adult } = await mismatched();
    await createUser({ name: "Kiran", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    const kiran = await loginAs("kiran@masti.test");
    // She sees the case while the passports are in stock (0006 amendment 13), to hand them over; correcting isn't hers.
    expect((await kiran.get(`/api/visa/cases/${c.caseNo}`)).status).toBe(200);
    const res = await change(kiran, c.caseNo, adult, { outcome: "APPROVED", visaNo: "0182 4479", validFrom: FROM, validTo: TO, stickerCheck: "MATCHES" });
    expect(res.status).toBe(403);
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await change(await loginAs("riya@masti.test"), c.caseNo, adult, { outcome: "APPROVED", visaNo: "0182 4479", validFrom: FROM, validTo: TO, stickerCheck: "MATCHES" });
    expect(hod.status).toBe(200);
  });

  it("not for a file taken back before a decision", async () => {
    const { c, processor } = await recalledCase();
    const [t] = await prisma.visaCaseTraveller.findMany({ where: { caseId: c.id }, orderBy: { position: "asc" } });
    const res = await change(processor, c.caseNo, t!.id, { outcome: "REFUSED" });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("This file was taken back before a decision: there's none to change.");
  });
});
