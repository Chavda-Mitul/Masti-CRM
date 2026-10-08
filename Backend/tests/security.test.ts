import cookieParser from "cookie-parser";
import express from "express";
import { beforeEach, describe, expect, it } from "vitest";
import { clearOfficeNetworkCache, ipAllowed, OFFICE_NETWORK_KEY } from "../src/modules/auth/officeNetwork";
import { can, canEditAnyDepartment, isHodOf, type DepartmentCode } from "../src/modules/auth/permissions";
import { toUserDto, type UserWithDepartments } from "../src/modules/users/user";
import { requireAuth, requireDepartment } from "../src/middleware/auth";
import { errorHandler } from "../src/middleware/error";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";

beforeEach(resetDb);

type FakeMembership = [DepartmentCode, "STAFF" | "HOD", "VIEW" | "EDIT", "switched off"?];

function fakeUser(partial: Partial<UserWithDepartments> & { depts?: FakeMembership[] }) {
  return {
    isActive: true,
    type: "OFFICE",
    ...partial,
    departments: (partial.depts ?? []).map(([code, role, access, off]) => ({
      role,
      access,
      department: { code, name: code, isActive: !off },
    })),
  } as unknown as UserWithDepartments;
}

describe("permissions: can()", () => {
  const head = fakeUser({ type: "HEAD" });
  const hod = fakeUser({ depts: [["VISA", "HOD", "VIEW"]] });
  const editor = fakeUser({ depts: [["VISA", "STAFF", "EDIT"]] });
  const viewer = fakeUser({ depts: [["VISA", "STAFF", "VIEW"]] });
  const inactive = fakeUser({ type: "HEAD", isActive: false });
  // Shouldn't exist (the database refuses it), but a field user must get nothing even with a department row.
  const field = fakeUser({ type: "FIELD", depts: [["VISA", "HOD", "EDIT"]] });

  it.each([
    ["Head", head, "TICKETS", "EDIT", true],
    ["HOD in own dept", hod, "VISA", "EDIT", true],
    ["HOD in another dept", hod, "HOTELS", "VIEW", false],
    ["Staff EDIT can view", editor, "VISA", "VIEW", true],
    ["Staff EDIT can edit", editor, "VISA", "EDIT", true],
    ["Staff VIEW can view", viewer, "VISA", "VIEW", true],
    ["Staff VIEW can't edit", viewer, "VISA", "EDIT", false],
    ["Staff in another dept", viewer, "HOTELS", "VIEW", false],
    ["Inactive Head", inactive, "VISA", "VIEW", false],
    ["Field staff", field, "VISA", "VIEW", false],
  ] as const)("%s → %s %s = %s", (_label, user, dept, access, expected) => {
    expect(can(user, dept, access)).toBe(expected);
  });
});

describe("permissions: switched-off departments grant nothing", () => {
  const offHod = fakeUser({ depts: [["VISA", "HOD", "EDIT", "switched off"], ["HOTELS", "STAFF", "VIEW"]] });

  it("an HOD of a switched-off department loses its access and HOD powers", () => {
    expect(can(offHod, "VISA", "VIEW")).toBe(false);
    expect(isHodOf(offHod, "VISA")).toBe(false);
    expect(isHodOf(fakeUser({ depts: [["VISA", "HOD", "EDIT"]] }), "VISA")).toBe(true);
  });

  it("EDIT only in a switched-off department doesn't count as EDIT anywhere", () => {
    expect(canEditAnyDepartment(offHod)).toBe(false);
    expect(canEditAnyDepartment(fakeUser({ depts: [["HOTELS", "STAFF", "EDIT"]] }))).toBe(true);
  });

  it("the browser isn't sent memberships of switched-off departments", () => {
    expect(toUserDto(offHod).departments.map((d) => d.code)).toEqual(["HOTELS"]);
  });
});

describe("requireDepartment middleware", () => {
  const mini = express();
  mini.use(cookieParser());
  mini.get("/visa/read", requireAuth, requireDepartment("VISA", "VIEW"), (_req, res) => void res.json({ ok: true }));
  mini.get("/visa/write", requireAuth, requireDepartment("VISA", "EDIT"), (_req, res) => void res.json({ ok: true }));
  mini.use(errorHandler);

  async function cookieFor(email: string) {
    const res = await request(app).post("/api/auth/login").send({ identifier: email, password: "Correct-Horse-9" });
    return res.headers["set-cookie"] as unknown as string[];
  }

  it("lets a VIEW user read but not write, and blocks other departments", async () => {
    await createUser({ email: "viewer@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    await createUser({ email: "hotels@masti.test", departments: [{ code: "HOTELS", access: "EDIT" }] });
    const viewer = await cookieFor("viewer@masti.test");
    const hotels = await cookieFor("hotels@masti.test");

    expect((await request(mini).get("/visa/read").set("Cookie", viewer)).status).toBe(200);
    expect((await request(mini).get("/visa/write").set("Cookie", viewer)).status).toBe(403);
    expect((await request(mini).get("/visa/read").set("Cookie", hotels)).status).toBe(403);
    expect((await request(mini).get("/visa/read")).status).toBe(401);
  });
});

describe("audit log", () => {
  it("is append-only: the database rejects UPDATE and DELETE", async () => {
    await createUser({ email: "a@masti.test", departments: [{ code: "VISA" }] });
    await loginAs("a@masti.test");
    expect(await prisma.auditLog.count()).toBeGreaterThan(0);
    await expect(prisma.$executeRawUnsafe(`UPDATE "AuditLog" SET action = 'tampered'`)).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "AuditLog"`)).rejects.toThrow(/append-only/);
  });
});

describe("CSRF guard", () => {
  it("rejects non-JSON state-changing requests", async () => {
    const res = await request(app).post("/api/auth/login").type("form").send("identifier=a&password=b");
    expect(res.status).toBe(415);
  });
});

describe("office network rule", () => {
  async function setOfficeNetwork(value: object) {
    await prisma.setting.upsert({ where: { key: OFFICE_NETWORK_KEY }, update: { value }, create: { key: OFFICE_NETWORK_KEY, value } });
    clearOfficeNetworkCache();
  }

  it("matches IPs and CIDR ranges", () => {
    expect(ipAllowed("203.0.113.10", ["203.0.113.0/24"])).toBe(true);
    expect(ipAllowed("::ffff:203.0.113.10", ["203.0.113.10"])).toBe(true);
    expect(ipAllowed("198.51.100.1", ["203.0.113.0/24"])).toBe(false);
    expect(ipAllowed(undefined, ["203.0.113.0/24"])).toBe(false);
  });

  it("is off by default", async () => {
    await createUser({ email: "free@masti.test", departments: [{ code: "VISA" }] });
    await loginAs("free@masti.test");
  });

  it("when on, blocks other networks but lets exempt field staff in", async () => {
    await createUser({ email: "office@masti.test", departments: [{ code: "VISA" }] });
    await createUser({ email: "ramesh@masti.test", mobile: "+919825000001", type: "FIELD" });
    await setOfficeNetwork({ enabled: true, allow: ["203.0.113.0/24"], exemptUserTypes: ["FIELD"] });

    // Tests connect from localhost, which is not in the allow-list.
    const blocked = await request(app).post("/api/auth/login").send({ identifier: "office@masti.test", password: "Correct-Horse-9" });
    expect(blocked.status).toBe(403);
    await loginAs("ramesh@masti.test");

    await setOfficeNetwork({ enabled: true, allow: ["127.0.0.1", "::1"], exemptUserTypes: ["FIELD"] });
    await loginAs("office@masti.test");
  });
});
