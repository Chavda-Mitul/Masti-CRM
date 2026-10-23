import { beforeEach, describe, expect, it } from "vitest";
import { CONSENT_FIELDS } from "../src/modules/consent/consent.seed";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";

// The consent form's fields in Settings (docs/decisions/0022-consent-form.md amendment 1, change request 18): the Head
// and the Visa HOD add, rename, reorder and switch off fields; Visa staff read them.

beforeEach(async () => {
  await resetDb();
});

async function visaHod() {
  await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
  return loginAs("riya@masti.test");
}

const fieldId = async (label: string) => (await prisma.consentField.findFirstOrThrow({ where: { label } })).id;
type Field = { id: number; label: string; kind: string; required: boolean; fixed: string | null; sortOrder: number; isActive: boolean };

describe("the consent form's fields", () => {
  it("are read by Visa staff, in the form's order, and changed only by the Visa HOD or the Head", async () => {
    expect((await request(app).get("/api/masters/consent-fields")).status).toBe(401);
    await createUser({ name: "Aarti", email: "aarti@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    const viewer = await loginAs("aarti@masti.test");
    const list = await viewer.get("/api/masters/consent-fields");
    expect(list.status).toBe(200);
    expect(list.body.fields.map((f: Field) => f.label)).toEqual(CONSENT_FIELDS.map((f) => f.label));
    expect(list.body.fields[0]).toMatchObject({ label: "Date of birth", kind: "DATE", fixed: "DATE_OF_BIRTH", required: true, isActive: true });

    await createUser({ email: "hotels@masti.test", departments: [{ code: "HOTELS", access: "EDIT" }] });
    expect((await (await loginAs("hotels@masti.test")).get("/api/masters/consent-fields")).status).toBe(403);

    await createUser({ name: "Neha", email: "neha@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    const editor = await loginAs("neha@masti.test");
    const refused = await editor.post("/api/masters/consent-fields").send({ label: "Twitter / X", kind: "LINK" });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/Visa HOD/);
    expect((await editor.patch(`/api/masters/consent-fields/${await fieldId("Institute")}`).send({ required: true })).status).toBe(403);
    expect((await editor.put("/api/masters/consent-fields/order").send({ ids: [1] })).status).toBe(403);

    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    const head = await loginAs("vimal@masti.test");
    expect((await head.post("/api/masters/consent-fields").send({ label: "YouTube", kind: "LINK" })).status).toBe(201);
  });

  it("adds a field at the end of the form, audited, and refuses a name already used", async () => {
    const hod = await visaHod();
    const added = await hod.post("/api/masters/consent-fields").send({ label: "  Twitter / X ", kind: "LINK", required: true });
    expect(added.status).toBe(201);
    expect(added.body.field).toMatchObject({ label: "Twitter / X", kind: "LINK", required: true, fixed: null, isActive: true, sortOrder: CONSENT_FIELDS.length + 1 });
    const entries = await prisma.auditLog.findMany({ where: { action: "consentField.create" } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entityType: "ConsentField", entityId: String(added.body.field.id) });

    for (const label of ["twitter / x", "INSTITUTE"]) {
      const same = await hod.post("/api/masters/consent-fields").send({ label, kind: "TEXT" });
      expect(same.status, label).toBe(409);
      expect(same.body.message).toMatch(/already on the form/);
    }
    // A switched-off field keeps its name: switch it back on instead.
    await hod.patch(`/api/masters/consent-fields/${await fieldId("Facebook")}`).send({ isActive: false });
    const off = await hod.post("/api/masters/consent-fields").send({ label: "Facebook", kind: "LINK" });
    expect(off.status).toBe(409);
    expect(off.body.message).toMatch(/switched off\. Switch it back on/);

    const bad = await hod.post("/api/masters/consent-fields").send({ label: " ", kind: "DROPDOWN" });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.issues).sort()).toEqual(["kind", "label"]);
    expect((await hod.post("/api/masters/consent-fields").send({ label: "x".repeat(101), kind: "TEXT" })).status).toBe(400);
  });

  it("renames a field, makes it required or not, and switches it off and on; its kind never changes", async () => {
    const hod = await visaHod();
    const id = await fieldId("Profession");
    const res = await hod.patch(`/api/masters/consent-fields/${id}`).send({ label: "Occupation", required: true, kind: "DATE" });
    expect(res.status).toBe(200);
    expect(res.body.field).toMatchObject({ label: "Occupation", required: true, kind: "TEXT" });
    const entries = await prisma.auditLog.findMany({ where: { action: "consentField.update" } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ before: { label: "Profession", required: false }, after: { label: "Occupation", required: true } });

    // Nothing changed: nothing written.
    expect((await hod.patch(`/api/masters/consent-fields/${id}`).send({ label: "Occupation" })).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "consentField.update" } })).toBe(1);

    expect((await hod.patch(`/api/masters/consent-fields/${id}`).send({ isActive: false })).body.field.isActive).toBe(false);
    expect((await hod.get("/api/masters/consent-fields?active=true")).body.fields.map((f: Field) => f.label)).not.toContain("Occupation");
    expect((await hod.patch(`/api/masters/consent-fields/${id}`).send({ isActive: true })).body.field.isActive).toBe(true);

    const taken = await hod.patch(`/api/masters/consent-fields/${id}`).send({ label: "education" });
    expect(taken.status).toBe(409);
    expect((await hod.patch("/api/masters/consent-fields/99999").send({ required: true })).status).toBe(404);
  });

  it("keeps the fixed fields on the form with their names; only whether they're needed changes, never the date of birth's", async () => {
    const hod = await visaHod();
    const birth = await fieldId("Date of birth");
    const home = await fieldId("Home address");
    for (const change of [{ label: "Born on" }, { isActive: false }]) {
      const res = await hod.patch(`/api/masters/consent-fields/${home}`).send(change);
      expect(res.status, JSON.stringify(change)).toBe(409);
      expect(res.body.message).toMatch(/covering letter/);
    }
    const dob = await hod.patch(`/api/masters/consent-fields/${birth}`).send({ required: false });
    expect(dob.status).toBe(409);
    expect(dob.body.message).toMatch(/who is a child/);
    expect((await hod.patch(`/api/masters/consent-fields/${birth}`).send({ isActive: false })).body.message).toMatch(/age/);

    // Home address's "required" is theirs to change ⚠️.
    const optional = await hod.patch(`/api/masters/consent-fields/${home}`).send({ required: false });
    expect(optional.status).toBe(200);
    expect(optional.body.field).toMatchObject({ label: "Home address", required: false, isActive: true });
  });

  it("saves the form's order, audited once, and refuses an order that misses a field added meanwhile", async () => {
    const hod = await visaHod();
    const before = (await hod.get("/api/masters/consent-fields")).body.fields as Field[];
    const ids = before.map((f) => f.id);
    // Institute moved to the top.
    const moved = [ids[10]!, ...ids.filter((id) => id !== ids[10])];
    const res = await hod.put("/api/masters/consent-fields/order").send({ ids: moved });
    expect(res.status).toBe(200);
    expect(res.body.fields.map((f: Field) => f.id)).toEqual(moved);
    expect(res.body.fields[0]).toMatchObject({ label: "Institute", sortOrder: 1 });
    expect(await prisma.auditLog.findMany({ where: { action: "consentField.order" } })).toEqual([
      expect.objectContaining({ before: { ids }, after: { ids: moved } }),
    ]);
    // The same order again writes nothing.
    expect((await hod.put("/api/masters/consent-fields/order").send({ ids: moved })).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "consentField.order" } })).toBe(1);

    await hod.post("/api/masters/consent-fields").send({ label: "YouTube", kind: "LINK" });
    const stale = await hod.put("/api/masters/consent-fields/order").send({ ids: moved });
    expect(stale.status).toBe(409);
    expect(stale.body.details.code).toBe("STALE");
    expect((await hod.put("/api/masters/consent-fields/order").send({ ids: [...moved, moved[0]!] })).status).toBe(409);
    expect((await hod.put("/api/masters/consent-fields/order").send({ ids: [] })).status).toBe(400);
  });
});
