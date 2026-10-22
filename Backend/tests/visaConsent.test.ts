import { beforeEach, describe, expect, it } from "vitest";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { saveCase, visaStaff, type Agent } from "./visaHelpers";

// The consent & liability form, part 1 (docs/decisions/0022-consent-form.md): staff fill in a traveller's details from
// the case, saved on the person for life.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

type Details = Record<string, unknown> & { personUpdatedAt: string; filledAt: string | null };
type Traveller = { id: string; member: { id: string } | null; consent: { state: string; details?: Details } };

/** A case at Documents with its first traveller named: Rakesh Mehta, the client himself. */
async function namedCase(agent: Agent) {
  const saved = await saveCase(agent);
  const relationId = (await prisma.relation.findUniqueOrThrow({ where: { code: "SELF" } })).id;
  const added = await agent.post(`/api/clients/${saved.client.id}/members`).send({ name: "Rakesh Mehta", relationId });
  expect(added.status).toBe(201);
  const memberId = added.body.member.id as string;
  return { ...(await link(agent, saved.caseNo, memberId)), clientId: saved.client.id, memberId };
}

async function link(agent: Agent, caseNo: string, memberId: string) {
  const fresh = (await agent.get(`/api/visa/cases/${caseNo}`)).body.case;
  const linked = await agent.put(`/api/visa/cases/${caseNo}/travellers/${fresh.travellers[0].id}/member`).send({ memberId });
  expect(linked.status).toBe(200);
  return { caseNo, traveller: linked.body.case.travellers[0] as Traveller };
}

const form = (traveller: Traveller, extra: Record<string, unknown> = {}) => ({
  dateOfBirth: "1980-05-14",
  spouseDateOfBirth: "1983-02-02",
  anniversary: "2005-12-10",
  motherDateOfBirth: null,
  fatherDateOfBirth: "1950-01-01",
  residentialAddress: "B-702, Raghuvir Residency, Vesu, Surat",
  officeAddress: "",
  annualIncome: 1_200_000,
  profession: "Diamond trader",
  education: "B.Com",
  updatedAt: traveller.consent.details!.personUpdatedAt,
  ...extra,
});

const save = (agent: Agent, caseNo: string, traveller: Traveller, body: Record<string, unknown>) =>
  agent.put(`/api/visa/cases/${caseNo}/travellers/${traveller.id}/consent-details`).send(body);

