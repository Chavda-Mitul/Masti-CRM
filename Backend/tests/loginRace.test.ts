import { beforeEach, describe, expect, it, vi } from "vitest";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";

// In its own file: it wraps verifyPassword so a reset or deactivation can commit while a login is checking the old
// password (argon2 is slow, so in real life that window is tens of milliseconds wide).
const hooks = vi.hoisted(() => ({ duringCheck: null as null | (() => Promise<unknown>) }));

vi.mock("../src/modules/auth/password", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/modules/auth/password")>();
  return {
    ...real,
    verifyPassword: async (hash: string, password: string) => {
      const ok = await real.verifyPassword(hash, password);
      const run = hooks.duringCheck;
      hooks.duringCheck = null;
      if (run) await run();
      return ok;
    },
  };
});

beforeEach(resetDb);

async function setUp() {
  await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
  const head = await loginAs("vimal@masti.test");
  const staff = await createUser({ name: "Aarti", email: "aarti@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
  return { head, staff };
}

async function loginWhile(during: () => Promise<unknown>) {
  hooks.duringCheck = during;
  return request(app).post("/api/auth/login").send({ identifier: "aarti@masti.test", password: "Correct-Horse-9" });
}

describe("a login that races an account change", () => {
  it("loses to a password reset that lands while the old password is being checked", async () => {
    const { head, staff } = await setUp();
    const res = await loginWhile(async () => expect((await head.post(`/api/users/${staff.id}/reset-password`).send({})).status).toBe(200));

    expect(res.status).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(await prisma.session.count({ where: { userId: staff.id } })).toBe(0);
    const failed = await prisma.auditLog.findFirstOrThrow({ where: { action: "auth.login.failed", entityId: staff.id } });
    expect(failed.after).toMatchObject({ reason: "changed_during_login" });
  });

  it("loses to a deactivation that lands while the password is being checked", async () => {
    const { head, staff } = await setUp();
    const res = await loginWhile(async () => expect((await head.post(`/api/users/${staff.id}/deactivate`).send({})).status).toBe(200));

    expect(res.status).toBe(401);
    expect(await prisma.session.count({ where: { userId: staff.id } })).toBe(0);
  });

  it("still logs in when nothing changed", async () => {
    const { staff } = await setUp();
    const res = await loginWhile(async () => undefined);
    expect(res.status).toBe(200);
    expect(await prisma.session.count({ where: { userId: staff.id } })).toBe(1);
  });
});
