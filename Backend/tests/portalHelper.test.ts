import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { sealSecret } from "../src/lib/secretBox";
import { clearOfficeNetworkCache } from "../src/modules/auth/officeNetwork";
import { redeemLimitStore } from "../src/modules/portalLogins/portalHelper.routes";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";

// "Log in for me" (docs/decisions/0024-portal-logins.md): a press makes a one-time ticket; the CRM helper collects the ID
// and password with it. The ticket works once, for 30 seconds, only for the helper, only from the computer that pressed
// (or the office), and collecting checks everything again.

/** The made-up helper ID tests run with (vitest.config.mts). */
const HELPER = "chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh";
const LOGIN_ID = "MASTI-AGENT-01";
const PASSWORD = "Spring-Visa-2026!";

type Agent = Awaited<ReturnType<typeof loginAs>>;

const redeem = (ticket: unknown, origin: string | null = HELPER) => {
  const req = request(app).post("/api/portal-helper/redeem");
  return (origin ? req.set("Origin", origin) : req).send({ ticket });
};

async function setOfficeAddresses(allow: string[], enabled = false) {
  const value = { enabled, allow, exemptUserTypes: ["FIELD"] };
  await prisma.setting.upsert({ where: { key: "officeNetwork" }, create: { key: "officeNetwork", value }, update: { value } });
  clearOfficeNetworkCache();
}

