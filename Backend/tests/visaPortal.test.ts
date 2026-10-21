import { beforeEach, describe, expect, it } from "vitest";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { redeemLimitStore } from "../src/modules/portalLogins/portalHelper.routes";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";
import { maturedCase, saveCase } from "./visaHelpers";

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

describe("Log in for me on a case", () => {
  const HELPER = "chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh";
  const redeem = (ticket: string) => request(app).post("/api/portal-helper/redeem").set("Origin", HELPER).send({ ticket });
  const press = (agent: Agent, caseNo: string) => agent.post(`/api/visa/cases/${caseNo}/portal/open`).send({});

  beforeEach(() => redeemLimitStore.resetAll());

  /** Postponed needs a reason and a resume date; closed has nothing due (checks in the migrations). */
  async function setStatus(caseId: string, status: "POSTPONED" | "CLOSED") {
    const reason = await prisma.enquiryReason.findFirstOrThrow();
    const data = status === "POSTPONED" ? { status, reasonId: reason.id, resumeOn: new Date("2026-12-01") } : { status, dueAt: null, resumeOn: null };
    await prisma.enquiry.update({ where: { id: caseId }, data });
  }

  /** A France · Tourist case at step 3 given to Neha, its visa linked to a portal nobody is listed on. */
  async function caseWithPortal() {
    const c = await maturedCase();
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    await createUser({ name: "Kiran", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    const riya = await loginAs("riya@masti.test");
    const portal = await addPortal(riya);
    const visa = await franceTourist();
    expect((await riya.patch(`/api/masters/visa-offerings/${visa.id}`).send({ portalLoginId: portal.id })).status).toBe(200);
    return { c, riya, portal, visa, neha: await loginAs("neha@masti.test"), kiran: await loginAs("kiran@masti.test") };
  }

  it("lets the person on the case log in though not on the portal's list, and keeps the case with the press", async () => {
    const { c, riya, portal, neha } = await caseWithPortal();
    const page = await neha.get(`/api/visa/cases/${c.caseNo}`);
    expect(page.body.case.portal).toEqual({ id: portal.id, name: "France visa portal", userIds: [], helperIds: ["aaaabbbbccccddddeeeeffffgggghhhh"] });
    expect(page.text).not.toContain("Spring-Visa-2026!");

    const opened = await press(neha, c.caseNo);
    expect(opened.status).toBe(201);
    const use = await prisma.portalLoginUse.findUniqueOrThrow({ where: { id: opened.body.useId } });
    expect(use.enquiryId).toBe(c.id);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "portalLogin.open" } });
    expect(entry.after).toMatchObject({ useId: use.id, caseNo: c.caseNo });

    const collected = await redeem(opened.body.ticket);
    expect(collected.status).toBe(200);
    expect(collected.body.loginId).toBe("MASTI-AGENT-01");
    const uses = (await riya.get("/api/portal-logins")).body.uses;
    expect(uses[0]).toMatchObject({ caseNo: c.caseNo, user: { name: "Neha Joshi" }, portal: { name: "France visa portal" } });
  });

  it("also lets the HOD and the Head press it; staff not on the case can't, even on the portal's list", async () => {
    const { c, riya, portal, kiran } = await caseWithPortal();
    expect((await press(kiran, c.caseNo)).status).toBe(403);
    expect((await press(await loginAs("aarti@masti.test"), c.caseNo)).status).toBe(403);
    expect((await press(riya, c.caseNo)).status).toBe(201);
    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    expect((await press(await loginAs("vimal@masti.test"), c.caseNo)).status).toBe(201);

    const kiranId = (await prisma.user.findUniqueOrThrow({ where: { email: "kiran@masti.test" } })).id;
    const listed = await riya.patch(`/api/portal-logins/${portal.id}`).send({ userIds: [kiranId], updatedAt: portal.updatedAt });
    expect(listed.status).toBe(200);
    // Staff open only their own cases (0006 Decision 1); the list is for Settings → Portal logins.
    expect((await press(kiran, c.caseNo)).status).toBe(403);
    expect((await riya.get(`/api/visa/cases/${c.caseNo}`)).body.case.portal.userIds).toEqual([kiranId]);
  });

  it("works from step 3 until the case closes, not before, and not while it's postponed", async () => {
    const { c, riya, neha } = await caseWithPortal();
    const dispatch = await prisma.departmentStage.findFirstOrThrow({ where: { code: "AT_VENDOR" } });
    await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: dispatch.id } });
    expect((await press(neha, c.caseNo)).status).toBe(201);

    await setStatus(c.id, "POSTPONED");
    const postponed = await press(riya, c.caseNo);
    expect(postponed.status).toBe(409);
    expect(postponed.body.message).toMatch(/Resume it first/);
    await setStatus(c.id, "CLOSED");
    expect((await press(riya, c.caseNo)).status).toBe(409);

    const early = await saveCase(await loginAs("aarti@masti.test"));
    const notYet = await press(riya, early.caseNo);
    expect(notYet.status).toBe(409);
    expect(notYet.body.message).toMatch(/step 3/);
  });

  it("says so when the visa has no portal", async () => {
    const { c, riya, visa, neha } = await caseWithPortal();
    await riya.patch(`/api/masters/visa-offerings/${visa.id}`).send({ portalLoginId: null });
    expect((await neha.get(`/api/visa/cases/${c.caseNo}`)).body.case.portal).toBeNull();
    const res = await press(neha, c.caseNo);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("No portal saved for this visa. Ask your HOD to add it.");
  });

  describe("collecting checks the case again", () => {
    const changes: [string, (ids: { caseId: string; visaId: number }) => Promise<unknown>][] = [
      ["given to someone else", async ({ caseId }) => {
        const kiran = await prisma.user.findUniqueOrThrow({ where: { email: "kiran@masti.test" } });
        await prisma.enquiry.update({ where: { id: caseId }, data: { ownerId: kiran.id } });
      }],
      ["the visa no longer names the portal", ({ visaId }) => prisma.visaOffering.update({ where: { id: visaId }, data: { portalLoginId: null } })],
      ["the case postponed", ({ caseId }) => setStatus(caseId, "POSTPONED")],
    ];
    for (const [what, change] of changes) {
      it(`refuses when ${what}`, async () => {
        const { c, visa, neha } = await caseWithPortal();
        const opened = await press(neha, c.caseNo);
        expect(opened.status).toBe(201);
        await change({ caseId: c.id, visaId: visa.id });
        const res = await redeem(opened.body.ticket);
        expect(res.status).toBe(403);
        expect(res.text).not.toContain("Spring-Visa-2026!");
        expect(await prisma.portalLoginUse.findUniqueOrThrow({ where: { id: opened.body.useId } })).toMatchObject({ outcome: "REFUSED" });
      });
    }
  });
});
