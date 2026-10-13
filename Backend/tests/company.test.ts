import { HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../src/app";
import { bucket, s3 } from "../src/lib/storage";
import { gstinChecksumOk } from "../src/modules/clients/clients.schemas";
import { createUser, loginAs, prisma, resetDb } from "./helpers";

// Masti's own details, the invoice's terms, and its logo and signature (docs/decisions/0008-visa-docket-dispatch.md
// Decision 5, docs/decisions/0009-visa-invoice.md Decision 8): read by every office user, changed only by the Head.

beforeEach(async () => {
  await resetDb();
});

const MASTI = {
  name: "MASTI TOUR AND TRAVEL",
  address: "301, Maitri, Opp. Canara Bank, Nr. Panchratna Tower, L.H. Road, Varachha, Surat-395006, (Guj.) INDIA",
  phone: "+91-93777-57580",
  phone2: null,
  email: null,
  website: null,
  pan: null,
  gstin: null,
  stateCode: null,
  bank: null,
};

/** A made-up PAN and a GSTIN built from it with a valid check character. */
const PAN = "ABCDE1234F";
function gstinFor(pan: string, state = "24") {
  const first14 = `${state}${pan}1Z`;
  return first14 + [..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"].find((c) => gstinChecksumOk(first14 + c));
}
const BANK = { accountName: "Test Travels", accountNo: "123456789012", bankName: "Test Bank", branch: "Varachha", ifsc: "TEST0000123" };

/** 1×1 images that pdf-lib can embed. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

async function people() {
  await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
  await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
  await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
  await createUser({ name: "Ravi", mobile: "+919876500001", type: "FIELD" });
  return {
    head: await loginAs("vimal@masti.test"),
    hod: await loginAs("riya@masti.test"),
    viewer: await loginAs("meena@masti.test"),
    field: await loginAs("9876500001"),
  };
}

type Agent = Awaited<ReturnType<typeof loginAs>>;
const upload = (agent: Agent, kind: string, body: Buffer | string, type = "image/png") =>
  agent.put(`/api/company/images/${kind}`).set("Content-Type", type).send(body);
const companyObjects = async () => (await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "company/" }))).Contents ?? [];

describe("company details", () => {
  it("are Masti's name, address and phone until changed, the tax and bank details empty; field staff can't read them", async () => {
    const { head, viewer, field } = await people();
    const view = (await viewer.get("/api/company/details")).body;
    expect(view.details).toEqual(MASTI);
    expect(view.images).toEqual({ logo: null, signature: null });
    expect(view.missingForInvoice).toEqual(["PAN", "GSTIN", "State", "Bank details", "Logo", "Signature"]);
    expect((await head.get("/api/company/details")).body.details).toEqual(MASTI);
    expect((await field.get("/api/company/details")).status).toBe(403);
  });

  it("only the Head changes them, audited, and only what changed", async () => {
    const { head, hod, viewer } = await people();
    expect((await hod.put("/api/company/details").send({ phone: "+91-90000-00000" })).status).toBe(403);
    expect((await viewer.put("/api/company/details").send({ phone: "+91-90000-00000" })).status).toBe(403);

    const res = await head.put("/api/company/details").send({ phone: "  +91-90000-00000 " });
    expect(res.status).toBe(200);
    expect(res.body.details).toEqual({ ...MASTI, phone: "+91-90000-00000" });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "setting.update", entityId: "company.details" } });
    expect(entry).toMatchObject({ before: { phone: MASTI.phone }, after: { phone: "+91-90000-00000" } });

    await head.put("/api/company/details").send({ phone: "+91-90000-00000" });
    expect(await prisma.auditLog.count({ where: { action: "setting.update", entityId: "company.details" } })).toBe(1);
  });

  it("refuses a blank or too long name, address or phone", async () => {
    const { head } = await people();
    expect((await head.put("/api/company/details").send({ name: "   " })).status).toBe(400);
    expect((await head.put("/api/company/details").send({ address: "x".repeat(301) })).status).toBe(400);
    expect((await head.put("/api/company/details").send({ phone: "9".repeat(31) })).status).toBe(400);
    expect((await head.get("/api/company/details")).body.details).toEqual(MASTI);
  });

  it("takes the tax and bank details, cleaned up, and the first invoice needs less", async () => {
    const { head } = await people();
    const res = await head.put("/api/company/details").send({
      phone2: "+91-261-677-77-77",
      email: " Accounts@Example.COM ",
      website: "https://www.example.com/",
      gstin: gstinFor(PAN).toLowerCase(),
      bank: { ...BANK, accountNo: "1234 5678 9012", ifsc: "test0000123", swift: "" },
    });
    expect(res.status).toBe(200);
    expect(res.body.details).toMatchObject({
      email: "accounts@example.com",
      website: "www.example.com",
      gstin: gstinFor(PAN),
      // Filled in from the GSTIN.
      pan: PAN,
      stateCode: "24",
      bank: { ...BANK, swift: null },
    });
    expect(res.body.missingForInvoice).toEqual(["Logo", "Signature"]);

    // Clearing works with "" or null.
    const cleared = await head.put("/api/company/details").send({ website: "", bank: null });
    expect(cleared.body.details).toMatchObject({ website: null, bank: null });
    expect(cleared.body.missingForInvoice).toContain("Bank details");
  });

  it("refuses bad tax and bank details, and a GSTIN that doesn't match the PAN or the state", async () => {
    const { head } = await people();
    const refused = async (body: object) => (await head.put("/api/company/details").send(body)).status;
    expect(await refused({ pan: "ABCDE12345" })).toBe(400);
    const good = gstinFor(PAN);
    expect(await refused({ gstin: good.slice(0, 14) + (good.endsWith("0") ? "1" : "0") })).toBe(400); // a wrong check character
    expect(await refused({ stateCode: "99" })).toBe(400);
    expect(await refused({ email: "not-an-email" })).toBe(400);
    expect(await refused({ website: "not a site" })).toBe(400);
    expect(await refused({ bank: { ...BANK, ifsc: "ICIC1000584" } })).toBe(400);
    expect(await refused({ bank: { ...BANK, accountNo: "12ab" } })).toBe(400);
    expect(await refused({ bank: { ...BANK, swift: "SHORT" } })).toBe(400);
    expect(await refused({ bank: { accountName: "Only a name" } })).toBe(400);

    const otherPan = await head.put("/api/company/details").send({ pan: "ZZZZZ9999Z", gstin: gstinFor(PAN) });
    expect(otherPan.status).toBe(400);
    expect(otherPan.body.issues.pan[0]).toMatch(/doesn't match/);
    const otherState = await head.put("/api/company/details").send({ stateCode: "27", gstin: gstinFor(PAN) });
    expect(otherState.status).toBe(400);
    expect(otherState.body.issues.stateCode[0]).toMatch(/registered in Gujarat/);
    expect((await head.get("/api/company/details")).body.details).toEqual(MASTI);
  });
});

describe("invoice terms", () => {
  it("start with Masti's five, are read by office users, and only the Head changes them", async () => {
    const { head, hod, viewer } = await people();
    const terms = (await viewer.get("/api/company/invoice-terms")).body.terms.lines as string[];
    expect(terms).toHaveLength(5);
    expect(terms[0]).toBe("Subject to Surat jurisdiction.");

    expect((await hod.put("/api/company/invoice-terms").send({ lines: ["One"] })).status).toBe(403);
    const saved = await head.put("/api/company/invoice-terms").send({ lines: ["  First term. ", "", "Second term."] });
    expect(saved.status).toBe(200);
    expect(saved.body.terms.lines).toEqual(["First term.", "Second term."]);
    expect(await prisma.auditLog.count({ where: { action: "setting.update", entityId: "invoice.terms" } })).toBe(1);
    await head.put("/api/company/invoice-terms").send({ lines: ["First term.", "Second term."] });
    expect(await prisma.auditLog.count({ where: { action: "setting.update", entityId: "invoice.terms" } })).toBe(1);
  });

  it("refuses no terms, more than 10, or a line over 200 characters", async () => {
    const { head } = await people();
    expect((await head.put("/api/company/invoice-terms").send({ lines: [] })).status).toBe(400);
    expect((await head.put("/api/company/invoice-terms").send({ lines: ["", "  "] })).status).toBe(400);
    expect((await head.put("/api/company/invoice-terms").send({ lines: Array.from({ length: 11 }, (_, i) => `Term ${i}`) })).status).toBe(400);
    expect((await head.put("/api/company/invoice-terms").send({ lines: ["x".repeat(201)] })).status).toBe(400);
  });
});

describe("logo and signature", () => {
  it("the Head uploads them; the newest is current and older ones are kept", async () => {
    const { head } = await people();
    const first = await upload(head, "logo", PNG);
    expect(first.status).toBe(200);
    expect(first.body.images.logo).toMatchObject({ contentType: "image/png", sizeBytes: PNG.length, uploadedBy: { name: "Vimal" } });
    expect(first.body.missingForInvoice).toContain("Signature");
    expect(first.body.missingForInvoice).not.toContain("Logo");

    const replaced = await upload(head, "logo", JPEG, "image/jpeg");
    expect(replaced.body.images.logo).toMatchObject({ contentType: "image/jpeg", sizeBytes: JPEG.length });
    expect(await prisma.companyImage.count({ where: { kind: "LOGO" } })).toBe(2);
    const logos = await prisma.companyImage.findMany({ where: { kind: "LOGO" } });
    const keys = new Set((await companyObjects()).map((o) => o.Key));
    expect(logos.every((l) => keys.has(l.storageKey))).toBe(true);

    const signed = await upload(head, "signature", PNG);
    expect(signed.body.images.signature).not.toBeNull();
    const rows = await prisma.companyImage.findMany({ where: { kind: "SIGNATURE" } });
    const stored = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: rows[0]!.storageKey }));
    expect(stored).toMatchObject({ ContentLength: PNG.length, ContentType: "image/png" });
    expect(await prisma.auditLog.count({ where: { action: "company.image.upload" } })).toBe(3);
  });

  it("only the Head uploads; office users get a short-lived link; nothing before an upload", async () => {
    const { head, hod, viewer, field } = await people();
    expect((await upload(hod, "logo", PNG)).status).toBe(403);
    expect((await upload(viewer, "logo", PNG)).status).toBe(403);
    expect((await viewer.get("/api/company/images/logo/link")).status).toBe(404);

    await upload(head, "logo", PNG);
    const link = await viewer.get("/api/company/images/logo/link");
    expect(link.status).toBe(200);
    expect(link.body.url).toContain("X-Amz-Signature");
    expect(new Date(link.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect((await field.get("/api/company/images/logo/link")).status).toBe(403);
    expect((await head.get("/api/company/images/stamp/link")).status).toBe(400);
  });

  it("refuses anything that isn't a readable PNG or JPEG, or is over 2 MB, and leaves nothing behind", async () => {
    const { head } = await people();
    const objectsBefore = (await companyObjects()).length;
    expect((await upload(head, "logo", JPEG, "image/png")).status).toBe(400); // JPEG bytes sent as PNG
    expect((await upload(head, "logo", Buffer.concat([PNG.subarray(0, 8), Buffer.from("not really a png")]))).status).toBe(400);
    expect((await upload(head, "logo", Buffer.alloc(0))).status).toBe(400);
    expect((await upload(head, "logo", PNG, "image/gif")).status).toBe(415);
    expect((await upload(head, "logo", "hello", "text/plain")).status).toBe(415);
    expect((await upload(head, "logo", PNG, "image/pngx")).status).toBe(415);
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    const tooBig = await upload(head, "logo", big);
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.message).toMatch(/over 2 MB/);
    expect(await prisma.companyImage.count()).toBe(0);
    expect(await companyObjects()).toHaveLength(objectsBefore);
  });
});

describe("CSRF guard", () => {
  it("compares the exact media type", async () => {
    const res = await request(app).post("/api/auth/login").set("Content-Type", "application/jsonx").send('{"identifier":"a","password":"b"}');
    expect(res.status).toBe(415);
    const ok = await request(app).post("/api/auth/login").set("Content-Type", "application/json; charset=utf-8").send('{"identifier":"a","password":"b"}');
    expect(ok.status).not.toBe(415);
  });
});
