import { HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it } from "vitest";
import { MB } from "../src/lib/pdf";
import { bucket, s3 } from "../src/lib/storage";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { jpegOf, padded, pngOf } from "./imageFiles";
import { saveCase, visaStaff, type Agent } from "./visaHelpers";

// The client document vault in visa Step 2 (docs/decisions/0016-client-documents.md Decision 5): "Save scan" keeps a
// traveller's paper in the client's vault (the test bucket, emptied by globalSetup); a paper that may be a xerox is
// ticked On file from the current copy; whoever can see the case opens that copy. The client page's side is in
// clientDocuments.test.ts.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

/** A 1×1 JPEG, as in company.test.ts. */
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

/** A real PDF with `pages` blank pages. */
async function pdf(pages: number) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return Buffer.from(await doc.save());
}

interface CaseDoc {
  id: string;
  name: string;
  requirement: string;
  status: string;
  receivedAs: string | null;
  onFile: { id: string; uploadedAt: string; contentType: string; pageCount: number | null; sizeBytes: number } | null;
  fromScan: { id: string; uploadedAt: string } | null;
  noScan: boolean;
  scanRules: Record<string, unknown>;
}
interface CaseDto {
  id: string;
  caseNo: string;
  client: { id: string };
  scanMaxMb: number;
  updatedAt: string;
  travellers: { id: string; name: string | null; done: number; documents: CaseDoc[] }[];
}

const BANK = "Bank statement, last 6 months";
const ITR = "ITR, last 3 years";
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const docOf = (c: CaseDto, name: string, traveller = 0) => c.travellers[traveller]!.documents.find((d) => d.name === name)!;
const tick = (agent: Agent, c: CaseDto, docId: string, body: Record<string, unknown>) =>
  agent.patch(`/api/visa/cases/${c.caseNo}/documents/${docId}`).send(body);
const onFile = { status: "RECEIVED", receivedAs: "ON_FILE" };
const saveScan = (agent: Agent, c: CaseDto, docId: string, body: Buffer | string, type = "application/pdf") =>
  agent.post(`/api/visa/cases/${c.caseNo}/documents/${docId}/scan`).set("Content-Type", type).send(body);
const openScan = (agent: Agent, c: CaseDto, docId: string) => agent.get(`/api/visa/cases/${c.caseNo}/documents/${docId}/scan/link`);
const objectsOf = async (clientId: string) =>
  (await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `clients/${clientId}/` }))).Contents ?? [];
const relationId = async (code: string) => (await prisma.relation.findUniqueOrThrow({ where: { code } })).id;

/** Aarti's France case (1 adult, 1 child) with the adult named as Rakesh Mehta; the child isn't named yet. */
async function linkedCase() {
  const staff = await visaStaff();
  const saved = await saveCase(staff);
  const member = await staff.post(`/api/clients/${saved.client.id}/members`).send({ name: "Rakesh Mehta", relationId: await relationId("SELF") });
  const rakesh = member.body.member.id as string;
  const c = await load(staff, saved.caseNo);
  expect((await staff.put(`/api/visa/cases/${c.caseNo}/travellers/${c.travellers[0]!.id}/member`).send({ memberId: rakesh })).status).toBe(200);
  return { staff, c: await load(staff, c.caseNo), rakesh };
}

