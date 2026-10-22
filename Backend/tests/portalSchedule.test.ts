import { beforeEach, describe, expect, it } from "vitest";
import { addDays, addMonths, istToday } from "../src/lib/dates";
import { sealSecret } from "../src/lib/secretBox";
import { isPasswordLocked, passwordDueOn } from "../src/modules/portalLogins/portalLogin";
import { redeemLimitStore } from "../src/modules/portalLogins/portalHelper.routes";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";

// Scheduled password changes (docs/decisions/0024-portal-logins.md, component 2): a portal's password has to change daily,
// weekly or monthly, or has no schedule. From the start of the due date the portal is locked for everyone until an HOD
// types a new password, and the saved one isn't new.

/** The made-up helper ID tests run with (vitest.config.mts). */
const HELPER = "chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh";
const PASSWORD = "Spring-Visa-2026!";
const LOCKED = "This portal is locked until the HOD changes its password.";

type Agent = Awaited<ReturnType<typeof loginAs>>;

/** An instant at an India-time date and hour. */
const ist = (date: string, time = "12:00") => new Date(`${date}T${time}:00+05:30`);

describe("when a portal's password is due", () => {
  it("is a day, a week or a month after the India-time day it last changed", () => {
    // 23:30 in India is 18:00 UTC: still the 21st here.
    const changed = ist("2026-10-21", "23:30");
    expect(passwordDueOn({ passwordSchedule: "DAILY", passwordChangedAt: changed })).toBe("2026-10-22");
    expect(passwordDueOn({ passwordSchedule: "WEEKLY", passwordChangedAt: changed })).toBe("2026-10-28");
    expect(passwordDueOn({ passwordSchedule: "MONTHLY", passwordChangedAt: changed })).toBe("2026-11-21");
    expect(passwordDueOn({ passwordSchedule: "NONE", passwordChangedAt: changed })).toBeNull();
    expect(passwordDueOn({ passwordSchedule: "MONTHLY", passwordChangedAt: ist("2027-01-31") })).toBe("2027-02-28");
    expect(passwordDueOn({ passwordSchedule: "MONTHLY", passwordChangedAt: ist("2028-01-31") })).toBe("2028-02-29");
    expect(passwordDueOn({ passwordSchedule: "WEEKLY", passwordChangedAt: ist("2026-12-28") })).toBe("2027-01-04");
  });

  it("locks the portal from the start of that day, India time; with no schedule, never", () => {
    const weekly = { passwordSchedule: "WEEKLY" as const, passwordChangedAt: ist("2026-10-21", "09:00") };
    expect(isPasswordLocked(weekly, ist("2026-10-27", "23:59"))).toBe(false);
    expect(isPasswordLocked(weekly, ist("2026-10-28", "00:00"))).toBe(true);
    expect(isPasswordLocked(weekly, ist("2026-11-30"))).toBe(true);
    expect(isPasswordLocked({ passwordSchedule: "NONE", passwordChangedAt: ist("2020-01-01") }, ist("2026-10-28"))).toBe(false);
  });
});

