import { beforeEach, describe, expect, it } from "vitest";
import { addMonths, istToday } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";

// Follow-up outcomes, next steps and postpone/cancel reasons (docs/decisions/0006-visa-documents.md Decision 7), each
// tagged with the departments it shows in (0018-dropdowns-by-department.md), and the database rules the Step 2 migration adds.

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

  it("are changed only by the Head or an HOD of every department the value is for", async () => {
    const staff = await visaStaff();
    const add = { code: "busy", name: "Busy, call back", departments: ["hotels"] };
    expect((await staff.post("/api/masters/follow-up-outcomes").send(add)).status).toBe(403);

    await createUser({ name: "Hiral", email: "hiral@masti.test", departments: [{ code: "HOTELS", role: "HOD" }] });
    const hod = await loginAs("hiral@masti.test");
    const created = await hod.post("/api/masters/follow-up-outcomes").send(add);
    expect(created.status).toBe(201);
    expect(created.body.outcome).toMatchObject({ code: "BUSY", name: "Busy, call back", isActive: true, departments: ["HOTELS"] });
    // Not for Visa: she isn't its HOD.
    expect((await hod.post("/api/masters/follow-up-outcomes").send({ code: "WAITING", name: "Waiting", departments: ["HOTELS", "VISA"] })).status).toBe(403);

    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    const head = await loginAs("vimal@masti.test");
    const step = { code: "SEND_LINK", name: "Send the list again", departments: ["VISA", "HOTELS"] };
    expect((await head.post("/api/masters/follow-up-next-steps").send(step)).status).toBe(201);
  });

  it("refuse a used code, never change a code or a reason's kind, and are switched off rather than deleted", async () => {
    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    const head = await loginAs("vimal@masti.test");

    expect((await head.post("/api/masters/follow-up-outcomes").send({ code: "NO_ANSWER", name: "Again", departments: ["VISA"] })).status).toBe(409);
    expect((await head.post("/api/masters/enquiry-reasons").send({ code: "BUDGET", name: "Budget", departments: ["VISA"] })).status).toBe(400);

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

describe("department tags (0018)", () => {
  const ALL = ["VISA", "HOLIDAYS", "HOTELS", "INSURANCE", "TICKETS"];
  const outcomeId = async (code: string) => (await prisma.followUpOutcome.findUniqueOrThrow({ where: { code } })).id;
  const nextStepId = async (code: string) => (await prisma.followUpNextStep.findUniqueOrThrow({ where: { code } })).id;
  const reasonId = async (code: string) => (await prisma.enquiryReason.findUniqueOrThrow({ where: { code } })).id;

  async function visaHod() {
    await createUser({ name: "Neha", email: "neha@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    return loginAs("neha@masti.test");
  }
  async function theHead() {
    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    return loginAs("vimal@masti.test");
  }

  it("are seeded: general values in every selling department, the visa ones in Visa only", async () => {
    const staff = await visaStaff();
    const byCode = (rows: { code: string; departments: string[] }[]) => Object.fromEntries(rows.map((r) => [r.code, r.departments]));
    const outcomes = byCode((await staff.get("/api/masters/follow-up-outcomes")).body.outcomes);
    expect(outcomes.NO_ANSWER).toEqual(ALL);
    expect(outcomes.SPOKE_DOCS_COMING).toEqual(["VISA"]);
    const steps = byCode((await staff.get("/api/masters/follow-up-next-steps")).body.nextSteps);
    expect(steps.SEND_COLLECTION_BOY).toEqual(["VISA"]);
    expect(steps.CALL_AGAIN).toEqual(ALL);
    const reasons = byCode((await staff.get("/api/masters/enquiry-reasons")).body.reasons);
    expect(reasons.VISA_NOT_NEEDED).toEqual(["VISA"]);
    expect(reasons.TRIP_CANCELLED).toEqual(ALL);
  });

  it("need at least one active department", async () => {
    const head = await theHead();
    const res = await head.post("/api/masters/follow-up-next-steps").send({ code: "REMIND", name: "Remind" });
    expect(res.status).toBe(400);
    expect(res.body.issues.departments).toBeTruthy();
    expect((await head.post("/api/masters/follow-up-next-steps").send({ code: "REMIND", name: "Remind", departments: [] })).status).toBe(400);
    const unknown = await head.post("/api/masters/follow-up-next-steps").send({ code: "REMIND", name: "Remind", departments: ["CRUISE"] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.issues.departments).toEqual(["Pick from the active departments."]);

    await prisma.department.update({ where: { code: "TICKETS" }, data: { isActive: false } });
    expect((await head.post("/api/masters/follow-up-next-steps").send({ code: "REMIND", name: "Remind", departments: ["TICKETS"] })).status).toBe(400);
    // A value keeps a department switched off since.
    const kept = await head.patch(`/api/masters/follow-up-next-steps/${await nextStepId("CALL_AGAIN")}`).send({ departments: ["VISA", "TICKETS"] });
    expect(kept.status).toBe(200);
    expect(kept.body.nextStep.departments).toEqual(["VISA", "TICKETS"]);
  });

  it("let an HOD change only values of their own departments; a value shared with others is the Head's", async () => {
    const hod = await visaHod();
    const head = await theHead();

    // A Visa-only value: hers to rename and switch off.
    const docsComing = await outcomeId("SPOKE_DOCS_COMING");
    const renamed = await hod.patch(`/api/masters/follow-up-outcomes/${docsComing}`).send({ name: "Spoke — papers coming", isActive: false });
    expect(renamed.status).toBe(200);
    expect(renamed.body.outcome).toMatchObject({ name: "Spoke — papers coming", isActive: false, departments: ["VISA"] });

    // Shared by every department: not hers, even to switch off.
    const noAnswer = await outcomeId("NO_ANSWER");
    expect((await hod.patch(`/api/masters/follow-up-outcomes/${noAnswer}`).send({ isActive: false })).status).toBe(403);
    expect((await hod.patch(`/api/masters/follow-up-outcomes/${noAnswer}`).send({ departments: ["VISA"] })).status).toBe(403);
    // Nor can she give her value to another department.
    const visaNotNeeded = await reasonId("VISA_NOT_NEEDED");
    expect((await hod.patch(`/api/masters/enquiry-reasons/${visaNotNeeded}`).send({ departments: ["VISA", "HOTELS"] })).status).toBe(403);

    // The Head can do both.
    expect((await head.patch(`/api/masters/follow-up-outcomes/${noAnswer}`).send({ departments: ["VISA"] })).status).toBe(200);
    const moved = await head.patch(`/api/masters/enquiry-reasons/${visaNotNeeded}`).send({ departments: ["hotels", "VISA", "VISA"] });
    expect(moved.status).toBe(200);
    expect(moved.body.reason.departments).toEqual(["VISA", "HOTELS"]);
    // NO_ANSWER is now Visa's only, so it is hers.
    expect((await hod.patch(`/api/masters/follow-up-outcomes/${noAnswer}`).send({ sortOrder: 9 })).status).toBe(200);
  });

  it("audit a change of departments with the codes before and after, and write nothing when the set is the same", async () => {
    const head = await theHead();
    const callAgain = await nextStepId("CALL_AGAIN");

    const same = await head.patch(`/api/masters/follow-up-next-steps/${callAgain}`).send({ departments: [...ALL].reverse() });
    expect(same.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "followUpNextStep.update" } })).toBe(0);

    await head.patch(`/api/masters/follow-up-next-steps/${callAgain}`).send({ departments: ["VISA", "HOLIDAYS"], name: "Call again later" });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "followUpNextStep.update" } });
    expect(entry.before).toEqual({ name: "Call again", departments: ALL });
    expect(entry.after).toEqual({ name: "Call again later", departments: ["VISA", "HOLIDAYS"] });

    await head.post("/api/masters/enquiry-reasons").send({ kind: "CANCEL", code: "BOOKED_DIRECT", name: "Booked direct", departments: ["TICKETS"] });
    const created = await prisma.auditLog.findFirstOrThrow({ where: { action: "enquiryReason.create" } });
    expect(created.after).toMatchObject({ code: "BOOKED_DIRECT", departments: ["TICKETS"] });
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
