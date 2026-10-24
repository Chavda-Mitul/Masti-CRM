import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, istToday } from "../src/lib/dates";
import { bucket, s3 } from "../src/lib/storage";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { VISA_PARTLY_APPROVED, VISA_VISA_COPY } from "../src/modules/messages/messages.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { jpegOf } from "./imageFiles";
import { decidedCase, evisaCase, type Agent } from "./visaHelpers";

// The visa copy (docs/decisions/0012-visa-decision.md Decision 3, amended 24 Oct 2026, change request 21 part 2): an
// approved paper visa's visa page or approval letter, a PDF or a photo kept as one, in the test bucket (MinIO, emptied
// by globalSetup). Optional; added any time once the traveller is approved, whatever the case's status, like the
// refusal letter. An approved e-visa's file is its e-visa instead.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface FileDto {
  id: string;
  fileName: string;
  pageCount: number;
  uploadedBy: { name: string };
  copies: number;
}
interface CaseDto {
  travellers: { id: string; visaCopy: FileDto | null }[];
}

const FROM = addDays(istToday(), 20);
const TO = addDays(istToday(), 60);
const reason = async (code: string) => (await prisma.enquiryReason.findUniqueOrThrow({ where: { code } })).id;

/** A real PDF with `pages` blank pages. */
async function pdf(pages: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return Buffer.from(await doc.save());
}
const upload = (agent: Agent, caseNo: string, travellerId: string, body: Buffer, type = "application/pdf") =>
  agent.post(`/api/visa/cases/${caseNo}/travellers/${travellerId}/visa-copy`).set("Content-Type", type).send(body);
const objectsOf = async (enquiryId: string) =>
  (await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `cases/${enquiryId}/visa/` }))).Contents ?? [];
/** "Change" on one traveller's row, with the case's updatedAt as it is now. */
async function change(agent: Agent, caseNo: string, travellerId: string, body: Record<string, unknown>) {
  // Read first: a request awaited inside another's .send(...) breaks supertest.
  const { updatedAt } = await prisma.enquiry.findUniqueOrThrow({ where: { caseNo }, select: { updatedAt: true } });
  return agent.put(`/api/visa/cases/${caseNo}/travellers/${travellerId}/decision`).send({ ...body, updatedAt: updatedAt.toISOString() });
}

describe("the visa copy", () => {
  it("stores an approved paper traveller's PDF or photo, named after the case and the traveller, audited, opened like any file", async () => {
    const { c, processor, adult } = await decidedCase(); // Rakesh approved, Aarav refused
    const res = await upload(processor, c.caseNo, adult, await pdf(2));
    expect(res.status).toBe(200);
    const travellers = (res.body.case as CaseDto).travellers;
    expect(travellers[0]!.visaCopy).toMatchObject({ fileName: `${c.caseNo}_Rakesh-Mehta_visa.pdf`, pageCount: 2, copies: 1, uploadedBy: { name: "Neha Joshi" } });
    expect(travellers[1]!.visaCopy).toBeNull();

    const row = await prisma.caseFile.findFirstOrThrow({ where: { kind: "VISA_COPY" } });
    expect(row).toMatchObject({ enquiryId: c.id, travellerId: adult, id: travellers[0]!.visaCopy!.id });
    expect(row.storageKey).toMatch(new RegExp(`^cases/${c.id}/visa/[0-9a-f-]{36}\\.pdf$`));
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.file.upload", entityId: row.id } });
    expect(entry).toMatchObject({ clientId: c.client.id, after: { kind: "VISA_COPY", traveller: "Rakesh Mehta", pageCount: 2, replaces: null } });

    // A phone photo of the visa page: kept as a one-page PDF, the newer one current.
    const photo = await upload(processor, c.caseNo, adult, jpegOf(400, 300), "image/jpeg");
    expect(photo.status).toBe(200);
    expect((photo.body.case as CaseDto).travellers[0]!.visaCopy).toMatchObject({ pageCount: 1, copies: 2 });
    expect(await objectsOf(c.id)).toHaveLength(2);

    const link = await processor.get(`/api/visa/cases/${c.caseNo}/files/${row.id}/link`);
    expect(link.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "visa.file.open", entityId: row.id } })).toBe(1);
  });

  it("is kept but not shown once the traveller is changed to Refused, and shows again when approved again", async () => {
    const { c, processor, adult } = await decidedCase();
    const copy = (await upload(processor, c.caseNo, adult, await pdf(1))).body.case.travellers[0].visaCopy as FileDto;

    const refuse = await change(processor, c.caseNo, adult, { outcome: "REFUSED" });
    expect(refuse.status).toBe(200);
    expect((refuse.body.case as CaseDto).travellers[0]!.visaCopy).toBeNull();
    const refused = await upload(processor, c.caseNo, adult, await pdf(1));
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe("Rakesh Mehta wasn't approved, so there's no visa copy to add.");

    const back = await change(processor, c.caseNo, adult, { outcome: "APPROVED", visaNo: "0182 4479", validFrom: FROM, validTo: TO });
    expect((back.body.case as CaseDto).travellers[0]!.visaCopy).toMatchObject({ id: copy.id, copies: 1 });
  });

  it("can be added at Passport back and once delivered, whatever the case's status", async () => {
    const { c, processor, adult } = await decidedCase();
    const { departmentId } = await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id } });
    const stage = async (code: string) => (await prisma.departmentStage.findFirstOrThrow({ where: { departmentId, code } })).id;
    await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: await stage("PASSPORT_BACK") } });
    expect((await upload(processor, c.caseNo, adult, await pdf(1))).status).toBe(200);
    await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: await stage("DELIVERED"), status: "CLOSED", dueAt: null } });
    expect((await upload(processor, c.caseNo, adult, await pdf(1))).status).toBe(200);
    await prisma.enquiry.update({ where: { id: c.id }, data: { status: "CANCELLED", reasonId: await reason("TRIP_CANCELLED") } });
    const res = await upload(processor, c.caseNo, adult, await pdf(1));
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).travellers[0]!.visaCopy!.copies).toBe(3);
    // Each went to the client, the closed and cancelled case's too (change request 21 part 3).
    expect(await prisma.outboundMessage.count({ where: { template: { code: VISA_VISA_COPY } } })).toBe(3);
  });
});

