import { beforeEach, describe, expect, it } from "vitest";
import { addDays, istDateTimeToUtc, istToday } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { nextOpenDay } from "../src/modules/holidays/blockedDays";
import { VISA_EVISA_PARTLY_APPROVED, VISA_EVISA_REFUSED, VISA_HANDED_OVER, VISA_PARTLY_APPROVED, VISA_REFUSED } from "../src/modules/messages/messages.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { evisaCase, type Agent } from "./visaHelpers";

// E-visas after the decision, part 5 (docs/decisions/0025-evisa-after-decision.md): refused e-visas. The decision gets
// message 20 (everyone refused) or 21 (some), with no passport lines. When everyone is refused there's nothing to send:
// with no passports held the case moves to Delivered and closes, after a warning, whether recorded so or changed so;
// with passports held it's due for their handover, at the desk or by the delivery boy.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface CaseDto {
  updatedAt: string;
  status: string;
  dueAt: string | null;
  stage: { code: string };
  travellers: { id: string }[];
  handover: { mode: string } | null;
}

const CLOSES_CASE = {
  code: "CASE_CLOSES",
  message: "Everyone is refused and we hold no passports: saving closes the case, and a closed case can't be changed.",
};
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const sent = (code: string) => prisma.outboundMessage.findMany({ where: { template: { code } } });
const nextStepOf = async (agent: Agent, caseNo: string) =>
  ((await agent.get("/api/enquiries")).body.enquiries as { caseNo: string; nextStep: string }[]).find((r) => r.caseNo === caseNo)?.nextStep;

/** "Record the decision" with everyone refused, as the dialog sends it. */
async function refuseAll(agent: Agent, caseNo: string, travellerIds: string[], confirmWarnings = false) {
  const { updatedAt } = await load(agent, caseNo);
  return agent.post(`/api/visa/cases/${caseNo}/decision`).send({
    outcomes: travellerIds.map((travellerId) => ({ travellerId, outcome: "REFUSED" })),
    updatedAt,
    ...(confirmWarnings ? { confirmWarnings } : {}),
  });
}

/** "Change" on one traveller's row, to Refused. */
async function changeToRefused(agent: Agent, caseNo: string, travellerId: string, confirmWarnings = false) {
  const { updatedAt } = await load(agent, caseNo);
  return agent.put(`/api/visa/cases/${caseNo}/travellers/${travellerId}/decision`).send({ outcome: "REFUSED", updatedAt, ...(confirmWarnings ? { confirmWarnings } : {}) });
}

/** "Hand over to the client" at the office: 2 + 0 counted, Rakesh collecting, a fresh photo. */
async function handOver(agent: Agent, caseNo: string) {
  // Read first: a request awaited inside another's .send(...) breaks supertest.
  const c = await load(agent, caseNo);
  const photoId = (await agent.post(`/api/visa/cases/${caseNo}/handover/photo`).set("Content-Type", "image/jpeg").send(JPEG)).body.photo?.id;
  return agent
    .post(`/api/visa/cases/${caseNo}/handover`)
    .send({ mode: "OFFICE", booklets: { current: 2, old: 0 }, receiver: { travellerId: c.travellers[0]!.id }, updatedAt: c.updatedAt, photoId });
}

