import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, addMonths, istToday, toDbDate } from "../src/lib/dates";
import { bucket, s3 } from "../src/lib/storage";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { nextOpenDay } from "../src/modules/holidays/blockedDays";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { decidedCase, PNG, recalledCase, receivedCase, type Agent } from "./visaHelpers";

// Visa Step 8, the office handover (docs/decisions/0014-visa-delivered.md, component 1): whoever is at the desk (any Visa
// staff with EDIT, who can open a case while its passports are in our stock) counts the booklets (they must match our
// stock), records who collected them and takes their photo, whatever the case's status. The case is Delivered and
// closes; a cancelled one stays cancelled.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface HandoverDto {
  mode: string;
  at: string;
  by: { name: string } | null;
  booklets: { current: number; old: number };
  receiver: { name: string; travellerId: string | null };
  photo: { id: string; fileName: string } | null;
}
interface CaseDto {
  updatedAt: string;
  status: string;
  dueAt: string | null;
  stage: { code: string };
  handover: HandoverDto | null;
  travellers: { id: string }[];
}
type Body = Record<string, unknown>;

/** A small "JPEG": the server checks a photo's first bytes, not the picture. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const neha = () => loginAs("neha@masti.test");
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const reason = async (code: string) => (await prisma.enquiryReason.findUniqueOrThrow({ where: { code } })).id;
const photo = (agent: Agent, caseNo: string, bytes: Buffer = JPEG, type = "image/jpeg") =>
  agent.post(`/api/visa/cases/${caseNo}/handover/photo`).set("Content-Type", type).send(bytes);

/** "Hand over to the client" at the office: 2 + 0 counted, Rakesh collecting, a fresh photo, unless `body` says otherwise. */
async function handOver(agent: Agent, caseNo: string, body: Body = {}) {
  // Read first: a request awaited inside another's .send(...) breaks supertest.
  const c = await load(agent, caseNo);
  const photoId = "photoId" in body ? body.photoId : (await photo(agent, caseNo)).body.photo.id;
  return agent
    .post(`/api/visa/cases/${caseNo}/handover`)
    .send({ mode: "OFFICE", booklets: { current: 2, old: 0 }, receiver: { travellerId: c.travellers[0]!.id }, updatedAt: c.updatedAt, ...body, photoId });
}

