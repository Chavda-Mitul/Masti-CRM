import { HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, addMonths, istToday, toDbDate } from "../src/lib/dates";
import { bucket, s3 } from "../src/lib/storage";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { decidedCase, evisaCase, holdCaseLock, untilWaitingOnLock, type Agent } from "./visaHelpers";

// E-visas after the decision, part 1 (docs/decisions/0025-evisa-after-decision.md): at Decision, each approved
// traveller's e-visa is kept as one PDF in the test bucket (MinIO, emptied by globalSetup), and checked against the
// passport and what was recorded: Matches or Doesn't match (VisaCaseTraveller.stickerCheck). A newer upload is current
// and clears the check; Change keeps it while the entry stays as it was.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface FileDto {
  id: string;
  fileName: string;
  sizeBytes: number;
  pageCount: number;
  uploadedBy: { name: string };
  copies: number;
}
interface CaseDto {
  updatedAt: string;
  evisaMaxMb: number;
  travellers: { id: string; evisa: FileDto | null; stickerCheck: string | null; decision: { outcome: string; visaNo: string | null } | null }[];
}

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
  agent.post(`/api/visa/cases/${caseNo}/travellers/${travellerId}/evisa`).set("Content-Type", type).send(body);
const setCheck = (agent: Agent, caseNo: string, travellerId: string, fileId: string, check: string | null) =>
  agent.put(`/api/visa/cases/${caseNo}/travellers/${travellerId}/evisa-check`).send({ fileId, check });
const objectsOf = async (enquiryId: string) =>
  (await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `cases/${enquiryId}/evisa/` }))).Contents ?? [];
/** "Change" on one traveller's row, with the case's updatedAt as it is now. */
async function change(agent: Agent, caseNo: string, travellerId: string, body: Record<string, unknown>) {
  // Read first: a request awaited inside another's .send(...) breaks supertest.
  const { updatedAt } = await prisma.enquiry.findUniqueOrThrow({ where: { caseNo }, select: { updatedAt: true } });
  return agent.put(`/api/visa/cases/${caseNo}/travellers/${travellerId}/decision`).send({ ...body, updatedAt: updatedAt.toISOString() });
}
/** Rakesh's e-visa as recorded by evisaCase. */
const rakesh = { outcome: "APPROVED", visaNo: "EV-2026/88213", validFrom: FROM, validTo: TO };

