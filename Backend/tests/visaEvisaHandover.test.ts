import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, istToday, toDbDate } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { nextOpenDay } from "../src/modules/holidays/blockedDays";
import { VISA_HANDED_OVER } from "../src/modules/messages/messages.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { decidedCase, evisaCase, lastDoorCode, type Agent } from "./visaHelpers";

// E-visas after the decision, part 4 (docs/decisions/0025-evisa-after-decision.md): handing back the passports we hold.
// An e-visa's passports never go to a vendor, so booklets counted in at intake stay at our office. Once the e-visa is
// sent (part 3), they go back as any other: at the desk, by whoever is there, or with the delivery boy; the count must
// match the intake, and the case is then Delivered and closed. A cancelled e-visa's go back at the office only.

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
  handover: { mode: string; booklets: { current: number; old: number } } | null;
  travellers: { id: string; evisa: { id: string } | null }[];
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const PLACE = { lat: 21.1702, lng: 72.8311, accuracy: 9 };
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const reason = async (code: string) => (await prisma.enquiryReason.findUniqueOrThrow({ where: { code } })).id;
const photo = (agent: Agent, caseNo: string) => agent.post(`/api/visa/cases/${caseNo}/handover/photo`).set("Content-Type", "image/jpeg").send(JPEG);

async function pdf() {
  const doc = await PDFDocument.create();
  doc.addPage();
  return Buffer.from(await doc.save());
}

/** The booklets counted in at intake: passports we hold. */
const holdPassports = (enquiryId: string, current = 2) => prisma.visaCase.update({ where: { enquiryId }, data: { bookletsCurrent: current, bookletsOld: 0 } });

/** "Hand over to the client" at the office: 2 + 0 counted, Rakesh collecting, a fresh photo, unless `body` says otherwise. */
async function handOver(agent: Agent, caseNo: string, body: Record<string, unknown> = {}) {
  // Read first: a request awaited inside another's .send(...) breaks supertest.
  const c = await load(agent, caseNo);
  const photoId = (await photo(agent, caseNo)).body.photo?.id;
  return agent
    .post(`/api/visa/cases/${caseNo}/handover`)
    .send({ mode: "OFFICE", booklets: { current: 2, old: 0 }, receiver: { travellerId: c.travellers[0]!.id }, updatedAt: c.updatedAt, photoId, ...body });
}

/** "Cancel" with the trip cancelled, as the case page sends it. */
async function cancel(agent: Agent, caseNo: string) {
  const { updatedAt } = await load(agent, caseNo);
  return agent.post(`/api/enquiries/${caseNo}/cancel`).send({ reasonId: await reason("TRIP_CANCELLED"), updatedAt });
}

/** Neha's e-visa (Rakesh and Aarav approved) with 2 + 0 booklets held; sent too unless `sent` is false. */
async function evisaHeld({ sent = true } = {}) {
  const e = await evisaCase();
  await holdPassports(e.c.id);
  for (const id of [e.adult, e.child]) {
    const up = await e.processor.post(`/api/visa/cases/${e.c.caseNo}/travellers/${id}/evisa`).set("Content-Type", "application/pdf").send(await pdf());
    const fileId = (up.body.case as CaseDto).travellers.find((t) => t.id === id)!.evisa!.id;
    expect((await e.processor.put(`/api/visa/cases/${e.c.caseNo}/travellers/${id}/evisa-check`).send({ fileId, check: "MATCHES" })).status).toBe(200);
  }
  if (sent) {
    const { updatedAt } = await load(e.processor, e.c.caseNo);
    expect((await e.processor.post(`/api/visa/cases/${e.c.caseNo}/send-evisa`).send({ updatedAt })).status).toBe(200);
  }
  return e;
}

