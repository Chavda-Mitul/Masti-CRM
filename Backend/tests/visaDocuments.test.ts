import { beforeEach, describe, expect, it } from "vitest";
import { addMonths, istToday } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";

// Visa Step 2 (docs/decisions/0006-visa-documents.md). Who may open a case is tested in enquiries.test.ts.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

type Agent = Awaited<ReturnType<typeof loginAs>>;

async function visaStaff() {
  await createUser({ name: "Aarti Patel", email: "aarti@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
  return loginAs("aarti@masti.test");
}

/** France Tourist for one adult and one child, saved by `agent`. */
async function saveCase(agent: Agent) {
  const fr = await prisma.country.findUniqueOrThrow({ where: { code: "FR" } });
  const offering = await prisma.visaOffering.findFirstOrThrow({ where: { countryId: fr.id } });
  const res = await agent.post("/api/visa/cases").send({
    mobile: "98250 41234",
    clientName: "Rakesh Mehta",
    sourceCode: "WHATSAPP",
    offeringId: offering.id,
    adults: 1,
    children: 1,
    travelMonth: addMonths(istToday(), 2).slice(0, 7),
  });
  expect(res.status).toBe(201);
  return res.body.case as { id: string; caseNo: string; client: { id: string } };
}

describe("the case page", () => {
  it("shows a fresh case: its steps, unnamed travellers, nothing ticked and no follow-ups", async () => {
    const staff = await visaStaff();
    const saved = await saveCase(staff);

    const res = await staff.get(`/api/visa/cases/${saved.caseNo.toLowerCase()}`);
    expect(res.status).toBe(200);
    const c = res.body.case;
    expect(c.steps.map((s: { name: string }) => s.name)).toEqual([
      "Enquiry",
      "Documents",
      "File preparation",
      "Docket & dispatch",
      "At vendor",
      "Decision",
      "Passport back",
      "Delivered",
    ]);
    expect(c.stage).toMatchObject({ code: "ENQUIRY", step: 1, of: 8 });
    expect(c).toMatchObject({
      status: "OPEN",
      reason: null,
      resumeOn: null,
      arrival: null,
      booklets: { current: null, old: null },
      maturedAt: null,
      maturedBy: null,
      followUps: [],
      owner: { name: "Aarti Patel" },
    });
    expect(Date.parse(c.updatedAt)).not.toBeNaN();

    const [adult, child] = c.travellers;
    expect(adult).toMatchObject({ label: "Adult 1", name: null, member: null, consent: { state: "UNLINKED" }, done: 0, need: 11, pendingCount: 11 });
    expect(child).toMatchObject({ label: "Child 1", isChild: true, done: 0, need: 10 });
    expect(adult.documents[0]).toMatchObject({ status: "PENDING", receivedAs: null, receivedAt: null, receivedBy: null });
  });

  it("shows the linked family member, their consent, ticked documents and follow-ups", async () => {
    const staff = await visaStaff();
    const saved = await saveCase(staff);
    const aarti = await prisma.user.findUniqueOrThrow({ where: { email: "aarti@masti.test" } });
    const self = await prisma.relation.findUniqueOrThrow({ where: { code: "SELF" } });

    // Written directly: the Step 2 actions come with the next parts.
    const expiresSoon = new Date(`${addMonths(istToday(), 3)}T00:00:00Z`);
    const born = new Date(`${addMonths(istToday(), -12 * 40 - 1)}T00:00:00Z`);
    const member = await prisma.clientMember.create({
      data: { clientId: saved.client.id, name: "RAKESH MEHTA", relationId: self.id, dateOfBirth: born, passportExpiry: expiresSoon, createdById: aarti.id },
    });
    const [adultRow] = await prisma.visaCaseTraveller.findMany({ where: { caseId: saved.id }, orderBy: { position: "asc" } });
    await prisma.visaCaseTraveller.update({ where: { id: adultRow!.id }, data: { memberId: member.id, name: member.name } });
    await prisma.consent.create({ data: { memberId: member.id, agreedAt: new Date("2026-09-28T09:44:00Z") } });

    const docs = await prisma.visaCaseDocument.findMany({ where: { travellerId: adultRow!.id }, orderBy: { sortOrder: "asc" } });
    const receivedAt = new Date("2026-10-03T10:42:00Z");
    await prisma.visaCaseDocument.update({ where: { id: docs[0]!.id }, data: { status: "RECEIVED", receivedAs: "ORIGINAL", receivedAt, receivedById: aarti.id } });
    await prisma.visaCaseDocument.update({ where: { id: docs[1]!.id }, data: { status: "NOT_NEEDED" } });

    const outcome = await prisma.followUpOutcome.findUniqueOrThrow({ where: { code: "SPOKE_DOCS_COMING" } });
    const nextStep = await prisma.followUpNextStep.findUniqueOrThrow({ where: { code: "CALL_AGAIN" } });
    const nextAt = new Date(Date.now() + 86_400_000);
    await prisma.followUp.create({ data: { enquiryId: saved.id, outcomeId: outcome.id, nextStepId: nextStep.id, nextAt, byId: aarti.id } });

    const c = (await staff.get(`/api/visa/cases/${saved.caseNo}`)).body.case;
    const adult = c.travellers[0];
    expect(adult).toMatchObject({
      name: "RAKESH MEHTA",
      member: { id: member.id, name: "RAKESH MEHTA", relation: { code: "SELF" }, age: 40, passportStatus: "RENEW_SOON" },
      consent: { state: "ON_FILE", agreedAt: "2026-09-28T09:44:00.000Z" },
      done: 1,
      need: 10,
      pendingCount: 9,
    });
    expect(adult.documents[0]).toMatchObject({
      status: "RECEIVED",
      receivedAs: "ORIGINAL",
      receivedAt: receivedAt.toISOString(),
      receivedBy: { id: aarti.id, name: "Aarti Patel" },
    });
    expect(adult.documents[1].status).toBe("NOT_NEEDED");
    // The child isn't linked to a family member yet.
    expect(c.travellers[1].consent).toEqual({ state: "UNLINKED" });

    expect(c.followUps).toEqual([
      {
        id: expect.any(String),
        outcome: "Spoke — documents coming",
        nextStep: "Call again",
        nextAt: nextAt.toISOString(),
        by: { id: aarti.id, name: "Aarti Patel" },
        createdAt: expect.any(String),
      },
    ]);
  });

  it("flags a linked traveller with no consent on file, and says 404 for an unknown case", async () => {
    const staff = await visaStaff();
    const saved = await saveCase(staff);
    const aarti = await prisma.user.findUniqueOrThrow({ where: { email: "aarti@masti.test" } });
    const son = await prisma.relation.findUniqueOrThrow({ where: { code: "SON" } });
    const member = await prisma.clientMember.create({ data: { clientId: saved.client.id, name: "AARAV MEHTA", relationId: son.id, createdById: aarti.id } });
    const child = await prisma.visaCaseTraveller.findFirstOrThrow({ where: { caseId: saved.id, isChild: true } });
    await prisma.visaCaseTraveller.update({ where: { id: child.id }, data: { memberId: member.id, name: member.name } });

    const c = (await staff.get(`/api/visa/cases/${saved.caseNo}`)).body.case;
    expect(c.travellers[1]).toMatchObject({ name: "AARAV MEHTA", consent: { state: "NONE" }, member: { age: null, passportStatus: null } });

    expect((await staff.get("/api/visa/cases/VISA-2026-9999")).status).toBe(404);
  });
});
