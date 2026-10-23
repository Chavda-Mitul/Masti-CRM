import { beforeEach, describe, expect, it } from "vitest";
import { openPortalSecret } from "../src/modules/portalLogins/portalLogins.service";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";

// Settings → Portal logins (docs/decisions/0024-portal-logins.md): the Head and a department's HOD add, change and remove
// its portals; staff see the ones they're listed on. The ID and password are sealed and never leave the server here.

const LOGIN_ID = "MASTI-AGENT-01";
const PASSWORD = "Spring-Visa-2026!";

const france = (userIds: string[] = []) => ({
  departmentCode: "VISA",
  name: "France visa portal",
  loginUrl: "https://France-Visas.gouv.fr/login",
  loginId: LOGIN_ID,
  password: PASSWORD,
  userIds,
});

const indigo = (userIds: string[] = []) => ({
  departmentCode: "TICKETS",
  name: "IndiGo agent portal",
  loginUrl: "https://agents.goindigo.in/",
  idLabel: "Agency code",
  loginId: "AG-4471",
  password: "Wings-2026",
  userIds,
});

async function team() {
  const vimal = await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
  const riya = await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
  const tarun = await createUser({ name: "Tarun", email: "tarun@masti.test", departments: [{ code: "TICKETS", role: "HOD" }] });
  const neha = await createUser({ name: "Neha", email: "neha@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
  const aarti = await createUser({ name: "Aarti", email: "aarti@masti.test", departments: [{ code: "VISA" }] });
  const nidhi = await createUser({ name: "Nidhi", email: "nidhi@masti.test", departments: [{ code: "TICKETS", access: "EDIT" }] });
  return { vimal, riya, tarun, neha, aarti, nidhi };
}

type Agent = Awaited<ReturnType<typeof loginAs>>;

/** Logs these people in, by the name before @masti.test, in order. */
async function agents<const N extends readonly string[]>(...names: N): Promise<{ [K in keyof N]: Agent }> {
  const out: Agent[] = [];
  for (const name of names) out.push(await loginAs(`${name}@masti.test`));
  return out as { [K in keyof N]: Agent };
}

async function add(agent: Agent, body: object) {
  const res = await agent.post("/api/portal-logins").send(body);
  if (res.status !== 201) throw new Error(`add failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.portal;
}

async function page(agent: Agent) {
  const res = await agent.get("/api/portal-logins");
  expect(res.status).toBe(200);
  return res.body;
}

beforeEach(resetDb);

describe("Settings → Portal logins", () => {
  it("needs a session, and gives field staff nothing", async () => {
    expect((await request(app).get("/api/portal-logins")).status).toBe(401);
    await createUser({ name: "Ramesh", mobile: "+919825041234", type: "FIELD" });
    const field = await loginAs("9825041234");
    expect((await field.get("/api/portal-logins")).status).toBe(403);
  });

  it("lets the Head and the department's HOD add a portal, and nobody else", async () => {
    await team();
    const [vimal, riya, tarun, neha] = await agents("vimal", "riya", "tarun", "neha");
    expect((await vimal.post("/api/portal-logins").send(france())).status).toBe(201);
    expect((await riya.post("/api/portal-logins").send({ ...france(), name: "China visa portal" })).status).toBe(201);
    expect((await tarun.post("/api/portal-logins").send({ ...france(), name: "UK visa portal" })).status).toBe(403);
    expect((await neha.post("/api/portal-logins").send({ ...france(), name: "UK visa portal" })).status).toBe(403);
    expect(await prisma.portalLogin.count()).toBe(2);
  });

  it("never sends or audits the ID or password, and keeps them sealed", async () => {
    const { neha } = await team();
    const vimal = await loginAs("vimal@masti.test");
    const created = await vimal.post("/api/portal-logins").send(france([neha.id]));
    expect(created.status).toBe(201);
    expect(created.body.portal).toMatchObject({
      name: "France visa portal",
      idLabel: "ID",
      loginUrl: "https://france-visas.gouv.fr/login",
      secureAddress: true,
      department: { code: "VISA" },
      users: [{ id: neha.id, name: "Neha" }],
      canUse: true,
      canEdit: true,
    });

    const listText = (await vimal.get("/api/portal-logins")).text;
    const nehaText = (await (await loginAs("neha@masti.test")).get("/api/portal-logins")).text;
    for (const text of [created.text, listText, nehaText]) {
      expect(text).not.toContain(LOGIN_ID);
      expect(text).not.toContain(PASSWORD);
    }
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "portalLogin.create" } });
    expect(JSON.stringify([entry.before, entry.after])).not.toContain(LOGIN_ID);
    expect(JSON.stringify([entry.before, entry.after])).not.toContain(PASSWORD);
    expect(entry.after).toMatchObject({ name: "France visa portal", userIds: [neha.id], status: "ACTIVE" });

    const row = await prisma.portalLogin.findUniqueOrThrow({ where: { id: created.body.portal.id } });
    expect(Buffer.from(row.secret!).toString("latin1")).not.toContain(PASSWORD);
    expect(openPortalSecret(row)).toEqual({ loginId: LOGIN_ID, password: PASSWORD });
  });

  it("refuses what can't be saved", async () => {
    const { nidhi } = await team();
    const field = await createUser({ name: "Ramesh", mobile: "+919825041234", type: "FIELD" });
    const gone = await createUser({ name: "Old Staff", email: "old@masti.test", isActive: false, departments: [{ code: "VISA" }] });
    const vimal = await loginAs("vimal@masti.test");
    const bad = [
      { ...france(), name: "   " },
      { ...france(), loginUrl: "ftp://france-visas.gouv.fr" },
      { ...france(), loginUrl: "javascript:alert(1)" },
      { ...france(), loginUrl: "https://agent:secret@france-visas.gouv.fr/login" },
      { ...france(), loginUrl: "france-visas.gouv.fr" },
      { ...france(), loginId: " " },
      { ...france(), password: "" },
      { ...france(), idLabel: "x".repeat(31) },
      france([nidhi.id]),
      france([field.id]),
      france([gone.id]),
    ];
    for (const body of bad) {
      const res = await vimal.post("/api/portal-logins").send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const { loginId: _id, ...withoutId } = france();
    const { password: _pw, ...withoutPassword } = france();
    expect((await vimal.post("/api/portal-logins").send(withoutId)).status).toBe(400);
    expect((await vimal.post("/api/portal-logins").send(withoutPassword)).status).toBe(400);
    expect((await vimal.post("/api/portal-logins").send({ ...france(), departmentCode: "CRUISE" })).status).toBe(400);
    expect(await prisma.portalLogin.count()).toBe(0);

    // A supplier's portal may have no https: saved, with a warning for the managers.
    const plain = await vimal.post("/api/portal-logins").send({ ...france(), name: "Hi Ace India", loginUrl: "http://www.hiaceindia.in/" });
    expect(plain.status).toBe(201);
    expect(plain.body.portal).toMatchObject({ loginUrl: "http://www.hiaceindia.in/", secureAddress: false });
  });

  it("keeps one active portal of a name per department, whatever the case", async () => {
    await team();
    const vimal = await loginAs("vimal@masti.test");
    const first = await add(vimal, france());
    const twice = await vimal.post("/api/portal-logins").send({ ...france(), name: "FRANCE VISA PORTAL" });
    expect(twice.status).toBe(409);
    expect(twice.body.message).toMatch(/already a portal called/);
    expect((await vimal.post("/api/portal-logins").send({ ...indigo(), name: "France visa portal" })).status).toBe(201);
    expect((await vimal.post(`/api/portal-logins/${first.id}/remove`).send({})).status).toBe(200);
    expect((await vimal.post("/api/portal-logins").send(france())).status).toBe(201);
  });

  it("shows the Head everything, an HOD their departments, and staff only the portals they're listed on", async () => {
    const { neha, nidhi } = await team();
    const vimal = await loginAs("vimal@masti.test");
    await add(vimal, france([neha.id]));
    await add(vimal, indigo([nidhi.id]));
    const [riya, nehaAgent, aarti, nidhiAgent] = await agents("riya", "neha", "aarti", "nidhi");

    const head = await page(vimal);
    expect(head.portals.map((p: { name: string }) => p.name)).toEqual(["France visa portal", "IndiGo agent portal"]);
    expect(head.addTo.map((d: { code: string }) => d.code)).toEqual(["VISA", "HOLIDAYS", "HOTELS", "INSURANCE", "TICKETS", "ACCOUNTS"]);
    expect(head).toMatchObject({ officeAddressesSet: false, ready: true, helperIds: ["aaaabbbbccccddddeeeeffffgggghhhh"], uses: [] });

    const hod = await page(riya);
    expect(hod.portals).toHaveLength(1);
    expect(hod.portals[0]).toMatchObject({ name: "France visa portal", canEdit: true, canUse: true, loginUrl: expect.any(String) });
    expect(hod.addTo).toEqual([{ code: "VISA", name: "Visa" }]);

    const staff = await page(nehaAgent);
    expect(staff.portals).toHaveLength(1);
    expect(staff.portals[0]).toMatchObject({ name: "France visa portal", canUse: true, canEdit: false });
    expect(staff.portals[0]).not.toHaveProperty("loginUrl");
    expect(staff.portals[0]).not.toHaveProperty("secureAddress");
    expect(staff.addTo).toEqual([]);

    expect((await page(aarti)).portals).toEqual([]);
    expect((await page(nidhiAgent)).portals.map((p: { name: string }) => p.name)).toEqual(["IndiGo agent portal"]);

    // Taken out of Visa: off the page, though still on the list.
    await prisma.userDepartment.deleteMany({ where: { userId: neha.id } });
    expect((await page(nehaAgent)).portals).toEqual([]);

    // A switched-off department's portals are hidden from everyone.
    await prisma.department.update({ where: { code: "TICKETS" }, data: { isActive: false } });
    expect((await page(vimal)).portals.map((p: { name: string }) => p.name)).toEqual(["France visa portal"]);
    expect((await page(nidhiAgent)).portals).toEqual([]);
  });

  it("offers an HOD the department's office staff for the list", async () => {
    await team();
    await createUser({ name: "Old Staff", email: "old@masti.test", isActive: false, departments: [{ code: "VISA" }] });
    const [riya, neha] = await agents("riya", "neha");
    const res = await riya.get("/api/portal-logins/people?department=visa");
    expect(res.status).toBe(200);
    expect(res.body.people.map((p: { name: string; role: string }) => `${p.name} ${p.role}`)).toEqual(["Aarti STAFF", "Neha STAFF", "Riya HOD"]);
    expect((await neha.get("/api/portal-logins/people?department=VISA")).status).toBe(403);
    expect((await riya.get("/api/portal-logins/people?department=TICKETS")).status).toBe(403);
  });

  it("changes a portal from the version opened, keeping the ID and password unless new ones are typed", async () => {
    const { neha, aarti } = await team();
    const vimal = await loginAs("vimal@masti.test");
    const portal = await add(vimal, france([neha.id]));
    const url = `/api/portal-logins/${portal.id}`;
    const [riya, tarun, nehaAgent] = await agents("riya", "tarun", "neha");
    const sealed = async () => (await prisma.portalLogin.findUniqueOrThrow({ where: { id: portal.id } })).secret!;
    const original = await sealed();

    expect((await tarun.patch(url).send({ name: "Mine", updatedAt: portal.updatedAt })).status).toBe(403);
    expect((await nehaAgent.patch(url).send({ name: "Mine", updatedAt: portal.updatedAt })).status).toBe(403);

    // The name only: the sealed login and the password date stay.
    const renamed = await riya.patch(url).send({ name: "France-Visas", updatedAt: portal.updatedAt });
    expect(renamed.status).toBe(200);
    expect(renamed.body.portal).toMatchObject({ name: "France-Visas", passwordChangedAt: portal.passwordChangedAt });
    expect(Buffer.from(await sealed()).equals(Buffer.from(original))).toBe(true);

    // Someone else saved first: refused.
    const stale = await vimal.patch(url).send({ name: "Too late", updatedAt: portal.updatedAt });
    expect(stale.status).toBe(409);
    expect(stale.body.details).toEqual({ code: "STALE" });

    // A new password: the ID is kept, the date moves, the audit says so without the values.
    const newPassword = await riya.patch(url).send({ password: "Autumn-Visa-2026!", updatedAt: renamed.body.portal.updatedAt });
    expect(newPassword.status).toBe(200);
    expect(new Date(newPassword.body.portal.passwordChangedAt).getTime()).toBeGreaterThan(new Date(portal.passwordChangedAt).getTime());
    const row = await prisma.portalLogin.findUniqueOrThrow({ where: { id: portal.id } });
    expect(openPortalSecret(row)).toEqual({ loginId: LOGIN_ID, password: "Autumn-Visa-2026!" });
    const entries = await prisma.auditLog.findMany({ where: { action: "portalLogin.update" }, orderBy: { id: "asc" } });
    expect(entries).toHaveLength(2);
    expect(entries[1]!.after).toMatchObject({ passwordChanged: true });
    expect(JSON.stringify(entries.map((e) => [e.before, e.after]))).not.toContain("Autumn-Visa-2026!");

    // The list only: still a change, so updatedAt moves and the audit has it.
    const listed = await riya.patch(url).send({ userIds: [neha.id, aarti.id], updatedAt: newPassword.body.portal.updatedAt });
    expect(listed.status).toBe(200);
    expect(listed.body.portal.users.map((u: { name: string }) => u.name)).toEqual(["Aarti", "Neha"]);
    expect(listed.body.portal.updatedAt).not.toBe(newPassword.body.portal.updatedAt);
    expect(await prisma.auditLog.count({ where: { action: "portalLogin.update" } })).toBe(3);

    // Nothing changed: nothing written.
    const same = await riya.patch(url).send({ name: "France-Visas", updatedAt: listed.body.portal.updatedAt });
    expect(same.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "portalLogin.update" } })).toBe(3);

    expect((await riya.patch(url).send({ password: "", updatedAt: listed.body.portal.updatedAt })).status).toBe(400);
  });

  it("removes a portal once, wiping its ID and password and keeping the row", async () => {
    const { neha } = await team();
    const vimal = await loginAs("vimal@masti.test");
    const portal = await add(vimal, france([neha.id]));
    const nehaAgent = await loginAs("neha@masti.test");
    expect((await nehaAgent.post(`/api/portal-logins/${portal.id}/remove`).send({})).status).toBe(403);

    const removed = await vimal.post(`/api/portal-logins/${portal.id}/remove`).send({});
    expect(removed.status).toBe(200);
    expect(removed.body.portal).toMatchObject({ status: "REMOVED", canUse: false });
    const row = await prisma.portalLogin.findUniqueOrThrow({ where: { id: portal.id } });
    expect(row).toMatchObject({ status: "REMOVED", secret: null });
    expect((await page(nehaAgent)).portals).toEqual([]);
    expect((await vimal.patch(`/api/portal-logins/${portal.id}`).send({ name: "Back", updatedAt: removed.body.portal.updatedAt })).status).toBe(400);

    expect((await vimal.post(`/api/portal-logins/${portal.id}/remove`).send({})).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "portalLogin.remove" } })).toBe(1);
  });
});

describe("a third login box (an agency code)", () => {
  it("stores the extra box's name, seals its value, and never shows the value", async () => {
    await team();
    const [vimal] = await agents("vimal");
    const portal = await add(vimal, { ...france(), extraLabel: "Agency code", extra: "AG-99" });
    expect(portal.extraLabel).toBe("Agency code");
    expect(JSON.stringify(portal)).not.toContain("AG-99");

    const row = await prisma.portalLogin.findUniqueOrThrow({ where: { id: portal.id } });
    expect(row.extraLabel).toBe("Agency code");
    expect(openPortalSecret(row)).toEqual({ loginId: LOGIN_ID, password: PASSWORD, extra: "AG-99" });

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "portalLogin.create" } });
    expect(JSON.stringify(entry.after)).toContain("Agency code");
    expect(JSON.stringify(entry.after)).not.toContain("AG-99");
  });

  it("needs both the extra box's name and its value, or neither", async () => {
    await team();
    const [vimal] = await agents("vimal");
    expect((await vimal.post("/api/portal-logins").send({ ...france(), extraLabel: "Agency code" })).status).toBe(400);
    expect((await vimal.post("/api/portal-logins").send({ ...france(), extra: "AG-99" })).status).toBe(400);
    expect((await vimal.post("/api/portal-logins").send(france())).status).toBe(201);
  });

  it("changes the value, renames the box keeping the value, and removes the box", async () => {
    await team();
    const [vimal] = await agents("vimal");
    let portal = await add(vimal, { ...france(), extraLabel: "Agency code", extra: "AG-99" });
    const opened = async () => openPortalSecret(await prisma.portalLogin.findUniqueOrThrow({ where: { id: portal.id } }));

    let res = await vimal.patch(`/api/portal-logins/${portal.id}`).send({ extra: "AG-100", updatedAt: portal.updatedAt });
    expect(res.status).toBe(200);
    portal = res.body.portal;
    expect(await opened()).toMatchObject({ extra: "AG-100" });

    res = await vimal.patch(`/api/portal-logins/${portal.id}`).send({ extraLabel: "Partner code", updatedAt: portal.updatedAt });
    expect(res.status).toBe(200);
    portal = res.body.portal;
    expect(portal.extraLabel).toBe("Partner code");
    expect(await opened()).toMatchObject({ extra: "AG-100" });

    res = await vimal.patch(`/api/portal-logins/${portal.id}`).send({ extraLabel: "", updatedAt: portal.updatedAt });
    expect(res.status).toBe(200);
    expect(res.body.portal.extraLabel).toBeNull();
    expect(await opened()).toEqual({ loginId: LOGIN_ID, password: PASSWORD });
  });
});

describe("steps shown on the portal", () => {
  it("stores the steps, shows them on the portal, and edits them", async () => {
    const { neha: nehaUser } = await team();
    const [vimal, neha] = await agents("vimal", "neha");
    const portal = await add(vimal, { ...france([]), steps: ["Fill the application form", "Enter the acknowledgement number"] });
    expect(portal.steps).toEqual(["Fill the application form", "Enter the acknowledgement number"]);
    // Staff on the list see the steps on the page too.
    const added = await vimal.patch(`/api/portal-logins/${portal.id}`).send({ userIds: [nehaUser.id], updatedAt: portal.updatedAt });
    expect(added.status).toBe(200);
    expect((await page(neha)).portals[0].steps).toEqual(["Fill the application form", "Enter the acknowledgement number"]);

    const res = await vimal.patch(`/api/portal-logins/${portal.id}`).send({ steps: ["Only one step"], updatedAt: added.body.portal.updatedAt });
    expect(res.status).toBe(200);
    expect(res.body.portal.steps).toEqual(["Only one step"]);

    const tooMany = await vimal.patch(`/api/portal-logins/${portal.id}`).send({ steps: Array(21).fill("x"), updatedAt: res.body.portal.updatedAt });
    expect(tooMany.status).toBe(400);
  });
});
