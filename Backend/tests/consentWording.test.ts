import { beforeEach, describe, expect, it } from "vitest";
import { wordingInUse } from "../src/modules/consent/consent.public.service";
import { MAX_CONSENT_WORDING_CHARS } from "../src/modules/consent/consent.schemas";
import { CONSENT_WORDING } from "../src/modules/consent/consent.seed";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";

// The consent form's wording in Settings (docs/decisions/0022-consent-form.md, part 2b): who reads it, who adds a
// version, and which version clients agree to. resetDb seeds the wording set up with the system.

beforeEach(async () => {
  await resetDb();
});

type Agent = Awaited<ReturnType<typeof loginAs>>;
type Version = { id: number; body: string; addedBy: { name: string } | null };

async function visaHod() {
  await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
  return loginAs("riya@masti.test");
}

async function visaStaff(access: "VIEW" | "EDIT" = "EDIT") {
  await createUser({ name: "Aarti", email: "aarti@masti.test", departments: [{ code: "VISA", access }] });
  return loginAs("aarti@masti.test");
}

const list = async (agent: Agent) => (await agent.get("/api/masters/consent-wording")).body.versions as Version[];
const add = (agent: Agent, body: string, basedOnId: number) => agent.post("/api/masters/consent-wording").send({ body, basedOnId });

const MASTI = "Masti's own consent and liability form.\n\nI agree to its terms.";

describe("who can see and change the consent wording", () => {
  it("needs a login, and refuses field staff and other departments", async () => {
    expect((await request(app).get("/api/masters/consent-wording")).status).toBe(401);
    await createUser({ name: "Ravi", mobile: "+919876500001", type: "FIELD" });
    expect((await (await loginAs("9876500001")).get("/api/masters/consent-wording")).status).toBe(403);
    await createUser({ email: "hotels@masti.test", departments: [{ code: "HOTELS", access: "EDIT" }] });
    expect((await (await loginAs("hotels@masti.test")).get("/api/masters/consent-wording")).status).toBe(403);
  });

  it("lets Visa staff read every version, but only the Visa HOD or the Head add one", async () => {
    const staff = await visaStaff("EDIT");
    const versions = await list(staff);
    expect(versions).toHaveLength(1);
    const draft = versions[0]!;
    expect(draft).toMatchObject({ body: CONSENT_WORDING, addedBy: null });

    const refused = await add(staff, MASTI, draft.id);
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/Visa HOD/);
    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    const viewOnly = await loginAs("meena@masti.test");
    expect((await viewOnly.get("/api/masters/consent-wording")).status).toBe(200);
    expect((await add(viewOnly, MASTI, draft.id)).status).toBe(403);

    const byHod = await add(await visaHod(), MASTI, draft.id);
    expect(byHod.status).toBe(201);
    expect((byHod.body.versions as Version[]).map((v) => v.addedBy?.name ?? null)).toEqual(["Riya", null]);

    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    const byHead = await add(await loginAs("vimal@masti.test"), `${MASTI}\n\nSigned.`, byHod.body.versions[0].id);
    expect(byHead.status).toBe(201);
    expect(byHead.body.versions).toHaveLength(3);
  });
});

describe("a new version", () => {
  it("is the one clients agree to from now on, audited; the earlier one stays as it was", async () => {
    const hod = await visaHod();
    const [draft] = await list(hod);
    const res = await add(hod, `  ${MASTI}\n`, draft!.id);
    expect(res.status).toBe(201);
    const [inUse, earlier] = res.body.versions as Version[];
    expect(inUse).toMatchObject({ body: MASTI, addedBy: { name: "Riya" } });
    expect(earlier).toMatchObject({ id: draft!.id, body: CONSENT_WORDING, addedBy: null });

    // The client's page shows the wording in use: now this one.
    expect(await wordingInUse()).toEqual({ id: inUse!.id, body: MASTI });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "consent.wording.add" } });
    expect(entry).toMatchObject({ entityType: "ConsentWording", entityId: String(inUse!.id) });
    expect(entry.after).toMatchObject({ versionId: inUse!.id, body: MASTI });
  });

  it("is refused on an old copy (409), and when blank, too long or the same words again (400)", async () => {
    const hod = await visaHod();
    const [draft] = await list(hod);
    expect((await add(hod, MASTI, draft!.id)).status).toBe(201);
    const stale = await add(hod, `${MASTI}\n\nAgain.`, draft!.id);
    expect(stale.status).toBe(409);
    expect(stale.body.details.code).toBe("STALE");

    const [inUse] = await list(hod);
    for (const body of ["   ", "x".repeat(MAX_CONSENT_WORDING_CHARS + 1)]) {
      expect((await add(hod, body, inUse!.id)).status).toBe(400);
    }
    const same = await add(hod, MASTI, inUse!.id);
    expect(same.status).toBe(400);
    expect(same.body.issues.body[0]).toMatch(/already in use/);
    expect((await add(hod, "x".repeat(MAX_CONSENT_WORDING_CHARS), inUse!.id)).status).toBe(201);
    expect(await prisma.consentWording.count()).toBe(3);
  });

  it("lets one of two saved at the same moment through, and tells the other to reload", async () => {
    const hod = await visaHod();
    const [draft] = await list(hod);
    const results = await Promise.all(["One.", "Two."].map((end) => add(hod, `${MASTI}\n${end}`, draft!.id)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.details.code).toBe("STALE");
    expect(await prisma.consentWording.count()).toBe(2);
  });
});