describe("filling in a traveller's consent details", () => {
  it("saves them on the person, audited, and the case shows them with who filled them in", async () => {
    const staff = await visaStaff();
    const { caseNo, clientId, memberId, traveller } = await namedCase(staff);
    expect(traveller.consent).toMatchObject({ state: "NONE", details: { dateOfBirth: null, residentialAddress: null, filledAt: null, filledBy: null } });

    const res = await save(staff, caseNo, traveller, form(traveller));
    expect(res.status).toBe(200);
    const details = res.body.case.travellers[0].consent.details;
    expect(details).toMatchObject({
      dateOfBirth: "1980-05-14",
      spouseDateOfBirth: "1983-02-02",
      anniversary: "2005-12-10",
      motherDateOfBirth: null,
      fatherDateOfBirth: "1950-01-01",
      residentialAddress: "B-702, Raghuvir Residency, Vesu, Surat",
      officeAddress: null,
      annualIncome: 1_200_000,
      profession: "Diamond trader",
      education: "B.Com",
      filledBy: { name: "Aarti Patel" },
    });
    expect(Math.abs(Date.parse(details.filledAt) - Date.now())).toBeLessThan(60_000);
    expect(res.body.case.travellers[0].consent.state).toBe("NONE");

    const member = await prisma.clientMember.findUniqueOrThrow({ where: { id: memberId } });
    expect(member).toMatchObject({ residentialAddress: "B-702, Raghuvir Residency, Vesu, Surat", officeAddress: null, annualIncome: 1_200_000 });
    const entries = await prisma.auditLog.findMany({ where: { action: "member.consent_details" } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entityType: "ClientMember",
      entityId: memberId,
      clientId,
      before: { dateOfBirth: null, residentialAddress: null },
      after: { dateOfBirth: "1980-05-14", residentialAddress: "B-702, Raghuvir Residency, Vesu, Surat", profession: "Diamond trader" },
    });
  });

  it("keeps them for life: the same person on the next case already has them", async () => {
    const staff = await visaStaff();
    const first = await namedCase(staff);
    expect((await save(staff, first.caseNo, first.traveller, form(first.traveller))).status).toBe(200);

    const next = await saveCase(staff);
    const { traveller } = await link(staff, next.caseNo, first.memberId);
    expect(traveller.consent.details).toMatchObject({ dateOfBirth: "1980-05-14", profession: "Diamond trader", filledBy: { name: "Aarti Patel" } });
  });

  it("needs the date of birth and the home address, and refuses future dates and a negative income", async () => {
    const staff = await visaStaff();
    const { caseNo, traveller } = await namedCase(staff);
    const refused = async (extra: Record<string, unknown>, field: string) => {
      const res = await save(staff, caseNo, traveller, form(traveller, extra));
      expect(res.status).toBe(400);
      expect(res.body.issues[field]).toBeDefined();
    };
    await refused({ dateOfBirth: undefined }, "dateOfBirth");
    await refused({ residentialAddress: "   " }, "residentialAddress");
    await refused({ annualIncome: -5 }, "annualIncome");
    await refused({ annualIncome: 12.5 }, "annualIncome");
    await refused({ anniversary: "2099-01-01" }, "anniversary");
    await refused({ profession: "x".repeat(101) }, "profession");
    expect(await prisma.auditLog.count({ where: { action: "member.consent_details" } })).toBe(0);
  });

  it("refuses an unnamed traveller, a stale form, and a case before Documents or after the handover", async () => {
    const staff = await visaStaff();
    const { caseNo, traveller } = await namedCase(staff);
    const child = (await staff.get(`/api/visa/cases/${caseNo}`)).body.case.travellers[1] as Traveller;
    const unnamed = await staff.put(`/api/visa/cases/${caseNo}/travellers/${child.id}/consent-details`).send(form(traveller));
    expect(unnamed.status).toBe(409);
    expect(unnamed.body.message).toMatch(/Name this traveller first/);

    const stale = await save(staff, caseNo, traveller, form(traveller, { updatedAt: "2026-01-01T00:00:00.000Z" }));
    expect(stale.status).toBe(409);
    expect(stale.body.details.code).toBe("STALE");

    const enquiry = await prisma.enquiry.findUniqueOrThrow({ where: { caseNo } });
    for (const code of ["ENQUIRY", "DELIVERED"]) {
      const stage = await prisma.departmentStage.findFirstOrThrow({ where: { code } });
      await prisma.enquiry.update({ where: { id: enquiry.id }, data: { stageId: stage.id } });
      const res = await save(staff, caseNo, traveller, form(traveller));
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/from Documents until the passports are handed over/);
    }
  });

  it("lets only the owner, the Visa HOD and the Head fill them in", async () => {
    const staff = await visaStaff();
    const { caseNo, traveller } = await namedCase(staff);
    await createUser({ name: "Neha", email: "neha@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    expect((await save(await loginAs("neha@masti.test"), caseNo, traveller, form(traveller))).status).toBe(403);

    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const byHod = await save(await loginAs("riya@masti.test"), caseNo, traveller, form(traveller));
    expect(byHod.status).toBe(200);
    expect(byHod.body.case.travellers[0].consent.details.filledBy).toMatchObject({ name: "Riya" });

    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    const after = byHod.body.case.travellers[0] as Traveller;
    expect((await save(await loginAs("vimal@masti.test"), caseNo, after, form(after, { profession: "Retired" }))).status).toBe(200);
  });
});

describe("the \"I agree\" link (part 2)", () => {
  const consentMessages = () =>
    prisma.outboundMessage.findMany({ where: { template: { code: "visa.consent_link" } }, orderBy: { createdAt: "asc" } });

  it("goes with the first save, to the client's main number, and saving again sends no other", async () => {
    const staff = await visaStaff();
    const { caseNo, clientId, memberId, traveller } = await namedCase(staff);
    const saved = await save(staff, caseNo, traveller, form(traveller));
    expect(saved.status).toBe(200);

    const links = await prisma.consentLink.findMany({ where: { memberId } });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ toMobile: "+919825041234", usedAt: null, replacedAt: null });
    expect(links[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const [message] = await consentMessages();
    expect(message).toMatchObject({ status: "QUEUED", toMobile: "+919825041234", clientId });
    expect(message!.body).toMatch(/^Dear Rakesh Mehta,/);
    // The link on a line of its own, easy to tap.
    expect(message!.body).toMatch(/consent and liability form for Rakesh Mehta and tap "I agree":\nhttp:\/\/localhost:5173\/consent#[A-Za-z0-9_-]{43}\n/);
    expect(saved.body.case.travellers[0].consent.link).toEqual({ sentAt: expect.any(String), toMobile: "+919825041234" });
    expect(await prisma.auditLog.count({ where: { action: "consent.link.sent", clientId } })).toBe(1);

    const again = saved.body.case.travellers[0] as Traveller;
    expect((await save(staff, caseNo, again, form(again, { profession: "Retired" }))).status).toBe(200);
    expect(await prisma.consentLink.count({ where: { memberId } })).toBe(1);
    expect(await consentMessages()).toHaveLength(1);
  });

  it("goes to the traveller's own number when one is saved, addressed to them", async () => {
    const staff = await visaStaff();
    const saved = await saveCase(staff);
    const relationId = (await prisma.relation.findUniqueOrThrow({ where: { code: "SPOUSE" } })).id;
    const added = await staff.post(`/api/clients/${saved.client.id}/members`).send({ name: "Anita Mehta", relationId, mobile: "98250 55555" });
    expect(added.status).toBe(201);
    const { traveller } = await link(staff, saved.caseNo, added.body.member.id);
    expect((await save(staff, saved.caseNo, traveller, form(traveller))).status).toBe(200);
    const [message] = await consentMessages();
    expect(message).toMatchObject({ toMobile: "+919825055555" });
    expect(message!.body).toMatch(/^Dear Anita Mehta,/);
  });

  it("shows on the case's Sent to the client card with its secret hidden", async () => {
    const staff = await visaStaff();
    const { caseNo, traveller } = await namedCase(staff);
    await save(staff, caseNo, traveller, form(traveller));
    const [message] = await consentMessages();
    const token = /consent#([A-Za-z0-9_-]+)/.exec(message!.body)![1]!;
    // The card also lists the case's document list (message 1); the consent message is the one with the link.
    const card = (await staff.get(`/api/visa/cases/${caseNo}/messages`)).body.messages as { title: string; body: string }[];
    const shown = card.filter((m) => m.title === "Consent form (I agree)");
    expect(shown).toHaveLength(1);
    expect(shown[0]!.body).toContain("/consent#…");
    expect(shown[0]!.body).not.toContain(token);
  });

  it("can be sent again: the old link stops working and a new one goes", async () => {
    const staff = await visaStaff();
    const { caseNo, memberId, traveller } = await namedCase(staff);
    const resend = () => staff.post(`/api/visa/cases/${caseNo}/travellers/${traveller.id}/consent-link`).set({ "Content-Type": "application/json" });
    const early = await resend();
    expect(early.status).toBe(409);
    expect(early.body.message).toMatch(/Fill in their details first/);

    await save(staff, caseNo, traveller, form(traveller));
    const first = await prisma.consentLink.findFirstOrThrow({ where: { memberId } });
    expect((await resend()).status).toBe(200);
    expect(await prisma.consentLink.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ replacedAt: expect.any(Date) });
    expect(await prisma.consentLink.count({ where: { memberId, replacedAt: null, usedAt: null } })).toBe(1);
    expect(await consentMessages()).toHaveLength(2);
  });
});

describe("the database", () => {
  it("refuses a blank address, a negative income, and a filled-in time without who", async () => {
    const staff = await visaStaff();
    const { memberId } = await namedCase(staff);
    const update = (data: Parameters<typeof prisma.clientMember.update>[0]["data"]) => prisma.clientMember.update({ where: { id: memberId }, data });
    await expect(update({ residentialAddress: "  " })).rejects.toThrow();
    await expect(update({ annualIncome: -1 })).rejects.toThrow();
    await expect(update({ profession: "" })).rejects.toThrow();
    await expect(update({ consentDetailsAt: new Date() })).rejects.toThrow();
  });
});