describe("the e-visa PDF", () => {
  it("stores an approved traveller's PDF: pages counted, named after the case and the traveller, audited, opened by link", async () => {
    const { c, processor, adult } = await evisaCase();
    const file = await pdf(2);
    const res = await upload(processor, c.caseNo, adult, file);
    expect(res.status).toBe(200);
    const evisa = (res.body.case as CaseDto).travellers[0]!.evisa;
    expect(evisa).toMatchObject({
      fileName: `${c.caseNo}_Rakesh-Mehta_evisa.pdf`,
      pageCount: 2,
      sizeBytes: file.length,
      uploadedBy: { name: "Neha Joshi" },
      copies: 1,
    });
    expect((res.body.case as CaseDto).travellers[1]!.evisa).toBeNull();

    const row = await prisma.caseFile.findFirstOrThrow({ where: { kind: "EVISA" } });
    expect(row).toMatchObject({ enquiryId: c.id, travellerId: adult, id: evisa!.id });
    // The key ends in the file's name, so the link WhatsApp gets shows it (part 2).
    expect(row.storageKey).toMatch(new RegExp(`^cases/${c.id}/evisa/[0-9a-f-]{36}/${c.caseNo}_Rakesh-Mehta_evisa\\.pdf$`));
    const stored = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: row.storageKey }));
    expect(stored).toMatchObject({ ContentLength: file.length, ContentType: "application/pdf" });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.file.upload", entityId: row.id } });
    expect(entry).toMatchObject({
      clientId: c.client.id,
      after: { kind: "EVISA", traveller: "Rakesh Mehta", fileName: row.fileName, pageCount: 2, replaces: null, checkCleared: null },
    });

    const link = await processor.get(`/api/visa/cases/${c.caseNo}/files/${row.id}/link`);
    expect(link.status).toBe(200);
    expect(link.body.url).toMatch(/X-Amz-Expires=300/);
    expect(await prisma.auditLog.count({ where: { action: "visa.file.open", entityId: row.id } })).toBe(1);
  });

  it("makes a newer upload the current one, keeps the older one, and clears the check", async () => {
    const { c, processor, adult } = await evisaCase();
    const first = (await upload(processor, c.caseNo, adult, await pdf(1))).body.case.travellers[0].evisa as FileDto;
    expect((await setCheck(processor, c.caseNo, adult, first.id, "MATCHES")).status).toBe(200);

    const res = await upload(processor, c.caseNo, adult, await pdf(3));
    expect(res.status).toBe(200);
    const t = (res.body.case as CaseDto).travellers[0]!;
    expect(t.evisa).toMatchObject({ pageCount: 3, copies: 2 });
    expect(t.evisa!.id).not.toBe(first.id);
    expect(t.stickerCheck).toBeNull();
    expect(await objectsOf(c.id)).toHaveLength(2);
    const second = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.file.upload", entityId: t.evisa!.id } });
    expect(second.after).toMatchObject({ replaces: first.id, checkCleared: "MATCHES" });
  });

  it("is kept but not shown once the traveller is changed to Refused, and shows again when approved again", async () => {
    const { c, processor, child } = await evisaCase();
    const evisa = (await upload(processor, c.caseNo, child, await pdf(1))).body.case.travellers[1].evisa as FileDto;

    const refuse = await change(processor, c.caseNo, child, { outcome: "REFUSED" });
    expect(refuse.status).toBe(200);
    expect((refuse.body.case as CaseDto).travellers[1]!.evisa).toBeNull();
    expect(await prisma.caseFile.count({ where: { travellerId: child, kind: "EVISA" } })).toBe(1);
    const refused = await upload(processor, c.caseNo, child, await pdf(1));
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe("Aarav Mehta wasn't approved, so there's no e-visa to add.");

    const back = await change(processor, c.caseNo, child, { outcome: "APPROVED", visaNo: "EV-2026/88214", validFrom: FROM, validTo: TO });
    expect((back.body.case as CaseDto).travellers[1]!.evisa).toMatchObject({ id: evisa.id, copies: 1 });
  });
});

describe("the check against the passport", () => {
  it("is saved and audited, writes nothing when repeated, can be undone, and leaves the case's updatedAt alone", async () => {
    const { c, processor, adult } = await evisaCase();
    const evisa = (await upload(processor, c.caseNo, adult, await pdf(1))).body.case.travellers[0].evisa as FileDto;
    const before = await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id }, select: { updatedAt: true } });

    const res = await setCheck(processor, c.caseNo, adult, evisa.id, "MATCHES");
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).travellers[0]!.stickerCheck).toBe("MATCHES");
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.evisa.check", entityId: adult } });
    expect(entry).toMatchObject({
      clientId: c.client.id,
      before: { traveller: "Rakesh Mehta", check: null },
      after: { traveller: "Rakesh Mehta", check: "MATCHES", fileId: evisa.id, fileName: evisa.fileName },
    });
    expect((await setCheck(processor, c.caseNo, adult, evisa.id, "MATCHES")).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "visa.evisa.check" } })).toBe(1);

    expect((await setCheck(processor, c.caseNo, adult, evisa.id, "MISMATCH")).body.case.travellers[0].stickerCheck).toBe("MISMATCH");
    expect((await setCheck(processor, c.caseNo, adult, evisa.id, null)).body.case.travellers[0].stickerCheck).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "visa.evisa.check" } })).toBe(3);
    const after = await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id }, select: { updatedAt: true } });
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("needs a PDF, and refuses one that's no longer the current upload", async () => {
    const { c, processor, adult } = await evisaCase();
    const none = await setCheck(processor, c.caseNo, adult, "not-a-file", "MATCHES");
    expect(none.status).toBe(409);
    expect(none.body.message).toBe("Upload Rakesh Mehta's e-visa first, then check it.");

    const first = (await upload(processor, c.caseNo, adult, await pdf(1))).body.case.travellers[0].evisa as FileDto;
    await upload(processor, c.caseNo, adult, await pdf(2));
    const stale = await setCheck(processor, c.caseNo, adult, first.id, "MATCHES");
    expect(stale.status).toBe(409);
    expect(stale.body.message).toBe("A newer e-visa was uploaded: open it and check again.");
    expect((await processor.put(`/api/visa/cases/${c.caseNo}/travellers/${adult}/evisa-check`).send({ fileId: first.id, check: "MAYBE" })).status).toBe(400);
    expect(await prisma.visaCaseTraveller.count({ where: { stickerCheck: { not: null } } })).toBe(0);
  });

  it("stands through a Change that keeps the entry, and is cleared by one that changes it", async () => {
    const { c, processor, adult } = await evisaCase();
    const evisa = (await upload(processor, c.caseNo, adult, await pdf(1))).body.case.travellers[0].evisa as FileDto;
    await setCheck(processor, c.caseNo, adult, evisa.id, "MATCHES");

    const same = await change(processor, c.caseNo, adult, rakesh);
    expect(same.status).toBe(200);
    expect((same.body.case as CaseDto).travellers[0]!.stickerCheck).toBe("MATCHES");
    expect(await prisma.auditLog.count({ where: { action: "visa.decision.change" } })).toBe(0);

    // The check is made on the PDF's row, not in Change.
    const carried = await change(processor, c.caseNo, adult, { ...rakesh, stickerCheck: "MATCHES" });
    expect(carried.status).toBe(400);
    expect(carried.body.issues.decision).toEqual(["An e-visa is checked on its row, beside its PDF."]);

    const typo = await change(processor, c.caseNo, adult, { ...rakesh, visaNo: "EV-2026/88219" });
    expect(typo.status).toBe(200);
    expect((typo.body.case as CaseDto).travellers[0]!.stickerCheck).toBeNull();
    await setCheck(processor, c.caseNo, adult, evisa.id, "MATCHES");
    const refused = await change(processor, c.caseNo, adult, { outcome: "REFUSED" });
    expect((refused.body.case as CaseDto).travellers[0]!.stickerCheck).toBeNull();
  });
});