describe("everyone refused", () => {
  it("with no passports held: warned first, then Delivered and closed, with message 20 and no passport lines", async () => {
    const { c, processor, adult, child } = await evisaCase({ decided: false });
    const warned = await refuseAll(processor, c.caseNo, [adult, child]);
    expect(warned.status).toBe(409);
    expect(warned.body.details).toEqual({ code: "WARNING", warnings: [CLOSES_CASE] });
    expect((await load(processor, c.caseNo)).stage.code).toBe("AT_VENDOR");

    const res = await refuseAll(processor, c.caseNo, [adult, child], true);
    expect(res.status).toBe(200);
    expect(res.body.case as CaseDto).toMatchObject({ stage: { code: "DELIVERED" }, status: "CLOSED", dueAt: null, handover: null });

    const [message] = await sent(VISA_EVISA_REFUSED);
    expect(message!.body).toContain(`We are sorry to tell you that the France tourist visa has been refused for Rakesh Mehta and Aarav Mehta (${c.caseNo}).`);
    expect(message!.body).toContain("we will explain the reason and what can be done next.");
    expect(message!.body).not.toMatch(/passport/i);
    expect(await sent(VISA_REFUSED)).toHaveLength(0);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.decision.record", entityId: c.id } });
    expect(entry.after).toMatchObject({ stage: "DELIVERED", status: "CLOSED", dueAt: null, confirmedWarnings: [CLOSES_CASE] });

    // A closed case can't change, and there's nothing to send.
    const again = await changeToRefused(processor, c.caseNo, adult);
    expect(again.status).toBe(409);
    const { updatedAt } = await load(processor, c.caseNo);
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/send-evisa`).send({ updatedAt })).status).toBe(409);
  });

  it("with passports held: no warning; due for their handover; the delivery boy can be booked; the desk hands them back", async () => {
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    expect((await (await loginAs("riya@masti.test")).put("/api/visa/settings").send({ handoverCheck: { afterDays: 2, at: "10:00" } })).status).toBe(200);
    const { c, processor, adult, child } = await evisaCase({ decided: false, held: 2 });

    const res = await refuseAll(processor, c.caseNo, [adult, child]);
    expect(res.status).toBe(200);
    const due = istDateTimeToUtc(await nextOpenDay(addDays(istToday(), 2), { office: true }), "10:00").toISOString();
    expect(res.body.case as CaseDto).toMatchObject({ stage: { code: "DECISION" }, status: "OPEN", dueAt: due });
    expect(await sent(VISA_EVISA_REFUSED)).toHaveLength(1);
    expect(await nextStepOf(processor, c.caseNo)).toBe("Hand back the passports");

    const ramesh = await createUser({ name: "Ramesh Patel", mobile: "+919825000001", type: "FIELD" });
    const slot = await prisma.fieldSlot.findUniqueOrThrow({ where: { code: "EVENING" } });
    // Read first: a request awaited inside another's .send(...) breaks supertest.
    const { updatedAt } = await load(processor, c.caseNo);
    const booked = await processor.post(`/api/visa/cases/${c.caseNo}/field-jobs`).send({
      kind: "DELIVERY",
      assigneeId: ramesh.id,
      day: await nextOpenDay(addDays(istToday(), 1), { office: true }),
      slotId: slot.id,
      address: "B-702, Raghuvir Residency, Vesu, Surat 395007",
      updatedAt,
    });
    expect(booked.status).toBe(200);

    // Whoever is at the desk can open it and hand them over; the booked delivery is called off.
    await createUser({ name: "Kiran Desai", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    const kiran = await loginAs("kiran@masti.test");
    expect((await kiran.get(`/api/visa/cases/${c.caseNo}`)).status).toBe(200);
    const handed = await handOver(kiran, c.caseNo);
    expect(handed.status).toBe(200);
    expect(handed.body.case as CaseDto).toMatchObject({ stage: { code: "DELIVERED" }, status: "CLOSED", dueAt: null, handover: { mode: "OFFICE" } });
    expect(await sent(VISA_HANDED_OVER)).toHaveLength(1);
    expect(await prisma.fieldJob.findFirstOrThrow({ where: { enquiryId: c.id, kind: "DELIVERY" } })).toMatchObject({ status: "CANCELLED" });
  });
});

describe("some refused", () => {
  it("gets message 21 with no passport lines, and waits for the e-visa to be sent", async () => {
    const { c, processor } = await evisaCase({ outcomes: ["APPROVED", "REFUSED"] });
    const [message] = await sent(VISA_EVISA_PARTLY_APPROVED);
    expect(message!.body).toContain(
      `The decision on your France tourist visa (${c.caseNo}) has come. Good news: it is approved for Rakesh Mehta, and we will send the e-visa here shortly. We are sorry that it was refused for Aarav Mehta.`,
    );
    expect(message!.body).not.toMatch(/passport/i);
    expect(await sent(VISA_PARTLY_APPROVED)).toHaveLength(0);
    expect(await load(processor, c.caseNo)).toMatchObject({ stage: { code: "DECISION" }, status: "OPEN" });
    expect(await nextStepOf(processor, c.caseNo)).toBe("Send the e-visa");
  });
});

describe("a change that leaves everyone refused", () => {
  it("with no passports held: warned first, then Delivered and closed, with no new message", async () => {
    const { c, processor, adult } = await evisaCase({ outcomes: ["APPROVED", "REFUSED"] });
    const warned = await changeToRefused(processor, c.caseNo, adult);
    expect(warned.status).toBe(409);
    expect(warned.body.details).toEqual({ code: "WARNING", warnings: [CLOSES_CASE] });

    const res = await changeToRefused(processor, c.caseNo, adult, true);
    expect(res.status).toBe(200);
    expect(res.body.case as CaseDto).toMatchObject({ stage: { code: "DELIVERED" }, status: "CLOSED", dueAt: null });
    // The client had message 21 when it was recorded; a correction sends nothing (staff call).
    expect(await prisma.outboundMessage.count({ where: { template: { code: { in: [VISA_EVISA_REFUSED, VISA_EVISA_PARTLY_APPROVED] } } } })).toBe(1);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.decision.change", entityId: adult } });
    expect(entry.after).toMatchObject({ outcome: "REFUSED", caseClosed: { stage: "DELIVERED", status: "CLOSED" }, confirmedWarnings: [CLOSES_CASE] });
  });

  it("with passports held: no warning; it stays open, to hand them back", async () => {
    const { c, processor, adult } = await evisaCase({ outcomes: ["APPROVED", "REFUSED"], held: 2 });
    const res = await changeToRefused(processor, c.caseNo, adult);
    expect(res.status).toBe(200);
    expect(res.body.case as CaseDto).toMatchObject({ stage: { code: "DECISION" }, status: "OPEN" });
    expect(await nextStepOf(processor, c.caseNo)).toBe("Hand back the passports");
    expect((await handOver(processor, c.caseNo)).status).toBe(200);
  });
});
