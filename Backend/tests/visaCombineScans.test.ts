import { randomUUID } from "node:crypto";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it } from "vitest";
import { addMonths, istToday, toDbDate } from "../src/lib/dates";
import { boss, QUEUES } from "../src/lib/jobs";
import { bucket, getObject, putObject, s3 } from "../src/lib/storage";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { scansPdf } from "../src/modules/visa/scansPdf";
import { runCombineScansJob } from "../src/modules/visa/visaCombineScans.service";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { jpegOf, pngOf } from "./imageFiles";
import { dispatchCase, holdCaseLock, readyCase, saveCase, untilWaitingOnLock, visaStaff, type Agent } from "./visaHelpers";

// The case's scans combined into its saved file (docs/decisions/0008-visa-docket-dispatch.md Amendment 1, change
// request 20). "Mark documents complete" queues the job, and "File ready" again; the tests do its work by calling it,
// as no workers run here. "Combine again" is the route. Scans are kept straight in the vault (the test bucket and
// ClientDocument rows): saving them through the vault is tested in clientDocuments.test.ts and visaCaseScans.test.ts.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
  await boss.deleteAllJobs();
});

const BANK = "Bank statement, last 6 months";
const ITR = "ITR, last 3 years";
/** The passports' page size, so the file's pages show where each scan went. */
const PASSPORT_PAGE: [number, number] = [400, 500];
/** A4 portrait, in whole points: a photo's page. */
const A4: [number, number] = [595, 842];

interface CaseDto {
  updatedAt: string;
  stage: { code: string };
  finalFile: { id: string; fileName: string; pageCount: number; uploadedBy: { name: string } } | null;
  finalFileCopies: number;
  combinedScans: {
    needed: number;
    missing: { traveller: string; papers: string[] }[];
    file: { id: string; scanCount: number; pageCount: number; at: string; by: { id: string; name: string } } | null;
  } | null;
}

const neha = () => loginAs("neha@masti.test");
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
/** "Combine again", sent as JSON like the page does (requireJson). */
const combineAgain = (agent: Agent, caseNo: string) => agent.post(`/api/visa/cases/${caseNo}/scans/combine`).set("Content-Type", "application/json");
const relationId = async (code: string) => (await prisma.relation.findUniqueOrThrow({ where: { code } })).id;
const paperId = async (code: string) => (await prisma.documentMaster.findUniqueOrThrow({ where: { code } })).id;
const reasonId = async (code: string) => (await prisma.enquiryReason.findUniqueOrThrow({ where: { code } })).id;
const finalFiles = (enquiryId: string) =>
  prisma.caseFile.findMany({ where: { enquiryId, kind: "FINAL_FILE" }, orderBy: [{ uploadedAt: "asc" }, { id: "asc" }] });
const objectsUnder = async (prefix: string) => (await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }))).Contents ?? [];

/** A real PDF with `pages` blank pages, of `size` points. */
async function pdfOf(pages: number, size?: [number, number]) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage(size);
  return Buffer.from(await doc.save());
}

interface Scan {
  bytes: Buffer;
  contentType: string;
  pageCount: number | null;
}

/** A scan of a paper, as the scanner or a phone gives it: the passport a 2-page PDF, the photos a PNG, the rest JPEGs. */
async function scanFor(paper: string): Promise<Scan> {
  if (paper === "Passport") return { bytes: await pdfOf(2, PASSPORT_PAGE), contentType: "application/pdf", pageCount: 2 };
  if (paper === "Photos") return { bytes: pngOf(350, 450), contentType: "image/png", pageCount: null };
  return { bytes: jpegOf(1200, 1600), contentType: "image/jpeg", pageCount: null };
}