async function setup() {
  await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
  await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
  await createUser({ name: "Tarun", email: "tarun@masti.test", departments: [{ code: "TICKETS", role: "HOD" }] });
  const neha = await createUser({ name: "Neha", email: "neha@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
  await createUser({ name: "Aarti", email: "aarti@masti.test", departments: [{ code: "VISA" }] });
  const vimal = await loginAs("vimal@masti.test");
  const added = await vimal.post("/api/portal-logins").send({
    departmentCode: "VISA",
    name: "France visa portal",
    loginUrl: "https://france-visas.gouv.fr/login",
    loginId: LOGIN_ID,
    password: PASSWORD,
    userIds: [neha.id],
  });
  expect(added.status).toBe(201);
  return { vimal, neha, portal: added.body.portal as { id: string } };
}

async function press(agent: Agent, portalId: string) {
  const res = await agent.post(`/api/portal-logins/${portalId}/open`).send({});
  if (res.status !== 201) throw new Error(`press failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body as { useId: string; ticket: string };
}

beforeEach(async () => {
  await resetDb();
  redeemLimitStore.resetAll();
});

describe("Log in for me", () => {
  it("gives the helper the ID and password once, for one press", async () => {
    const { portal } = await setup();
    const neha = await loginAs("neha@masti.test");
    const { useId, ticket } = await press(neha, portal.id);
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const opened = await prisma.portalLoginUse.findUniqueOrThrow({ where: { id: useId } });
    expect(opened).toMatchObject({ ticketHash: createHash("sha256").update(ticket).digest("hex"), redeemedAt: null, outcome: null });
    expect(opened.openedIp).toBeTruthy();
    expect(await prisma.auditLog.count({ where: { action: "portalLogin.open" } })).toBe(1);

    const collected = await redeem(ticket);
    expect(collected.status).toBe(200);
    expect(collected.headers["cache-control"]).toBe("no-store");
    expect(collected.body).toEqual({ loginUrl: "https://france-visas.gouv.fr/login", loginId: LOGIN_ID, password: PASSWORD });
    const used = await prisma.portalLoginUse.findUniqueOrThrow({ where: { id: useId } });
    expect(used).toMatchObject({ ticketHash: null, redeemedIp: opened.openedIp });
    expect(used.redeemedAt).toBeInstanceOf(Date);
    const entries = await prisma.auditLog.findMany({ where: { action: "portalLogin.use" } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorId: opened.userId, entityId: portal.id });
    expect(JSON.stringify(entries.map((e) => [e.before, e.after]))).not.toContain(PASSWORD);

    // Spent, unknown or expired: the same answer.
    const again = await redeem(ticket);
    expect(again.status).toBe(410);
    expect(again.body.message).toBe("This login has run out. Press Log in for me again.");
    expect((await redeem(randomBytes(32).toString("base64url"))).body).toEqual(again.body);
  });

  it("refuses a ticket after its 30 seconds", async () => {
    const { portal } = await setup();
    const neha = await loginAs("neha@masti.test");
    const { useId, ticket } = await press(neha, portal.id);
    const past = Date.now() - 2 * 60_000;
    await prisma.portalLoginUse.update({ where: { id: useId }, data: { createdAt: new Date(past), ticketExpiresAt: new Date(past + 30_000) } });
    expect((await redeem(ticket)).status).toBe(410);
  });

  it("hands over a third login box when the portal has one", async () => {
    const nehaUser = await createUser({ name: "Neha", email: "neha@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    const vimal = await loginAs("vimal@masti.test");
    const neha = await loginAs("neha@masti.test");
    const added = await vimal.post("/api/portal-logins").send({
      departmentCode: "VISA",
      name: "DVMS Gold Medal",
      loginUrl: "https://www.gold-medal.in/pos/",
      idLabel: "Username",
      loginId: LOGIN_ID,
      password: PASSWORD,
      extraLabel: "Agency code",
      extra: "AG-99",
      steps: ["Fill the application form", "Enter the acknowledgement number"],
      userIds: [nehaUser.id],
    });
    expect(added.status).toBe(201);
    const { ticket } = await press(neha, added.body.portal.id);
    const got = await redeem(ticket);
    expect(got.status).toBe(200);
    expect(got.body).toEqual({
      loginUrl: "https://www.gold-medal.in/pos/",
      loginId: LOGIN_ID,
      password: PASSWORD,
      extraLabel: "Agency code",
      extra: "AG-99",
      steps: ["Fill the application form", "Enter the acknowledgement number"],
    });
  });

  it("hands the login only to the helper", async () => {
    const { portal } = await setup();
    const neha = await loginAs("neha@masti.test");
    const { ticket } = await press(neha, portal.id);
    for (const origin of [null, "http://localhost:5173", "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]) {
      const res = await redeem(ticket, origin);
      expect(res.status, String(origin)).toBe(403);
      expect(res.text).not.toContain(PASSWORD);
    }
    expect((await redeem(5)).status).toBe(400);
    // Those refusals didn't spend it.
    expect((await redeem(ticket)).status).toBe(200);
  });

  describe("checks everything again when the helper collects", () => {
    const cases: [string, (ids: { userId: string; portalId: string }) => Promise<unknown>, number][] = [
      ["switched off", ({ userId }) => prisma.user.update({ where: { id: userId }, data: { isActive: false } }), 403],
      ["taken off the list", ({ portalId }) => prisma.portalLoginUser.deleteMany({ where: { portalLoginId: portalId } }), 403],
      ["on a temporary password", ({ userId }) => prisma.user.update({ where: { id: userId }, data: { mustChangePassword: true } }), 403],
      ["no longer in the office", () => setOfficeAddresses(["203.0.113.0/24"]), 403],
      ["the portal removed", ({ portalId }) => prisma.portalLogin.update({ where: { id: portalId }, data: { status: "REMOVED", secret: null } }), 410],
      [
        "the saved login unreadable",
        ({ portalId }) => prisma.portalLogin.update({ where: { id: portalId }, data: { secret: new Uint8Array(sealSecret({ loginId: "x", password: "y" }, "another-row")) } }),
        409,
      ],
    ];
    for (const [what, change, status] of cases) {
      it(`refuses when ${what}, and spends the ticket`, async () => {
        const { portal } = await setup();
        const neha = await loginAs("neha@masti.test");
        const { useId, ticket } = await press(neha, portal.id);
        const userId = (await prisma.portalLoginUse.findUniqueOrThrow({ where: { id: useId } })).userId;
        await change({ userId, portalId: portal.id });

        const res = await redeem(ticket);
        expect(res.status).toBe(status);
        expect(res.text).not.toContain(PASSWORD);
        expect(await prisma.portalLoginUse.findUniqueOrThrow({ where: { id: useId } })).toMatchObject({ ticketHash: null, redeemedAt: null, outcome: "REFUSED" });
        expect(await prisma.auditLog.count({ where: { action: "portalLogin.refuse" } })).toBe(1);
        expect(await prisma.auditLog.count({ where: { action: "portalLogin.use" } })).toBe(0);
        expect((await redeem(ticket)).status).toBe(410);
      });
    }
  });

  it("finishes only on the computer that pressed, or on an office one", async () => {
    const { portal } = await setup();
    const neha = await loginAs("neha@masti.test");

    const first = await press(neha, portal.id);
    await prisma.portalLoginUse.update({ where: { id: first.useId }, data: { openedIp: "203.0.113.9" } });
    const elsewhere = await redeem(first.ticket);
    expect(elsewhere.status).toBe(403);
    expect(elsewhere.body.message).toMatch(/computer where it was pressed/);

    await setOfficeAddresses(["127.0.0.1", "::1"]);
    const second = await press(neha, portal.id);
    await prisma.portalLoginUse.update({ where: { id: second.useId }, data: { openedIp: "203.0.113.9" } });
    expect((await redeem(second.ticket)).status).toBe(200);
  });

  it("lets the Head, the department's HOD and the people on the list press it", async () => {
    const { portal } = await setup();
    const [aarti, riya, tarun] = [await loginAs("aarti@masti.test"), await loginAs("riya@masti.test"), await loginAs("tarun@masti.test")];
    const notListed = await aarti.post(`/api/portal-logins/${portal.id}/open`).send({});
    expect(notListed.status).toBe(403);
    expect(notListed.body.message).toBe("You aren't on this portal's list. Ask your HOD.");
    expect((await riya.post(`/api/portal-logins/${portal.id}/open`).send({})).status).toBe(201);
    expect((await (await loginAs("vimal@masti.test")).post(`/api/portal-logins/${portal.id}/open`).send({})).status).toBe(201);
    expect((await tarun.post(`/api/portal-logins/${portal.id}/open`).send({})).status).toBe(403);

    await createUser({ name: "Ramesh", mobile: "+919825041234", type: "FIELD" });
    expect((await (await loginAs("9825041234")).post(`/api/portal-logins/${portal.id}/open`).send({})).status).toBe(403);

    await prisma.portalLogin.update({ where: { id: portal.id }, data: { status: "REMOVED", secret: null } });
    expect((await riya.post(`/api/portal-logins/${portal.id}/open`).send({})).status).toBe(400);
  });

  it("works anywhere until office addresses are set, then only from them, for the Head too", async () => {
    const { vimal, portal } = await setup();
    expect((await vimal.post(`/api/portal-logins/${portal.id}/open`).send({})).status).toBe(201);
    expect((await vimal.get("/api/portal-logins")).body.officeAddressesSet).toBe(false);

    // The CRM-wide switch stays off: the CRM still opens, but Log in for me doesn't.
    await setOfficeAddresses(["203.0.113.0/24"]);
    const list = await vimal.get("/api/portal-logins");
    expect(list.status).toBe(200);
    expect(list.body.officeAddressesSet).toBe(true);
    const outside = await vimal.post(`/api/portal-logins/${portal.id}/open`).send({});
    expect(outside.status).toBe(403);
    expect(outside.body.message).toBe("Log in for me works only in the office.");

    await setOfficeAddresses(["203.0.113.0/24", "127.0.0.1", "::1"]);
    expect((await vimal.post(`/api/portal-logins/${portal.id}/open`).send({})).status).toBe(201);
  });

  it("keeps what the helper said happened, once, from the person who pressed", async () => {
    const { portal } = await setup();
    const neha = await loginAs("neha@masti.test");
    const { useId, ticket } = await press(neha, portal.id);
    expect((await redeem(ticket)).status).toBe(200);
    const url = `/api/portal-logins/uses/${useId}/outcome`;

    expect((await (await loginAs("riya@masti.test")).post(url).send({ outcome: "SUBMITTED" })).status).toBe(404);
    for (const bad of ["REFUSED", "LOGGED_IN", 5]) expect((await neha.post(url).send({ outcome: bad })).status).toBe(400);
    const ok = await neha.post(url).send({ outcome: "SUBMITTED" });
    expect(ok.status).toBe(200);
    expect(await prisma.portalLoginUse.findUniqueOrThrow({ where: { id: useId } })).toMatchObject({ outcome: "SUBMITTED" });
    expect((await neha.post(url).send({ outcome: "FAILED" })).status).toBe(409);
    expect(await prisma.auditLog.count({ where: { action: "portalLogin.outcome" } })).toBe(1);
  });

  it("shows who used what to the people who manage the portals, newest first, ten at most", async () => {
    const { vimal, portal } = await setup();
    const tickets = await vimal.post("/api/portal-logins").send({
      departmentCode: "TICKETS",
      name: "IndiGo agent portal",
      loginUrl: "https://agents.goindigo.in/",
      loginId: "AG-4471",
      password: "Wings-2026",
    });
    const neha = await loginAs("neha@masti.test");
    const tarun = await loginAs("tarun@masti.test");

    const nehaPress = await press(neha, portal.id);
    await redeem(nehaPress.ticket);
    await neha.post(`/api/portal-logins/uses/${nehaPress.useId}/outcome`).send({ outcome: "WAITING_FOR_STAFF" });
    await press(neha, portal.id); // pressed, never collected: not in the list
    await redeem((await press(tarun, tickets.body.portal.id)).ticket);

    const head = (await vimal.get("/api/portal-logins")).body.uses;
    expect(head.map((u: { user: { name: string }; portal: { name: string } }) => `${u.user.name} · ${u.portal.name}`)).toEqual([
      "Tarun · IndiGo agent portal",
      "Neha · France visa portal",
    ]);
    expect(head[1]).toMatchObject({ outcome: "WAITING_FOR_STAFF", at: expect.any(String) });
    expect((await (await loginAs("riya@masti.test")).get("/api/portal-logins")).body.uses).toHaveLength(1);
    expect((await neha.get("/api/portal-logins")).body.uses).toEqual([]);

    for (let i = 0; i < 10; i++) await redeem((await press(vimal, portal.id)).ticket);
    const ten = (await vimal.get("/api/portal-logins")).body.uses;
    expect(ten).toHaveLength(10);
    expect(ten.every((u: { user: { name: string } }) => u.user.name === "Vimal")).toBe(true);
  });
});
