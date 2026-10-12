import { beforeEach, describe, expect, it } from "vitest";
import { addMonths, istToday } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";

// Follow-up outcomes, next steps and postpone/cancel reasons (docs/decisions/0006-visa-documents.md Decision 7),
// and the database rules the Step 2 migration adds.

beforeEach(async () => {
  await resetDb();
  await seedEnquiryMasters(prisma);
});

async function visaStaff() {
  await createUser({ name: "Aarti Patel", email: "aarti@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
  return loginAs("aarti@masti.test");
}

describe("follow-up and reason dropdowns", () => {
  it("are seeded with the demo values, and read by any office user but not field staff", async () => {
    const staff = await visaStaff();
    const outcomes = await staff.get("/api/masters/follow-up-outcomes");
    expect(outcomes.status).toBe(200);
    expect(outcomes.body.outcomes.map((o: { name: string }) => o.name)).toContain("Spoke — documents coming");
    expect((await staff.get("/api/masters/follow-up-next-steps")).body.nextSteps).toHaveLength(3);
    const reasons = (await staff.get("/api/masters/enquiry-reasons")).body.reasons as { kind: string; name: string }[];
    expect(reasons.filter((r) => r.kind === "POSTPONE").map((r) => r.name)).toEqual(["Travel dates moved", "Waiting for leave approval"]);
    expect(reasons.filter((r) => r.kind === "CANCEL")).toHaveLength(6);

    expect((await request(app).get("/api/masters/follow-up-outcomes")).status).toBe(401);
    await createUser({ name: "Ravi", mobile: "+919876500001", type: "FIELD" });
    expect((await (await loginAs("9876500001")).get("/api/masters/enquiry-reasons")).status).toBe(403);
  });

  it("are changed only by the Head or an HOD of any department", async () => {
    const staff = await visaStaff();
    const add = { code: "busy", name: "Busy, call back" };
    expect((await staff.post("/api/masters/follow-up-outcomes").send(add)).status).toBe(403);

    // Shared by every department, so an HOD of Hotels may change them too.
    await createUser({ name: "Hiral", email: "hiral@masti.test", departments: [{ code: "HOTELS", role: "HOD" }] });
    const hod = await loginAs("hiral@masti.test");
    const created = await hod.post("/api/masters/follow-up-outcomes").send(add);
    expect(created.status).toBe(201);
    expect(created.body.outcome).toMatchObject({ code: "BUSY", name: "Busy, call back", isActive: true });

    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    const head = await loginAs("vimal@masti.test");
    expect((await head.post("/api/masters/follow-up-next-steps").send({ code: "SEND_LINK", name: "Send the list again" })).status).toBe(201);
  });

  it("refuse a used code, never change a code or a reason's kind, and are switched off rather than deleted", async () => {
    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    const head = await loginAs("vimal@masti.test");

    expect((await head.post("/api/masters/follow-up-outcomes").send({ code: "NO_ANSWER", name: "Again" })).status).toBe(409);
    expect((await head.post("/api/masters/enquiry-reasons").send({ code: "BUDGET", name: "Budget" })).status).toBe(400);

    const reason = (await prisma.enquiryReason.findUniqueOrThrow({ where: { code: "NO_REPLY" } }));
    const res = await head.patch(`/api/masters/enquiry-reasons/${reason.id}`).send({ code: "X", kind: "POSTPONE", name: "No reply at all", isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.reason).toMatchObject({ code: "NO_REPLY", kind: "CANCEL", name: "No reply at all", isActive: false });

    const active = (await head.get("/api/masters/enquiry-reasons?active=true")).body.reasons as { code: string }[];
    expect(active.map((r) => r.code)).not.toContain("NO_REPLY");
    expect((await head.get("/api/masters/enquiry-reasons")).body.reasons).toHaveLength(8);

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "enquiryReason.update" } });
    expect(entry.before).toEqual({ name: "No reply", isActive: true });
    expect(entry.after).toEqual({ name: "No reply at all", isActive: false });
  });
});

describe("the database (Step 2 rules)", () => {
  /** A saved visa case, straight from intake. */
  async function savedCase() {
    await seedVisaMasters(prisma);
    const staff = await visaStaff();
    const fr = await prisma.country.findUniqueOrThrow({ where: { code: "FR" } });
    const offering = await prisma.visaOffering.findFirstOrThrow({ where: { countryId: fr.id } });
    const res = await staff.post("/api/visa/cases").send({
      mobile: "98250 41234",
      clientName: "Rakesh Mehta",
      sourceCode: "WHATSAPP",
      offeringId: offering.id,
      adults: 1,
      children: 0,
      travelMonth: addMonths(istToday(), 2).slice(0, 7),
    });
    expect(res.status).toBe(201);
    return res.body.case.id as string;
  }

  it("refuses a postponed or cancelled enquiry without its reason, bad booklet counts, half a maturity and a bad code", async () => {
    const id = await savedCase();
    const reason = await prisma.enquiryReason.findUniqueOrThrow({ where: { code: "TRAVEL_DATES_MOVED" } });

    await expect(prisma.enquiry.update({ where: { id }, data: { status: "POSTPONED", reasonId: reason.id } })).rejects.toThrow();
    await expect(prisma.enquiry.update({ where: { id }, data: { status: "CANCELLED" } })).rejects.toThrow();
    await expect(prisma.visaCase.update({ where: { enquiryId: id }, data: { bookletsCurrent: 51 } })).rejects.toThrow();
    await expect(prisma.visaCase.update({ where: { enquiryId: id }, data: { bookletsOld: -1 } })).rejects.toThrow();
    await expect(prisma.visaCase.update({ where: { enquiryId: id }, data: { maturedAt: new Date() } })).rejects.toThrow();
    await expect(prisma.followUpOutcome.create({ data: { code: "no answer", name: "x" } })).rejects.toThrow();

    await expect(
      prisma.enquiry.update({ where: { id }, data: { status: "POSTPONED", reasonId: reason.id, resumeOn: new Date("2027-01-04") } }),
    ).resolves.toBeTruthy();
  });
});
