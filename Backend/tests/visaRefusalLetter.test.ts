import { HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, addMonths, istToday, toDbDate } from "../src/lib/dates";
import { bucket, getObject, s3 } from "../src/lib/storage";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { VISA_PARTLY_APPROVED, VISA_REFUSAL_LETTER } from "../src/modules/messages/messages.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { jpegOf, pngOf } from "./imageFiles";
import { decidedCase, holdCaseLock, untilWaitingOnLock, type Agent } from "./visaHelpers";

// Visa Step 6, the refusal letter (docs/decisions/0012-visa-decision.md Decision 4): a refused traveller's letter,
// scanned as one PDF, or a phone's JPEG or PNG kept as a one-page PDF (change request 21, part 2), in the test bucket
// (MinIO, emptied by globalSetup). Optional; added any time once the traveller is refused, whatever the case's status.
// A newer upload is current; a traveller changed to Approved keeps their letters, which the case then doesn't show.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface LetterDto {
  id: string;
  fileName: string;
  sizeBytes: number;
  pageCount: number;
  uploadedBy: { name: string };
  copies: number;
}
interface CaseDto {
  updatedAt: string;
  travellers: { id: string; refusalLetter: LetterDto | null }[];
}

const neha = () => loginAs("neha@masti.test");
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const reason = async (code: string) => (await prisma.enquiryReason.findUniqueOrThrow({ where: { code } })).id;
const FROM = addDays(istToday(), 20);
const TO = addDays(istToday(), 60);

/** A real PDF with `pages` blank pages. */
async function pdf(pages: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return Buffer.from(await doc.save());
}
const upload = (agent: Agent, caseNo: string, travellerId: string, body: Buffer, type = "application/pdf") =>
  agent.post(`/api/visa/cases/${caseNo}/travellers/${travellerId}/refusal-letter`).set("Content-Type", type).send(body);
const objectsOf = async (enquiryId: string) =>
  (await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `cases/${enquiryId}/refusal/` }))).Contents ?? [];
/** "Change" on one traveller's row, with the case's updatedAt as it is now. */
async function change(agent: Agent, caseNo: string, travellerId: string, body: Record<string, unknown>) {
  // Read first: a request awaited inside another's .send(...) breaks supertest.
  const { updatedAt } = await prisma.enquiry.findUniqueOrThrow({ where: { caseNo }, select: { updatedAt: true } });
  return agent.put(`/api/visa/cases/${caseNo}/travellers/${travellerId}/decision`).send({ ...body, updatedAt: updatedAt.toISOString() });
}