describe("at the desk", () => {
  it("waits for the e-visa to be sent: the passports go back after it", async () => {
    const { c, processor } = await evisaHeld({ sent: false });
    const early = await photo(processor, c.caseNo);
    expect(early.status).toBe(409);
    expect(early.body.message).toBe("Send the e-visa first: the passports go back after it.");
  });

  it("once sent: counted against the intake, then Delivered and closed, with message 15 and the audit", async () => {
    const { c, processor } = await evisaHeld();
    const short = await handOver(processor, c.caseNo, { booklets: { current: 1, old: 0 } });
    expect(short.status).toBe(400);
    expect(short.body.issues.booklets).toEqual(["Count again: our stock has 2 current + 0 old. Find what's missing before handing over."]);

    const res = await handOver(processor, c.caseNo);
    expect(res.status).toBe(200);
    expect(res.body.case as CaseDto).toMatchObject({ stage: { code: "DELIVERED" }, status: "CLOSED", dueAt: null, handover: { mode: "OFFICE", booklets: { current: 2, old: 0 } } });
    const [message] = await prisma.outboundMessage.findMany({ where: { template: { code: VISA_HANDED_OVER } } });
    expect(message!.body).toContain(`We have handed over 2 passports for ${c.caseNo} to Rakesh Mehta on `);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.handover", entityId: c.id } });
    expect(entry).toMatchObject({ before: { stage: "DECISION", status: "OPEN" }, after: { stage: "DELIVERED", status: "CLOSED", mode: "OFFICE" } });
    expect(entry.after).not.toHaveProperty("beforeDispatch");
  });

  it("whoever is at the desk can open it and hand them over once it's sent, not before", async () => {
    const { c, processor } = await evisaHeld({ sent: false });
    await createUser({ name: "Kiran Desai", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    const kiran = await loginAs("kiran@masti.test");
    expect((await kiran.get(`/api/visa/cases/${c.caseNo}`)).status).toBe(403);

    const { updatedAt } = await load(processor, c.caseNo);
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/send-evisa`).send({ updatedAt })).status).toBe(200);
    expect((await kiran.get(`/api/visa/cases/${c.caseNo}`)).status).toBe(200);
    const res = await handOver(kiran, c.caseNo);
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).status).toBe("CLOSED");
  });
});

describe("the delivery boy", () => {
  it("is booked for a sent e-visa; his stop counts the intake; the handover at the door closes the case", async () => {
    const { c, processor, adult } = await evisaHeld();
    const ramesh = await createUser({ name: "Ramesh Patel", mobile: "+919825000001", type: "FIELD" });
    const slot = await prisma.fieldSlot.findUniqueOrThrow({ where: { code: "EVENING" } });
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
    // He records a stop on its day: the booking's day is moved to today, as fieldDoorstepHandover.test.ts books it.
    const job = await prisma.fieldJob.findFirstOrThrow({ where: { enquiryId: c.id, kind: "DELIVERY" } });
    await prisma.fieldJob.update({ where: { id: job.id }, data: { day: toDbDate(istToday()) } });

    const boy = await loginAs("98250 00001");
    expect((await boy.get(`/api/field/jobs/${job.id}`)).body.stop).toMatchObject({ kind: "DELIVERY", booklets: { current: 2, old: 0 } });
    expect((await boy.post(`/api/field/jobs/${job.id}/otp`).send({})).status).toBe(200);
    expect((await boy.post(`/api/field/jobs/${job.id}/otp/check`).send({ code: await lastDoorCode() })).status).toBe(200);
    const receiverPhoto = (await boy.post(`/api/field/jobs/${job.id}/receiver-photo`).set("Content-Type", "image/jpeg").send(JPEG)).body.photo;
    const selfie = (await boy.post(`/api/field/jobs/${job.id}/selfie`).set("Content-Type", "image/jpeg").send(JPEG)).body.selfie;
    const door = await boy.post(`/api/field/jobs/${job.id}/handover`).send({
      booklets: { current: 2, old: 0 },
      receiver: { travellerId: adult },
      photoId: receiverPhoto.id,
      selfieId: selfie.id,
      place: PLACE,
    });
    expect(door.status).toBe(200);

    const enquiry = await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id }, include: { stage: true } });
    expect(enquiry).toMatchObject({ status: "CLOSED", dueAt: null, stage: { code: "DELIVERED" } });
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.handover", entityId: c.id } })).toMatchObject({
      before: { stage: "DECISION" },
      after: { stage: "DELIVERED", status: "CLOSED", mode: "DELIVERY", fieldJobId: job.id },
    });
  });
});

describe("a cancelled e-visa", () => {
  it("at At vendor with passports held: still to hand back, at the office only; it stays cancelled at its step", async () => {
    const { c, processor } = await evisaCase({ decided: false });
    await holdPassports(c.id);
    expect((await cancel(processor, c.caseNo)).status).toBe(200);
    const cancelled = await load(processor, c.caseNo);
    expect(cancelled).toMatchObject({ status: "CANCELLED", stage: { code: "AT_VENDOR" } });
    // On its owner's list until the passports are back with the client (0006 amendment 15), and due for it.
    expect(cancelled.dueAt).not.toBeNull();
    const list = await processor.get("/api/enquiries");
    expect((list.body.enquiries as { caseNo: string }[]).map((r) => r.caseNo)).toContain(c.caseNo);

    // The delivery boy takes only an open case's: a cancelled one's go back at the office.
    const ramesh = await createUser({ name: "Ramesh Patel", mobile: "+919825000001", type: "FIELD" });
    const slot = await prisma.fieldSlot.findUniqueOrThrow({ where: { code: "EVENING" } });
    const refused = await processor.post(`/api/visa/cases/${c.caseNo}/field-jobs`).send({
      kind: "DELIVERY",
      assigneeId: ramesh.id,
      day: await nextOpenDay(addDays(istToday(), 1), { office: true }),
      slotId: slot.id,
      address: "B-702, Raghuvir Residency, Vesu, Surat 395007",
      updatedAt: cancelled.updatedAt,
    });
    expect(refused.status).toBe(409);

    const res = await handOver(processor, c.caseNo);
    expect(res.status).toBe(200);
    expect(res.body.case as CaseDto).toMatchObject({ status: "CANCELLED", stage: { code: "AT_VENDOR" }, dueAt: null, handover: { mode: "OFFICE" } });
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.handover", entityId: c.id } })).toMatchObject({
      after: { stage: "AT_VENDOR", status: "CANCELLED" },
    });
  });
});

describe("a paper visa", () => {
  it("cancelled at At vendor: its passports are with the vendor, so nothing is handed back from the intake count", async () => {
    const { c, processor } = await decidedCase({ decided: false });
    await holdPassports(c.id);
    expect((await cancel(processor, c.caseNo)).status).toBe(200);
    const res = await photo(processor, c.caseNo);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Passports are handed over from Passport back.");
  });
});
