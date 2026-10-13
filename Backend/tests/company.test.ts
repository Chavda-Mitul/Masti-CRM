import { beforeEach, describe, expect, it } from "vitest";
import { createUser, loginAs, prisma, resetDb } from "./helpers";

// Masti's own details (docs/decisions/0008-visa-docket-dispatch.md Decision 5): the "From" on the parcel sticker, read
// by every office user, changed only by the Head.

beforeEach(async () => {
  await resetDb();
});

const MASTI = {
  name: "MASTI TOUR AND TRAVEL",
  address: "301, Maitri, Opp. Canara Bank, Nr. Panchratna Tower, L.H. Road, Varachha, Surat-395006, (Guj.) INDIA",
  phone: "+91-93777-57580",
};

async function people() {
  await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
  await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
  await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
  await createUser({ name: "Ravi", mobile: "+919876500001", type: "FIELD" });
  return {
    head: await loginAs("vimal@masti.test"),
    hod: await loginAs("riya@masti.test"),
    viewer: await loginAs("meena@masti.test"),
    field: await loginAs("+919876500001"),
  };
}

describe("company details", () => {
  it("are Masti's until changed, and every office user can read them; field staff can't", async () => {
    const { head, viewer, field } = await people();
    expect((await viewer.get("/api/company/details")).body.details).toEqual(MASTI);
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
    expect(entry).toMatchObject({ before: MASTI, after: { ...MASTI, phone: "+91-90000-00000" } });

    await head.put("/api/company/details").send({ phone: "+91-90000-00000" });
    expect(await prisma.auditLog.count({ where: { action: "setting.update", entityId: "company.details" } })).toBe(1);
  });

  it("refuses a blank or too long value", async () => {
    const { head } = await people();
    expect((await head.put("/api/company/details").send({ name: "   " })).status).toBe(400);
    expect((await head.put("/api/company/details").send({ address: "x".repeat(301) })).status).toBe(400);
    expect((await head.put("/api/company/details").send({ phone: "9".repeat(31) })).status).toBe(400);
    expect((await head.get("/api/company/details")).body.details).toEqual(MASTI);
  });
});