describe("the refusal letter (Decision 4)", () => {
  it("stores a refused traveller's PDF in the bucket: pages counted, named after the case and the traveller, audited", async () => {
    const { c, processor, child } = await decidedCase();
    const file = await pdf(2);
    const res = await upload(processor, c.caseNo, child, file);
    expect(res.status).toBe(200);
    const letter = (res.body.case as CaseDto).travellers[1]!.refusalLetter;
    expect(letter).toMatchObject({
      fileName: `${c.caseNo}_Aarav-Mehta_refusal.pdf`,
      pageCount: 2,
      sizeBytes: file.length,
      uploadedBy: { name: "Neha Joshi" },
      copies: 1,
    });
    expect((res.body.case as CaseDto).travellers[0]!.refusalLetter).toBeNull();

    const row = await prisma.caseFile.findFirstOrThrow({ where: { kind: "REFUSAL_LETTER" } });
    expect(row).toMatchObject({ enquiryId: c.id, travellerId: child, id: letter!.id });
    expect(row.storageKey).toMatch(new RegExp(`^cases/${c.id}/refusal/[0-9a-f-]{36}\\.pdf$`));
    const stored = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: row.storageKey }));
    expect(stored).toMatchObject({ ContentLength: file.length, ContentType: "application/pdf" });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.file.upload", entityId: row.id } });
    expect(entry).toMatchObject({
      clientId: c.client.id,
      after: { kind: "REFUSAL_LETTER", traveller: "Aarav Mehta", fileName: row.fileName, pageCount: 2, replaces: null },
    });
    // It's not the case's final file, nor counted with it.
    const whole = (await processor.get(`/api/visa/cases/${c.caseNo}`)).body.case;
    expect(whole.finalFile.id).not.toBe(row.id);
    expect(whole.finalFileCopies).toBe(1);

    // Opened like any case file: a short-lived link, audited.
    const link = await processor.get(`/api/visa/cases/${c.caseNo}/files/${row.id}/link`);
    expect(link.status).toBe(200);
    expect(link.body.url).toMatch(/X-Amz-Expires=300/);
    expect(await prisma.auditLog.count({ where: { action: "visa.file.open", entityId: row.id } })).toBe(1);
  });

  it("keeps a JPEG or PNG photo as a one-page PDF, named and stored like any letter, the photo noted in the audit", async () => {
    const { c, processor, child } = await decidedCase();
    // A phone photo shot on its side (EXIF 6): turned upright onto a portrait page.
    const res = await upload(processor, c.caseNo, child, jpegOf(400, 300, 6), "image/jpeg");
    expect(res.status).toBe(200);
    const letter = (res.body.case as CaseDto).travellers[1]!.refusalLetter!;
    expect(letter).toMatchObject({ fileName: `${c.caseNo}_Aarav-Mehta_refusal.pdf`, pageCount: 1, copies: 1 });
    const row = await prisma.caseFile.findUniqueOrThrow({ where: { id: letter.id } });
    expect(row.storageKey).toMatch(new RegExp(`^cases/${c.id}/refusal/[0-9a-f-]{36}\\.pdf$`));
    const stored = await getObject(row.storageKey);
    expect(row.sizeBytes).toBe(stored.length);
    expect(await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: row.storageKey }))).toMatchObject({ ContentType: "application/pdf" });
    const page = (await PDFDocument.load(stored)).getPage(0).getSize();
    expect(page.height).toBeGreaterThan(page.width);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.file.upload", entityId: row.id } });
    expect(entry.after).toMatchObject({ kind: "REFUSAL_LETTER", pageCount: 1, photo: "image/jpeg" });

    const png = await upload(processor, c.caseNo, child, pngOf(40, 30), "image/png");
    expect(png.status).toBe(200);
    expect((png.body.case as CaseDto).travellers[1]!.refusalLetter).toMatchObject({ pageCount: 1, copies: 2 });
    // A PDF sent as a PDF isn't marked as a photo.
    const plain = await upload(processor, c.caseNo, child, await pdf(1));
    const plainEntry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.file.upload", entityId: (plain.body.case as CaseDto).travellers[1]!.refusalLetter!.id } });
    expect(plainEntry.after).not.toHaveProperty("photo");
  });

  it("makes a newer upload the current letter and keeps the older one", async () => {
    const { c, processor, child } = await decidedCase();
    const first = (await upload(processor, c.caseNo, child, await pdf(1))).body.case.travellers[1].refusalLetter as LetterDto;
    const res = await upload(processor, c.caseNo, child, await pdf(3));
    expect(res.status).toBe(200);
    const current = (res.body.case as CaseDto).travellers[1]!.refusalLetter!;
    expect(current).toMatchObject({ pageCount: 3, copies: 2 });
    expect(current.id).not.toBe(first.id);
    expect(await objectsOf(c.id)).toHaveLength(2);
    const second = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.file.upload", entityId: current.id } });
    expect(second.after).toMatchObject({ replaces: first.id });
  });

  it("is kept but not shown once the traveller is changed to Approved, and shows again when changed back", async () => {
    const { c, processor, child } = await decidedCase();
    const letter = (await upload(processor, c.caseNo, child, await pdf(1))).body.case.travellers[1].refusalLetter as LetterDto;

    const approve = await change(processor, c.caseNo, child, { outcome: "APPROVED", visaNo: "0182 4472", validFrom: FROM, validTo: TO });
    expect(approve.status).toBe(200);
    expect((approve.body.case as CaseDto).travellers[1]!.refusalLetter).toBeNull();
    expect(await prisma.caseFile.count({ where: { travellerId: child } })).toBe(1);
    expect(await objectsOf(c.id)).toHaveLength(1);
    // An approved traveller gets no letter.
    const refused = await upload(processor, c.caseNo, child, await pdf(1));
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe("Aarav Mehta wasn't refused, so there's no refusal letter to add.");

    const back = await change(processor, c.caseNo, child, { outcome: "REFUSED" });
    expect((back.body.case as CaseDto).travellers[1]!.refusalLetter).toMatchObject({ id: letter.id, copies: 1 });
  });

  it("can be added whatever the case's status: postponed, or cancelled", async () => {
    const { c, processor, child } = await decidedCase();
    await prisma.enquiry.update({
      where: { id: c.id },
      data: { status: "POSTPONED", reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: toDbDate(addMonths(istToday(), 1)) },
    });
    expect((await upload(processor, c.caseNo, child, await pdf(1))).status).toBe(200);
    await prisma.enquiry.update({ where: { id: c.id }, data: { status: "CANCELLED", reasonId: await reason("TRIP_CANCELLED"), resumeOn: null, dueAt: null } });
    const res = await upload(processor, c.caseNo, child, await pdf(1));
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).travellers[1]!.refusalLetter!.copies).toBe(2);
    // Changing the decision still needs the case open, at Decision.
    expect((await change(processor, c.caseNo, child, { outcome: "APPROVED", visaNo: "0182 4472", validFrom: FROM, validTo: TO })).status).toBe(409);
  });
});

