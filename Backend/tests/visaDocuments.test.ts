import { beforeEach, describe, expect, it } from "vitest";
import { addDays, addMonths, istDateTimeToUtc, istToday, toDbDate } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { nextOpenDay } from "../src/modules/holidays/blockedDays";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { holdCaseLock, saveCase, untilWaitingOnLock, visaStaff, type Agent } from "./visaHelpers";

// Visa Step 2 (docs/decisions/0006-visa-documents.md). Who may open a case is tested in enquiries.test.ts.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

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
    // A consent given through its link, to the wording in use (docs/decisions/0022-consent-form.md).
    const wording = await prisma.consentWording.findFirstOrThrow();
    const link = await prisma.consentLink.create({
      data: { memberId: member.id, enquiryId: saved.id, tokenHash: "test-hash", toMobile: "+919825041234", createdById: aarti.id, usedAt: new Date("2026-09-28T09:44:00Z") },
    });
    await prisma.consent.create({
      data: { memberId: member.id, agreedAt: new Date("2026-09-28T09:44:00Z"), wordingId: wording.id, linkId: link.id, details: { name: member.name } },
    });

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
    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    const head = await loginAs("vimal@masti.test");
    const otherClient = await head.post("/api/clients").send({ name: "Other Family", mobile: "9825000077" });
    const stranger = await addMember(head, otherClient.body.client.id, "Stranger Person");
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

  it("records how the documents reach us and the booklets (optional), audited", async () => {
    const staff = await visaStaff();
    const c = await freshCase(staff);
    const patch = (agent: Agent, body: Record<string, unknown>) => agent.patch(`/api/visa/cases/${c.caseNo}`).send(body);

    const set = await patch(staff, { arrival: "CLIENT_BRINGS", bookletsCurrent: 2, bookletsOld: 1 });
    expect(set.status).toBe(200);
    expect(set.body.case).toMatchObject({ arrival: "CLIENT_BRINGS", booklets: { current: 2, old: 1 }, stage: { code: "DOCUMENTS" } });

    expect((await patch(staff, { bookletsCurrent: 51 })).status).toBe(400);
    expect((await patch(staff, { bookletsOld: -1 })).status).toBe(400);
    expect((await patch(staff, { arrival: "BY_POST" })).status).toBe(400);

    // Booklets can be cleared (e-visas hand over no passport); only what changed is audited.
    const cleared = await patch(staff, { arrival: "COLLECTION_BOY", bookletsCurrent: null, bookletsOld: 1 });
    expect(cleared.body.case).toMatchObject({ arrival: "COLLECTION_BOY", booklets: { current: null, old: 1 } });
    const entries = await prisma.auditLog.findMany({ where: { action: "visa.case.update" }, orderBy: { createdAt: "asc" } });
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      clientId: c.client.id,
      before: { arrival: "CLIENT_BRINGS", bookletsCurrent: 2 },
      after: { arrival: "COLLECTION_BOY", bookletsCurrent: null },
    });

    await createUser({ name: "Neha", email: "neha@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    expect((await patch(await loginAs("neha@masti.test"), { arrival: "CLIENT_BRINGS" })).status).toBe(403);
  });

  describe("Mark documents complete", () => {
    type FullCase = CaseDto & {
      updatedAt: string;
      owner: { name: string } | null;
      dueAt: string | null;
      maturedAt: string | null;
      maturedBy: { name: string } | null;
      booklets: { current: number | null; old: number | null };
      travellers: (CaseDto["travellers"][number] & { documents: (CaseDoc & { requirement: string })[] })[];
    };

    const mature = (agent: Agent, c: { caseNo: string }, updatedAt: string) => agent.post(`/api/visa/cases/${c.caseNo}/mature`).send({ updatedAt });
    const load = async (agent: Agent, caseNo: string): Promise<FullCase> => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case;
    const link = async (agent: Agent, c: CaseDto, traveller: number, memberId: string) =>
      expect((await agent.put(`/api/visa/cases/${c.caseNo}/travellers/${c.travellers[traveller]!.id}/member`).send({ memberId })).status).toBe(200);

    /** Names both travellers and ticks every paper by what it needs (salary slips "Not needed"), except `skip`. */
    async function completeCase(agent: Agent, c: CaseDto, skip?: string) {
      await link(agent, c, 0, await addMember(agent, c.client.id, "Rakesh Mehta"));
      await link(agent, c, 1, await addMember(agent, c.client.id, "Aarav Mehta", "SON"));
      for (const t of (await load(agent, c.caseNo)).travellers) {
        for (const d of t.documents) {
          if (d.name === skip) continue;
          const body =
            d.requirement === "ARRANGED_BY_US"
              ? { status: "MADE" }
              : d.name.startsWith("Salary slips")
                ? { status: "NOT_NEEDED" }
                : { status: "RECEIVED", receivedAs: d.requirement === "ORIGINAL" ? "ORIGINAL" : "XEROX" };
          expect((await tick(agent, c, d.id, body)).status).toBe(200);
        }
      }
      return load(agent, c.caseNo);
    }

    it("refuses while a traveller is unnamed or a paper is pending, and says what is missing", async () => {
      const staff = await visaStaff();
      const c = await freshCase(staff);
      await link(staff, c, 0, await addMember(staff, c.client.id, "Rakesh Mehta"));
      await tick(staff, c, docOf(c, "Passport").id, { status: "RECEIVED", receivedAs: "ORIGINAL" });
      const before = await load(staff, c.caseNo);

      const refused = await mature(staff, c, before.updatedAt);
      expect(refused.status).toBe(409);
      expect(refused.body.details.code).toBe("NOT_READY");
      expect(refused.body.message).toMatch(/name Child 1/);
      expect(refused.body.details.missing.unnamed).toEqual(["Child 1"]);
      const pending = refused.body.details.missing.pending as { traveller: string; documents: string[] }[];
      expect(pending.map((p) => p.traveller)).toEqual(["Rakesh Mehta", "Child 1"]);
      expect(pending[0]!.documents).not.toContain("Passport");
      expect(pending[0]!.documents).toContain("Flight reservation");

      // Nothing changed.
      expect(await load(staff, c.caseNo)).toMatchObject({ stage: { code: "DOCUMENTS" }, owner: { name: "Aarti Patel" }, maturedAt: null });
      expect(await prisma.auditLog.count({ where: { action: "visa.mature" } })).toBe(0);
      expect(await prisma.outboundMessage.count()).toBe(0);

      // One paper short is still refused.
      const other = await freshCase(staff);
      const almost = await completeCase(staff, other, "Passport");
      const short = await mature(staff, other, almost.updatedAt);
      expect(short.status).toBe(409);
      expect(short.body.details.missing).toEqual({
        unnamed: [],
        pending: [
          { traveller: "Rakesh Mehta", documents: ["Passport"] },
          { traveller: "Aarav Mehta", documents: ["Passport"] },
        ],
      });
    });

    it("moves a complete case to File preparation with no owner, stamped and audited; booklets are optional", async () => {
      const staff = await visaStaff();
      const c = await freshCase(staff);
      const complete = await completeCase(staff, c);
      expect(complete.booklets).toEqual({ current: null, old: null });

      const res = await mature(staff, c, complete.updatedAt);
      expect(res.status).toBe(200);
      const after: FullCase = res.body.case;
      expect(after).toMatchObject({ stage: { code: "FILE_PREPARATION", step: 3 }, status: "OPEN", owner: null, maturedBy: { name: "Aarti Patel" } });
      // Due with the HOD the next open office day at 11:00 ⚠️ (visa.assignCheck), not late the moment it's handed over.
      expect(Math.abs(Date.parse(after.maturedAt!) - Date.now())).toBeLessThan(60_000);
      expect(after.dueAt).toBe(istDateTimeToUtc(await nextOpenDay(addDays(istToday(), 1), { office: true }), "11:00").toISOString());

      const aarti = await prisma.user.findUniqueOrThrow({ where: { email: "aarti@masti.test" } });
      const entries = await prisma.auditLog.findMany({ where: { action: "visa.mature" } });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorId: aarti.id,
        entityId: c.id,
        clientId: c.client.id,
        before: { stage: "DOCUMENTS", ownerId: aarti.id },
        after: { stage: "FILE_PREPARATION", ownerId: null, maturedById: aarti.id },
      });

      // The client's "All documents received" WhatsApp is queued with the move (0021); messages.test.ts sends it.
      const messages = await prisma.outboundMessage.findMany({ include: { template: { select: { code: true } } } });
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        status: "QUEUED",
        clientId: c.client.id,
        enquiryId: c.id,
        toMobile: "+919825041234",
        template: { code: "visa.documents_received" },
      });

      // The owner is cleared, so whoever matured it no longer opens it: it is the HOD's to assign.
      expect((await staff.get(`/api/visa/cases/${c.caseNo}`)).status).toBe(403);
    });

    it("waits while the collection boy is booked: the office calls him off first (0015)", async () => {
      const staff = await visaStaff();
      const c = await freshCase(staff);
      const { updatedAt } = await completeCase(staff, c);
      const ramesh = await createUser({ name: "Ramesh", mobile: "+919825000001", type: "FIELD" });
      const aarti = await prisma.user.findUniqueOrThrow({ where: { email: "aarti@masti.test" } });
      const visa = await prisma.department.findUniqueOrThrow({ where: { code: "VISA" } });
      const slot = await prisma.fieldSlot.findUniqueOrThrow({ where: { code: "EVENING" } });
      const job = await prisma.fieldJob.create({
        data: { departmentId: visa.id, kind: "PICKUP", enquiryId: c.id, assigneeId: ramesh.id, day: toDbDate(istToday()), slotId: slot.id, address: "B-702, Raghuvir Residency, Vesu", mobile: "+919825041234", createdById: aarti.id },
      });

      const refused = await mature(staff, c, updatedAt);
      expect(refused.status).toBe(409);
      expect(refused.body.message).toBe("The collection boy is still booked for this case. Cancel his pickup first.");
      expect(await prisma.auditLog.count({ where: { action: "visa.mature" } })).toBe(0);
      expect(await prisma.outboundMessage.count()).toBe(0);

      await prisma.fieldJob.update({ where: { id: job.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: aarti.id } });
      expect((await mature(staff, c, updatedAt)).status).toBe(200);
    });

    it("is due with the HOD as the setting says (visa.assignCheck)", async () => {
      const staff = await visaStaff();
      const c = await freshCase(staff);
      const complete = await completeCase(staff, c);
      await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
      expect((await (await loginAs("riya@masti.test")).put("/api/visa/settings").send({ assignCheck: { afterDays: 2, at: "10:00" } })).status).toBe(200);
      const after: FullCase = (await mature(staff, c, complete.updatedAt)).body.case;
      expect(after.dueAt).toBe(istDateTimeToUtc(await nextOpenDay(addDays(istToday(), 2), { office: true }), "10:00").toISOString());
    });

    it("lets only the owner, the Visa HOD and the Head mark it complete", async () => {
      const staff = await visaStaff();
      const c = await freshCase(staff);
      const { updatedAt } = await completeCase(staff, c);

      await createUser({ name: "Neha", email: "neha@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
      expect((await mature(await loginAs("neha@masti.test"), c, updatedAt)).status).toBe(403);
      await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
      expect((await mature(await loginAs("meena@masti.test"), c, updatedAt)).status).toBe(403);
      expect(await prisma.outboundMessage.count()).toBe(0);

      await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
      const byHod = await mature(await loginAs("riya@masti.test"), c, updatedAt);
      expect(byHod.status).toBe(200);
      expect(byHod.body.case.maturedBy).toMatchObject({ name: "Riya" });

      const second = await freshCase(staff);
      const done = await completeCase(staff, second);
      await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
      expect((await mature(await loginAs("vimal@masti.test"), second, done.updatedAt)).status).toBe(200);
    });

    it("refuses a stale page, a second press, and a postponed or cancelled case", async () => {
      const staff = await visaStaff();
      await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
      const hod = await loginAs("riya@masti.test");
      const c = await freshCase(staff);
      const { updatedAt } = await completeCase(staff, c);

      const stale = await mature(staff, c, "2026-01-01T00:00:00.000Z");
      expect(stale.status).toBe(409);
      expect(stale.body.details.code).toBe("STALE");
      expect((await mature(staff, c, "yesterday")).status).toBe(400);

      expect((await mature(staff, c, updatedAt)).status).toBe(200);
      const again = await mature(hod, c, updatedAt);
      expect(again.status).toBe(409);
      expect(again.body.message).toMatch(/moved past/);
      expect(await prisma.auditLog.count({ where: { action: "visa.mature" } })).toBe(1);
      // One message for the one move: a stale page or a second press queues none.
      expect(await prisma.outboundMessage.count()).toBe(1);

      const reason = async (code: string) => (await prisma.enquiryReason.findUniqueOrThrow({ where: { code } })).id;
      const held = await freshCase(staff);
      const ready = await completeCase(staff, held);
      const postponed = await staff
        .post(`/api/enquiries/${held.caseNo}/postpone`)
        .send({ reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: addMonths(istToday(), 1), updatedAt: ready.updatedAt });
      expect(postponed.status).toBe(200);
      expect((await mature(staff, held, postponed.body.enquiry.updatedAt)).body.message).toMatch(/postponed/);
      const cancelled = await staff
        .post(`/api/enquiries/${held.caseNo}/cancel`)
        .send({ reasonId: await reason("TRIP_CANCELLED"), updatedAt: postponed.body.enquiry.updatedAt });
      expect(cancelled.status).toBe(200);
      expect((await mature(staff, held, cancelled.body.enquiry.updatedAt)).status).toBe(409);
    });

    it("locks the checklist, and the HOD gives the file to a processor other than whoever matured it", async () => {
      const staff = await visaStaff();
      await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
      await createUser({ name: "Neha", email: "neha@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
      const hod = await loginAs("riya@masti.test");
      const c = await freshCase(staff);
      const complete = await completeCase(staff, c);
      const matured: FullCase = (await mature(staff, c, complete.updatedAt)).body.case;

      const locked = await tick(hod, c, docOf(matured, "Passport").id, { status: "PENDING" });
      expect(locked.status).toBe(409);
      expect(locked.body.message).toMatch(/moved past/);
      expect((await hod.patch(`/api/visa/cases/${c.caseNo}`).send({ bookletsCurrent: 1 })).status).toBe(409);

      const assignees = (await hod.get(`/api/enquiries/${c.caseNo}/assignees`)).body.assignees as { name: string }[];
      expect(assignees.map((a) => a.name)).not.toContain("Aarti Patel");
      const aarti = await prisma.user.findUniqueOrThrow({ where: { email: "aarti@masti.test" } });
      const neha = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
      expect((await hod.put(`/api/enquiries/${c.caseNo}/owner`).send({ ownerId: aarti.id, updatedAt: matured.updatedAt })).status).toBe(400);
      expect((await hod.put(`/api/enquiries/${c.caseNo}/owner`).send({ ownerId: neha.id, updatedAt: matured.updatedAt })).status).toBe(200);

      const processor = await loginAs("neha@masti.test");
      expect(await load(processor, c.caseNo)).toMatchObject({ stage: { code: "FILE_PREPARATION" }, owner: { name: "Neha" }, maturedBy: { name: "Aarti Patel" } });
    });

    it("doesn't mature a case while a paper is being un-ticked: it waits, then sees the paper pending", async () => {
      const staff = await visaStaff();
      const c = await freshCase(staff);
      const complete = await completeCase(staff, c);
      const passport = docOf(complete, "Passport");

      // Un-ticking the passport is mid-transaction: it holds the case and has set the paper back to Pending, not committed.
      const untick = holdCaseLock(c.id, (tx) =>
        tx.visaCaseDocument.update({ where: { id: passport.id }, data: { status: "PENDING", receivedAs: null, receivedAt: null, receivedById: null } }),
      );
      await untick.ready;
      const pressed = mature(staff, c, complete.updatedAt).then((r) => r);
      try {
        await untilWaitingOnLock();
      } finally {
        untick.release();
        await untick.done;
      }

      const res = await pressed;
      expect(res.status).toBe(409);
      expect(res.body.details).toMatchObject({ code: "NOT_READY", missing: { pending: [{ traveller: "Rakesh Mehta", documents: ["Passport"] }] } });
      expect(await load(staff, c.caseNo)).toMatchObject({ stage: { code: "DOCUMENTS" }, owner: { name: "Aarti Patel" }, maturedAt: null });
    });

    it("doesn't let a tick slip in while the case is being matured: it waits, then sees the case has moved on", async () => {
      const staff = await visaStaff();
      const c = await freshCase(staff);
      const complete = await completeCase(staff, c);
      const passport = docOf(complete, "Passport");
      const filePrep = await prisma.departmentStage.findFirstOrThrow({ where: { code: "FILE_PREPARATION" } });

      // Maturity is mid-transaction: it holds the case and has moved it to File preparation, not committed.
      const maturing = holdCaseLock(c.id, (tx) => tx.enquiry.update({ where: { id: c.id }, data: { stageId: filePrep.id } }));
      await maturing.ready;
      const ticked = tick(staff, c, passport.id, { status: "PENDING" }).then((r) => r);
      try {
        await untilWaitingOnLock();
      } finally {
        maturing.release();
        await maturing.done;
      }

      const res = await ticked;
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/moved past/);
      expect(await prisma.visaCaseDocument.findUniqueOrThrow({ where: { id: passport.id } })).toMatchObject({ status: "RECEIVED" });
    });

    it("waits under To assign for the HOD and the Head until a processor is picked", async () => {
      const staff = await visaStaff();
      await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
      await createUser({ name: "Neha", email: "neha@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
      await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
      const hod = await loginAs("riya@masti.test");
      const head = await loginAs("vimal@masti.test");
      const toAssign = async (agent: Agent) => ((await agent.get("/api/enquiries?unassigned=true")).body.enquiries as { caseNo: string }[]).map((r) => r.caseNo);
      const count = async (agent: Agent) => (await agent.get("/api/enquiries/to-assign")).body.count as number;

      const c = await freshCase(staff);
      await freshCase(staff); // still collecting: not to assign
      expect(await count(hod)).toBe(0);
      const matured: FullCase = (await mature(staff, c, (await completeCase(staff, c)).updatedAt)).body.case;

      expect(await toAssign(hod)).toEqual([c.caseNo]);
      expect(await toAssign(head)).toEqual([c.caseNo]);
      expect(await count(hod)).toBe(1);
      expect(await count(head)).toBe(1);
      // Only those who assign may ask: staff and view-only users (who see the whole department) are refused.
      await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
      const viewOnly = await loginAs("meena@masti.test");
      for (const agent of [staff, viewOnly]) {
        expect((await agent.get("/api/enquiries?unassigned=true")).status).toBe(403);
        expect((await agent.get("/api/enquiries/to-assign")).status).toBe(403);
      }
      // An HOD elsewhere who can view Visa sees only their own department's cases to assign.
      await createUser({
        name: "Kiran",
        email: "kiran@masti.test",
        departments: [
          { code: "HOLIDAYS", role: "HOD" },
          { code: "VISA", access: "VIEW" },
        ],
      });
      const otherHod = await loginAs("kiran@masti.test");
      expect(await toAssign(otherHod)).toEqual([]);
      expect(await count(otherHod)).toBe(0);
      expect((await otherHod.get("/api/enquiries?unassigned=true&department=VISA")).status).toBe(403);

      const neha = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
      expect((await hod.put(`/api/enquiries/${c.caseNo}/owner`).send({ ownerId: neha.id, updatedAt: matured.updatedAt })).status).toBe(200);
      expect(await count(hod)).toBe(0);
      expect(await toAssign(hod)).toEqual([]);
    });
  });
});
