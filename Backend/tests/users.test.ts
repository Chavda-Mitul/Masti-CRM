import { beforeEach, describe, expect, it } from "vitest";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";

beforeEach(resetDb);

async function headAgent() {
  await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
  return loginAs("vimal@masti.test");
}

describe("users API access", () => {
  it("is Head only", async () => {
    await createUser({ email: "hod@masti.test", departments: [{ code: "VISA", role: "HOD", access: "EDIT" }] });
    const hod = await loginAs("hod@masti.test");
    expect((await hod.get("/api/users")).status).toBe(403);
    expect((await request(app).get("/api/users")).status).toBe(401);
  });

  it("is blocked until a temporary password is changed", async () => {
    await createUser({ email: "boss@masti.test", type: "HEAD", mustChangePassword: true });
    const head = await loginAs("boss@masti.test");
    const res = await head.get("/api/users");
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/temporary password/);
  });
});

describe("creating users", () => {
  it("creates a user with departments and returns a temporary password once", async () => {
    const head = await headAgent();
    const res = await head.post("/api/users").send({
      name: "Aarti Patel",
      mobile: "98250 41234",
      departments: [
        { departmentCode: "VISA", role: "STAFF", access: "EDIT" },
        { departmentCode: "HOLIDAYS", role: "HOD", access: "VIEW" },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.tempPassword).toMatch(/^\w{4}-\w{4}-\w{4}$/);
    expect(res.body.user.mobile).toBe("+919825041234");
    expect(res.body.user.mustChangePassword).toBe(true);
    // HODs always get EDIT
    expect(res.body.user.departments).toContainEqual({ code: "HOLIDAYS", name: "Holidays", role: "HOD", access: "EDIT" });

    const login = await request(app).post("/api/auth/login").send({ identifier: "9825041234", password: res.body.tempPassword });
    expect(login.status).toBe(200);

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.create" } });
    expect(JSON.stringify(entry.after)).not.toMatch(/passwordHash|tempPassword/);
  });

  it("needs a mobile or an email, and a department unless Head", async () => {
    const head = await headAgent();
    expect((await head.post("/api/users").send({ name: "No contact", departments: [{ departmentCode: "VISA", role: "STAFF", access: "VIEW" }] })).status).toBe(400);
    expect((await head.post("/api/users").send({ name: "No dept", email: "x@masti.test" })).status).toBe(400);
    expect((await head.post("/api/users").send({ name: "Bad mobile", mobile: "12345", departments: [{ departmentCode: "VISA", role: "STAFF", access: "VIEW" }] })).status).toBe(400);
    expect((await head.post("/api/users").send({ name: "Bad dept", email: "y@masti.test", departments: [{ departmentCode: "CRUISE", role: "STAFF", access: "VIEW" }] })).status).toBe(400);
  });

  it("refuses a mobile or email that belongs to someone else", async () => {
    const head = await headAgent();
    await createUser({ mobile: "+919825041234", email: "taken@masti.test", departments: [{ code: "VISA" }] });
    const dept = [{ departmentCode: "VISA", role: "STAFF", access: "VIEW" }];
    const byMobile = await head.post("/api/users").send({ name: "Dup", mobile: "09825041234", departments: dept });
    const byEmail = await head.post("/api/users").send({ name: "Dup", email: "TAKEN@masti.test", departments: dept });
    expect(byMobile.status).toBe(409);
    expect(byEmail.status).toBe(409);
  });
});

describe("updating users", () => {
  it("replaces departments and audits before/after", async () => {
    const head = await headAgent();
    const user = await createUser({ email: "staff@masti.test", departments: [{ code: "VISA" }] });
    const res = await head.patch(`/api/users/${user.id}`).send({
      name: "Renamed",
      departments: [{ departmentCode: "TICKETS", role: "STAFF", access: "EDIT" }],
    });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe("Renamed");
    expect(res.body.user.departments).toEqual([{ code: "TICKETS", name: "Tickets", role: "STAFF", access: "EDIT" }]);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.update" } });
    expect((entry.before as { name: string }).name).toBe("Test User");
  });

  it("keeps roles in switched-off departments when the departments are edited", async () => {
    const head = await headAgent();
    const user = await createUser({
      email: "ravi@masti.test",
      departments: [
        { code: "VISA", access: "VIEW" },
        { code: "HOTELS", role: "HOD", access: "EDIT" },
      ],
    });
    await prisma.department.update({ where: { code: "HOTELS" }, data: { isActive: false } });

    const res = await head.patch(`/api/users/${user.id}`).send({ departments: [{ departmentCode: "VISA", role: "STAFF", access: "EDIT" }] });
    expect(res.status).toBe(200);
    expect(res.body.user.departments).toEqual([{ code: "VISA", name: "Visa", role: "STAFF", access: "EDIT" }]);

    // Hotels comes back on: Ravi is still its HOD.
    await prisma.department.update({ where: { code: "HOTELS" }, data: { isActive: true } });
    const after = await head.get(`/api/users/${user.id}`);
    expect(after.body.user.departments).toContainEqual({ code: "HOTELS", name: "Hotels", role: "HOD", access: "EDIT" });
  });

  it("won't remove the last active Head", async () => {
    const head = await headAgent();
    const me = await prisma.user.findFirstOrThrow({ where: { type: "HEAD" } });
    const res = await head.patch(`/api/users/${me.id}`).send({ type: "OFFICE", departments: [{ departmentCode: "VISA", role: "HOD", access: "EDIT" }] });
    expect(res.status).toBe(409);
  });
});

describe("deactivating users", () => {
  it("ends the user's open sessions immediately", async () => {
    const head = await headAgent();
    const user = await createUser({ email: "leaver@masti.test", departments: [{ code: "VISA" }] });
    const leaver = await loginAs("leaver@masti.test");
    expect((await leaver.get("/api/auth/me")).status).toBe(200);

    const res = await head.post(`/api/users/${user.id}/deactivate`).set("Content-Type", "application/json");
    expect(res.status).toBe(200);
    expect(res.body.user.isActive).toBe(false);

    expect((await leaver.get("/api/auth/me")).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ identifier: "leaver@masti.test", password: "Correct-Horse-9" })).status).toBe(401);

    const back = await head.post(`/api/users/${user.id}/activate`).set("Content-Type", "application/json");
    expect(back.body.user.isActive).toBe(true);
  });

  it("can't deactivate yourself or the last Head", async () => {
    const head = await headAgent();
    const me = await prisma.user.findFirstOrThrow({ where: { type: "HEAD" } });
    expect((await head.post(`/api/users/${me.id}/deactivate`).set("Content-Type", "application/json")).status).toBe(400);
  });

  it("leaves an active Head when two Heads deactivate each other at the same moment", async () => {
    await headAgent();
    await createUser({ name: "Nikita", email: "nikita@masti.test", type: "HEAD" });
    const nikita = await loginAs("nikita@masti.test");
    const [vimalRow, nikitaRow] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { email: "vimal@masti.test" } }),
      prisma.user.findUniqueOrThrow({ where: { email: "nikita@masti.test" } }),
    ]);

    // Vimal's deactivation of Nikita is mid-transaction: it has locked the Head rows and switched Nikita off, not yet committed.
    let commit!: () => void;
    const held = new Promise<void>((resolve) => (commit = resolve));
    const first = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "type" = 'HEAD' AND "isActive" ORDER BY "id" FOR UPDATE`;
        await tx.user.update({ where: { id: nikitaRow.id }, data: { isActive: false } });
        await held;
      },
      { timeout: 10_000 },
    );

    // Meanwhile Nikita deactivates Vimal. Her check must wait for the first one, then see she is no longer active.
    const second = nikita.post(`/api/users/${vimalRow.id}/deactivate`).set("Content-Type", "application/json").then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 300));
    commit();
    await first;

    expect((await second).status).toBe(409);
    expect(await prisma.user.count({ where: { type: "HEAD", isActive: true } })).toBe(1);
  });

  it("returns 404 for an unknown user", async () => {
    const head = await headAgent();
    const res = await head.post("/api/users/00000000-0000-0000-0000-000000000000/deactivate").set("Content-Type", "application/json");
    expect(res.status).toBe(404);
  });
});

describe("resetting passwords", () => {
  it("issues a new temporary password and signs the user out", async () => {
    const head = await headAgent();
    const user = await createUser({ email: "forgot@masti.test", departments: [{ code: "VISA" }] });
    const forgot = await loginAs("forgot@masti.test");

    const res = await head.post(`/api/users/${user.id}/reset-password`).set("Content-Type", "application/json");
    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(true);
    expect((await forgot.get("/api/auth/me")).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ identifier: "forgot@masti.test", password: res.body.tempPassword })).status).toBe(200);
  });
});

describe("departments", () => {
  it("lists departments for any logged-in user", async () => {
    await createUser({ email: "s@masti.test", departments: [{ code: "VISA" }] });
    const agent = await loginAs("s@masti.test");
    const res = await agent.get("/api/departments");
    expect(res.status).toBe(200);
    expect(res.body.departments.map((d: { code: string }) => d.code)).toEqual([
      "VISA",
      "HOLIDAYS",
      "HOTELS",
      "INSURANCE",
      "TICKETS",
      "ACCOUNTS",
    ]);
  });
});
