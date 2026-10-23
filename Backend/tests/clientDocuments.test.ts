import { HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it } from "vitest";
import { istToday } from "../src/lib/dates";
import { MB } from "../src/lib/pdf";
import { bucket, s3 } from "../src/lib/storage";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { jpegOf, padded, pngOf } from "./imageFiles";

// The client document vault (docs/decisions/0016-client-documents.md), the client page's side: the Head and the HOD of
// any department keep scans of a client's papers, per family member, in the test bucket (MinIO, emptied by
// globalSetup). Nothing is changed or deleted: a newer scan of a paper for a person is the current one; older ones stay.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
});

type Agent = Awaited<ReturnType<typeof loginAs>>;

/** 1×1 images, as in company.test.ts. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
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

/** The Head, a Holidays HOD (no Visa access at all), Visa staff who can edit, view-only Visa staff, the collection boy. */
async function people() {
  await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
  await createUser({ name: "Kiran Shah", email: "kiran@masti.test", departments: [{ code: "HOLIDAYS", role: "HOD" }] });
  await createUser({ name: "Aarti", email: "aarti@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
  await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
  await createUser({ name: "Ravi", mobile: "+919876500001", type: "FIELD" });
  return {
    head: await loginAs("vimal@masti.test"),
    hod: await loginAs("kiran@masti.test"),
    editor: await loginAs("aarti@masti.test"),
    viewer: await loginAs("meena@masti.test"),
    field: await loginAs("9876500001"),
  };
}

const relationId = async (code: string) => (await prisma.relation.findUniqueOrThrow({ where: { code } })).id;
const paper = async (code: string) => (await prisma.documentMaster.findUniqueOrThrow({ where: { code } })).id;

async function addMember(agent: Agent, clientId: string, name: string, relation: string) {
  const res = await agent.post(`/api/clients/${clientId}/members`).send({ name, relationId: await relationId(relation) });
  if (res.status !== 201) throw new Error(`member failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.member as { id: string };
}

/** The Mehta family (Rakesh, then his son Aarav), and another client with a person of their own. */
async function family(head: Agent) {
  const client = (await head.post("/api/clients").send({ mobile: "9825041234", name: "Rakesh Mehta" })).body.client as { id: string };
  const rakesh = await addMember(head, client.id, "Rakesh Mehta", "SELF");
  const aarav = await addMember(head, client.id, "Aarav Mehta", "SON");
  const other = (await head.post("/api/clients").send({ mobile: "9825049999", name: "Sunita Patel" })).body.client as { id: string };
  const sunita = await addMember(head, other.id, "Sunita Patel", "SELF");
  return { client, rakesh, aarav, other, sunita };
}

const upload = (agent: Agent, clientId: string, query: Record<string, string | number>, body: Buffer | string, type = "application/pdf") =>
  agent.post(`/api/clients/${clientId}/documents`).query(query).set("Content-Type", type).send(body);
const objectsOf = async (clientId: string) =>
  (await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `clients/${clientId}/` }))).Contents ?? [];

interface ScanDto {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  pageCount: number | null;
  uploadedBy: { name: string };
}
interface VaultDto {
  groups: {
    member: { id: string; name: string; relation: string; archived: boolean } | null;
    papers: { paper: { id: number; name: string }; current: ScanDto; older: ScanDto[] }[];
  }[];
  papers: { id: number; name: string; rules: Record<string, unknown> }[];
  maxMb: number;
}

describe("adding scans (Decisions 2 and 3)", () => {
  it("keeps a Holidays HOD's PDF of a member's passport: in the bucket, named, listed as current, audited", async () => {
    const { head, hod } = await people();
    const { client, aarav } = await family(head);
    const file = await pdf(2);

    const res = await upload(hod, client.id, { documentId: await paper("PASSPORT"), memberId: aarav.id }, file);
    expect(res.status).toBe(201);
    const vault = res.body as VaultDto;
    expect(vault.groups).toHaveLength(1);
    expect(vault.groups[0]).toMatchObject({
      member: { id: aarav.id, name: "Aarav Mehta", relation: "Son", archived: false },
      papers: [
        {
          paper: { name: "Passport" },
          current: {
            fileName: `Aarav-Mehta_Passport_${istToday()}.pdf`,
            contentType: "application/pdf",
            pageCount: 2,
            sizeBytes: file.length,
            uploadedBy: { name: "Kiran Shah" },
          },
          older: [],
        },
      ],
    });
    // The Add form's papers come with it (a Holidays HOD can't read the Visa masters), with the Aadhaar and PAN cards.
    expect(vault.papers.map((p) => p.name)).toEqual(expect.arrayContaining(["Passport", "Aadhaar card", "PAN card"]));
    expect(vault.papers).toHaveLength(16);
    expect(vault.maxMb).toBe(20);

    const row = await prisma.clientDocument.findFirstOrThrow();
    expect(row).toMatchObject({ id: vault.groups[0]!.papers[0]!.current.id, clientId: client.id, memberId: aarav.id });
    expect(row.storageKey).toMatch(new RegExp(`^clients/${client.id}/[0-9a-f-]{36}\\.pdf$`));
    const stored = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: row.storageKey }));
    expect(stored).toMatchObject({ ContentLength: file.length, ContentType: "application/pdf" });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "client.document.add", entityId: row.id } });
    expect(entry).toMatchObject({
      clientId: client.id,
      after: { paper: "Passport", person: "Aarav Mehta", fileName: row.fileName, contentType: "application/pdf", pageCount: 2, replaces: null },
    });

    expect((await hod.get(`/api/clients/${client.id}/documents`)).body).toEqual(res.body);
  });

  it("takes phone photos (JPEG, PNG) and the client's own papers, which are listed first", async () => {
    const { head } = await people();
    const { client, rakesh } = await family(head);

    expect((await upload(head, client.id, { documentId: await paper("AADHAAR_CARD"), memberId: rakesh.id }, JPEG, "image/jpeg")).status).toBe(201);
    const res = await upload(head, client.id, { documentId: await paper("PAN_CARD") }, PNG, "image/png");
    expect(res.status).toBe(201);

    const { groups } = res.body as VaultDto;
    expect(groups.map((g) => g.member?.name ?? null)).toEqual([null, "Rakesh Mehta"]);
    expect(groups[0]!.papers[0]).toMatchObject({
      paper: { name: "PAN card" },
      current: { fileName: `Rakesh-Mehta_PAN-card_${istToday()}.png`, contentType: "image/png", pageCount: null, sizeBytes: PNG.length },
    });
    expect(groups[1]!.papers[0]).toMatchObject({
      paper: { name: "Aadhaar card" },
      current: { fileName: `Rakesh-Mehta_Aadhaar-card_${istToday()}.jpg`, contentType: "image/jpeg", pageCount: null },
    });
    const own = await prisma.clientDocument.findFirstOrThrow({ where: { memberId: null } });
    expect(own.storageKey).toMatch(/\.png$/);
    expect(await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: own.storageKey }))).toMatchObject({ ContentType: "image/png" });
  });

  it("makes a newer scan of the same paper the current one, keeps the older, and lists papers in the master's order", async () => {
    const { head } = await people();
    const { client, aarav } = await family(head);
    const passport = { documentId: await paper("PASSPORT"), memberId: aarav.id };

    // The photos are seeded 35 × 45 mm in shape (0016 Amendment 1).
    await upload(head, client.id, { documentId: await paper("PHOTOS"), memberId: aarav.id }, pngOf(70, 90), "image/png");
    const first = (await upload(head, client.id, passport, await pdf(1))).body as VaultDto;
    const firstId = first.groups[0]!.papers[0]!.current.id;
    const res = await upload(head, client.id, passport, await pdf(3));
    expect(res.status).toBe(201);

    const papers = (res.body as VaultDto).groups[0]!.papers;
    expect(papers.map((p) => p.paper.name)).toEqual(["Passport", "Photos"]);
    expect(papers[0]!.current.pageCount).toBe(3);
    expect(papers[0]!.older.map((s) => [s.id, s.pageCount])).toEqual([[firstId, 1]]);
    expect(await objectsOf(client.id)).toHaveLength(3);
    const latest = await prisma.auditLog.findFirstOrThrow({ where: { action: "client.document.add" }, orderBy: { id: "desc" } });
    expect(latest.after).toMatchObject({ replaces: firstId });
  });

  it("lists people in the family's order with anyone taken off it last, whose scans still open but take no new ones", async () => {
    const { head } = await people();
    const { client, rakesh, aarav } = await family(head);
    await upload(head, client.id, { documentId: await paper("PASSPORT"), memberId: aarav.id }, await pdf(1));
    const before = (await upload(head, client.id, { documentId: await paper("PASSPORT"), memberId: rakesh.id }, await pdf(1))).body as VaultDto;
    expect(before.groups.map((g) => g.member?.name)).toEqual(["Rakesh Mehta", "Aarav Mehta"]);

    expect((await head.post(`/api/clients/${client.id}/members/${rakesh.id}/archive`).send({})).status).toBe(200);
    const after = (await head.get(`/api/clients/${client.id}/documents`)).body as VaultDto;
    expect(after.groups.map((g) => [g.member?.name, g.member?.archived])).toEqual([
      ["Aarav Mehta", false],
      ["Rakesh Mehta", true],
    ]);
    const scanId = after.groups[1]!.papers[0]!.current.id;
    expect((await head.get(`/api/clients/${client.id}/documents/${scanId}/link`)).status).toBe(200);

    const refused = await upload(head, client.id, { documentId: await paper("PHOTOS"), memberId: rakesh.id }, JPEG, "image/jpeg");
    expect(refused.status).toBe(400);
    expect(refused.body.message).toBe("This person was taken off the family list.");
  });
});

describe("who sees the vault (Decision 4)", () => {
  it("is only for the Head and HODs: staff, view-only staff and field staff are refused, and nothing is stored", async () => {
    const { head, editor, viewer, field } = await people();
    const { client, aarav } = await family(head);
    const scanId = ((await upload(head, client.id, { documentId: await paper("PASSPORT"), memberId: aarav.id }, await pdf(1))).body as VaultDto)
      .groups[0]!.papers[0]!.current.id;

    for (const agent of [editor, viewer, field]) {
      expect((await agent.get(`/api/clients/${client.id}/documents`)).status).toBe(403);
      expect((await upload(agent, client.id, { documentId: await paper("PHOTOS"), memberId: aarav.id }, JPEG, "image/jpeg")).status).toBe(403);
      expect((await agent.get(`/api/clients/${client.id}/documents/${scanId}/link`)).status).toBe(403);
    }
    expect((await editor.get(`/api/clients/${client.id}/documents`)).body.message).toBe("Only an HOD or the Head can see a client's documents.");
    expect(await prisma.clientDocument.count()).toBe(1);
    expect(await objectsOf(client.id)).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: "client.document.open" } })).toBe(0);
  });

  it("refuses the HOD of a switched-off department", async () => {
    const { head } = await people();
    const { client } = await family(head);
    await createUser({ name: "Hotels HOD", email: "hotels@masti.test", departments: [{ code: "HOTELS", role: "HOD" }] });
    const hotels = await loginAs("hotels@masti.test");
    expect((await hotels.get(`/api/clients/${client.id}/documents`)).status).toBe(200);

    await prisma.department.update({ where: { code: "HOTELS" }, data: { isActive: false } });
    expect((await hotels.get(`/api/clients/${client.id}/documents`)).status).toBe(403);
  });
});

describe("what a scan must be", () => {
  it("refuses files that aren't a real PDF, JPEG or PNG before keeping anything", async () => {
    const { head } = await people();
    const { client, aarav } = await family(head);
    const query = { documentId: await paper("PASSPORT"), memberId: aarav.id };

    expect((await upload(head, client.id, query, "hello", "text/plain")).status).toBe(415);
    const json = await upload(head, client.id, query, JSON.stringify({ file: "x" }), "application/json");
    expect(json.status).toBe(415);
    expect(json.body.message).toBe("Upload a PDF, JPEG or PNG.");

    const wrongImage = await upload(head, client.id, query, JPEG, "image/png");
    expect(wrongImage.status).toBe(400);
    expect(wrongImage.body.message).toMatch(/^This isn't a PNG image\./);
    const notPdf = await upload(head, client.id, query, Buffer.from("not a pdf at all"));
    expect(notPdf.status).toBe(400);
    expect(notPdf.body.message).toMatch(/^This isn't a PDF\./);
    const empty = await upload(head, client.id, query, Buffer.alloc(0));
    expect(empty.status).toBe(400);
    expect(empty.body.message).toBe("Pick the file to upload.");

    expect(await prisma.clientDocument.count()).toBe(0);
    expect(await objectsOf(client.id)).toHaveLength(0);
  });

  it("refuses a scan over the size limit, a setting only the Head changes", async () => {
    const { head, hod } = await people();
    const { client, aarav } = await family(head);
    expect((await hod.put("/api/clients/settings").send({ documents: { maxMb: 1 } })).status).toBe(403);
    expect((await head.put("/api/clients/settings").send({ documents: { maxMb: 0 } })).status).toBe(400);
    const saved = await head.put("/api/clients/settings").send({ documents: { maxMb: 1 } });
    expect(saved.status).toBe(200);
    expect(saved.body.settings.documents).toEqual({ maxMb: 1 });
    expect((await hod.get(`/api/clients/${client.id}/documents`)).body.maxMb).toBe(1);

    const big = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(MB)]);
    const res = await upload(hod, client.id, { documentId: await paper("PASSPORT"), memberId: aarav.id }, big);
    expect(res.status).toBe(413);
    expect(res.body.message).toBe('"Passport" can be at most 1 MB. Scan it at a lower resolution and upload it again.');
    expect(await prisma.clientDocument.count()).toBe(0);
    expect(await objectsOf(client.id)).toHaveLength(0);
  });

  it("refuses a scan its paper's upload rules don't take, before keeping anything (0016 Amendment 1)", async () => {
    const { head } = await people();
    const { client, aarav } = await family(head);
    // The photos are seeded 35 × 45 mm in shape; here they also take only a JPG or PNG of 0.01–0.3 MB.
    await prisma.documentMaster.update({ where: { code: "PHOTOS" }, data: { fileTypes: ["JPG", "PNG"], minSize: 0.01, maxSize: 0.3 } });
    const photos = { documentId: await paper("PHOTOS"), memberId: aarav.id };
    const vault = (await head.get(`/api/clients/${client.id}/documents`)).body as VaultDto;
    expect(vault.papers.find((p) => p.name === "Photos")!.rules).toEqual({
      fileTypes: ["JPG", "PNG"],
      minSize: 0.01,
      maxSize: 0.3,
      sizeUnit: "MB",
      photoWidthMm: 35,
      photoHeightMm: 45,
      minWidthPx: null,
      minHeightPx: null,
      maxWidthPx: null,
      maxHeightPx: null,
    });

    const refused = async (body: Buffer, type: string, status: number, message: string) => {
      const res = await upload(head, client.id, photos, body, type);
      expect(res.status).toBe(status);
      expect(res.body.message).toBe(message);
    };
    await refused(await pdf(1), "application/pdf", 415, '"Photos" must be a JPG or PNG. This file is a PDF.');
    await refused(padded(pngOf(70, 90), 0.31 * MB), "image/png", 413, '"Photos" can be at most 0.3 MB. Scan it at a lower resolution and upload it again.');
    await refused(pngOf(70, 90), "image/png", 400, '"Photos" must be at least 0.01 MB. This file is under 0.01 MB: scan it at a higher resolution.');
    const shape = (w: number, h: number) =>
      `"Photos" must have the shape of 35 × 45 mm. This photo is ${w} × ${h} pixels: crop it to that shape and upload it again.`;
    await refused(padded(pngOf(600, 600), 0.1 * MB), "image/png", 400, shape(600, 600));
    await refused(padded(jpegOf(450, 350), 0.1 * MB), "image/jpeg", 400, shape(450, 350)); // On its side.
    await refused(padded(pngOf(380, 531), 0.1 * MB), "image/png", 400, shape(380, 531)); // 8% too narrow.
    expect(await prisma.clientDocument.count()).toBe(0);
    expect(await objectsOf(client.id)).toHaveLength(0);

    // 35 × 45 mm at 300 dpi; just under 3% narrower; a phone photo shot on its side that shows upright (EXIF 6).
    for (const [file, type] of [
      [pngOf(413, 531), "image/png"],
      [pngOf(401, 531), "image/png"],
      [jpegOf(900, 700, 6), "image/jpeg"],
    ] as const) {
      expect((await upload(head, client.id, photos, padded(file, 0.1 * MB), type)).status).toBe(201);
    }
    expect(await objectsOf(client.id)).toHaveLength(3);

    // A PDF's shape isn't checked, and a paper's own largest scan can be above the shared one.
    expect((await head.put("/api/clients/settings").send({ documents: { maxMb: 1 } })).status).toBe(200);
    await prisma.documentMaster.update({ where: { code: "PASSPORT" }, data: { maxSize: 2, photoWidthMm: 35, photoHeightMm: 45 } });
    const passport = { documentId: await paper("PASSPORT"), memberId: aarav.id };
    expect((await upload(head, client.id, passport, await pdf(1))).status).toBe(201);
    expect((await upload(head, client.id, passport, padded(pngOf(413, 531), 1.5 * MB), "image/png")).status).toBe(201);
  });

  it("refuses a photo of too few or too many pixels, or not its exact size, before keeping anything (0016 Amendment 1)", async () => {
    const { head } = await people();
    const { client, aarav } = await family(head);
    // The USA's 600 × 600 to 1200 × 1200 pixels, with no shape, to see the pixels alone.
    await prisma.documentMaster.update({
      where: { code: "PHOTOS" },
      data: { photoWidthMm: null, photoHeightMm: null, minWidthPx: 600, minHeightPx: 600, maxWidthPx: 1200, maxHeightPx: 1200 },
    });
    const photos = { documentId: await paper("PHOTOS"), memberId: aarav.id };
    const refused = async (file: Buffer, type: string, message: string) => {
      const res = await upload(head, client.id, photos, padded(file, 0.1 * MB), type);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe(message);
    };
    const tooFew = (w: number, h: number) =>
      `"Photos" must be at least 600 × 600 pixels. This photo is ${w} × ${h} pixels: scan it at a higher resolution.`;
    await refused(pngOf(450, 450), "image/png", tooFew(450, 450));
    await refused(pngOf(800, 599), "image/png", tooFew(800, 599));
    await refused(jpegOf(1000, 500, 6), "image/jpeg", tooFew(500, 1000)); // Shot on its side: 500 wide as it shows.
    await refused(
      pngOf(2400, 2400),
      "image/png",
      '"Photos" can be at most 1200 × 1200 pixels. This photo is 2400 × 2400 pixels: scan it at a lower resolution.',
    );
    expect(await prisma.clientDocument.count()).toBe(0);
    expect(await objectsOf(client.id)).toHaveLength(0);
    for (const file of [pngOf(600, 600), pngOf(1200, 1200), pngOf(800, 1000)]) {
      expect((await upload(head, client.id, photos, padded(file, 0.1 * MB), "image/png")).status).toBe(201);
    }

    // Singapore's exact 400 × 514: the smallest and the largest the same.
    await prisma.documentMaster.update({ where: { code: "PHOTOS" }, data: { minWidthPx: 400, minHeightPx: 514, maxWidthPx: 400, maxHeightPx: 514 } });
    await refused(
      pngOf(413, 531),
      "image/png",
      '"Photos" must be exactly 400 × 514 pixels. This photo is 413 × 531 pixels: make it that size and upload it again.',
    );
    expect((await upload(head, client.id, photos, padded(pngOf(400, 514), 0.1 * MB), "image/png")).status).toBe(201);

    // With a shape too, the shape is checked first. A PDF has no pixels to check.
    await prisma.documentMaster.update({ where: { code: "PHOTOS" }, data: { photoWidthMm: 35, photoHeightMm: 45 } });
    await refused(
      pngOf(600, 600),
      "image/png",
      '"Photos" must have the shape of 35 × 45 mm. This photo is 600 × 600 pixels: crop it to that shape and upload it again.',
    );
    expect((await upload(head, client.id, photos, await pdf(1))).status).toBe(201);
  });

  it("words a paper's sizes in KB when it sets them in KB (0016 Amendment 1)", async () => {
    const { head } = await people();
    const { client, aarav } = await family(head);
    // The USA's photo is at most 240 KB; at least 40 KB too, to see both ends. 1 KB is 1,024 bytes.
    await prisma.documentMaster.update({ where: { code: "PHOTOS" }, data: { sizeUnit: "KB", minSize: 40, maxSize: 240 } });
    const photos = { documentId: await paper("PHOTOS"), memberId: aarav.id };
    const vault = (await head.get(`/api/clients/${client.id}/documents`)).body as VaultDto;
    expect(vault.papers.find((p) => p.name === "Photos")!.rules).toMatchObject({ sizeUnit: "KB", minSize: 40, maxSize: 240 });

    const big = await upload(head, client.id, photos, padded(pngOf(70, 90), 240 * 1024 + 1), "image/png");
    expect(big.status).toBe(413);
    expect(big.body.message).toBe('"Photos" can be at most 240 KB. Scan it at a lower resolution and upload it again.');
    const small = await upload(head, client.id, photos, padded(pngOf(70, 90), 40 * 1024 - 1), "image/png");
    expect(small.status).toBe(400);
    expect(small.body.message).toBe('"Photos" must be at least 40 KB. This file is 39 KB: scan it at a higher resolution.');
    expect(await objectsOf(client.id)).toHaveLength(0);

    for (const bytes of [40 * 1024, 240 * 1024]) {
      expect((await upload(head, client.id, photos, padded(pngOf(70, 90), bytes), "image/png")).status).toBe(201);
    }
  });

  it("checks the client, the person and the paper", async () => {
    const { head } = await people();
    const { client, aarav, sunita } = await family(head);
    const passport = await paper("PASSPORT");

    const otherPerson = await upload(head, client.id, { documentId: passport, memberId: sunita.id }, await pdf(1));
    expect(otherPerson.status).toBe(404);
    expect(otherPerson.body.message).toBe("Person not found on this client.");
    const noPaper = await upload(head, client.id, { documentId: 9999, memberId: aarav.id }, await pdf(1));
    expect(noPaper.status).toBe(404);
    expect(noPaper.body.message).toBe("Paper not found.");
    expect((await upload(head, client.id, { memberId: aarav.id }, await pdf(1))).status).toBe(400);
    expect((await upload(head, "no-such-client", { documentId: passport }, await pdf(1))).status).toBe(404);
    expect((await head.get("/api/clients/no-such-client/documents")).status).toBe(404);

    await prisma.documentMaster.update({ where: { code: "PHOTOS" }, data: { isActive: false } });
    const switchedOff = await upload(head, client.id, { documentId: await paper("PHOTOS"), memberId: aarav.id }, JPEG, "image/jpeg");
    expect(switchedOff.status).toBe(400);
    expect(switchedOff.body.message).toBe('"Photos" is switched off in the document list.');
    expect(((await head.get(`/api/clients/${client.id}/documents`)).body as VaultDto).papers.map((p) => p.name)).not.toContain("Photos");

    expect(await objectsOf(client.id)).toHaveLength(0);
  });
});

describe("opening a scan", () => {
  it("gives a short-lived link that opens the file, and audits it; another client's scan isn't found", async () => {
    const { head, hod } = await people();
    const { client, other, aarav } = await family(head);
    const file = await pdf(1);
    const scanId = ((await upload(hod, client.id, { documentId: await paper("PASSPORT"), memberId: aarav.id }, file)).body as VaultDto).groups[0]!
      .papers[0]!.current.id;

    const link = await hod.get(`/api/clients/${client.id}/documents/${scanId}/link`);
    expect(link.status).toBe(200);
    expect(link.body.url).toMatch(/X-Amz-Expires=300/);
    const opened = await fetch(link.body.url as string);
    expect(opened.status).toBe(200);
    expect(opened.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await opened.arrayBuffer()).equals(file)).toBe(true);

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "client.document.open", entityId: scanId } });
    expect(entry).toMatchObject({ clientId: client.id, after: { fileName: `Aarav-Mehta_Passport_${istToday()}.pdf` } });

    const elsewhere = await hod.get(`/api/clients/${other.id}/documents/${scanId}/link`);
    expect(elsewhere.status).toBe(404);
    expect(elsewhere.body.message).toBe("Document not found on this client.");
  });
});

describe("the database", () => {
  it("refuses a scan of another type, an empty one, and pages that don't fit the type", async () => {
    await people();
    const head = await prisma.user.findFirstOrThrow({ where: { email: "vimal@masti.test" } });
    const client = await prisma.client.create({ data: { mobile: "+919825041234", name: "Rakesh Mehta", billingCycleId: 1 } });
    const base = {
      clientId: client.id,
      documentId: await paper("PASSPORT"),
      fileName: "x.pdf",
      contentType: "application/pdf",
      sizeBytes: 10,
      pageCount: 1 as number | null,
      uploadedById: head.id,
    };
    let n = 0;
    const insert = (data: Partial<typeof base>) => prisma.clientDocument.create({ data: { ...base, storageKey: `clients/${client.id}/${n++}`, ...data } });

    await expect(insert({ contentType: "text/plain", pageCount: null })).rejects.toThrow(/ClientDocument_type/);
    await expect(insert({ sizeBytes: 0 })).rejects.toThrow(/ClientDocument_size/);
    await expect(insert({ pageCount: null })).rejects.toThrow(/ClientDocument_pages/);
    await expect(insert({ pageCount: 0 })).rejects.toThrow(/ClientDocument_pages/);
    await expect(insert({ contentType: "image/png", pageCount: 1 })).rejects.toThrow(/ClientDocument_pages/);
    await expect(insert({ contentType: "image/png", pageCount: null })).resolves.toBeTruthy();
  });
});