describe("Save scan from the case", () => {
  it("keeps a named traveller's paper in the client's vault, audited with the case; the case then shows it on file", async () => {
    const { staff, c, rakesh } = await linkedCase();
    const file = await pdf(2);

    const res = await saveScan(staff, c, docOf(c, BANK).id, file);
    expect(res.status).toBe(200);
    const after = res.body.case as CaseDto;
    expect(docOf(after, BANK)).toMatchObject({
      status: "PENDING", // saving a scan doesn't tick the paper
      onFile: { contentType: "application/pdf", pageCount: 2, sizeBytes: file.length },
      fromScan: null,
    });
    expect(docOf(after, ITR).onFile).toBeNull();
    expect(docOf(after, "Birth certificate", 1).onFile).toBeNull();
    expect(after.scanMaxMb).toBe(20);

    const row = await prisma.clientDocument.findFirstOrThrow();
    const bankPaper = await prisma.documentMaster.findUniqueOrThrow({ where: { code: "BANK_STATEMENT_6M" } });
    expect(row).toMatchObject({ id: docOf(after, BANK).onFile!.id, clientId: c.client.id, memberId: rakesh, documentId: bankPaper.id });
    expect(await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: row.storageKey }))).toMatchObject({ ContentType: "application/pdf" });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "client.document.add", entityId: row.id } });
    expect(entry).toMatchObject({ clientId: c.client.id, after: { paper: BANK, person: "Rakesh Mehta", case: c.caseNo } });

    // It's in the client's vault, which the Visa HOD sees on the client page (a Holidays HOD doesn't: the family has
    // only a visa case, 0004 amendment 4).
    await createUser({ name: "Kiran Shah", email: "kiran@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await loginAs("kiran@masti.test");
    const vault = (await hod.get(`/api/clients/${c.client.id}/documents`)).body;
    expect(vault.groups).toHaveLength(1);
    expect(vault.groups[0]).toMatchObject({ member: { name: "Rakesh Mehta" }, papers: [{ paper: { name: BANK }, current: { id: row.id } }] });
  });

  it("is refused for a thing we arrange, an unnamed traveller, a wrong file, anyone who can't tick, after Step 2 and over the limit", async () => {
    const { staff, c } = await linkedCase();
    const bank = docOf(c, BANK).id;

    const arranged = await saveScan(staff, c, docOf(c, "Flight reservation").id, await pdf(1));
    expect(arranged.status).toBe(400);
    expect(arranged.body.message).toBe("We arrange this one, so it isn't kept in the client's documents.");
    const unnamed = await saveScan(staff, c, docOf(c, "Birth certificate", 1).id, await pdf(1));
    expect(unnamed.status).toBe(400);
    expect(unnamed.body.message).toBe("Name the traveller first: scans are kept per person.");

    expect((await saveScan(staff, c, bank, "hello", "text/plain")).status).toBe(415);
    const notPng = await saveScan(staff, c, bank, JPEG, "image/png");
    expect(notPng.status).toBe(400);
    expect(notPng.body.message).toMatch(/^This isn't a PNG image\./);

    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    await createUser({ name: "Kiran", email: "kiran.visa@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    expect((await saveScan(await loginAs("meena@masti.test"), c, bank, await pdf(1))).status).toBe(403);
    expect((await saveScan(await loginAs("kiran.visa@masti.test"), c, bank, await pdf(1))).status).toBe(403);

    await prisma.setting.create({ data: { key: "clients.documents", value: { maxMb: 1 } } });
    const big = await saveScan(staff, c, bank, Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(MB)]));
    expect(big.status).toBe(413);
    expect(big.body.message).toBe(`"${BANK}" can be at most 1 MB. Scan it at a lower resolution and upload it again.`);

    const filePrep = await prisma.departmentStage.findFirstOrThrow({ where: { code: "FILE_PREPARATION" } });
    await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: filePrep.id } });
    const late = await saveScan(staff, c, bank, await pdf(1));
    expect(late.status).toBe(409);
    expect(late.body.message).toBe("This case has moved past collecting documents.");

    expect(await prisma.clientDocument.count()).toBe(0);
    expect(await objectsOf(c.client.id)).toHaveLength(0);
  });

  it("sends each paper's upload rules with the case and refuses a scan they don't take (0016 Amendment 1)", async () => {
    const { staff, c } = await linkedCase();
    expect(docOf(c, "Photos").scanRules).toEqual({
      fileTypes: ["PDF", "JPG", "PNG"],
      minSizeMb: null,
      maxSizeMb: null,
      photoWidthMm: 35,
      photoHeightMm: 45,
    });
    // Read live from the document master, like the scan warning: a change reaches the open case.
    await prisma.documentMaster.update({ where: { code: "BANK_STATEMENT_6M" }, data: { fileTypes: ["PDF"], maxSizeMb: 2 } });
    const live = await load(staff, c.caseNo);
    expect(docOf(live, BANK).scanRules).toMatchObject({ fileTypes: ["PDF"], maxSizeMb: 2 });

    const png = await saveScan(staff, live, docOf(live, BANK).id, pngOf(70, 90), "image/png");
    expect(png.status).toBe(415);
    expect(png.body.message).toBe(`"${BANK}" must be a PDF. This file is a PNG.`);
    const square = await saveScan(staff, live, docOf(live, "Photos").id, padded(jpegOf(600, 600), 0.1 * MB), "image/jpeg");
    expect(square.status).toBe(400);
    expect(square.body.message).toMatch(/^"Photos" must have the shape of 35 × 45 mm\. This photo is 600 × 600 pixels/);
    expect(await objectsOf(c.client.id)).toHaveLength(0);

    expect((await saveScan(staff, live, docOf(live, BANK).id, await pdf(1))).status).toBe(200);
    expect((await saveScan(staff, live, docOf(live, "Photos").id, pngOf(70, 90), "image/png")).status).toBe(200);
  });
});