describe("what is refused", () => {
  it("before the decision", async () => {
    const { c, processor, adult } = await evisaCase({ decided: false });
    const res = await upload(processor, c.caseNo, adult, await pdf(1));
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("The e-visa is added once the decision is recorded.");
    expect(await objectsOf(c.id)).toHaveLength(0);
  });

  it("on a paper visa: its sticker is checked when the passports come back", async () => {
    const { c, processor, adult } = await decidedCase();
    const res = await upload(processor, c.caseNo, adult, await pdf(1));
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("This visa has a sticker, not an e-visa: it's checked when the passports come back.");
  });

  it("a refused traveller, someone not on the case, and anything that isn't a good PDF", async () => {
    const { c, processor, adult, child } = await evisaCase({ outcomes: ["APPROVED", "REFUSED"] });
    const notApproved = await upload(processor, c.caseNo, child, await pdf(1));
    expect(notApproved.status).toBe(409);
    expect(notApproved.body.message).toBe("Aarav Mehta wasn't approved, so there's no e-visa to add.");
    expect((await upload(processor, c.caseNo, "not-a-traveller", await pdf(1))).status).toBe(404);

    const bad = async (body: Buffer, message: RegExp, type?: string) => {
      const res = await upload(processor, c.caseNo, adult, body, type);
      expect(res.body.message).toMatch(message);
      return res.status;
    };
    expect(await bad(Buffer.alloc(0), /Pick the PDF/)).toBe(400);
    expect(await bad(Buffer.from("just some text"), /isn't a PDF/)).toBe(400);
    expect(await bad(Buffer.from("%PDF-1.7\nthis is not really a pdf"), /can't be opened/)).toBe(400);
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/travellers/${adult}/evisa`).send({ file: "x" })).status).toBe(415);
    // WhatsApp's limit, though the final file may be bigger…
    expect((await load(processor, c.caseNo)).evisaMaxMb).toBe(16);
    expect(await bad(Buffer.concat([await pdf(1), Buffer.alloc(16.2 * 1024 * 1024)]), /over 16 MB/)).toBe(413);
    // …and the final file's when it's lower.
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    expect((await (await loginAs("riya@masti.test")).put("/api/visa/settings").send({ finalFile: { maxMb: 1 } })).status).toBe(200);
    expect((await load(processor, c.caseNo)).evisaMaxMb).toBe(1);
    expect(await bad(Buffer.concat([await pdf(1), Buffer.alloc(1.2 * 1024 * 1024)]), /over 1 MB/)).toBe(413);

    expect(await prisma.caseFile.count({ where: { kind: "EVISA" } })).toBe(0);
    expect(await objectsOf(c.id)).toHaveLength(0);
  });

  it("on a postponed or cancelled case", async () => {
    const { c, processor, adult } = await evisaCase();
    const evisa = (await upload(processor, c.caseNo, adult, await pdf(1))).body.case.travellers[0].evisa as FileDto;
    await prisma.enquiry.update({
      where: { id: c.id },
      data: { status: "POSTPONED", reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: toDbDate(addMonths(istToday(), 1)) },
    });
    expect((await upload(processor, c.caseNo, adult, await pdf(1))).status).toBe(409);
    expect((await setCheck(processor, c.caseNo, adult, evisa.id, "MATCHES")).status).toBe(409);
    await prisma.enquiry.update({ where: { id: c.id }, data: { status: "CANCELLED", reasonId: await reason("TRIP_CANCELLED"), resumeOn: null, dueAt: null } });
    expect((await upload(processor, c.caseNo, adult, await pdf(1))).status).toBe(409);
    expect(await prisma.caseFile.count({ where: { kind: "EVISA" } })).toBe(1);
  });

  it("removes the stored copy when the traveller was changed to Refused while the upload waited", async () => {
    const { c, processor, adult } = await evisaCase();
    const refuse = holdCaseLock(c.id, (tx) =>
      tx.visaCaseTraveller.update({ where: { id: adult }, data: { outcome: "REFUSED", visaNo: null, validFrom: null, validTo: null } }),
    );
    await refuse.ready;
    const pending = upload(processor, c.caseNo, adult, await pdf(1)).then((r) => r);
    try {
      await untilWaitingOnLock();
    } finally {
      refuse.release();
    }
    await refuse.done;
    const res = await pending;
    expect(res.status).toBe(409);
    expect(await prisma.caseFile.count({ where: { kind: "EVISA" } })).toBe(0);
    expect(await objectsOf(c.id)).toHaveLength(0);
  });
});

describe("who may add and check it", () => {
  it("its processor, the Visa HOD and the Head; not other staff, view-only users or other departments", async () => {
    const { c, processor, adult } = await evisaCase();
    await createUser({ name: "Kiran", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    await createUser({ name: "Hetal", email: "hetal@masti.test", departments: [{ code: "HOLIDAYS", access: "EDIT" }] });
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const file = await pdf(1);
    const evisa = (await upload(processor, c.caseNo, adult, file)).body.case.travellers[0].evisa as FileDto;
    for (const email of ["kiran@masti.test", "meena@masti.test", "hetal@masti.test"]) {
      const agent = await loginAs(email);
      expect((await upload(agent, c.caseNo, adult, file)).status).toBe(403);
      expect((await setCheck(agent, c.caseNo, adult, evisa.id, "MATCHES")).status).toBe(403);
    }
    const riya = await loginAs("riya@masti.test");
    const hod = await upload(riya, c.caseNo, adult, file);
    expect(hod.status).toBe(200);
    const head = await loginAs("vimal@masti.test");
    const latest = (await upload(head, c.caseNo, adult, file)).body.case.travellers[0].evisa as FileDto;
    expect(latest).toMatchObject({ copies: 3, uploadedBy: { name: "Vimal" } });
    expect((await setCheck(head, c.caseNo, adult, latest.id, "MATCHES")).status).toBe(200);
    expect((await load(riya, c.caseNo)).travellers[0]!.stickerCheck).toBe("MATCHES");
  });
});

describe("the database", () => {
  it("gives a refusal letter or an e-visa a traveller, and only those", async () => {
    const { c, adult } = await evisaCase();
    const neha = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
    const file = (data: Record<string, unknown>) =>
      prisma.caseFile.create({
        data: { enquiryId: c.id, storageKey: `cases/${c.id}/x/${Math.random()}.pdf`, fileName: "x.pdf", sizeBytes: 1, pageCount: 1, uploadedById: neha.id, kind: "FINAL_FILE", ...data },
      });
    await expect(file({ kind: "EVISA" })).rejects.toThrow(/CaseFile_traveller/);
    await expect(file({ kind: "FINAL_FILE", travellerId: adult })).rejects.toThrow(/CaseFile_traveller/);
    await file({ kind: "EVISA", travellerId: adult });
  });
});
