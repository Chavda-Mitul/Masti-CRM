import { beforeEach, describe, expect, it } from "vitest";
import { addDays, istToday } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { nextOpenDay } from "../src/modules/holidays/blockedDays";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { saveCase, type Agent } from "./visaHelpers";

// A leaver's work (docs/decisions/0002-user-types.md amendment 1): switching someone off, or taking away their EDIT in a
// department, sends their unfinished cases there to "To assign" for the HOD; switching off a field boy, or making him
// office staff, calls off his booked jobs, so each case books another boy.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

/** Vimal (Head), Hina (Visa HOD), Ravi and Sita (Visa staff with EDIT; Ravi in Holidays too), logged in. */
async function office() {
  await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
  await createUser({ name: "Hina", email: "hina@masti.test", departments: [{ code: "VISA", role: "HOD", access: "EDIT" }] });
  const ravi = await createUser({ name: "Ravi", email: "ravi@masti.test", departments: [{ code: "VISA", access: "EDIT" }, { code: "HOLIDAYS", access: "EDIT" }] });
  const sita = await createUser({ name: "Sita", email: "sita@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
  return {
    head: await loginAs("vimal@masti.test"),
    hina: await loginAs("hina@masti.test"),
    ravi,
    raviAgent: await loginAs("ravi@masti.test"),
    sita,
    sitaAgent: await loginAs("sita@masti.test"),
  };
}

const updatedAt = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case.updatedAt as string;
const reason = async (code: string) => (await prisma.enquiryReason.findUniqueOrThrow({ where: { code } })).id;
const ownerOf = async (caseNo: string) => (await prisma.enquiry.findUniqueOrThrow({ where: { caseNo } })).ownerId;
const toAssign = async (agent: Agent) => {
  const list = await agent.get("/api/enquiries?unassigned=true");
  expect(list.status).toBe(200);
  return (list.body.enquiries as { caseNo: string }[]).map((e) => e.caseNo).sort();
};

/** Ravi's cases in every state that matters: open, postponed, cancelled with passports at our office, cancelled with nothing to hand back, closed. */
async function ravisCases(raviAgent: Agent) {
  const open = await saveCase(raviAgent, { mobile: "98250 41001", clientName: "Asha Open" });
  const postponed = await saveCase(raviAgent, { mobile: "98250 41002", clientName: "Bina Postponed" });
  const holding = await saveCase(raviAgent, { mobile: "98250 41003", clientName: "Chirag Holding" });
  const cancelled = await saveCase(raviAgent, { mobile: "98250 41004", clientName: "Dev Cancelled" });
  const closed = await saveCase(raviAgent, { mobile: "98250 41005", clientName: "Esha Closed" });

  // Read first: a request awaited inside another's .send(...) breaks supertest.
  const wait = { reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: addDays(istToday(), 20), updatedAt: await updatedAt(raviAgent, postponed.caseNo) };
  expect((await raviAgent.post(`/api/enquiries/${postponed.caseNo}/postpone`).send(wait)).status).toBe(200);
  // Two passports counted in at the office, then cancelled: they're still to hand back (0006 amendment 15).
  await prisma.visaCase.update({ where: { enquiryId: holding.id }, data: { bookletsCurrent: 2, bookletsOld: 0 } });
  for (const c of [holding, cancelled]) {
    const body = { reasonId: await reason("TRIP_CANCELLED"), updatedAt: await updatedAt(raviAgent, c.caseNo) };
    expect((await raviAgent.post(`/api/enquiries/${c.caseNo}/cancel`).send(body)).status).toBe(200);
  }
  await prisma.enquiry.update({ where: { id: closed.id }, data: { status: "CLOSED", dueAt: null } });
  return { open, postponed, holding, cancelled, closed };
}

describe("switching off a staff member", () => {
  it("sends their unfinished cases to To assign, and keeps their finished ones and everyone else's", async () => {
    const { head, hina, ravi, raviAgent, sitaAgent } = await office();
    const c = await ravisCases(raviAgent);
    const sitas = await saveCase(sitaAgent, { mobile: "98250 41006", clientName: "Farah Sita" });
    expect(await ownerOf(c.open.caseNo)).toBe(ravi.id);

    const res = await head.post(`/api/users/${ravi.id}/deactivate`).send({});
    expect(res.status).toBe(200);

    const unfinished = [c.open.caseNo, c.postponed.caseNo, c.holding.caseNo].sort();
    for (const caseNo of unfinished) expect(await ownerOf(caseNo)).toBeNull();
    expect(await ownerOf(c.cancelled.caseNo)).toBe(ravi.id);
    expect(await ownerOf(c.closed.caseNo)).toBe(ravi.id);
    expect(await ownerOf(sitas.caseNo)).not.toBeNull();

    expect(await toAssign(hina)).toEqual(unfinished);
    expect((await hina.get("/api/enquiries/to-assign")).body).toEqual({ count: 3 });

    const audits = await prisma.auditLog.findMany({ where: { action: "enquiry.unassign" } });
    expect(audits).toHaveLength(3);
    expect(audits.every((a) => (a.before as { ownerId: string }).ownerId === ravi.id)).toBe(true);
    expect(audits.every((a) => (a.after as { why: string }).why === "user deactivated")).toBe(true);
    const userAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.deactivate" } });
    expect((userAudit.after as { casesToAssign: string[] }).casesToAssign).toEqual(unfinished);
  });

  it("lets the HOD give out each one, a cancelled case still holding passports too, but not a finished one", async () => {
    const { head, hina, ravi, raviAgent, sita } = await office();
    const c = await ravisCases(raviAgent);
    await head.post(`/api/users/${ravi.id}/deactivate`).send({});

    for (const caseNo of [c.open.caseNo, c.postponed.caseNo, c.holding.caseNo]) {
      const body = { ownerId: sita.id, updatedAt: await updatedAt(hina, caseNo) };
      expect((await hina.put(`/api/enquiries/${caseNo}/owner`).send(body)).status).toBe(200);
      expect(await ownerOf(caseNo)).toBe(sita.id);
    }
    expect(await toAssign(hina)).toEqual([]);

    const body = { ownerId: sita.id, updatedAt: await updatedAt(hina, c.cancelled.caseNo) };
    const finished = await hina.put(`/api/enquiries/${c.cancelled.caseNo}/owner`).send(body);
    expect(finished.status).toBe(409);
    expect(finished.body.message).toBe("This case is closed.");
  });

  it("hands back nothing for someone with no cases", async () => {
    const { head, sita } = await office();
    expect((await head.post(`/api/users/${sita.id}/deactivate`).send({})).status).toBe(200);
    const userAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.deactivate" } });
    expect(userAudit.after).not.toHaveProperty("casesToAssign");
    expect(userAudit.after).not.toHaveProperty("fieldJobsCancelled");
  });
});

describe("changing someone's access", () => {
  it("hands back only the cases of the departments they can no longer edit", async () => {
    const { head, hina, ravi, raviAgent } = await office();
    const visa = await saveCase(raviAgent, { mobile: "98250 41011", clientName: "Gita Visa" });
    // A holiday enquiry of his, straight in the database (Holidays comes in Stage 2).
    const holidays = await prisma.department.findUniqueOrThrow({ where: { code: "HOLIDAYS" } });
    const stage = await prisma.departmentStage.create({
      data: { departmentId: holidays.id, flow: "HOLIDAYS", code: "ENQUIRY", name: "Enquiry", sortOrder: 1, statusLabel: "Enquiry saved", nextStepLabel: "Send a quote" },
    });
    const source = await prisma.enquirySource.findFirstOrThrow();
    const trip = await prisma.enquiry.create({
      data: { caseNo: "HOL-2026-0001", departmentId: holidays.id, clientId: visa.client.id, sourceId: source.id, stageId: stage.id, ownerId: ravi.id },
    });

    const res = await head.patch(`/api/users/${ravi.id}`).send({
      departments: [
        { departmentCode: "VISA", role: "STAFF", access: "VIEW" },
        { departmentCode: "HOLIDAYS", role: "STAFF", access: "EDIT" },
      ],
    });
    expect(res.status).toBe(200);
    expect(await ownerOf(visa.caseNo)).toBeNull();
    expect((await prisma.enquiry.findUniqueOrThrow({ where: { id: trip.id } })).ownerId).toBe(ravi.id);
    expect(await toAssign(hina)).toEqual([visa.caseNo]);

    const unassign = await prisma.auditLog.findFirstOrThrow({ where: { action: "enquiry.unassign" } });
    expect((unassign.after as { why: string }).why).toBe("user's access changed");
    const userAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.update" } });
    expect((userAudit.after as { casesToAssign: string[] }).casesToAssign).toEqual([visa.caseNo]);
  });

  it("keeps the cases of someone made HOD, or made Head", async () => {
    const { head, sita, sitaAgent } = await office();
    const c = await saveCase(sitaAgent, { mobile: "98250 41021", clientName: "Hari Sita" });

    const hod = await head.patch(`/api/users/${sita.id}`).send({ departments: [{ departmentCode: "VISA", role: "HOD", access: "EDIT" }] });
    expect(hod.status).toBe(200);
    expect(await ownerOf(c.caseNo)).toBe(sita.id);

    const madeHead = await head.patch(`/api/users/${sita.id}`).send({ type: "HEAD" });
    expect(madeHead.status).toBe(200);
    expect(await ownerOf(c.caseNo)).toBe(sita.id);
    expect(await prisma.auditLog.count({ where: { action: "enquiry.unassign" } })).toBe(0);
  });
});

describe("switching off a field boy", () => {
  /** Books `boy` to pick up a case's papers, `from` days out, as `agent`. */
  async function book(agent: Agent, caseNo: string, boyId: string, from = 1) {
    const body = {
      kind: "PICKUP",
      assigneeId: boyId,
      day: await nextOpenDay(addDays(istToday(), from), { office: true }),
      slotId: (await prisma.fieldSlot.findUniqueOrThrow({ where: { code: "EVENING" } })).id,
      address: "B-702, Raghuvir Residency, Vesu, Surat",
      updatedAt: await updatedAt(agent, caseNo),
    };
    return agent.post(`/api/visa/cases/${caseNo}/field-jobs`).send(body);
  }

  /** A Visa case of Sita's for `clientName`, the client's email on file, a pickup booked for `boy`. */
  async function bookedPickup(sitaAgent: Agent, mobile: string, clientName: string, boyId: string) {
    const c = await saveCase(sitaAgent, { mobile, clientName });
    await prisma.client.update({ where: { id: c.client.id }, data: { email: `${mobile.replace(/\D/g, "")}@example.com` } });
    expect((await book(sitaAgent, c.caseNo, boyId)).status).toBe(200);
    return c;
  }

  it("calls off his booked jobs, keeps the other boy's, and the case books another boy", async () => {
    const { head, sitaAgent } = await office();
    const ramesh = await createUser({ name: "Ramesh", mobile: "+919825000001", type: "FIELD" });
    const suresh = await createUser({ name: "Suresh", mobile: "+919825000002", type: "FIELD" });
    const his = await bookedPickup(sitaAgent, "98250 41031", "Kavya Shah", ramesh.id);
    const other = await bookedPickup(sitaAgent, "98250 41032", "Neel Mehta", suresh.id);

    const work = await head.get(`/api/users/${ramesh.id}/open-work`);
    expect(work.status).toBe(200);
    expect(work.body.cases).toEqual([]);
    expect(work.body.fieldJobs).toEqual([expect.objectContaining({ kind: "PICKUP", caseNo: his.caseNo, client: { name: "Kavya Shah" } })]);

    expect((await head.post(`/api/users/${ramesh.id}/deactivate`).send({})).status).toBe(200);

    const vimal = await prisma.user.findUniqueOrThrow({ where: { email: "vimal@masti.test" } });
    const [called] = await prisma.fieldJob.findMany({ where: { enquiryId: his.id } });
    expect(called).toMatchObject({ status: "CANCELLED", cancelledById: vimal.id });
    expect((await prisma.fieldJob.findFirstOrThrow({ where: { enquiryId: other.id } })).status).toBe("BOOKED");
    const cancelAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: "field.job.cancel", entityId: called!.id } });
    expect((cancelAudit.after as { why: string }).why).toBe("user deactivated");
    const userAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.deactivate" } });
    expect((userAudit.after as { fieldJobsCancelled: unknown[] }).fieldJobsCancelled).toEqual([{ id: called!.id, kind: "PICKUP" }]);

    // The case books Suresh instead.
    expect((await book(sitaAgent, his.caseNo, suresh.id, 2)).status).toBe(200);
  });

  it("calls them off when he becomes office staff too", async () => {
    const { head, sitaAgent } = await office();
    const ramesh = await createUser({ name: "Ramesh", mobile: "+919825000001", type: "FIELD" });
    const his = await bookedPickup(sitaAgent, "98250 41041", "Om Patel", ramesh.id);

    const res = await head.patch(`/api/users/${ramesh.id}`).send({ type: "OFFICE", departments: [{ departmentCode: "VISA", role: "STAFF", access: "VIEW" }] });
    expect(res.status).toBe(200);
    expect((await prisma.fieldJob.findFirstOrThrow({ where: { enquiryId: his.id } })).status).toBe("CANCELLED");
    const cancelAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: "field.job.cancel" } });
    expect((cancelAudit.after as { why: string }).why).toBe("user's access changed");
  });
});

describe("what the Deactivate box warns about", () => {
  it("lists their unfinished cases, for the Head only", async () => {
    const { head, hina, ravi, raviAgent } = await office();
    const c = await ravisCases(raviAgent);

    const res = await head.get(`/api/users/${ravi.id}/open-work`);
    expect(res.status).toBe(200);
    expect((res.body.cases as { caseNo: string }[]).map((x) => x.caseNo)).toEqual([c.open.caseNo, c.postponed.caseNo, c.holding.caseNo].sort());
    expect(res.body.cases[0]).toEqual({
      caseNo: c.open.caseNo,
      status: "OPEN",
      department: { code: "VISA", name: "Visa" },
      client: { name: "Asha Open" },
    });
    expect(res.body.fieldJobs).toEqual([]);

    expect((await hina.get(`/api/users/${ravi.id}/open-work`)).status).toBe(403);
  });
});