/** Keeps a scan in the client's vault, straight in the test bucket and the table, as Save scan would. */
async function keepScan(clientId: string, memberId: string, documentId: number, scan: Scan, uploadedById: string, uploadedAt?: Date) {
  const ext = scan.contentType === "application/pdf" ? "pdf" : scan.contentType === "image/png" ? "png" : "jpg";
  const storageKey = `clients/${clientId}/${randomUUID()}.${ext}`;
  await putObject(storageKey, scan.bytes, scan.contentType);
  return prisma.clientDocument.create({
    data: {
      clientId,
      memberId,
      documentId,
      storageKey,
      fileName: `scan.${ext}`,
      contentType: scan.contentType,
      sizeBytes: scan.bytes.length,
      pageCount: scan.pageCount,
      uploadedById,
      ...(uploadedAt ? { uploadedAt } : {}),
    },
  });
}

/**
 * Mehta's France case at Docket & dispatch (dispatchCase: Neha's; Rakesh and his son, every paper in or made, the
 * salary slips not needed; a saved file uploaded), Rakesh linked to his family member and his son to Aarav's, and a
 * scan of every paper that came in (scanFor). `skip` leaves papers unscanned (by name and traveller position, 1 for
 * Rakesh, 2 for his son); `linkChild: false` leaves the son unnamed. `at: "prep"` leaves it at File preparation with
 * Step 3 done (readyCase), and `withUpload: false` without the saved file uploaded. Another case in the same test needs
 * `vendorId` (a vendor's name is unique) and its own client in `extra`.
 */
async function scannedCase({
  skip = () => false,
  linkChild = true,
  at = "dispatch",
  withUpload = true,
  vendorId,
  extra,
}: {
  skip?: (paper: string, position: number) => boolean;
  linkChild?: boolean;
  at?: "prep" | "dispatch";
  withUpload?: boolean;
  vendorId?: number;
  extra?: Record<string, unknown>;
} = {}) {
  const options = { ...(vendorId ? { vendorId } : {}), ...(extra ? { extra } : {}) };
  const c = at === "prep" ? await readyCase(options) : await dispatchCase(options);
  if (!withUpload) await prisma.caseFile.delete({ where: { id: c.file.id } });
  const nehaUser = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
  const [adult, child] = await prisma.visaCaseTraveller.findMany({ where: { caseId: c.id }, orderBy: { position: "asc" } });
  const member = { clientId: c.client.id, createdById: nehaUser.id };
  const rakesh = await prisma.clientMember.create({ data: { ...member, name: "Rakesh Mehta", relationId: await relationId("SELF") } });
  await prisma.visaCaseTraveller.update({ where: { id: adult!.id }, data: { memberId: rakesh.id } });
  if (linkChild) {
    const aarav = await prisma.clientMember.create({ data: { ...member, name: "Aarav Mehta", relationId: await relationId("SON"), sortOrder: 1 } });
    await prisma.visaCaseTraveller.update({ where: { id: child!.id }, data: { memberId: aarav.id } });
  }
  const papers = await prisma.visaCaseDocument.findMany({
    where: { traveller: { caseId: c.id }, status: "RECEIVED" },
    include: { traveller: { select: { position: true, memberId: true } } },
  });
  for (const p of papers) {
    if (!p.traveller.memberId || skip(p.name, p.traveller.position)) continue;
    await keepScan(c.client.id, p.traveller.memberId, p.documentId, await scanFor(p.name), nehaUser.id);
  }
  return { ...c, neha: nehaUser, rakesh: rakesh.id };
}

/** The case's paper `name` of the traveller at `position`. */
const paperOf = (caseId: string, name: string, position = 1) =>
  prisma.visaCaseDocument.findFirstOrThrow({ where: { name, traveller: { caseId, position } } });

/** Each page's size in whole points. */
async function pageSizes(storageKey: string) {
  const pdf = await PDFDocument.load(await getObject(storageKey));
  return pdf.getPages().map((page) => {
    const { width, height } = page.getSize();
    return [Math.round(width), Math.round(height)];
  });
}