describe("scheduled password changes", () => {
  beforeEach(async () => {
    await resetDb();
    redeemLimitStore.resetAll();
  });

  async function team() {
    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const neha = await createUser({ name: "Neha", email: "neha@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    return {
      nehaId: neha.id,
      vimal: await loginAs("vimal@masti.test"),
      riya: await loginAs("riya@masti.test"),
      neha: await loginAs("neha@masti.test"),
    };
  }

  async function add(agent: Agent, body: Record<string, unknown> = {}) {
    const res = await agent.post("/api/portal-logins").send({
      departmentCode: "VISA",
      name: "France visa portal",
      loginUrl: "https://france-visas.gouv.fr/login",
      loginId: "MASTI-AGENT-01",
      password: PASSWORD,
      ...body,
    });
    if (res.status !== 201) throw new Error(`add failed (${res.status}): ${JSON.stringify(res.body)}`);
    return res.body.portal as { id: string; updatedAt: string };
  }

  /** As if the password was last changed that many days ago. */
  async function changedDaysAgo(portalId: string, days: number) {
    await prisma.portalLogin.update({ where: { id: portalId }, data: { passwordChangedAt: new Date(Date.now() - days * 86_400_000) } });
  }

  /** The portal as this person's page shows it. */
  async function seen(agent: Agent, portalId: string) {
    const res = await agent.get("/api/portal-logins");
    expect(res.status).toBe(200);
    return res.body.portals.find((p: { id: string }) => p.id === portalId);
  }

  /** A change from the version the page shows now. */
  async function change(agent: Agent, portalId: string, body: Record<string, unknown>) {
    const { updatedAt } = await seen(agent, portalId);
    return agent.patch(`/api/portal-logins/${portalId}`).send({ ...body, updatedAt });
  }

  const press = (agent: Agent, portalId: string) => agent.post(`/api/portal-logins/${portalId}/open`).send({});

  it("is monthly unless the HOD picks another, and the page says when it's due", async () => {
    const { riya } = await team();
    const today = istToday();
    const monthly = await add(riya);
    expect(await seen(riya, monthly.id)).toMatchObject({ passwordSchedule: "MONTHLY", passwordDueOn: addMonths(today, 1), locked: false });
    const created = await prisma.auditLog.findFirstOrThrow({ where: { action: "portalLogin.create", entityId: monthly.id } });
    expect(created.after).toMatchObject({ passwordSchedule: "MONTHLY" });

    const weekly = await add(riya, { name: "UK visa portal", passwordSchedule: "WEEKLY" });
    expect(await seen(riya, weekly.id)).toMatchObject({ passwordSchedule: "WEEKLY", passwordDueOn: addDays(today, 7) });
    const none = await add(riya, { name: "China visa portal", passwordSchedule: "NONE" });
    expect(await seen(riya, none.id)).toMatchObject({ passwordSchedule: "NONE", passwordDueOn: null, locked: false });

    const yearly = await riya.post("/api/portal-logins").send({
      departmentCode: "VISA",
      name: "Japan visa portal",
      loginUrl: "https://japan.example/login",
      loginId: "X",
      password: "Y",
      passwordSchedule: "YEARLY",
    });
    expect(yearly.status).toBe(400);
    expect(yearly.body.issues.passwordSchedule).toEqual(["Pick how often the password changes."]);
  });

  it("locks an overdue portal for everyone, the Head included, and makes no ticket", async () => {
    const { vimal, riya, neha, nehaId } = await team();
    const portal = await add(riya, { userIds: [nehaId] });
    await changedDaysAgo(portal.id, 32);

    expect(await seen(neha, portal.id)).toMatchObject({ locked: true, canUse: true });
    for (const agent of [neha, riya, vimal]) {
      const res = await press(agent, portal.id);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ message: LOCKED, details: { code: "LOCKED" } });
    }
    expect(await prisma.portalLoginUse.count()).toBe(0);
  });

  it("refuses a ticket made just before the lock", async () => {
    const { riya, neha, nehaId } = await team();
    const portal = await add(riya, { userIds: [nehaId] });
    const opened = await press(neha, portal.id);
    expect(opened.status).toBe(201);
    await changedDaysAgo(portal.id, 32);

    const res = await request(app).post("/api/portal-helper/redeem").set("Origin", HELPER).send({ ticket: opened.body.ticket });
    expect(res.status).toBe(409);
    expect(res.text).not.toContain(PASSWORD);
    expect(await prisma.portalLoginUse.findUniqueOrThrow({ where: { id: opened.body.useId } })).toMatchObject({ outcome: "REFUSED", redeemedAt: null });
    const refused = await prisma.auditLog.findFirstOrThrow({ where: { action: "portalLogin.refuse" } });
    expect(refused.after).toMatchObject({ reason: "locked" });
  });

  it("is unlocked only by a new password, and is due again from today", async () => {
    const { riya, neha, nehaId } = await team();
    const portal = await add(riya, { userIds: [nehaId] });
    await changedDaysAgo(portal.id, 32);
    const { passwordChangedAt } = await prisma.portalLogin.findUniqueOrThrow({ where: { id: portal.id } });

    for (const body of [{ password: PASSWORD }, { loginId: "MASTI-AGENT-02", password: PASSWORD }]) {
      const same = await change(riya, portal.id, body);
      expect(same.status).toBe(400);
      expect(same.body.issues.password).toEqual(["That's the same password. Change it on the portal first, then type the new one here."]);
    }
    expect((await prisma.portalLogin.findUniqueOrThrow({ where: { id: portal.id } })).passwordChangedAt).toEqual(passwordChangedAt);

    // A new ID alone isn't the change the schedule asks for.
    expect((await change(riya, portal.id, { loginId: "MASTI-AGENT-02" })).status).toBe(200);
    expect(await seen(neha, portal.id)).toMatchObject({ locked: true });

    const renewed = await change(riya, portal.id, { password: "Autumn-Visa-2026!" });
    expect(renewed.status).toBe(200);
    expect(await seen(neha, portal.id)).toMatchObject({ locked: false, passwordDueOn: addMonths(istToday(), 1) });
    expect((await press(neha, portal.id)).status).toBe(201);
    const updates = await prisma.auditLog.findMany({ where: { action: "portalLogin.update", entityId: portal.id } });
    expect(updates.map((u) => u.after)).toEqual([expect.objectContaining({ idChanged: true }), expect.objectContaining({ passwordChanged: true })]);
  });

  it("changes schedule audited; a locked portal only with a new password; with no schedule it never locks", async () => {
    const { riya } = await team();
    const portal = await add(riya);

    expect((await change(riya, portal.id, { passwordSchedule: "WEEKLY" })).status).toBe(200);
    expect(await seen(riya, portal.id)).toMatchObject({ passwordSchedule: "WEEKLY", passwordDueOn: addDays(istToday(), 7) });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "portalLogin.update" } });
    expect(entry).toMatchObject({ before: { passwordSchedule: "MONTHLY" }, after: { passwordSchedule: "WEEKLY" } });

    await changedDaysAgo(portal.id, 8);
    const dodged = await change(riya, portal.id, { passwordSchedule: "NONE" });
    expect(dodged.status).toBe(400);
    expect(dodged.body.issues.passwordSchedule).toEqual(["Type the new password first: the portal is locked until then."]);
    expect((await change(riya, portal.id, { name: "France visa portal (Mumbai)" })).status).toBe(200);
    expect(await seen(riya, portal.id)).toMatchObject({ passwordSchedule: "WEEKLY", locked: true });

    expect((await change(riya, portal.id, { passwordSchedule: "NONE", password: "Autumn-Visa-2026!" })).status).toBe(200);
    await changedDaysAgo(portal.id, 400);
    expect(await seen(riya, portal.id)).toMatchObject({ passwordSchedule: "NONE", passwordDueOn: null, locked: false });
  });

  it("lets an HOD replace a login that can't be read, whatever was saved", async () => {
    const { riya } = await team();
    const portal = await add(riya);
    // Sealed for another row: it doesn't open here, so there's nothing to compare with.
    await prisma.portalLogin.update({
      where: { id: portal.id },
      data: { secret: new Uint8Array(sealSecret({ loginId: "MASTI-AGENT-01", password: PASSWORD }, "another-row")) },
    });
    const replaced = await change(riya, portal.id, { loginId: "MASTI-AGENT-01", password: PASSWORD });
    expect(replaced.status).toBe(200);
  });
});