describe("On file (Decision 5)", () => {
  it("ticks a paper that may be a xerox from the current copy: received, naming the copy, audited", async () => {
    const { staff, c } = await linkedCase();
    const bank = docOf(c, BANK).id;
    await saveScan(staff, c, bank, await pdf(1));
    const current = docOf((await saveScan(staff, c, bank, await pdf(3))).body.case, BANK).onFile!;

    const res = await tick(staff, c, bank, onFile);
    expect(res.status).toBe(200);
    const ticked = res.body.case as CaseDto;
    expect(docOf(ticked, BANK)).toMatchObject({ status: "RECEIVED", receivedAs: "ON_FILE", fromScan: { id: current.id } });
    expect(ticked.travellers[0]!.done).toBe(c.travellers[0]!.done + 1);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.document.update", entityId: bank } });
    expect(entry.after).toMatchObject({ status: "RECEIVED", receivedAs: "ON_FILE", clientDocumentId: current.id });

    // The same tick again changes nothing.
    expect((await tick(staff, c, bank, onFile)).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "visa.document.update", entityId: bank } })).toBe(1);

    // A newer scan becomes the current copy; the paper keeps the copy it came from until it's ticked On file again.
    const newer = docOf((await saveScan(staff, c, bank, await pdf(5))).body.case, BANK);
    expect(newer.onFile!.id).not.toBe(current.id);
    expect(newer.fromScan!.id).toBe(current.id);
    expect(docOf((await tick(staff, c, bank, onFile)).body.case, BANK).fromScan!.id).toBe(newer.onFile!.id);

    // Ticked as a xerox instead: the link to the copy goes.
    expect(docOf((await tick(staff, c, bank, { status: "RECEIVED", receivedAs: "XEROX" })).body.case, BANK)).toMatchObject({
      receivedAs: "XEROX",
      fromScan: null,
    });
  });

  it("is refused for a paper needed as an original, a thing we arrange, a paper with no copy and an unnamed traveller", async () => {
    const { staff, c } = await linkedCase();
    const passport = docOf(c, "Passport").id;
    await saveScan(staff, c, passport, await pdf(1)); // a passport scan is kept, but never stands in for the passport

    const original = await tick(staff, c, passport, onFile);
    expect(original.status).toBe(400);
    expect(original.body.message).toBe("Only papers that may be a xerox can come from the copy on file.");
    expect((await tick(staff, c, docOf(c, "Flight reservation").id, onFile)).status).toBe(400);
    const none = await tick(staff, c, docOf(c, ITR).id, onFile);
    expect(none.status).toBe(400);
    expect(none.body.message).toBe(`There's no copy of "${ITR}" on file for Rakesh Mehta.`);
    const unnamed = await tick(staff, c, docOf(c, "Birth certificate", 1).id, onFile);
    expect(unnamed.status).toBe(400);
    expect(unnamed.body.message).toBe("Name the traveller first: copies on file are kept per person.");

    const after = await load(staff, c.caseNo);
    expect(after.travellers.flatMap((t) => t.documents).every((d) => d.status === "PENDING")).toBe(true);
  });

  it("puts a traveller's On file papers back to Pending when they're relinked to someone else", async () => {
    const { staff, c } = await linkedCase();
    await saveScan(staff, c, docOf(c, BANK).id, await pdf(1));
    await tick(staff, c, docOf(c, BANK).id, onFile);
    await tick(staff, c, docOf(c, ITR).id, { status: "RECEIVED", receivedAs: "XEROX" });

    const member = await staff.post(`/api/clients/${c.client.id}/members`).send({ name: "Priya Mehta", relationId: await relationId("SPOUSE") });
    const relinked = await staff.put(`/api/visa/cases/${c.caseNo}/travellers/${c.travellers[0]!.id}/member`).send({ memberId: member.body.member.id });
    expect(relinked.status).toBe(200);
    const after = relinked.body.case as CaseDto;
    expect(docOf(after, BANK)).toMatchObject({ status: "PENDING", receivedAs: null, fromScan: null, onFile: null });
    expect(docOf(after, ITR)).toMatchObject({ status: "RECEIVED", receivedAs: "XEROX" }); // a paper that came in stays
    const reset = await prisma.auditLog.findFirstOrThrow({
      where: { action: "visa.document.update", entityId: docOf(c, BANK).id },
      orderBy: { id: "desc" },
    });
    expect(reset).toMatchObject({ before: { receivedAs: "ON_FILE" }, after: { status: "PENDING", receivedAs: null, clientDocumentId: null } });
  });
});

