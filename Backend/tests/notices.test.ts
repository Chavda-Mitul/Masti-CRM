import { beforeEach, describe, expect, it } from "vitest";
import type { Access, DepartmentRole } from "../generated/prisma/client";
import { addDays, istToday, toDbDate } from "../src/lib/dates";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";

// The notice board (docs/decisions/0017-today-dashboard.md Decision 11) and the visa team's login popup (Decision 12).

beforeEach(async () => {
  await resetDb();
});

type Agent = Awaited<ReturnType<typeof loginAs>>;

async function person(name: string, email: string, departments: { code: string; role?: DepartmentRole; access?: Access }[]) {
  await createUser({ name, email, departments });
  return loginAs(email);
}

async function head() {
  await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
  return loginAs("vimal@masti.test");
}

const china = { departmentCode: "VISA", category: "EMBASSY", about: "China", title: "China visa centres closed 1–7 Oct", body: "Don't promise dates in this window." };

async function post(agent: Agent, body: Record<string, unknown>) {
  const res = await agent.post("/api/notices").send(body);
  if (res.status !== 201) throw new Error(`post failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.notice;
}

const board = async (agent: Agent, query = "") => (await agent.get(`/api/notices${query}`)).body;
const titles = (body: { notices: { title: string }[] }) => body.notices.map((n) => n.title);

describe("the notice board", () => {
  it("is everyone's to read; a department's staff post to it, and the Head anywhere", async () => {
    expect((await request(app).get("/api/notices")).status).toBe(401);
    await createUser({ name: "Ravi", mobile: "+919876500001", type: "FIELD" });
    expect((await (await loginAs("9876500001")).get("/api/notices")).status).toBe(403);

    const aarti = await person("Aarti Patel", "aarti@masti.test", [{ code: "VISA", access: "EDIT" }]);
    const notice = await post(aarti, china);
    expect(notice).toMatchObject({
      department: { code: "VISA", name: "Visa" },
      category: "EMBASSY",
      about: "China",
      source: "TEAM",
      status: "ACTIVE",
      postedBy: { name: "Aarti Patel" },
      canChange: true,
    });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "notice.create" } });
    expect(entry).toMatchObject({ entityId: notice.id, after: { title: china.title, category: "EMBASSY", about: "China" } });

    // Posting needs edit access in that department.
    const mona = await person("Mona", "mona@masti.test", [{ code: "VISA", access: "VIEW" }]);
    expect((await mona.post("/api/notices").send(china)).status).toBe(403);
    expect((await aarti.post("/api/notices").send({ ...china, departmentCode: "TICKETS" })).status).toBe(403);

    // Reading doesn't: every department's notices, for everyone in the office.
    const tara = await person("Tara", "tara@masti.test", [{ code: "TICKETS", access: "EDIT" }]);
    expect((await board(tara)).notices).toMatchObject([{ id: notice.id, canChange: false }]);
    expect(titles(await board(mona))).toEqual([china.title]);

    const vimal = await head();
    const sale = await post(vimal, { departmentCode: "tickets", category: "AIRLINE", about: "[Airline]", title: "Sale on Gulf sectors till 10 Oct", source: "IVS" });
    expect(sale).toMatchObject({ department: { code: "TICKETS" }, source: "IVS", body: null, canChange: true });

    // What a notice is checked for.
    const issues = async (body: Record<string, unknown>) => {
      const res = await vimal.post("/api/notices").send(body);
      expect(res.status).toBe(400);
      return res.body.issues ?? res.body.message;
    };
    expect(await issues({ ...china, departmentCode: "CRUISE" })).toBe("Unknown department: CRUISE");
    expect((await issues({ ...china, title: "  " })).title).toBeDefined();
    expect((await issues({ ...china, about: "x".repeat(61) })).about).toBeDefined();
    expect((await issues({ ...china, category: "WEATHER" })).category).toBeDefined();
    // A blank "which one" or details is no "which one" or details.
    expect(await post(vimal, { ...china, about: "  ", body: " " })).toMatchObject({ about: null, body: null });
  });

  it("lists newest first, by department tab and category, 30 at a time, without removed notices", async () => {
    const vimal = await head();
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
    const make = async (title: string, departmentCode: string, category: string, minutesAgo: number) => {
      const n = await post(vimal, { departmentCode, category, title });
      await prisma.notice.update({ where: { id: n.id }, data: { createdAt: at(minutesAgo) } });
      return n;
    };
    await make("Oldest: baggage rules changed", "TICKETS", "AIRLINE", 40);
    await make("China visa centres closed", "VISA", "EMBASSY", 30);
    await make("Free airport transfer in November", "HOTELS", "HOTEL", 20);
    await make("Half-monthly bills go out on the 15th", "ACCOUNTS", "GENERAL", 10);
    const gone = await make("Newest, but removed", "VISA", "GENERAL", 1);
    expect((await vimal.post(`/api/notices/${gone.id}/remove`).send({})).status).toBe(200);

    expect(titles(await board(vimal))).toEqual([
      "Half-monthly bills go out on the 15th",
      "Free airport transfer in November",
      "China visa centres closed",
      "Oldest: baggage rules changed",
    ]);
    expect(titles(await board(vimal, "?department=visa"))).toEqual(["China visa centres closed"]);
    expect(titles(await board(vimal, "?category=AIRLINE"))).toEqual(["Oldest: baggage rules changed"]);
    expect(titles(await board(vimal, "?department=VISA&category=HOTEL"))).toEqual([]);

    const first = await board(vimal, "?limit=3");
    expect(first.notices).toHaveLength(3);
    const second = await board(vimal, `?limit=3&cursor=${first.nextCursor}`);
    expect(titles(second)).toEqual(["Oldest: baggage rules changed"]);
    expect(second.nextCursor).toBeNull();
  });

  it("is changed by its author, the department's HOD or the Head, from the version they opened", async () => {
    const aarti = await person("Aarti Patel", "aarti@masti.test", [{ code: "VISA", access: "EDIT" }]);
    const neha = await person("Neha Joshi", "neha@masti.test", [{ code: "VISA", access: "EDIT" }]);
    const riya = await person("Riya", "riya@masti.test", [{ code: "VISA", role: "HOD" }]);
    const vimal = await head();
    const notice = await post(aarti, china);
    const url = `/api/notices/${notice.id}`;

    expect((await neha.patch(url).send({ title: "Mine now", updatedAt: notice.updatedAt })).status).toBe(403);
    expect((await board(neha)).notices[0].canChange).toBe(false);
    expect((await board(riya)).notices[0].canChange).toBe(true);
    expect((await board(vimal)).notices[0].canChange).toBe(true);

    const edited = await aarti.patch(url).send({ title: "China visa centres closed 1–8 Oct", updatedAt: notice.updatedAt });
    expect(edited.status).toBe(200);
    expect(edited.body.notice).toMatchObject({ title: "China visa centres closed 1–8 Oct", about: "China" });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "notice.update" } });
    expect(entry).toMatchObject({ before: { title: china.title }, after: { title: "China visa centres closed 1–8 Oct" } });

    // Someone else saved first: refused, nothing overwritten.
    const stale = await riya.patch(url).send({ title: "Too late", updatedAt: notice.updatedAt });
    expect(stale.status).toBe(409);
    expect(stale.body.details).toEqual({ code: "STALE" });

    // Nothing changed: nothing written.
    const same = await aarti.patch(url).send({ title: "China visa centres closed 1–8 Oct", updatedAt: edited.body.notice.updatedAt });
    expect(same.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "notice.update" } })).toBe(1);

    const byHod = await riya.patch(url).send({ category: "GENERAL", about: null, updatedAt: edited.body.notice.updatedAt });
    expect(byHod.body.notice).toMatchObject({ category: "GENERAL", about: null });
    const byHead = await vimal.patch(url).send({ source: "IVS", updatedAt: byHod.body.notice.updatedAt });
    expect(byHead.body.notice).toMatchObject({ source: "IVS", department: { code: "VISA" } });
  });

  it("is removed once, by its author, the HOD or the Head, and kept for the record", async () => {
    const aarti = await person("Aarti Patel", "aarti@masti.test", [{ code: "VISA", access: "EDIT" }]);
    const neha = await person("Neha Joshi", "neha@masti.test", [{ code: "VISA", access: "EDIT" }]);
    const notice = await post(aarti, china);
    const url = `/api/notices/${notice.id}`;

    expect((await neha.post(`${url}/remove`).send({})).status).toBe(403);
    const removed = await aarti.post(`${url}/remove`).send({});
    expect(removed.status).toBe(200);
    expect(removed.body.notice.status).toBe("REMOVED");
    expect((await aarti.post(`${url}/remove`).send({})).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "notice.remove" } })).toBe(1);

    expect((await board(aarti)).notices).toEqual([]);
    expect(await prisma.notice.findUniqueOrThrow({ where: { id: notice.id } })).toMatchObject({ status: "REMOVED", title: china.title });
    expect((await aarti.patch(url).send({ title: "Back", updatedAt: removed.body.notice.updatedAt })).status).toBe(400);
    expect((await aarti.patch("/api/notices/not-a-notice").send({ title: "x", updatedAt: removed.body.notice.updatedAt })).status).toBe(404);
  });

  it("the database refuses a blank title", async () => {
    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    const vimal = await prisma.user.findUniqueOrThrow({ where: { email: "vimal@masti.test" } });
    const visa = await prisma.department.findUniqueOrThrow({ where: { code: "VISA" } });
    await expect(prisma.notice.create({ data: { departmentId: visa.id, category: "GENERAL", title: "  ", postedById: vimal.id } })).rejects.toThrow();
    await expect(prisma.notice.create({ data: { departmentId: visa.id, category: "GENERAL", title: "Fine", about: " ", postedById: vimal.id } })).rejects.toThrow();
    // In the visa team's popup means picked by someone.
    await expect(
      prisma.notice.create({ data: { departmentId: visa.id, category: "GENERAL", title: "Picked by nobody", loginPopupAt: new Date(), postedById: vimal.id } }),
    ).rejects.toThrow();
  });
});

describe("the visa team's login popup", () => {
  it("takes Visa notices the Head or the Visa HOD picks", async () => {
    const aarti = await person("Aarti Patel", "aarti@masti.test", [{ code: "VISA", access: "EDIT" }]);
    const riya = await person("Riya", "riya@masti.test", [{ code: "VISA", role: "HOD" }]);
    const vimal = await head();

    const picked = await post(riya, { ...china, loginPopup: true });
    expect(picked.inLoginPopup).toBe(true);
    const created = await prisma.auditLog.findFirstOrThrow({ where: { action: "notice.create", entityId: picked.id } });
    expect(created.after).toMatchObject({ loginPopup: true });

    // Staff don't pick; and only a Visa notice goes in the visa team's popup.
    expect((await aarti.post("/api/notices").send({ ...china, loginPopup: true })).status).toBe(403);
    expect((await vimal.post("/api/notices").send({ ...china, departmentCode: "TICKETS", loginPopup: true })).status).toBe(400);

    // The Head picks one later. Its author still edits it (the pick unchanged), but can't take it out.
    const mine = await post(aarti, { ...china, title: "Schengen covering letter" });
    expect(mine.inLoginPopup).toBe(false);
    const byHead = await vimal.patch(`/api/notices/${mine.id}`).send({ loginPopup: true, updatedAt: mine.updatedAt });
    expect(byHead.body.notice.inLoginPopup).toBe(true);
    const edited = await aarti
      .patch(`/api/notices/${mine.id}`)
      .send({ title: "Schengen covering letter, new format", loginPopup: true, updatedAt: byHead.body.notice.updatedAt });
    expect(edited.body.notice).toMatchObject({ title: "Schengen covering letter, new format", inLoginPopup: true });
    expect((await aarti.patch(`/api/notices/${mine.id}`).send({ loginPopup: false, updatedAt: edited.body.notice.updatedAt })).status).toBe(403);
  });

  it("shows the visa team what's new to them, until they've seen it", async () => {
    const aarti = await person("Aarti Patel", "aarti@masti.test", [{ code: "VISA", access: "EDIT" }]);
    const tara = await person("Tara", "tara@masti.test", [{ code: "TICKETS", access: "EDIT" }]);
    const mona = await person("Mona", "mona@masti.test", [{ code: "VISA", access: "VIEW" }]);
    const vimal = await head();
    const vimalId = (await prisma.user.findUniqueOrThrow({ where: { email: "vimal@masti.test" } })).id;

    // A holiday Vimal added half an hour ago is new; one added ten days ago, and the seeded Sunday off, aren't.
    const holiday = (name: string, addedById: string | null, minutesAgo: number, start: string, end: string | null) =>
      prisma.holiday.create({
        data: {
          name,
          repeat: end ? "NONE" : "WEEKLY",
          startDate: toDbDate(start),
          endDate: end ? toDbDate(end) : null,
          weekday: end ? null : 7,
          addedById,
          createdAt: new Date(Date.now() - minutesAgo * 60_000),
          targets: { create: [{ kind: "ALL_EMBASSIES" }] },
        },
      });
    const day = istToday();
    const dussehra = await holiday("Dussehra", vimalId, 30, addDays(day, 1), addDays(day, 1));
    await holiday("Added ten days ago", vimalId, 10 * 24 * 60, addDays(day, 5), addDays(day, 5));
    await holiday("Weekly off", null, 5, day, null);

    const picked = await post(vimal, { ...china, loginPopup: true });
    await post(vimal, { ...china, title: "Not picked" });
    const gone = await post(vimal, { ...china, title: "Picked, then removed", loginPopup: true });
    await vimal.post(`/api/notices/${gone.id}/remove`).send({});
    // A notice Aarti wrote herself isn't news to her, even once picked.
    const own = await post(aarti, { ...china, title: "Aarti's own" });
    await vimal.patch(`/api/notices/${own.id}`).send({ loginPopup: true, updatedAt: own.updatedAt });

    const popup = async (agent: Agent) => (await agent.get("/api/notices/login-popup")).body.items as { kind: string; title?: string; name?: string; at: string }[];
    const items = await popup(aarti);
    expect(items.map((i) => i.title ?? i.name)).toEqual([china.title, "Dussehra"]);
    expect(items[0]).toMatchObject({ kind: "NOTICE", department: { code: "VISA" }, postedBy: { name: "Vimal" } });
    expect(items[1]).toMatchObject({ kind: "HOLIDAY", label: expect.any(String), targets: ["All embassies in India"] });

    // The Head picks; Tickets staff and view-only Visa staff aren't the visa team.
    expect(await popup(vimal)).toEqual([]);
    expect(await popup(tara)).toEqual([]);
    expect(await popup(mona)).toEqual([]);

    // Got it: seen up to the newest of them, and who acknowledged what is audited. Nothing new: no popup.
    const seen = await aarti.post("/api/notices/login-popup/seen").send({ upTo: items[0]?.at, noticeIds: [picked.id], holidayIds: [dussehra.id] });
    expect(seen.status).toBe(200);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "notice.popup.seen" } });
    expect(entry.after).toMatchObject({ noticeIds: [picked.id], holidayIds: [dussehra.id] });
    expect(await popup(aarti)).toEqual([]);

    // What the Visa HOD picks herself isn't news to her.
    const riya = await person("Riya", "riya@masti.test", [{ code: "VISA", role: "HOD" }]);
    const hers = await post(vimal, { ...china, title: "Riya's pick" });
    await riya.patch(`/api/notices/${hers.id}`).send({ loginPopup: true, updatedAt: hers.updatedAt });
    expect((await popup(riya)).map((i) => i.title ?? i.name)).not.toContain("Riya's pick");
    const riyasPick = await popup(aarti);
    expect(riyasPick.map((i) => i.title)).toEqual(["Riya's pick"]);
    await aarti.post("/api/notices/login-popup/seen").send({ upTo: riyasPick[0]?.at });

    // Something picked later shows on its own; taking it out of the popup takes it off.
    const later = await post(vimal, { ...china, title: "Picked later", loginPopup: true });
    expect((await popup(aarti)).map((i) => i.title)).toEqual(["Picked later"]);
    await vimal.patch(`/api/notices/${later.id}`).send({ loginPopup: false, updatedAt: later.updatedAt });
    expect(await popup(aarti)).toEqual([]);
  });

  it("brings the oldest unseen first, 20 at a time, so Got it never marks one seen that wasn't shown", async () => {
    const aarti = await person("Aarti Patel", "aarti@masti.test", [{ code: "VISA", access: "EDIT" }]);
    await head();
    const vimalId = (await prisma.user.findUniqueOrThrow({ where: { email: "vimal@masti.test" } })).id;
    const visa = await prisma.department.findUniqueOrThrow({ where: { code: "VISA" } });
    // 25 picked notices a minute apart; the 21st was picked at the same instant as the 20th.
    const start = Date.now() - 60 * 60_000;
    for (let i = 1; i <= 25; i++) {
      const minute = i === 21 ? 20 : i;
      const at = new Date(start + minute * 60_000);
      await prisma.notice.create({
        data: { departmentId: visa.id, category: "GENERAL", title: `Update ${i}`, postedById: vimalId, loginPopupAt: at, loginPopupById: vimalId },
      });
    }

    const popup = async () => (await aarti.get("/api/notices/login-popup")).body as { items: { title: string; at: string }[]; more: boolean };
    const gotIt = (items: { at: string }[]) => aarti.post("/api/notices/login-popup/seen").send({ upTo: items[0]?.at });

    // The oldest first, shown newest first. The 20th waits with the 21st, so Got it can't mark it seen unshown.
    const first = await popup();
    expect(first.items.map((i) => i.title)).toEqual(Array.from({ length: 19 }, (_, k) => `Update ${19 - k}`));
    expect(first.more).toBe(true);
    expect((await gotIt(first.items)).status).toBe(200);

    const second = await popup();
    expect(second.items.map((i) => i.title).sort()).toEqual(["Update 20", "Update 21", "Update 22", "Update 23", "Update 24", "Update 25"].sort());
    expect(second.more).toBe(false);
    await gotIt(second.items);
    expect(await popup()).toEqual({ items: [], more: false });
  });
});