describe("the message to the client (change request 21 part 3)", () => {
  const sent = () => prisma.outboundMessage.findMany({ where: { template: { code: VISA_REFUSAL_LETTER } }, orderBy: { createdAt: "asc" } });

  it("each upload sends message 22 with its PDF, after the decision's message: a replacement too, whatever the case's status", async () => {
    const { c, processor, adult, child } = await decidedCase();
    const first = (await upload(processor, c.caseNo, child, await pdf(1))).body.case.travellers[1].refusalLetter as LetterDto;
    const [message] = await sent();
    expect(message).toMatchObject({
      idempotencyKey: `${VISA_REFUSAL_LETTER}:${first.id}`,
      enquiryId: c.id,
      clientId: c.client.id,
      attachmentId: first.id,
      status: "QUEUED",
      variables: expect.objectContaining({ traveller_name: "Aarav Mehta", case_no: c.caseNo }),
    });
    expect(message!.body).toContain(`The refusal letter for Aarav Mehta's France tourist visa (${c.caseNo}) is attached.`);
    const decision = await prisma.outboundMessage.findFirstOrThrow({ where: { template: { code: VISA_PARTLY_APPROVED } } });
    expect(decision.createdAt.getTime()).toBeLessThanOrEqual(message!.createdAt.getTime());

    // A replacement goes too, on a cancelled case as well; a refused upload sends nothing.
    await prisma.enquiry.update({ where: { id: c.id }, data: { status: "CANCELLED", reasonId: await reason("TRIP_CANCELLED"), resumeOn: null, dueAt: null } });
    const second = (await upload(processor, c.caseNo, child, await pdf(2))).body.case.travellers[1].refusalLetter as LetterDto;
    expect((await upload(processor, c.caseNo, adult, await pdf(1))).status).toBe(409);
    expect((await sent()).map((m) => m.attachmentId)).toEqual([first.id, second.id]);
  });
});