describe("the office handover (Decisions 3 and 7)", () => {
  it("the processor hands over: Delivered and closed, the photo kept privately, audited", async () => {
    const { c, processor, adult } = await receivedCase();
    const up = await photo(processor, c.caseNo);
    expect(up.status).toBe(200);
    const file = await prisma.caseFile.findUniqueOrThrow({ where: { id: up.body.photo.id } });
    expect(file).toMatchObject({ kind: "RECEIVER_PHOTO", pageCount: null, fileName: `${c.caseNo}_receiver.jpg`, sizeBytes: JPEG.length });
    expect(file.storageKey).toMatch(new RegExp(`^cases/${c.id}/handover/.+\\.jpg$`));
    expect((await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: file.storageKey }))).ContentType).toBe("image/jpeg");

    const res = await handOver(processor, c.caseNo, { photoId: file.id });
    expect(res.status).toBe(200);
    const after = res.body.case as CaseDto;
    expect(after).toMatchObject({ stage: { code: "DELIVERED" }, status: "CLOSED", dueAt: null });
    expect(after.handover).toMatchObject({
      mode: "OFFICE",
      by: { name: "Neha Joshi" },
      booklets: { current: 2, old: 0 },
      receiver: { name: "Rakesh Mehta", travellerId: adult },
      photo: { id: file.id, fileName: `${c.caseNo}_receiver.jpg` },
    });

    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.handover" } });
    expect(row).toMatchObject({ entityType: "Enquiry", entityId: c.id, clientId: c.client.id });
    expect(row.before).toMatchObject({ stage: "PASSPORT_BACK", status: "OPEN" });
    expect(row.after).toMatchObject({ stage: "DELIVERED", status: "CLOSED", mode: "OFFICE", receiver: "Rakesh Mehta", receiverIsTraveller: true, photoId: file.id });
    // The processor still opens the photo, through a short-lived link.
    expect((await processor.get(`/api/visa/cases/${c.caseNo}/files/${file.id}/link`)).status).toBe(200);
  });

  it("someone else collecting, by name; a PNG photo", async () => {
    const { c, processor } = await receivedCase();
    const up = await photo(processor, c.caseNo, PNG, "image/png");
    expect(up.status).toBe(200);
    expect(up.body.photo.fileName).toBe(`${c.caseNo}_receiver.png`);
    const res = await handOver(processor, c.caseNo, { receiver: { name: "  Sunita Patel " }, photoId: up.body.photo.id });
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).handover!.receiver).toEqual({ name: "Sunita Patel", travellerId: null });
  });

  it("a postponed case closes, its reason cleared; a cancelled one stays cancelled, at Delivered", async () => {
    const { c, processor } = await receivedCase();
    await prisma.enquiry.update({
      where: { id: c.id },
      data: { status: "POSTPONED", reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: toDbDate(addMonths(istToday(), 1)) },
    });
    const postponed = await handOver(processor, c.caseNo);
    expect(postponed.status).toBe(200);
    expect(postponed.body.case).toMatchObject({ status: "CLOSED", reason: null, resumeOn: null, dueAt: null, stage: { code: "DELIVERED" } });

    const other = await receivedCase({ extra: { mobile: "98250 41236", clientName: "Kiran Bhatt" }, vendorId: c.vendor.id });
    await prisma.enquiry.update({ where: { id: other.c.id }, data: { status: "CANCELLED", reasonId: await reason("TRIP_CANCELLED"), resumeOn: null, dueAt: null } });
    const cancelled = await handOver(processor, other.c.caseNo);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.case).toMatchObject({ status: "CANCELLED", reason: { name: "Trip cancelled" }, stage: { code: "DELIVERED" } });
  });

  it("a recalled file is handed over the same way", async () => {
    const { c, processor } = await recalledCase();
    const expectedOn = await nextOpenDay(addDays(istToday(), 2), { office: true });
    const recalled = (await load(processor, c.caseNo)).updatedAt;
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/passports-back`).send({ collectedOn: istToday(), expectedOn, updatedAt: recalled })).status).toBe(200);
    const inTransit = (await load(processor, c.caseNo)).updatedAt;
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/passports-received`).send({ booklets: { current: 2, old: 0 }, stickers: [], updatedAt: inTransit })).status).toBe(200);
    const res = await handOver(processor, c.caseNo);
    expect(res.status).toBe(200);
    expect(res.body.case).toMatchObject({ stage: { code: "DELIVERED" }, status: "CLOSED" });
  });
});

describe("whoever is at the desk (Decision 5)", () => {
  it("any Visa staff with EDIT opens and hands over a case whose passports are in our stock, and only that", async () => {
    const before = await decidedCase();
    await createUser({ name: "Kiran Desai", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    const kiran = await loginAs("kiran@masti.test");
    // Not in our stock yet: someone else's case, as before.
    expect((await kiran.get(`/api/visa/cases/${before.c.caseNo}`)).status).toBe(403);

    const { c } = await receivedCase({ extra: { mobile: "98250 41237", clientName: "Sunil Shah" }, vendorId: before.c.vendor.id });
    expect((await kiran.get(`/api/visa/cases/${c.caseNo}`)).status).toBe(200);
    const list = await kiran.get("/api/enquiries?department=VISA");
    expect(list.body.enquiries.map((e: { caseNo: string }) => e.caseNo)).toEqual([c.caseNo]);

    // Only the handover is theirs.
    const seen = await load(kiran, c.caseNo);
    const postpone = await kiran
      .post(`/api/enquiries/${c.caseNo}/postpone`)
      .send({ reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: addMonths(istToday(), 1), updatedAt: seen.updatedAt });
    expect(postpone.status).toBe(403);

    const res = await handOver(kiran, c.caseNo);
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).handover!.by!.name).toBe("Kiran Desai");
    // Delivered: back to the normal rule.
    expect((await kiran.get(`/api/visa/cases/${c.caseNo}`)).status).toBe(403);
    expect((await kiran.get("/api/enquiries?department=VISA&status=CLOSED")).body.enquiries).toEqual([]);
    expect((await (await neha()).get("/api/enquiries?department=VISA&status=CLOSED")).body.enquiries.map((e: { caseNo: string }) => e.caseNo)).toEqual([c.caseNo]);
  });

  it("not view-only users or other departments", async () => {
    const { c } = await receivedCase();
    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    await createUser({ name: "Hetal", email: "hetal@masti.test", departments: [{ code: "HOLIDAYS", access: "EDIT" }] });
    for (const email of ["meena@masti.test", "hetal@masti.test"]) {
      expect((await photo(await loginAs(email), c.caseNo)).status).toBe(403);
    }
  });
});

