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

    // Written directly, to set up every kind of state at once (the actions are tested below).
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

describe("Step 2 actions: naming travellers and ticking documents", () => {
  type CaseDoc = { id: string; name: string; status: string; receivedAs: string | null; receivedAt: string | null; receivedBy: { name: string } | null };
  type CaseDto = {
    id: string;
    caseNo: string;
    client: { id: string };
    stage: { code: string; step: number };
    travellers: { id: string; name: string | null; member: { id: string } | null; done: number; need: number; documents: CaseDoc[] }[];
  };

  const docOf = (c: CaseDto, name: string, traveller = 0) => c.travellers[traveller]!.documents.find((d) => d.name === name)!;
  const tick = (agent: Agent, c: CaseDto, docId: string, body: Record<string, unknown>) =>
    agent.patch(`/api/visa/cases/${c.caseNo}/documents/${docId}`).send(body);
  const json = { "Content-Type": "application/json" };

  async function addMember(agent: Agent, clientId: string, name: string, relation = "SELF") {
    const relationId = (await prisma.relation.findUniqueOrThrow({ where: { code: relation } })).id;
    const res = await agent.post(`/api/clients/${clientId}/members`).send({ name, relationId });
    expect(res.status).toBe(201);
    return res.body.member.id as string;
  }

  async function freshCase(agent: Agent): Promise<CaseDto> {
    const saved = await saveCase(agent);
    return (await agent.get(`/api/visa/cases/${saved.caseNo}`)).body.case;
  }

  it("starts collecting documents once, audited", async () => {
    const staff = await visaStaff();
    const c = await freshCase(staff);
    expect(c.stage).toMatchObject({ code: "ENQUIRY", step: 1 });

    const started = await staff.post(`/api/visa/cases/${c.caseNo}/start`).set(json);
    expect(started.status).toBe(200);
    expect(started.body.case.stage).toMatchObject({ code: "DOCUMENTS", step: 2, statusLabel: "Documents pending" });
    expect((await staff.post(`/api/visa/cases/${c.caseNo}/start`).set(json)).status).toBe(409);

    const entries = await prisma.auditLog.findMany({ where: { action: "enquiry.stage" } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entityId: c.id, clientId: c.client.id, before: { stage: "ENQUIRY" }, after: { stage: "DOCUMENTS" } });
  });

  it("ticks papers as original or xerox, made, not needed or pending, stamping who and when", async () => {
    const staff = await visaStaff();
    const c = await freshCase(staff);
    const passport = docOf(c, "Passport");
    const flight = docOf(c, "Flight reservation");

    expect((await tick(staff, c, passport.id, { status: "RECEIVED" })).body.issues.receivedAs).toBeDefined();
    expect((await tick(staff, c, passport.id, { status: "MADE" })).status).toBe(400);
    expect((await tick(staff, c, flight.id, { status: "RECEIVED", receivedAs: "ORIGINAL" })).status).toBe(400);

    // The first tick also moves the case to Documents.
    const received = await tick(staff, c, passport.id, { status: "RECEIVED", receivedAs: "XEROX" });
    expect(received.status).toBe(200);
    let after: CaseDto = received.body.case;
    expect(after.stage.code).toBe("DOCUMENTS");
    expect(docOf(after, "Passport")).toMatchObject({ status: "RECEIVED", receivedAs: "XEROX", receivedBy: { name: "Aarti Patel" } });
    expect(Date.parse(docOf(after, "Passport").receivedAt!)).not.toBeNaN();
    expect(after.travellers[0]).toMatchObject({ done: 1, need: 11 });

    after = (await tick(staff, c, passport.id, { status: "RECEIVED", receivedAs: "ORIGINAL" })).body.case;
    expect(docOf(after, "Passport").receivedAs).toBe("ORIGINAL");
    after = (await tick(staff, c, flight.id, { status: "MADE" })).body.case;
    expect(docOf(after, "Flight reservation")).toMatchObject({ status: "MADE", receivedAs: null });
    after = (await tick(staff, c, docOf(c, "Salary slips, last 3 months").id, { status: "NOT_NEEDED" })).body.case;
    expect(after.travellers[0]).toMatchObject({ done: 2, need: 10 });

    after = (await tick(staff, c, passport.id, { status: "PENDING" })).body.case;
    expect(docOf(after, "Passport")).toMatchObject({ status: "PENDING", receivedAs: null, receivedAt: null, receivedBy: null });

    // Sending the same tick again changes nothing.
    await tick(staff, c, passport.id, { status: "PENDING" });
    const entries = await prisma.auditLog.findMany({ where: { action: "visa.document.update" }, orderBy: { createdAt: "asc" } });
    expect(entries).toHaveLength(5);
    expect(entries[0]).toMatchObject({ clientId: c.client.id, before: { status: "PENDING" }, after: { status: "RECEIVED", receivedAs: "XEROX" } });
    expect(await prisma.auditLog.count({ where: { action: "enquiry.stage" } })).toBe(1);

    // A paper from another case.
    const other = await freshCase(staff);
    expect((await tick(staff, c, docOf(other, "Passport").id, { status: "NOT_NEEDED" })).status).toBe(404);
  });

  it("names travellers by linking family members, and refuses another family's or the same person twice", async () => {
    const staff = await visaStaff();
    const c = await freshCase(staff);
    const adult = c.travellers[0]!;
    const child = c.travellers[1]!;
    const link = (travellerId: string, memberId: string) => staff.put(`/api/visa/cases/${c.caseNo}/travellers/${travellerId}/member`).send({ memberId });
    const rakesh = await addMember(staff, c.client.id, "Rakesh Mehta");
    const aarav = await addMember(staff, c.client.id, "Aarav Mehta", "SON");

    const linked = await link(adult.id, rakesh);
    expect(linked.status).toBe(200);
    expect(linked.body.case.stage.code).toBe("DOCUMENTS");
    expect(linked.body.case.travellers[0]).toMatchObject({ name: "Rakesh Mehta", member: { id: rakesh }, consent: { state: "NONE" } });

    expect((await link(child.id, rakesh)).status).toBe(409);

    // Picking someone else corrects a mistake.
    expect((await link(adult.id, aarav)).body.case.travellers[0]).toMatchObject({ name: "Aarav Mehta", member: { id: aarav } });

    // Another client's family member, and an archived one.
    const otherClient = await staff.post("/api/clients").send({ name: "Other Family", mobile: "9825000077" });
    const stranger = await addMember(staff, otherClient.body.client.id, "Stranger Person");
    const refused = await link(child.id, stranger);
    expect(refused.status).toBe(400);
    expect(refused.body.issues.memberId).toBeDefined();
    await staff.post(`/api/clients/${c.client.id}/members/${rakesh}/archive`).set(json);
    expect((await link(child.id, rakesh)).status).toBe(400);

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.traveller.link" }, orderBy: { createdAt: "asc" } });
    expect(entry).toMatchObject({ clientId: c.client.id, before: { memberId: null, name: null }, after: { memberId: rakesh, name: "Rakesh Mehta" } });
  });

  it("lets only the owner, the Visa HOD and the Head act", async () => {
    const staff = await visaStaff();
    const c = await freshCase(staff);
    const passport = docOf(c, "Passport");

    await createUser({ name: "Neha", email: "neha@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    expect((await tick(await loginAs("neha@masti.test"), c, passport.id, { status: "NOT_NEEDED" })).status).toBe(403);
    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    expect((await tick(await loginAs("meena@masti.test"), c, passport.id, { status: "NOT_NEEDED" })).status).toBe(403);

    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    expect((await tick(await loginAs("riya@masti.test"), c, passport.id, { status: "NOT_NEEDED" })).status).toBe(200);
    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    expect((await tick(await loginAs("vimal@masti.test"), c, passport.id, { status: "PENDING" })).status).toBe(200);
  });

  it("refuses changes once the case is postponed, cancelled or past collecting documents", async () => {
    const staff = await visaStaff();
    const c = await freshCase(staff);
    const passport = docOf(c, "Passport");
    const reason = async (code: string) => (await prisma.enquiryReason.findUniqueOrThrow({ where: { code } })).id;

    await prisma.enquiry.update({
      where: { id: c.id },
      data: { status: "POSTPONED", reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: new Date(`${addMonths(istToday(), 1)}T00:00:00Z`) },
    });
    const postponed = await tick(staff, c, passport.id, { status: "NOT_NEEDED" });
    expect(postponed.status).toBe(409);
    expect(postponed.body.message).toMatch(/postponed/);

    await prisma.enquiry.update({ where: { id: c.id }, data: { status: "CANCELLED", reasonId: await reason("TRIP_CANCELLED"), resumeOn: null } });
    expect((await tick(staff, c, passport.id, { status: "NOT_NEEDED" })).status).toBe(409);

    const filePrep = await prisma.departmentStage.findFirstOrThrow({ where: { code: "FILE_PREPARATION" } });
    await prisma.enquiry.update({ where: { id: c.id }, data: { status: "OPEN", reasonId: null, stageId: filePrep.id } });
    const past = await tick(staff, c, passport.id, { status: "NOT_NEEDED" });
    expect(past.status).toBe(409);
    expect(past.body.message).toMatch(/moved past/);
    expect((await staff.post(`/api/visa/cases/${c.caseNo}/start`).set(json)).status).toBe(409);
  });
});