describe("opening a copy from the case", () => {
  it("opens the copy for anyone who can see the case, audited; staff who can't see it are refused; 404 with no copy", async () => {
    const { staff, c } = await linkedCase();
    const bank = docOf(c, BANK).id;
    const file = await pdf(2);
    const scanId = docOf((await saveScan(staff, c, bank, file)).body.case, BANK).onFile!.id;

    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    const viewer = await loginAs("meena@masti.test");
    const link = await openScan(viewer, c, bank);
    expect(link.status).toBe(200);
    expect(link.body.url).toMatch(/X-Amz-Expires=300/);
    const opened = await fetch(link.body.url as string);
    expect(opened.status).toBe(200);
    expect(Buffer.from(await opened.arrayBuffer()).equals(file)).toBe(true);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "client.document.open", entityId: scanId } });
    expect(entry).toMatchObject({ clientId: c.client.id, after: { case: c.caseNo } });

    // Another Visa colleague who doesn't own the case can't see it.
    await createUser({ name: "Kiran", email: "kiran.visa@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    expect((await openScan(await loginAs("kiran.visa@masti.test"), c, bank)).status).toBe(403);

    const none = await openScan(staff, c, docOf(c, ITR).id);
    expect(none.status).toBe(404);
    expect(none.body.message).toBe("There's no copy of this paper on file.");
  });

  it("opens the copy an On file paper came from, even after a newer scan", async () => {
    const { staff, c } = await linkedCase();
    const bank = docOf(c, BANK).id;
    await saveScan(staff, c, bank, await pdf(1));
    const used = docOf((await tick(staff, c, bank, onFile)).body.case, BANK).fromScan!.id;
    await saveScan(staff, c, bank, await pdf(4));

    expect((await openScan(staff, c, bank)).status).toBe(200);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "client.document.open" } });
    expect(entry.entityId).toBe(used);
  });
});

