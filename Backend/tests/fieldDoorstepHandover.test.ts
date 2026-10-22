import { beforeEach, describe, expect, it, vi } from "vitest";
import { istToday, toDbDate } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { VISA_HANDED_OVER } from "../src/modules/messages/messages.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { receivedCase, type Agent } from "./visaHelpers";

// The field staff app, phase 5 (docs/decisions/0015-field-staff-app.md Decision 4): the handover at the client's door.
// The client's code, the booklets matching our stock, who receives them and their photo, his selfie and the place; the
// case then moves to Delivered, as at the office. No code, no handover; a count that doesn't match, no handover.

const failures = vi.hoisted(() => ({ next: 0 }));
vi.mock("../src/lib/email", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/email")>();
  return {
    ...real,
    sendEmail: async (email: Parameters<typeof real.sendEmail>[0]) => {
      if (failures.next > 0) {
        failures.next--;
        throw new Error("Connection refused");
      }
      return real.sendEmail(email);
    },
  };
});

const mailpit = process.env.MAILPIT_URL as string;

beforeEach(async () => {
  failures.next = 0;
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
  await fetch(`${mailpit}/api/v1/messages`, { method: "DELETE" });
});

/** The newest email Mailpit caught for the Mehtas (another test file's can still be arriving): its code and text. */
async function lastEmail() {
  type Mail = { ID: string; Subject: string; To: { Address: string }[] };
  const { messages } = (await (await fetch(`${mailpit}/api/v1/messages`)).json()) as { messages: Mail[] };
  const newest = messages.find((m) => m.To.some((t) => t.Address === "rakesh@example.com"));
  if (!newest) throw new Error("No email in Mailpit");
  const { Text } = (await (await fetch(`${mailpit}/api/v1/message/${newest.ID}`)).json()) as { Text: string };
  return { code: /: (\d{6})$/.exec(newest.Subject)![1]!, text: Text };
}

const PLACE = { lat: 21.1702, lng: 72.8311, accuracy: 9 };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);

/**
 * Mehta's passports in our stock (receivedCase: 2 current + 0 old; Rakesh and Aarav, Neha's case), the client's email on
 * file, and Ramesh's delivery today, written straight to the database (booking is tested in visaFieldJobs.test.ts).
 */
async function setup() {
  const ramesh = await createUser({ name: "Ramesh Patel", mobile: "+919825000001", type: "FIELD" });
  const d = await receivedCase();
  await prisma.client.update({ where: { id: d.c.client.id }, data: { email: "rakesh@example.com" } });
  const neha = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
  const visa = await prisma.department.findUniqueOrThrow({ where: { code: "VISA" } });
  const slot = await prisma.fieldSlot.findUniqueOrThrow({ where: { code: "MORNING" } });
  const job = (data: Record<string, unknown> = {}) =>
    prisma.fieldJob.create({
      data: {
        departmentId: visa.id,
        kind: "DELIVERY",
        enquiryId: d.c.id,
        assigneeId: ramesh.id,
        day: toDbDate(istToday()),
        slotId: slot.id,
        address: "B-702, Raghuvir Residency, Vesu",
        mobile: "+919825041234",
        createdById: neha.id,
        ...data,
      } as never,
    });
  const delivery = await job();
  const boy = await loginAs("98250 00001");
  return { ...d, ramesh, delivery, job, boy };
}

const confirmCode = async (boy: Agent, jobId: string) => {
  expect((await boy.post(`/api/field/jobs/${jobId}/otp`).send({})).status).toBe(200);
  const { code } = await lastEmail();
  expect((await boy.post(`/api/field/jobs/${jobId}/otp/check`).send({ code })).status).toBe(200);
};
const photo = (boy: Agent, jobId: string, path: "receiver-photo" | "selfie") => boy.post(`/api/field/jobs/${jobId}/${path}`).set("Content-Type", "image/jpeg").send(JPEG);
const handOver = (boy: Agent, jobId: string, body: Record<string, unknown>) => boy.post(`/api/field/jobs/${jobId}/handover`).send(body);