describe("what is refused", () => {
  it("before the decision, an approved traveller, another case's traveller, and anything that isn't a good PDF or photo", async () => {
    const { c, processor, adult, child } = await decidedCase({ decided: false });
    const early = await upload(processor, c.caseNo, child, await pdf(1));
    expect(early.status).toBe(409);
    expect(early.body.message).toBe("A refusal letter is added once the decision is recorded.");

    const other = await decidedCase({ extra: { mobile: "98250 41239", clientName: "Sunil Shah" }, vendorId: c.vendor.id });
    expect((await upload(processor, other.c.caseNo, other.adult, await pdf(1))).status).toBe(409);
    expect((await upload(processor, other.c.caseNo, child, await pdf(1))).status).toBe(404);
    expect(adult).not.toBe(other.adult);

    const bad = async (body: Buffer, message: RegExp, type?: string) => {
      const res = await upload(processor, other.c.caseNo, other.child, body, type);
      expect(res.body.message).toMatch(message);
      return res.status;
    };
    expect(await bad(Buffer.alloc(0), /Pick the PDF/)).toBe(400);
    expect(await bad(Buffer.from("just some text"), /isn't a PDF/)).toBe(400);
    expect(await bad(Buffer.from("%PDF-1.7\nthis is not really a pdf"), /can't be opened/)).toBe(400);
    // A photo must be what it's sent as, and readable.
    expect(await bad(Buffer.alloc(0), /Pick the file/, "image/jpeg")).toBe(400);
    expect(await bad(await pdf(1), /isn't a PNG/, "image/png")).toBe(400);
    expect(await bad(jpegOf(40, 30), /isn't a PNG/, "image/png")).toBe(400);
    expect(await bad(Buffer.from([0xff, 0xd8, 0xff, 0x00]), /can't be read/, "image/jpeg")).toBe(400);
    const json = await processor.post(`/api/visa/cases/${other.c.caseNo}/travellers/${other.child}/refusal-letter`).send({ file: "x" });
    expect(json.status).toBe(415);
    expect(json.body.message).toBe("Upload a PDF, JPEG or PNG.");

    // The limit is WhatsApp's 16 MB ⚠️, under the final file's 50 (part 3 sends the letter), or the final file's when lower.
    expect(await bad(Buffer.concat([await pdf(1), Buffer.alloc(16.2 * 1024 * 1024)]), /over 16 MB/)).toBe(413);
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    expect((await (await loginAs("riya@masti.test")).put("/api/visa/settings").send({ finalFile: { maxMb: 1 } })).status).toBe(200);
    const big = Buffer.concat([await pdf(1), Buffer.alloc(1.2 * 1024 * 1024)]);
    expect(await bad(big, /over 1 MB/)).toBe(413);

    expect(await prisma.caseFile.count({ where: { kind: "REFUSAL_LETTER" } })).toBe(0);
    expect(await objectsOf(c.id)).toHaveLength(0);
    expect(await objectsOf(other.c.id)).toHaveLength(0);
  });

  it("removes the stored copy when the traveller was changed to Approved while the upload waited", async () => {
    const { c, processor, child } = await decidedCase();
    const approve = holdCaseLock(c.id, (tx) =>
      tx.visaCaseTraveller.update({ where: { id: child }, data: { outcome: "APPROVED", visaNo: "0182 4472", validFrom: toDbDate(FROM), validTo: toDbDate(TO) } }),
    );
    await approve.ready;
    const pending = upload(processor, c.caseNo, child, await pdf(1)).then((r) => r);
    try {
      await untilWaitingOnLock();
    } finally {
      approve.release();
    }
    await approve.done;
    const res = await pending;
    expect(res.status).toBe(409);
    expect(await prisma.caseFile.count({ where: { kind: "REFUSAL_LETTER" } })).toBe(0);
    expect(await objectsOf(c.id)).toHaveLength(0);
  });
});

describe("who may upload it", () => {
  it("its processor, the Visa HOD and the Head; not other staff, view-only users or other departments", async () => {
    const { c, processor, child } = await decidedCase();
    await createUser({ name: "Kiran", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    await createUser({ name: "Hetal", email: "hetal@masti.test", departments: [{ code: "HOLIDAYS", access: "EDIT" }] });
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const file = await pdf(1);
    for (const email of ["kiran@masti.test", "meena@masti.test", "hetal@masti.test"]) {
      expect((await upload(await loginAs(email), c.caseNo, child, file)).status).toBe(403);
    }
    expect((await upload(processor, c.caseNo, child, file)).status).toBe(200);
    expect((await upload(await loginAs("riya@masti.test"), c.caseNo, child, file)).status).toBe(200);
    const head = await upload(await loginAs("vimal@masti.test"), c.caseNo, child, file);
    expect(head.status).toBe(200);
    expect((head.body.case as CaseDto).travellers[1]!.refusalLetter).toMatchObject({ copies: 3, uploadedBy: { name: "Vimal" } });
  });
});

describe("the database", () => {
  it("gives a refusal letter a traveller, and only a refusal letter", async () => {
    const { c, child } = await decidedCase();
    const neha = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
    const file = (data: Record<string, unknown>) =>
      prisma.caseFile.create({
        data: { enquiryId: c.id, storageKey: `cases/${c.id}/x/${Math.random()}.pdf`, fileName: "x.pdf", sizeBytes: 1, pageCount: 1, uploadedById: neha.id, kind: "FINAL_FILE", ...data },
      });
    await expect(file({ kind: "REFUSAL_LETTER" })).rejects.toThrow(/CaseFile_traveller/);
    await expect(file({ kind: "FINAL_FILE", travellerId: child })).rejects.toThrow(/CaseFile_traveller/);
    await file({ kind: "REFUSAL_LETTER", travellerId: child });
  });
});
