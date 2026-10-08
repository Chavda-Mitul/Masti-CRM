import { beforeEach, describe, expect, it } from "vitest";
import { app, createUser, loginAs, PASSWORD, prisma, request, resetDb } from "./helpers";

beforeEach(resetDb);

describe("login", () => {
  it.each(["98250 41234", "09825041234", "+91 98250-41234", "919825041234"])(
    "logs in with the mobile number written as %s",
    async (identifier) => {
      await createUser({ name: "Aarti", mobile: "+919825041234", departments: [{ code: "VISA" }] });
      const res = await request(app).post("/api/auth/login").send({ identifier, password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.user.name).toBe("Aarti");
      expect(res.body.user).not.toHaveProperty("passwordHash");
      expect(res.headers["set-cookie"]?.[0]).toMatch(/^masti_sid=.+HttpOnly/i);
    },
  );

  it("logs in with email, ignoring case", async () => {
    await createUser({ email: "neha@masti.test", departments: [{ code: "VISA" }] });
    const res = await request(app).post("/api/auth/login").send({ identifier: "  Neha@Masti.TEST ", password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it("gives the same error for a wrong password, an unknown user and a deactivated user", async () => {
    await createUser({ email: "a@masti.test", departments: [{ code: "VISA" }] });
    await createUser({ email: "gone@masti.test", isActive: false, departments: [{ code: "VISA" }] });

    const wrong = await request(app).post("/api/auth/login").send({ identifier: "a@masti.test", password: "nope-nope" });
    const unknown = await request(app).post("/api/auth/login").send({ identifier: "x@masti.test", password: PASSWORD });
    const inactive = await request(app).post("/api/auth/login").send({ identifier: "gone@masti.test", password: PASSWORD });

    for (const res of [wrong, unknown, inactive]) {
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Wrong mobile number/email or password.");
    }
    const failures = await prisma.auditLog.findMany({ where: { action: "auth.login.failed" } });
    expect(failures.map((f) => (f.after as { reason: string }).reason).sort()).toEqual([
      "inactive_user",
      "unknown_user",
      "wrong_password",
    ]);
  });

  it("rate-limits repeated failures for the same identifier", async () => {
    await createUser({ email: "target@masti.test", departments: [{ code: "VISA" }] });
    for (let i = 0; i < 10; i++) {
      const res = await request(app).post("/api/auth/login").send({ identifier: "target@masti.test", password: "wrong-pass" });
      expect(res.status).toBe(401);
    }
    const blocked = await request(app).post("/api/auth/login").send({ identifier: "target@masti.test", password: PASSWORD });
    expect(blocked.status).toBe(429);
  });

  it("rejects a missing or invalid body", async () => {
    const res = await request(app).post("/api/auth/login").send({ identifier: "" });
    expect(res.status).toBe(400);
  });

  it("records a successful login in the audit log and on the user", async () => {
    const user = await createUser({ email: "ok@masti.test", departments: [{ code: "VISA" }] });
    await loginAs("ok@masti.test");
    expect(await prisma.auditLog.count({ where: { action: "auth.login.success", actorId: user.id } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).lastLoginAt).not.toBeNull();
  });
});

describe("session", () => {
  it("/me needs a session", async () => {
    expect((await request(app).get("/api/auth/me")).status).toBe(401);
  });

  it("/me returns the user with departments", async () => {
    await createUser({ email: "hod@masti.test", departments: [{ code: "VISA", role: "HOD", access: "EDIT" }] });
    const agent = await loginAs("hod@masti.test");
    const res = await agent.get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.user.departments).toEqual([{ code: "VISA", name: "Visa", role: "HOD", access: "EDIT" }]);
  });

  it("logout ends the session", async () => {
    await createUser({ email: "out@masti.test", departments: [{ code: "VISA" }] });
    const agent = await loginAs("out@masti.test");
    expect((await agent.post("/api/auth/logout").set("Content-Type", "application/json")).status).toBe(204);
    expect((await agent.get("/api/auth/me")).status).toBe(401);
    expect(await prisma.session.count()).toBe(0);
  });

  it("rejects an expired session", async () => {
    await createUser({ email: "old@masti.test", departments: [{ code: "VISA" }] });
    const agent = await loginAs("old@masti.test");
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await agent.get("/api/auth/me")).status).toBe(401);
    expect(await prisma.session.count()).toBe(0);
  });

  it("stores only a hash of the session token", async () => {
    await createUser({ email: "hash@masti.test", departments: [{ code: "VISA" }] });
    const res = await request(app).post("/api/auth/login").send({ identifier: "hash@masti.test", password: PASSWORD });
    const token = /masti_sid=([^;]+)/.exec(res.headers["set-cookie"]?.[0] ?? "")?.[1];
    const session = await prisma.session.findFirstOrThrow();
    expect(token).toBeTruthy();
    expect(session.tokenHash).not.toBe(token);
    expect(session.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("change password", () => {
  it("changes the password, clears the temporary flag and signs out other devices", async () => {
    await createUser({ email: "new@masti.test", mustChangePassword: true, departments: [{ code: "VISA" }] });
    const phone = await loginAs("new@masti.test");
    const laptop = await loginAs("new@masti.test");

    const res = await laptop
      .post("/api/auth/change-password")
      .send({ currentPassword: PASSWORD, newPassword: "A-brand-new-one-7" });
    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(false);

    expect((await laptop.get("/api/auth/me")).status).toBe(200);
    expect((await phone.get("/api/auth/me")).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ identifier: "new@masti.test", password: "A-brand-new-one-7" })).status).toBe(200);
  });

  it("refuses a wrong current password and a too-short new one", async () => {
    await createUser({ email: "pw@masti.test", departments: [{ code: "VISA" }] });
    const agent = await loginAs("pw@masti.test");
    expect((await agent.post("/api/auth/change-password").send({ currentPassword: "wrong-one", newPassword: "Long-enough-1" })).status).toBe(400);
    expect((await agent.post("/api/auth/change-password").send({ currentPassword: PASSWORD, newPassword: "short" })).status).toBe(400);
  });
});