describe("the handover at the door (phase 5)", () => {
  it("sends the client a code worded for the handover, and takes the receiver's photo at a delivery", async () => {
    const { delivery, boy, c, ramesh } = await setup();
    expect((await boy.post(`/api/field/jobs/${delivery.id}/otp`).send({})).status).toBe(200);
    expect((await lastEmail()).text).toContain(`Ramesh from MASTI TOUR AND TRAVEL is at your door to hand over the passports for ${c.caseNo}.`);

    const res = await photo(boy, delivery.id, "receiver-photo");
    expect(res.status).toBe(200);
    expect(res.body.photo).toMatchObject({ fileName: `${c.caseNo}_receiver.jpg` });
    expect(await prisma.caseFile.findUniqueOrThrow({ where: { id: res.body.photo.id } })).toMatchObject({ kind: "RECEIVER_PHOTO", uploadedById: ramesh.id });
    // His selfie works at a delivery too.
    expect((await photo(boy, delivery.id, "selfie")).status).toBe(200);
  });

  it("needs the code, a count matching our stock, who receives and their photo, and his selfie; then Delivered and closed", async () => {
    const { delivery, boy, c, adult, processor, ramesh } = await setup();
    const stop = (await boy.get(`/api/field/jobs/${delivery.id}`)).body.stop;
    expect(stop).toMatchObject({ kind: "DELIVERY", booklets: { current: 2, old: 0 } });
    expect(stop.travellers).toEqual([
      { id: adult, name: "Rakesh Mehta", isChild: false },
      { id: expect.any(String), name: "Aarav Mehta", isChild: true },
    ]);

    const receiverPhoto = (await photo(boy, delivery.id, "receiver-photo")).body.photo;
    const selfie = (await photo(boy, delivery.id, "selfie")).body.selfie;
    const body = { booklets: { current: 2, old: 0 }, receiver: { travellerId: adult }, photoId: receiverPhoto.id, selfieId: selfie.id, place: PLACE };

    const early = await handOver(boy, delivery.id, body);
    expect(early.status).toBe(409);
    expect(early.body.message).toBe("The client hasn't confirmed with the code yet.");
    await confirmCode(boy, delivery.id);

    const short = await handOver(boy, delivery.id, { ...body, booklets: { current: 1, old: 0 } });
    expect(short.status).toBe(400);
    expect(short.body.issues.booklets).toEqual(["Count again: our stock has 2 current + 0 old. Find what's missing before handing over."]);
    expect((await handOver(boy, delivery.id, { ...body, receiver: {} })).body.issues.receiver).toEqual(["Pick who collected the passports."]);
    expect((await handOver(boy, delivery.id, { ...body, photoId: selfie.id })).body.issues.photoId).toEqual(["Take a photo of the person receiving."]);
    expect((await handOver(boy, delivery.id, { ...body, selfieId: receiverPhoto.id })).body.issues.selfieId).toEqual(["Take your selfie at the door."]);

    const res = await handOver(boy, delivery.id, body);
    expect(res.status).toBe(200);
    expect(res.body.stop).toMatchObject({ status: "DONE" });

    expect(await prisma.visaHandover.findUniqueOrThrow({ where: { enquiryId: c.id } })).toMatchObject({
      mode: "DELIVERY",
      byId: ramesh.id,
      bookletsCurrent: 2,
      bookletsOld: 0,
      receiverTravellerId: adult,
      receiverName: null,
      receiverPhotoId: receiverPhoto.id,
      fieldJobId: delivery.id,
    });
    expect(await prisma.fieldJob.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({
      status: "DONE",
      bookletsCurrent: 2,
      bookletsOld: 0,
      selfieId: selfie.id,
      latitude: 21.1702,
      longitude: 72.8311,
      accuracyM: 9,
    });
    const enquiry = await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id }, include: { stage: true } });
    expect(enquiry).toMatchObject({ status: "CLOSED", dueAt: null, stage: { code: "DELIVERED" } });
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.handover" } })).toMatchObject({
      actorId: ramesh.id,
      after: { mode: "DELIVERY", receiver: "Rakesh Mehta", fieldJobId: delivery.id, place: PLACE },
    });
    expect(await prisma.auditLog.count({ where: { action: "field.job.done", entityId: delivery.id } })).toBe(1);
    // The client's WhatsApp, as at the office (message 15).
    const [message] = await prisma.outboundMessage.findMany({ where: { template: { code: VISA_HANDED_OVER } } });
    expect(message!.body).toContain(`We have handed over 2 passports for ${c.caseNo} to Rakesh Mehta on `);

    // The office sees the handover at the door, and can't hand over again.
    const seen = (await processor.get(`/api/visa/cases/${c.caseNo}`)).body.case;
    expect(seen.handover).toMatchObject({ mode: "DELIVERY", fieldJobId: delivery.id, receiver: { name: "Rakesh Mehta" }, booklets: { current: 2, old: 0 } });
    expect(seen.fieldJobs[0]).toMatchObject({ id: delivery.id, status: "DONE", selfie: { id: selfie.id } });
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/handover/photo`).set("Content-Type", "image/jpeg").send(JPEG)).status).toBe(409);
    expect((await handOver(boy, delivery.id, body)).body.message).toBe("This stop is already recorded.");
  });

  it("asks before handing a child the passports, then hands over once confirmed (a warning, 19 Oct 2026)", async () => {
    const { delivery, boy, c, child } = await setup();
    // His stop marks the child on the list of who may receive them.
    expect((await boy.get(`/api/field/jobs/${delivery.id}`)).body.stop.travellers).toEqual([
      { id: expect.any(String), name: "Rakesh Mehta", isChild: false },
      { id: child, name: "Aarav Mehta", isChild: true },
    ]);
    await confirmCode(boy, delivery.id);
    const receiverPhoto = (await photo(boy, delivery.id, "receiver-photo")).body.photo;
    const selfie = (await photo(boy, delivery.id, "selfie")).body.selfie;
    const body = { booklets: { current: 2, old: 0 }, receiver: { travellerId: child }, photoId: receiverPhoto.id, selfieId: selfie.id, place: PLACE };

    const warned = await handOver(boy, delivery.id, body);
    expect(warned.status).toBe(409);
    expect(warned.body.details.warnings.map((w: { code: string }) => w.code)).toEqual(["CHILD_COLLECTS"]);
    expect((await prisma.fieldJob.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe("BOOKED");

    expect((await handOver(boy, delivery.id, { ...body, confirmWarnings: true })).status).toBe(200);
    expect(await prisma.visaHandover.findUniqueOrThrow({ where: { enquiryId: c.id } })).toMatchObject({ mode: "DELIVERY", receiverTravellerId: child });
  });

  it("takes someone else by name; a cancelled case stays cancelled", async () => {
    const { delivery, boy, c, processor } = await setup();
    // Cancelling calls a booked job off, so the delivery is booked again afterwards, as the office handover allows.
    const reasonId = (await prisma.enquiryReason.findUniqueOrThrow({ where: { code: "TRIP_CANCELLED" } })).id;
    const { updatedAt } = (await processor.get(`/api/visa/cases/${c.caseNo}`)).body.case;
    expect((await processor.post(`/api/enquiries/${c.caseNo}/cancel`).send({ reasonId, updatedAt })).status).toBe(200);
    expect((await prisma.fieldJob.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe("CANCELLED");
    const again = await prisma.fieldJob.create({
      data: { ...(await prisma.fieldJob.findUniqueOrThrow({ where: { id: delivery.id }, select: { departmentId: true, kind: true, enquiryId: true, assigneeId: true, day: true, slotId: true, address: true, mobile: true, createdById: true } })) },
    });

    await confirmCode(boy, again.id);
    const receiverPhoto = (await photo(boy, again.id, "receiver-photo")).body.photo;
    const selfie = (await photo(boy, again.id, "selfie")).body.selfie;
    const res = await handOver(boy, again.id, { booklets: { current: 2, old: 0 }, receiver: { name: "Meena Mehta" }, photoId: receiverPhoto.id, selfieId: selfie.id, place: PLACE });
    expect(res.status).toBe(200);
    expect(await prisma.visaHandover.findUniqueOrThrow({ where: { enquiryId: c.id } })).toMatchObject({ receiverName: "Meena Mehta", receiverTravellerId: null });
    expect(await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id }, include: { stage: true } })).toMatchObject({ status: "CANCELLED", stage: { code: "DELIVERED" } });
  });

  it("loses to the office when the office hands over first; refuses a pickup and another boy's stop", async () => {
    const { delivery, boy, c, processor, adult, job } = await setup();
    await confirmCode(boy, delivery.id);
    const receiverPhoto = (await photo(boy, delivery.id, "receiver-photo")).body.photo;
    const selfie = (await photo(boy, delivery.id, "selfie")).body.selfie;

    // The client turns up at the office meanwhile: the office's handover calls his delivery off.
    const officePhoto = (await processor.post(`/api/visa/cases/${c.caseNo}/handover/photo`).set("Content-Type", "image/jpeg").send(JPEG)).body.photo.id;
    const { updatedAt } = (await processor.get(`/api/visa/cases/${c.caseNo}`)).body.case;
    const office = await processor
      .post(`/api/visa/cases/${c.caseNo}/handover`)
      .send({ mode: "OFFICE", booklets: { current: 2, old: 0 }, receiver: { travellerId: adult }, photoId: officePhoto, updatedAt });
    expect(office.status).toBe(200);
    const late = await handOver(boy, delivery.id, { booklets: { current: 2, old: 0 }, receiver: { travellerId: adult }, photoId: receiverPhoto.id, selfieId: selfie.id, place: PLACE });
    expect(late.status).toBe(409);
    expect(late.body.message).toBe("The office called this stop off.");

    const pickup = await job({ kind: "PICKUP" });
    expect((await handOver(boy, pickup.id, {})).status).toBe(400);
    expect((await handOver(boy, pickup.id, { booklets: { current: 2, old: 0 }, receiver: { travellerId: adult }, photoId: "x", selfieId: "y", place: PLACE })).body.message).toBe(
      "Only a delivery is handed over this way.",
    );
    await createUser({ name: "Suresh", mobile: "+919825000002", type: "FIELD" });
    expect((await (await loginAs("98250 00002")).get(`/api/field/jobs/${delivery.id}`)).status).toBe(404);
  });
});