describe("the message to the client (change request 21 part 3)", () => {
  it("each upload sends message 23 with its PDF, keyed by the file, after the decision's message: a replacement too", async () => {
    const { c, processor, adult } = await decidedCase();
    const first = (await upload(processor, c.caseNo, adult, await pdf(1))).body.case.travellers[0].visaCopy as FileDto;
    const second = (await upload(processor, c.caseNo, adult, jpegOf(400, 300), "image/jpeg")).body.case.travellers[0].visaCopy as FileDto;
    const sent = await prisma.outboundMessage.findMany({ where: { template: { code: VISA_VISA_COPY } }, orderBy: { createdAt: "asc" } });
    expect(sent.map((m) => m.attachmentId)).toEqual([first.id, second.id]);
    expect(sent[0]).toMatchObject({
      idempotencyKey: `${VISA_VISA_COPY}:${first.id}`,
      enquiryId: c.id,
      clientId: c.client.id,
      status: "QUEUED",
      variables: expect.objectContaining({ traveller_name: "Rakesh Mehta", case_no: c.caseNo }),
    });
    expect(sent[0]!.body).toContain(`A copy of Rakesh Mehta's France tourist visa (${c.caseNo}) is attached for your records.`);
    const decision = await prisma.outboundMessage.findFirstOrThrow({ where: { template: { code: VISA_PARTLY_APPROVED } } });
    expect(decision.createdAt.getTime()).toBeLessThanOrEqual(sent[0]!.createdAt.getTime());
  });
});

describe("what is refused", () => {
  it("before the decision, a refused traveller, another case's traveller, and a body that isn't a PDF, JPEG or PNG", async () => {
    const { c, processor, adult } = await decidedCase({ decided: false });
    const early = await upload(processor, c.caseNo, adult, await pdf(1));
    expect(early.status).toBe(409);
    expect(early.body.message).toBe("A visa copy is added once the decision is recorded.");

    const other = await decidedCase({ extra: { mobile: "98250 41239", clientName: "Sunil Shah" }, vendorId: c.vendor.id });
    const refused = await upload(processor, other.c.caseNo, other.child, await pdf(1));
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe("Aarav Mehta wasn't approved, so there's no visa copy to add.");
    expect((await upload(processor, other.c.caseNo, adult, await pdf(1))).status).toBe(404);
    const json = await processor.post(`/api/visa/cases/${other.c.caseNo}/travellers/${other.adult}/visa-copy`).send({ file: "x" });
    expect(json.status).toBe(415);
    expect(json.body.message).toBe("Upload a PDF, JPEG or PNG.");
    expect(await prisma.caseFile.count({ where: { kind: "VISA_COPY" } })).toBe(0);
  });

  it("an e-visa: its approval is the e-visa itself", async () => {
    const { c, processor, adult } = await evisaCase();
    const res = await upload(processor, c.caseNo, adult, await pdf(1));
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("This is an e-visa: add its PDF as the e-visa.");
    expect(await prisma.caseFile.count({ where: { kind: "VISA_COPY" } })).toBe(0);
  });
});

describe("who may upload it", () => {
  it("its processor, the Visa HOD and the Head; not other staff, view-only users or other departments", async () => {
    const { c, processor, adult } = await decidedCase();
    await createUser({ name: "Kiran", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    await createUser({ name: "Hetal", email: "hetal@masti.test", departments: [{ code: "HOLIDAYS", access: "EDIT" }] });
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const file = await pdf(1);
    for (const email of ["kiran@masti.test", "meena@masti.test", "hetal@masti.test"]) {
      expect((await upload(await loginAs(email), c.caseNo, adult, file)).status).toBe(403);
    }
    expect((await upload(processor, c.caseNo, adult, file)).status).toBe(200);
    expect((await upload(await loginAs("riya@masti.test"), c.caseNo, adult, file)).status).toBe(200);
    const head = await upload(await loginAs("vimal@masti.test"), c.caseNo, adult, file);
    expect((head.body.case as CaseDto).travellers[0]!.visaCopy).toMatchObject({ copies: 3, uploadedBy: { name: "Vimal" } });
  });
});

describe("the database", () => {
  it("gives a visa copy a traveller, as a refusal letter and an e-visa have", async () => {
    const { c, adult } = await decidedCase();
    const neha = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
    const file = (data: Record<string, unknown>) =>
      prisma.caseFile.create({
        data: { enquiryId: c.id, storageKey: `cases/${c.id}/x/${Math.random()}.pdf`, fileName: "x.pdf", sizeBytes: 1, pageCount: 1, uploadedById: neha.id, kind: "FINAL_FILE", ...data },
      });
    await expect(file({ kind: "VISA_COPY" })).rejects.toThrow(/CaseFile_traveller/);
    await expect(file({ kind: "VISA_COPY", travellerId: adult, pageCount: null })).rejects.toThrow(/CaseFile_size_and_pages/);
    await file({ kind: "VISA_COPY", travellerId: adult });
  });
});