describe("combining the scans", () => {
  it('"Mark documents complete" queues the job, for the case and whoever pressed it', async () => {
    const staff = await visaStaff();
    const saved = await saveCase(staff);
    const base = `/api/visa/cases/${saved.caseNo}`;
    expect((await staff.post(`${base}/start`).set("Content-Type", "application/json")).status).toBe(200);
    const travellers = (await staff.get(base)).body.case.travellers as { id: string; documents: { id: string; requirement: string }[] }[];
    for (const [i, [name, relation]] of [
      ["Rakesh Mehta", "SELF"],
      ["Aarav Mehta", "SON"],
    ].entries()) {
      const member = await staff.post(`/api/clients/${saved.client.id}/members`).send({ name, relationId: await relationId(relation!) });
      expect((await staff.put(`${base}/travellers/${travellers[i]!.id}/member`).send({ memberId: member.body.member.id })).status).toBe(200);
    }
    for (const d of travellers.flatMap((t) => t.documents)) {
      const body = d.requirement === "ARRANGED_BY_US" ? { status: "MADE" } : { status: "RECEIVED", receivedAs: d.requirement === "ORIGINAL" ? "ORIGINAL" : "XEROX" };
      expect((await staff.patch(`${base}/documents/${d.id}`).send(body)).status).toBe(200);
    }
    const updatedAt = (await staff.get(base)).body.case.updatedAt as string;
    expect((await staff.post(`${base}/mature`).send({ updatedAt })).status).toBe(200);

    const aarti = await prisma.user.findUniqueOrThrow({ where: { email: "aarti@masti.test" } });
    const jobs = await boss.findJobs(QUEUES.visaCombineScans, { data: { enquiryId: saved.id } });
    expect(jobs.map((j) => j.data)).toEqual([{ enquiryId: saved.id, userId: aarti.id }]);
  });

  it("at file preparation the combined PDF is the saved file, so File ready needs no upload; File ready's job then leaves it", async () => {
    const c = await scannedCase({ at: "prep", withUpload: false });
    const processor = await neha();
    expect((await load(processor, c.caseNo)).combinedScans).toEqual({ needed: 14, missing: [], file: null });

    await runCombineScansJob({ enquiryId: c.id, userId: c.neha.id });
    const [combined] = await finalFiles(c.id);
    expect(combined).toMatchObject({ fileName: `${c.caseNo}_Mehta_scans.pdf`, scanCount: 14, pageCount: 16 });
    const shown = await load(processor, c.caseNo);
    expect(shown.finalFile?.id).toBe(combined!.id);
    expect(shown.combinedScans?.file?.id).toBe(combined!.id);

    expect((await processor.post(`/api/visa/cases/${c.caseNo}/file-ready`).send({ updatedAt: shown.updatedAt })).status).toBe(200);
    await runCombineScansJob({ enquiryId: c.id, userId: c.neha.id });
    expect(await finalFiles(c.id)).toHaveLength(1);
  });

  it("an upload after it is the current saved file; the case still shows the combined copy, which isn't made again", async () => {
    const c = await scannedCase({ at: "prep", withUpload: false });
    await runCombineScansJob({ enquiryId: c.id, userId: c.neha.id });
    const [combined] = await finalFiles(c.id);
    const processor = await neha();
    const uploaded = await processor.post(`/api/visa/cases/${c.caseNo}/files/final`).set("Content-Type", "application/pdf").send(await pdfOf(3));
    expect(uploaded.status).toBe(200);

    const shown = await load(processor, c.caseNo);
    expect(shown.finalFile).toMatchObject({ fileName: `${c.caseNo}_Mehta_file.pdf`, pageCount: 3 });
    expect(shown.finalFileCopies).toBe(2);
    expect(shown.combinedScans?.file?.id).toBe(combined!.id);
    expect((await combineAgain(processor, c.caseNo)).status).toBe(409);
  });

  it('"File ready" queues the job, for the case and whoever pressed it', async () => {
    const c = await readyCase();
    const processor = await neha();
    const seen = (await load(processor, c.caseNo)).updatedAt;
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/file-ready`).send({ updatedAt: seen })).status).toBe(200);

    const nehaUser = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
    const jobs = await boss.findJobs(QUEUES.visaCombineScans, { data: { enquiryId: c.id } });
    expect(jobs.map((j) => j.data)).toEqual([{ enquiryId: c.id, userId: nehaUser.id }]);
  });

  it("with every scan there, makes one PDF in the travellers' and the checklist's order, the newest saved file, audited; the upload stays", async () => {
    const c = await scannedCase();
    await runCombineScansJob({ enquiryId: c.id, userId: c.neha.id });

    const [upload, combined] = await finalFiles(c.id);
    expect(upload!.id).toBe(c.file.id);
    // 14 papers came in: Rakesh's 7 and his son's 7. The passports are 2 pages each.
    expect(combined).toMatchObject({ fileName: `${c.caseNo}_Mehta_scans.pdf`, scanCount: 14, pageCount: 16, uploadedById: c.neha.id });
    expect(combined!.storageKey).toMatch(new RegExp(`^cases/${c.id}/final/[0-9a-f-]+\\.pdf$`));
    // Rakesh's passport first, then his other 6 papers (each photo on an A4 page), then his son's passport and his 6.
    expect(await pageSizes(combined!.storageKey)).toEqual([
      PASSPORT_PAGE,
      PASSPORT_PAGE,
      ...Array<[number, number]>(6).fill(A4),
      PASSPORT_PAGE,
      PASSPORT_PAGE,
      ...Array<[number, number]>(6).fill(A4),
    ]);

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.file.combine" } });
    expect(entry).toMatchObject({
      actorId: c.neha.id,
      entityType: "CaseFile",
      entityId: combined!.id,
      clientId: c.client.id,
      after: { fileName: combined!.fileName, scanCount: 14, pageCount: 16, replaces: upload!.id, auto: true },
    });
    expect((entry.after as { scans: string[] }).scans).toHaveLength(14);

    const shown = await load(await neha(), c.caseNo);
    expect(shown.finalFile).toMatchObject({ id: combined!.id, fileName: combined!.fileName, pageCount: 16, uploadedBy: { name: "Neha Joshi" } });
    expect(shown.finalFileCopies).toBe(2);
    expect(shown.combinedScans).toEqual({
      needed: 14,
      missing: [],
      file: { id: combined!.id, scanCount: 14, pageCount: 16, at: combined!.uploadedAt.toISOString(), by: { id: c.neha.id, name: "Neha Joshi" } },
    });
  });

  it("with a scan missing, makes nothing; the case lists whose are missing, and Combine again is refused with them", async () => {
    const c = await scannedCase({ skip: (paper, position) => (position === 1 && paper === BANK) || (position === 2 && paper === "Passport") });
    await runCombineScansJob({ enquiryId: c.id, userId: c.neha.id });
    expect(await finalFiles(c.id)).toHaveLength(1);
    expect(await objectsUnder(`cases/${c.id}/`)).toHaveLength(0);

    const processor = await neha();
    const missing = [
      { traveller: "Rakesh Mehta", papers: [BANK] },
      { traveller: "Aarav Mehta", papers: ["Passport"] },
    ];
    expect((await load(processor, c.caseNo)).combinedScans).toEqual({ needed: 14, missing, file: null });
    const res = await combineAgain(processor, c.caseNo);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(`Not combined: 2 scans missing — Rakesh Mehta: ${BANK}; Aarav Mehta: Passport.`);
    expect(res.body.details).toEqual({ code: "SCANS_MISSING", missing });
    expect(await finalFiles(c.id)).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: "visa.file.combine" } })).toBe(0);
  });

  it("uses each person's newest scan, from this case or an earlier one, an On file paper's own copy, and only papers that came in; an unnamed traveller has none", async () => {
    const c = await scannedCase({ skip: (paper, position) => position === 1 && (paper === ITR || paper === BANK), linkChild: false });
    const { createdAt } = await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id } });
    const lastYear = new Date(createdAt.getTime() - 365 * 24 * 60 * 60_000);
    // The ITR's only copy is from an earlier trip: it counts (decided 24 Oct 2026).
    await keepScan(c.client.id, c.rakesh, await paperId("ITR_3Y"), await scanFor(ITR), c.neha.id, lastYear);
    // The bank statement was printed from last year's copy (On file): that copy counts.
    const old = await keepScan(c.client.id, c.rakesh, await paperId("BANK_STATEMENT_6M"), await scanFor(BANK), c.neha.id, lastYear);
    await prisma.visaCaseDocument.update({ where: { id: (await paperOf(c.id, BANK)).id }, data: { receivedAs: "ON_FILE", clientDocumentId: old.id } });
    // The leave letter never came: a Pending paper isn't asked for, like the salary slips (Not needed) and what we made.
    await prisma.visaCaseDocument.update({
      where: { id: (await paperOf(c.id, "Leave letter / NOC")).id },
      data: { status: "PENDING", receivedAs: null, receivedAt: null, receivedById: null, check: null, checkedAt: null, checkedById: null },
    });

    const shown = await load(await neha(), c.caseNo);
    expect(shown.combinedScans).toEqual({
      needed: 13,
      missing: [
        // The son isn't linked to a family member, so none of his scans can be found.
        { traveller: "Child 1", papers: ["Passport", "Old passports", "Visa form, signed", "Photos", "Birth certificate", "School letter", "Parents' NOC"] },
      ],
      file: null,
    });
  });

  it("shows during file preparation and at Docket & dispatch, not at other steps", async () => {
    const c = await readyCase();
    const processor = await neha();
    expect((await load(processor, c.caseNo)).combinedScans).toMatchObject({ needed: 14, file: null });
    const atVendor = await prisma.departmentStage.findFirstOrThrow({ where: { code: "AT_VENDOR" } });
    await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: atVendor.id } });
    expect((await load(processor, c.caseNo)).combinedScans).toBeNull();
  });

  it("an e-visa's scans are combined too", async () => {
    const c = await scannedCase();
    const { offeringId } = await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id }, select: { offeringId: true } });
    await prisma.visaOffering.update({ where: { id: offeringId }, data: { vendorNeeded: false } });
    await prisma.visaCase.update({ where: { enquiryId: c.id }, data: { vendorId: null } });

    await runCombineScansJob({ enquiryId: c.id, userId: c.neha.id });
    expect((await load(await neha(), c.caseNo)).combinedScans?.file).toMatchObject({ scanCount: 14, pageCount: 16 });
  });
});

describe("Combine again", () => {
  it("combines once an HOD adds the missing scan on the client page", async () => {
    const c = await scannedCase({ skip: (paper, position) => position === 1 && paper === BANK });
    await runCombineScansJob({ enquiryId: c.id, userId: c.neha.id });
    expect(await finalFiles(c.id)).toHaveLength(1);

    await createUser({ name: "Riya Shah", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await loginAs("riya@masti.test");
    const added = await hod
      .post(`/api/clients/${c.client.id}/documents?documentId=${await paperId("BANK_STATEMENT_6M")}&memberId=${c.rakesh}`)
      .set("Content-Type", "application/pdf")
      .send(await pdfOf(3));
    expect(added.status).toBe(201);

    const processor = await neha();
    expect((await load(processor, c.caseNo)).combinedScans).toMatchObject({ missing: [], file: null });
    const res = await combineAgain(processor, c.caseNo);
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).combinedScans?.file).toMatchObject({ scanCount: 14, pageCount: 18, by: { name: "Neha Joshi" } });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.file.combine" } });
    expect(entry.after).toMatchObject({ auto: false, scanCount: 14 });
  });

  it("is for the processor, the Visa HOD and the Head; not other staff or view-only users", async () => {
    await createUser({ name: "Kiran", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    await createUser({ name: "Riya Shah", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });

    const first = await scannedCase();
    expect((await combineAgain(await loginAs("kiran@masti.test"), first.caseNo)).status).toBe(403);
    expect((await combineAgain(await loginAs("meena@masti.test"), first.caseNo)).status).toBe(403);
    expect((await combineAgain(await loginAs("riya@masti.test"), first.caseNo)).status).toBe(200);

    const second = await scannedCase({ vendorId: first.vendor.id, extra: { mobile: "98250 41235", clientName: "Sunil Shah" } });
    expect((await combineAgain(await loginAs("vimal@masti.test"), second.caseNo)).status).toBe(200);
    const third = await scannedCase({ vendorId: first.vendor.id, extra: { mobile: "98250 41236", clientName: "Asha Patel" } });
    expect((await combineAgain(await neha(), third.caseNo)).status).toBe(200);
  });

  it("is refused at another step and while the case is postponed", async () => {
    const c = await scannedCase();
    const processor = await neha();
    await prisma.enquiry.update({
      where: { id: c.id },
      data: { status: "POSTPONED", reasonId: await reasonId("TRAVEL_DATES_MOVED"), resumeOn: toDbDate(addMonths(istToday(), 1)) },
    });
    const postponed = await combineAgain(processor, c.caseNo);
    expect(postponed.status).toBe(409);
    expect(postponed.body.message).toMatch(/postponed/);
    // The job leaves a postponed case alone too.
    await runCombineScansJob({ enquiryId: c.id, userId: c.neha.id });
    expect(await finalFiles(c.id)).toHaveLength(1);

    await prisma.enquiry.update({ where: { id: c.id }, data: { status: "OPEN", reasonId: null, resumeOn: null } });
    const atVendor = await prisma.departmentStage.findFirstOrThrow({ where: { code: "AT_VENDOR" } });
    await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: atVendor.id } });
    const moved = await combineAgain(processor, c.caseNo);
    expect(moved.status).toBe(409);
    expect(moved.body.message).toBe("The scans are combined during file preparation or while the case waits for dispatch.");
    // The job leaves a case that moved on too.
    await runCombineScansJob({ enquiryId: c.id, userId: c.neha.id });
    expect(await finalFiles(c.id)).toHaveLength(1);
  });

  it("works during file preparation too, for the Visa HOD before a processor has it", async () => {
    const c = await scannedCase({ at: "prep", withUpload: false });
    await prisma.enquiry.update({ where: { id: c.id }, data: { ownerId: null } });
    await createUser({ name: "Riya Shah", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const res = await combineAgain(await loginAs("riya@masti.test"), c.caseNo);
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).finalFile).toMatchObject({ fileName: `${c.caseNo}_Mehta_scans.pdf`, uploadedBy: { name: "Riya Shah" } });
  });
});

describe("made once", () => {
  it("the job finds it combined and leaves it; Combine again is refused", async () => {
    const c = await scannedCase();
    await runCombineScansJob({ enquiryId: c.id, userId: c.neha.id });
    await runCombineScansJob({ enquiryId: c.id, userId: c.neha.id });
    expect((await finalFiles(c.id)).filter((f) => f.scanCount !== null)).toHaveLength(1);

    const res = await combineAgain(await neha(), c.caseNo);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("The scans are already combined into the saved file.");
    expect(await objectsUnder(`cases/${c.id}/`)).toHaveLength(1);
  });

  it("a job and a press at the same moment save one copy, and the other's PDF is removed from the bucket", async () => {
    const c = await scannedCase();
    // Only the passports needed, so both reach the lock quickly.
    await prisma.visaCaseDocument.updateMany({
      where: { traveller: { caseId: c.id }, status: "RECEIVED", NOT: { name: "Passport" } },
      data: { status: "NOT_NEEDED", receivedAs: null, receivedAt: null, receivedById: null, check: null, checkedAt: null, checkedById: null },
    });
    const processor = await neha();
    const hold = holdCaseLock(c.id, async () => {});
    await hold.ready;
    const job = runCombineScansJob({ enquiryId: c.id, userId: c.neha.id });
    const press = combineAgain(processor, c.caseNo).then((res) => res);
    await untilWaitingOnLock();
    hold.release();
    await hold.done;
    const [, res] = await Promise.all([job, press]);

    // Whichever came first saved it; the press either did, or was told it's done.
    expect([200, 409]).toContain(res.status);
    const combined = (await finalFiles(c.id)).filter((f) => f.scanCount !== null);
    expect(combined).toHaveLength(1);
    expect((await objectsUnder(`cases/${c.id}/`)).map((o) => o.Key)).toEqual([combined[0]!.storageKey]);
  });
});

describe("a scan that can't be put in", () => {
  it("one that won't open, or a password-protected PDF, is refused naming it; nothing is kept", async () => {
    const c = await scannedCase({ skip: (paper, position) => position === 1 && (paper === BANK || paper === ITR) });
    await keepScan(
      c.client.id,
      c.rakesh,
      await paperId("BANK_STATEMENT_6M"),
      { bytes: Buffer.from("%PDF-1.7\nnot really a PDF"), contentType: "application/pdf", pageCount: 1 },
      c.neha.id,
    );
    const locked = await PDFDocument.create();
    locked.addPage();
    locked.context.trailerInfo.Encrypt = locked.context.obj({ Filter: "Standard" });
    const lockedBytes = Buffer.from(await locked.save({ useObjectStreams: false }));
    await keepScan(c.client.id, c.rakesh, await paperId("ITR_3Y"), { bytes: lockedBytes, contentType: "application/pdf", pageCount: 1 }, c.neha.id);

    const processor = await neha();
    const res = await combineAgain(processor, c.caseNo);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(`Rakesh Mehta's ${BANK} can't be opened, so the scans can't be combined.`);
    expect(await finalFiles(c.id)).toHaveLength(1);
    expect(await objectsUnder(`cases/${c.id}/`)).toHaveLength(0);

    // The job ends quietly: trying again wouldn't help.
    await expect(runCombineScansJob({ enquiryId: c.id, userId: c.neha.id })).resolves.toBeUndefined();
    expect(await finalFiles(c.id)).toHaveLength(1);

    // With the bank statement fixed, the ITR's password stops it.
    await keepScan(c.client.id, c.rakesh, await paperId("BANK_STATEMENT_6M"), await scanFor(BANK), c.neha.id);
    const protectedRes = await combineAgain(processor, c.caseNo);
    expect(protectedRes.status).toBe(400);
    expect(protectedRes.body.message).toBe(`Rakesh Mehta's ${ITR} is password-protected, so the scans can't be combined.`);
  });
});

describe("the PDF", () => {
  const photo = (bytes: Buffer, contentType = "image/jpeg") => ({ what: "Rakesh Mehta's Photos", contentType, load: async () => bytes });

  it("puts each photo on an A4 page turned to suit it, upright by the photo's EXIF orientation", async () => {
    const { bytes, pageCount } = await scansPdf(
      [
        photo(jpegOf(1600, 1200)), // wide: a landscape page
        photo(jpegOf(1600, 1200, 6)), // shot on its side, shows tall: a portrait page
        photo(jpegOf(1600, 1200, 8)),
        photo(jpegOf(1600, 1200, 3)), // upside down: still wide
        photo(pngOf(300, 200), "image/png"),
      ],
      "VISA-2026-0001 scans",
    );
    expect(pageCount).toBe(5);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getTitle()).toBe("VISA-2026-0001 scans");
    expect(pdf.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())])).toEqual([
      [842, 595],
      [595, 842],
      [595, 842],
      [842, 595],
      [842, 595],
    ]);
  });
});