describe("Scan not saved (Decision 7)", () => {
  const PASSPORT = "Passport";
  const original = { status: "RECEIVED", receivedAs: "ORIGINAL" };
  const xerox = { status: "RECEIVED", receivedAs: "XEROX" };
  const warnOn = (code: string) => prisma.documentMaster.update({ where: { code }, data: { warnIfNoScan: true } });

  it("warns on a paper ticked as an original or a xerox when the master asks for it, until a scan is saved", async () => {
    const { staff, c } = await linkedCase();
    expect(docOf(c, PASSPORT).noScan).toBe(false); // pending

    const ticked = (await tick(staff, c, docOf(c, PASSPORT).id, original)).body.case as CaseDto;
    expect(docOf(ticked, PASSPORT).noScan).toBe(true);
    expect(docOf((await tick(staff, c, docOf(c, BANK).id, xerox)).body.case, BANK).noScan).toBe(false); // the switch is off
    // The child isn't named yet, so nothing can be saved for them: no warning.
    expect(docOf((await tick(staff, c, docOf(c, PASSPORT, 1).id, original)).body.case, PASSPORT, 1).noScan).toBe(false);

    expect(docOf((await saveScan(staff, c, docOf(c, PASSPORT).id, await pdf(1))).body.case, PASSPORT).noScan).toBe(false);

    // Switched on for the bank statement later: cases already open warn too.
    await warnOn("BANK_STATEMENT_6M");
    expect(docOf(await load(staff, c.caseNo), BANK).noScan).toBe(true);
  });

  it("doesn't count a copy from before the case, and never warns for a paper ticked On file", async () => {
    const { staff, c } = await linkedCase();
    await warnOn("BANK_STATEMENT_6M");
    await saveScan(staff, c, docOf(c, PASSPORT).id, await pdf(1));
    await saveScan(staff, c, docOf(c, BANK).id, await pdf(1));
    const opened = await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id } });
    await prisma.clientDocument.updateMany({ data: { uploadedAt: new Date(opened.createdAt.getTime() - 60_000) } });

    await tick(staff, c, docOf(c, PASSPORT).id, original);
    await tick(staff, c, docOf(c, BANK).id, onFile);
    const after = await load(staff, c.caseNo);
    expect(docOf(after, PASSPORT)).toMatchObject({ noScan: true, onFile: { id: expect.any(String) } });
    expect(docOf(after, BANK)).toMatchObject({ receivedAs: "ON_FILE", noScan: false });
  });

  it("is a warning only: the documents can still be marked complete", async () => {
    const { staff, c } = await linkedCase();
    const aarav = await staff.post(`/api/clients/${c.client.id}/members`).send({ name: "Aarav Mehta", relationId: await relationId("SON") });
    await staff.put(`/api/visa/cases/${c.caseNo}/travellers/${c.travellers[1]!.id}/member`).send({ memberId: aarav.body.member.id });
    for (const t of (await load(staff, c.caseNo)).travellers) {
      for (const d of t.documents) {
        const body =
          d.requirement === "ARRANGED_BY_US"
            ? { status: "MADE" }
            : d.name.startsWith("Salary slips")
              ? { status: "NOT_NEEDED" }
              : d.requirement === "ORIGINAL"
                ? original
                : xerox;
        expect((await tick(staff, c, d.id, body)).status).toBe(200);
      }
    }
    const ready = await load(staff, c.caseNo);
    expect([0, 1].map((i) => docOf(ready, PASSPORT, i).noScan)).toEqual([true, true]);

    const res = await staff.post(`/api/visa/cases/${c.caseNo}/mature`).send({ updatedAt: ready.updatedAt });
    expect(res.status).toBe(200);
  });
});

describe("the database", () => {
  it("refuses On file without its copy, a copy without On file, and On file for a paper needed as an original", async () => {
    const { staff, c } = await linkedCase();
    const scanId = docOf((await saveScan(staff, c, docOf(c, BANK).id, await pdf(1))).body.case, BANK).onFile!.id;
    const set = (name: string, data: Record<string, unknown>) =>
      prisma.visaCaseDocument.update({ where: { id: docOf(c, name).id }, data: { status: "RECEIVED", ...data } });

    await expect(set(BANK, { receivedAs: "ON_FILE" })).rejects.toThrow(/VisaCaseDocument_on_file\b/);
    await expect(set(BANK, { receivedAs: "XEROX", clientDocumentId: scanId })).rejects.toThrow(/VisaCaseDocument_on_file\b/);
    await expect(set("Passport", { receivedAs: "ON_FILE", clientDocumentId: scanId })).rejects.toThrow(/VisaCaseDocument_on_file_xerox/);
    await expect(set(BANK, { receivedAs: "ON_FILE", clientDocumentId: scanId })).resolves.toBeTruthy();
  });
});
