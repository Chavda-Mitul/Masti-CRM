import { beforeEach, describe, expect, it } from "vitest";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";

// "Log in for me" on the visa case (docs/decisions/0024-portal-logins.md, component 3). Each visa names the portal its
// cases open, picked by the Head or the Visa HOD on the visa's settings page.

type Agent = Awaited<ReturnType<typeof loginAs>>;

async function franceTourist() {
  const fr = await prisma.country.findUniqueOrThrow({ where: { code: "FR" } });
  return prisma.visaOffering.findFirstOrThrow({ where: { countryId: fr.id } });
}

async function addPortal(agent: Agent, body: Record<string, unknown> = {}) {
  const res = await agent.post("/api/portal-logins").send({
    departmentCode: "VISA",
    name: "France visa portal",
    loginUrl: "https://france-visas.gouv.fr/login",
    loginId: "MASTI-AGENT-01",
    password: "Spring-Visa-2026!",
    ...body,
  });
  if (res.status !== 201) throw new Error(`add failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.portal as { id: string; name: string; updatedAt: string };
}

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

describe("a visa's portal", () => {
  async function team() {
    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    await createUser({ name: "Tarun", email: "tarun@masti.test", departments: [{ code: "TICKETS", role: "HOD" }] });
    await createUser({ name: "Aarti", email: "aarti@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    return { riya: await loginAs("riya@masti.test"), vimal: await loginAs("vimal@masti.test"), aarti: await loginAs("aarti@masti.test") };
  }

  it("is picked by the Head or the Visa HOD, shown on the visa's page, audited, and can be cleared", async () => {
    const { riya, aarti } = await team();
    const visa = await franceTourist();
    const portal = await addPortal(riya);
    const url = `/api/masters/visa-offerings/${visa.id}`;

    expect((await aarti.patch(url).send({ portalLoginId: portal.id })).status).toBe(403);

    const linked = await riya.patch(url).send({ portalLoginId: portal.id });
    expect(linked.status).toBe(200);
    expect(linked.body.offering).toMatchObject({ portal: { id: portal.id, name: "France visa portal" } });
    const checklist = await aarti.get(`${url}/checklist`);
    expect(checklist.body.offering.portal).toEqual({ id: portal.id, name: "France visa portal" });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visaOffering.update" } });
    expect(entry).toMatchObject({ before: { portalLoginId: null }, after: { portalLoginId: portal.id } });

    const cleared = await riya.patch(url).send({ portalLoginId: null });
    expect(cleared.status).toBe(200);
    expect((await aarti.get(`${url}/checklist`)).body.offering.portal).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "visaOffering.update" } })).toBe(2);
  });

  it("must be one of the Visa department's portals that's still in use", async () => {
    const { riya, vimal } = await team();
    const visa = await franceTourist();
    const url = `/api/masters/visa-offerings/${visa.id}`;
    const tickets = await addPortal(vimal, { departmentCode: "TICKETS", name: "IndiGo agent portal" });
    const gone = await addPortal(riya, { name: "Old visa portal" });
    expect((await riya.post(`/api/portal-logins/${gone.id}/remove`).send({})).status).toBe(200);

    for (const portalLoginId of [tickets.id, gone.id, "00000000-0000-4000-8000-000000000000", "not-an-id"]) {
      const res = await riya.patch(url).send({ portalLoginId });
      expect(res.status, portalLoginId).toBe(400);
    }
    expect((await prisma.visaOffering.findUniqueOrThrow({ where: { id: visa.id } })).portalLoginId).toBeNull();
  });

  it("is cleared from its visas when the portal is removed, audited", async () => {
    const { riya } = await team();
    const visa = await franceTourist();
    const portal = await addPortal(riya);
    await riya.patch(`/api/masters/visa-offerings/${visa.id}`).send({ portalLoginId: portal.id });

    expect((await riya.post(`/api/portal-logins/${portal.id}/remove`).send({})).status).toBe(200);
    expect((await prisma.visaOffering.findUniqueOrThrow({ where: { id: visa.id } })).portalLoginId).toBeNull();
    const entries = await prisma.auditLog.findMany({ where: { action: "visaOffering.update", entityId: String(visa.id) }, orderBy: { id: "asc" } });
    expect(entries.at(-1)).toMatchObject({ before: { portalLoginId: portal.id }, after: { portalLoginId: null } });
  });
});
