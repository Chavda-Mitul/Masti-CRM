import { beforeEach, describe, expect, it } from "vitest";
import { addDays, istToday } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { nextOpenDay } from "../src/modules/holidays/blockedDays";
import { seedHolidays } from "../src/modules/holidays/holidays.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { maturedCase, saveCase, visaStaff, type Agent } from "./visaHelpers";

// How urgent a visa case is, changed on the case page (docs/decisions/0003-visa-intake.md amendment 1, part 3).

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
  await seedHolidays(prisma); // the weekly Sunday off, for the postponed case's resume day
});

const setUrgency = (agent: Agent, caseNo: string, body: object) => agent.put(`/api/visa/cases/${caseNo}/urgency`).send(body);
const level = async (code: string) => (await prisma.urgencyLevel.findUniqueOrThrow({ where: { code } })).id;

describe("PUT /api/visa/cases/:caseNo/urgency", () => {
  it("the owner marks it Urgent and back, audited; it moves neither the step nor updatedAt; an unchanged pick writes nothing", async () => {
    const staff = await visaStaff();
    const c = await saveCase(staff);
    const before = await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id } });

    const urgent = await setUrgency(staff, c.caseNo, { urgencyId: await level("URGENT") });
    expect(urgent.status).toBe(200);
    expect(urgent.body.case.urgency).toMatchObject({ code: "URGENT", name: "Urgent" });
    expect(urgent.body.case.stage.code).toBe("ENQUIRY");
    expect((await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id } })).updatedAt).toEqual(before.updatedAt);
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.urgency.update" } })).toMatchObject({
      entityType: "VisaCase",
      entityId: c.id,
      clientId: c.client.id,
      before: { urgency: "NORMAL" },
      after: { urgency: "URGENT" },
    });

    expect((await setUrgency(staff, c.caseNo, { urgencyId: await level("URGENT") })).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "visa.urgency.update" } })).toBe(1);

    const normal = await setUrgency(staff, c.caseNo, { urgencyId: await level("NORMAL") });
    expect(normal.body.case.urgency.code).toBe("NORMAL");
    expect(await prisma.auditLog.count({ where: { action: "visa.urgency.update" } })).toBe(2);
  });

  it("only the owner, the Visa HOD and the Head change it; a bad body is a 400", async () => {
    const staff = await visaStaff();
    const c = await saveCase(staff);
    const urgencyId = await level("URGENT");
    expect((await setUrgency(staff, c.caseNo, {})).status).toBe(400);
    expect((await setUrgency(staff, c.caseNo, { urgencyId: "URGENT" })).body.issues.urgencyId).toEqual(["Pick how urgent it is."]);

    await createUser({ name: "Neha", email: "neha@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    expect((await setUrgency(await loginAs("neha@masti.test"), c.caseNo, { urgencyId })).status).toBe(403);
    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    expect((await setUrgency(await loginAs("meena@masti.test"), c.caseNo, { urgencyId })).status).toBe(403);

    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    expect((await setUrgency(await loginAs("riya@masti.test"), c.caseNo, { urgencyId })).status).toBe(200);
    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    expect((await setUrgency(await loginAs("vimal@masti.test"), c.caseNo, { urgencyId: await level("NORMAL") })).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "visa.urgency.update" } })).toBe(2);
  });

  it("changes at a later step, by the processor who has the case now", async () => {
    const c = await maturedCase();
    const processor = await loginAs("neha@masti.test");
    const changed = await setUrgency(processor, c.caseNo, { urgencyId: await level("URGENT") });
    expect(changed.status).toBe(200);
    expect(changed.body.case).toMatchObject({ stage: { code: "FILE_PREPARATION" }, urgency: { code: "URGENT" } });
    // Whoever matured it no longer owns it.
    expect((await setUrgency(await loginAs("aarti@masti.test"), c.caseNo, { urgencyId: await level("NORMAL") })).status).toBe(403);
  });

  it("is refused on a postponed or a cancelled case", async () => {
    const staff = await visaStaff();
    const c = await saveCase(staff);
    const urgencyId = await level("URGENT");

    const reasonId = (await prisma.enquiryReason.findUniqueOrThrow({ where: { code: "WAITING_LEAVE_APPROVAL" } })).id;
    const updatedAt = (await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id } })).updatedAt.toISOString();
    const resumeOn = await nextOpenDay(addDays(istToday(), 10), { office: true });
    expect((await staff.post(`/api/enquiries/${c.caseNo}/postpone`).send({ reasonId, resumeOn, updatedAt })).status).toBe(200);
    const postponed = await setUrgency(staff, c.caseNo, { urgencyId });
    expect(postponed.status).toBe(409);
    expect(postponed.body.message).toMatch(/Resume it first/);

    const cancelReason = (await prisma.enquiryReason.findUniqueOrThrow({ where: { code: "TRIP_CANCELLED" } })).id;
    await prisma.enquiry.update({ where: { id: c.id }, data: { status: "CANCELLED", reasonId: cancelReason, resumeOn: null } });
    expect((await setUrgency(staff, c.caseNo, { urgencyId })).status).toBe(409);
    expect(await prisma.auditLog.count({ where: { action: "visa.urgency.update" } })).toBe(0);
  });

  it("keeps a level switched off since on the case, but doesn't pick it anew", async () => {
    const staff = await visaStaff();
    const c = await saveCase(staff, { urgencyId: await level("URGENT") });
    const other = await saveCase(staff, { mobile: "99000 11122" });
    await prisma.urgencyLevel.update({ where: { code: "URGENT" }, data: { isActive: false } });

    expect((await staff.get(`/api/visa/cases/${c.caseNo}`)).body.case.urgency).toMatchObject({ code: "URGENT", name: "Urgent" });
    // Already its level: nothing to change.
    expect((await setUrgency(staff, c.caseNo, { urgencyId: await level("URGENT") })).status).toBe(200);

    const refused = await setUrgency(staff, other.caseNo, { urgencyId: await level("URGENT") });
    expect(refused.status).toBe(400);
    expect(refused.body.issues.urgencyId).toEqual(["That urgency level isn't used any more. Pick another."]);
    expect((await setUrgency(staff, other.caseNo, { urgencyId: 999 })).status).toBe(400);
    expect(await prisma.auditLog.count({ where: { action: "visa.urgency.update" } })).toBe(0);
  });
});
