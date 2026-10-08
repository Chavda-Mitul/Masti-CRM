import { beforeEach, describe, expect, it } from "vitest";
import { createUser, loginAs, prisma, resetDb } from "./helpers";

beforeEach(resetDb);

const RAMESH_MOBILE = "+919825000001";
const VISA_STAFF = [{ departmentCode: "VISA", role: "STAFF", access: "EDIT" }];

async function headAgent() {
  await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
  return loginAs("vimal@masti.test");
}

async function visaId() {
  return (await prisma.department.findUniqueOrThrow({ where: { code: "VISA" } })).id;
}

describe("field staff access", () => {
  it("can log in and see themselves, but nothing from the desktop CRM", async () => {
    await createUser({ name: "Ramesh", mobile: RAMESH_MOBILE, type: "FIELD" });
    const ramesh = await loginAs("98250 00001");

    const me = await ramesh.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ type: "FIELD", departments: [] });

    expect((await ramesh.get("/api/departments")).status).toBe(403);
    expect((await ramesh.get("/api/users")).status).toBe(403);
  });
});

describe("users API: account types", () => {
  it("creates field staff with a mobile and no departments", async () => {
    const head = await headAgent();
    const res = await head.post("/api/users").send({ name: "Ramesh", mobile: "98250 00001", type: "FIELD" });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ type: "FIELD", mobile: RAMESH_MOBILE, departments: [] });
  });

  it("refuses field staff without a mobile, or with departments", async () => {
    const head = await headAgent();
    expect((await head.post("/api/users").send({ name: "No mobile", email: "f@masti.test", type: "FIELD" })).status).toBe(400);
    expect((await head.post("/api/users").send({ name: "With dept", mobile: "98250 00002", type: "FIELD", departments: VISA_STAFF })).status).toBe(400);
  });

  it("refuses a Head with departments, and office staff without one", async () => {
    const head = await headAgent();
    expect((await head.post("/api/users").send({ name: "Head+dept", email: "h@masti.test", type: "HEAD", departments: VISA_STAFF })).status).toBe(400);
    expect((await head.post("/api/users").send({ name: "Office", email: "o@masti.test", type: "OFFICE" })).status).toBe(400);
  });

  it("drops department access when office staff become field staff", async () => {
    const head = await headAgent();
    const user = await createUser({ mobile: "+919825000003", departments: [{ code: "VISA" }] });
    const res = await head.patch(`/api/users/${user.id}`).send({ type: "FIELD" });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ type: "FIELD", departments: [] });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.update" } });
    expect(entry.before).toMatchObject({ type: "OFFICE" });
    expect(entry.after).toMatchObject({ type: "FIELD", departments: [] });
  });

  it("turns field staff into office staff with departments", async () => {
    const head = await headAgent();
    const user = await createUser({ mobile: RAMESH_MOBILE, type: "FIELD" });
    expect((await head.patch(`/api/users/${user.id}`).send({ type: "OFFICE" })).status).toBe(400);
    const res = await head.patch(`/api/users/${user.id}`).send({ type: "OFFICE", departments: VISA_STAFF });
    expect(res.status).toBe(200);
    expect(res.body.user.departments).toEqual([{ code: "VISA", name: "Visa", role: "STAFF", access: "EDIT" }]);
  });

  it("won't clear a field worker's mobile", async () => {
    const head = await headAgent();
    const user = await createUser({ mobile: RAMESH_MOBILE, email: "ramesh@masti.test", type: "FIELD" });
    expect((await head.patch(`/api/users/${user.id}`).send({ mobile: null })).status).toBe(400);
  });
});

describe("database rules (below the API)", () => {
  it("refuses field staff without a mobile", async () => {
    await expect(createUser({ email: "f@masti.test", type: "FIELD" })).rejects.toThrow(/User_field_needs_mobile/);
    const user = await createUser({ mobile: RAMESH_MOBILE, email: "r@masti.test", type: "FIELD" });
    await expect(prisma.user.update({ where: { id: user.id }, data: { mobile: null } })).rejects.toThrow(/User_field_needs_mobile/);
  });

  it("refuses department roles for Head and field staff", async () => {
    const departmentId = await visaId();
    const field = await createUser({ mobile: RAMESH_MOBILE, type: "FIELD" });
    const head = await createUser({ email: "h@masti.test", type: "HEAD" });
    for (const user of [field, head]) {
      await expect(prisma.userDepartment.create({ data: { userId: user.id, departmentId } })).rejects.toThrow(/Only OFFICE users/);
    }
    await expect(createUser({ mobile: "+919825000002", type: "FIELD", departments: [{ code: "VISA" }] })).rejects.toThrow(/Only OFFICE users/);
  });

  it("refuses to change the type of a user who still has department roles", async () => {
    const user = await createUser({ mobile: "+919825000003", departments: [{ code: "VISA" }] });
    await expect(prisma.user.update({ where: { id: user.id }, data: { type: "FIELD" } })).rejects.toThrow(/Remove the department roles/);
    await expect(prisma.user.update({ where: { id: user.id }, data: { type: "HEAD" } })).rejects.toThrow(/Remove the department roles/);

    await prisma.userDepartment.deleteMany({ where: { userId: user.id } });
    await prisma.user.update({ where: { id: user.id }, data: { type: "FIELD" } });
  });

  it("lets office staff have department roles", async () => {
    const user = await createUser({ email: "o@masti.test" });
    await prisma.userDepartment.create({ data: { userId: user.id, departmentId: await visaId() } });
  });
});

describe("field jobs", () => {
  it("can be assigned to any user and keep the department that raised them", async () => {
    const ramesh = await createUser({ mobile: RAMESH_MOBILE, type: "FIELD" });
    const job = await prisma.fieldJob.create({ data: { departmentId: await visaId(), assigneeId: ramesh.id } });
    const mine = await prisma.fieldJob.findMany({ where: { assigneeId: ramesh.id }, include: { department: true } });
    expect(mine).toHaveLength(1);
    expect(mine[0]?.id).toBe(job.id);
    expect(mine[0]?.department.code).toBe("VISA");
    // Users are deactivated, never deleted, so jobs keep their assignee.
    await expect(prisma.user.delete({ where: { id: ramesh.id } })).rejects.toThrow();
  });
});