describe("what is refused", () => {
  it("a count that doesn't match our stock (Decision 4)", async () => {
    const { c, processor } = await receivedCase();
    const res = await handOver(processor, c.caseNo, { booklets: { current: 1, old: 0 } });
    expect(res.status).toBe(400);
    expect(res.body.issues.booklets).toEqual(["Count again: our stock has 2 current + 0 old. Find what's missing before handing over."]);
    expect((await handOver(processor, c.caseNo, { booklets: { current: 2, old: 1 } })).status).toBe(400);
    expect(await prisma.visaHandover.count()).toBe(0);
    expect((await load(processor, c.caseNo)).stage.code).toBe("PASSPORT_BACK");
  });

  it("who collected, and the photo", async () => {
    const { c, processor } = await receivedCase();
    const other = await receivedCase({ extra: { mobile: "98250 41236", clientName: "Kiran Bhatt" }, vendorId: c.vendor.id });
    const issue = async (body: Body, field: string) => {
      const res = await handOver(processor, c.caseNo, body);
      expect(res.status).toBe(400);
      return res.body.issues[field] as string[];
    };
    expect(await issue({ receiver: {} }, "receiver")).toEqual(["Pick who collected the passports."]);
    expect(await issue({ receiver: { travellerId: other.adult, name: "Sunita Patel" } }, "receiver")).toEqual(["Pick who collected the passports."]);
    expect(await issue({ receiver: { travellerId: other.adult } }, "receiver")).toEqual(["Pick someone on this case, or Someone else."]);
    expect(await issue({ receiver: { name: "R2-D2" } }, "receiver")).toEqual(["Use letters only (spaces and . ' - are fine)."]);
    const othersPhoto = (await photo(processor, other.c.caseNo)).body.photo.id;
    expect(await issue({ photoId: othersPhoto }, "photoId")).toEqual(["Take a photo of the person collecting."]);
    expect(await issue({ photoId: undefined }, "photoId")).toEqual(["Take a photo of the person collecting."]);
    expect(await issue({ mode: "DELIVERY" }, "mode")).toEqual(["The delivery boy hands over from his phone."]);
    expect(await prisma.visaHandover.count()).toBe(0);
  });

  it("a photo that isn't a JPEG or PNG, or is too big", async () => {
    const { c, processor } = await receivedCase();
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const notAPhoto = await photo(processor, c.caseNo, Buffer.from(await pdf.save()));
    expect(notAPhoto.status).toBe(400);
    expect(notAPhoto.body.message).toBe("This isn't a JPEG photo. Take it again.");
    expect((await photo(processor, c.caseNo, PNG, "image/jpeg")).status).toBe(400);
    expect((await photo(processor, c.caseNo, JPEG, "application/pdf")).status).toBe(415);

    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    expect((await (await loginAs("riya@masti.test")).put("/api/visa/settings").send({ handoverPhoto: { maxMb: 1 } })).status).toBe(200);
    const big = Buffer.concat([JPEG, Buffer.alloc(1024 * 1024 + 1)]);
    expect((await photo(processor, c.caseNo, big)).status).toBe(413);
    expect(await prisma.caseFile.count({ where: { kind: "RECEIVER_PHOTO" } })).toBe(0);
  });

  it("before the passports are in our stock, twice, and on a stale page", async () => {
    const { c, processor } = await decidedCase();
    const atDecision = await photo(processor, c.caseNo);
    expect(atDecision.status).toBe(409);
    expect(atDecision.body.message).toBe("Passports are handed over from Passport back.");
    const expectedOn = await nextOpenDay(addDays(istToday(), 2), { office: true });
    const decided = (await load(processor, c.caseNo)).updatedAt;
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/passports-back`).send({ collectedOn: istToday(), expectedOn, updatedAt: decided })).status).toBe(200);
    const inTransit = await photo(processor, c.caseNo);
    expect(inTransit.status).toBe(409);
    expect(inTransit.body.message).toBe("Mark the passports received first.");

    const received = await receivedCase({ extra: { mobile: "98250 41236", clientName: "Kiran Bhatt" }, vendorId: c.vendor.id });
    expect((await handOver(processor, received.c.caseNo, { updatedAt: "2026-01-01T00:00:00.000Z" })).body.details.code).toBe("STALE");
    expect((await handOver(processor, received.c.caseNo)).status).toBe(200);
    const twice = await photo(processor, received.c.caseNo);
    expect(twice.status).toBe(409);
    expect(twice.body.message).toBe("Passports are handed over from Passport back.");
  });
});

describe("afterwards", () => {
  it("a refusal letter can still be added at Delivered", async () => {
    const { c, processor, child } = await receivedCase();
    expect((await handOver(processor, c.caseNo)).status).toBe(200);
    const doc = await PDFDocument.create();
    doc.addPage();
    const letter = await processor
      .post(`/api/visa/cases/${c.caseNo}/travellers/${child}/refusal-letter`)
      .set("Content-Type", "application/pdf")
      .send(Buffer.from(await doc.save()));
    expect(letter.status).toBe(200);
  });
});

describe("the database", () => {
  it("keeps a photo without pages, one receiver, a photo, the door's job, the counts, and a closed case undue", async () => {
    const { c, adult } = await receivedCase();
    const neha = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
    const file =(data: Record<string, unknown>) =>
      prisma.caseFile.create({ data: { enquiryId: c.id, storageKey: `t/${Math.random()}`, fileName: "x", sizeBytes: 1, uploadedById: neha.id, ...data } as never });
    await expect(file({ kind: "RECEIVER_PHOTO", pageCount: 1 })).rejects.toThrow(/CaseFile_size_and_pages/);
    await expect(file({ kind: "FINAL_FILE", pageCount: null })).rejects.toThrow(/CaseFile_size_and_pages/);
    const pic = await file({ kind: "RECEIVER_PHOTO", pageCount: null });

    const handover = (data: Record<string, unknown>) =>
      prisma.visaHandover.create({
        data: { enquiryId: c.id, mode: "OFFICE", at: new Date(), byId: neha.id, bookletsCurrent: 2, bookletsOld: 0, receiverTravellerId: adult, receiverPhotoId: pic.id, ...data } as never,
      });
    await expect(handover({ receiverName: "Sunita Patel" })).rejects.toThrow(/VisaHandover_one_receiver/);
    await expect(handover({ receiverTravellerId: null })).rejects.toThrow(/VisaHandover_one_receiver/);
    await expect(handover({ receiverTravellerId: null, receiverName: " " })).rejects.toThrow(/VisaHandover_receiver_name/);
    // A handover at the door, and only one, points at the boy's job (0015 phase 5).
    await expect(handover({ mode: "DELIVERY" })).rejects.toThrow(/VisaHandover_field_job/);
    await expect(handover({ bookletsCurrent: 0 })).rejects.toThrow(/VisaHandover_booklets_range/);
    await handover({});
    // The photo is required for both kinds of handover (0015 phase 5).
    await expect(prisma.$executeRaw`UPDATE "VisaHandover" SET "receiverPhotoId" = NULL`).rejects.toThrow(/receiverPhotoId/);

    await expect(prisma.enquiry.update({ where: { id: c.id }, data: { status: "CLOSED", dueAt: new Date() } })).rejects.toThrow(/Enquiry_closed_not_due/);
  });
});
