import { beforeEach, describe, expect, it } from "vitest";
import { istToday } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { agreeThroughLink, consentForm, fillConsent } from "./consentHelpers";
import { prisma, resetDb } from "./helpers";
import { saveCase, visaStaff, type Agent } from "./visaHelpers";

// A parent or guardian agrees for a child (docs/decisions/0022-consent-form.md amendment 2, change request 18): staff
// pick them from the family list, the "I agree" link goes to them, and the consent records who agreed.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

/** Today n years ago, as a date of birth. */
const yearsAgo = (n: number) => {
  const today = istToday();
  return `${Number(today.slice(0, 4)) - n}${today.slice(4)}`;
};

/** Aarav's answers, a 12-year-old. */
const AARAV = { "Date of birth": yearsAgo(12), "Home address": "B-702, Raghuvir Residency, Vesu, Surat" };

async function relationId(code: string) {
  return (await prisma.relation.findUniqueOrThrow({ where: { code } })).id;
}

async function addMember(agent: Agent, clientId: string, body: Record<string, unknown>) {
  const res = await agent.post(`/api/clients/${clientId}/members`).send(body);
  expect(res.status).toBe(201);
  return res.body.member.id as string;
}

/**
 * Rakesh's family on a France case: Rakesh, the client (no number of his own); Priya, his wife, with her own number and
 * no date of birth on file; Kiara, 8; and Aarav, 12, named as the case's child.
 */
async function family() {
  const staff = await visaStaff();
  const saved = await saveCase(staff);
  const clientId = saved.client.id;
  const rakesh = await addMember(staff, clientId, { name: "Rakesh Mehta", relationId: await relationId("SELF"), dateOfBirth: "1980-05-14" });
  const priya = await addMember(staff, clientId, { name: "Priya Mehta", relationId: await relationId("SPOUSE"), mobile: "98250 55555" });
  const kiara = await addMember(staff, clientId, { name: "Kiara Mehta", relationId: await relationId("DAUGHTER"), dateOfBirth: yearsAgo(8) });
  const aarav = await addMember(staff, clientId, { name: "Aarav Mehta", relationId: await relationId("SON"), dateOfBirth: yearsAgo(12) });
  const c = (await staff.get(`/api/visa/cases/${saved.caseNo}`)).body.case;
  const travellerId = c.travellers[1].id as string;
  const linked = await staff.put(`/api/visa/cases/${saved.caseNo}/travellers/${travellerId}/member`).send({ memberId: aarav, confirmWarnings: true });
  expect(linked.status).toBe(200);
  return { staff, caseNo: saved.caseNo, clientId, travellerId, rakesh, priya, kiara, aarav };
}

const save = (f: Awaited<ReturnType<typeof family>>, guardianId: string | null, answers: Record<string, string> = AARAV) =>
  fillConsent(f.staff, f.caseNo, f.travellerId, answers, { guardianId });

const consentMessages = () =>
  prisma.outboundMessage.findMany({ where: { template: { code: "visa.consent_link" } }, orderBy: { createdAt: "asc" } });

describe("a child's consent form", () => {
  it("says who may agree for them: the family's grown-ups, not the child or another child", async () => {
    const f = await family();
    const form = await consentForm(f.staff, f.caseNo, f.travellerId);
    expect(form).toMatchObject({ adultFrom: 18, guardianId: null });
    expect(form.guardianChoices).toEqual([
      { id: f.rakesh, name: "Rakesh Mehta", relation: "Self", age: expect.any(Number) },
      // No date of birth on file: staff know who the parent is.
      { id: f.priya, name: "Priya Mehta", relation: "Spouse", age: null },
    ]);
  });

  it("needs a parent or guardian from this family who isn't a child and is still on the list", async () => {
    const f = await family();
    const refused = async (guardianId: string | null, message: RegExp) => {
      const res = await save(f, guardianId);
      expect(res.status).toBe(400);
      expect(res.body.issues.guardianId?.[0]).toMatch(message);
    };
    await refused(null, /Pick the parent or guardian/);
    await refused(f.kiara, /isn't a child/);
    await refused(f.aarav, /isn't a child/);

    const other = await saveCase(f.staff, { mobile: "98250 77777", clientName: "Someone Else" });
    await refused(await addMember(f.staff, other.client.id, { name: "Someone Else", relationId: await relationId("SELF") }), /isn't a child/);

    await prisma.clientMember.update({ where: { id: f.priya }, data: { archivedAt: new Date() } });
    await refused(f.priya, /isn't a child/);
    expect(await prisma.auditLog.count({ where: { action: "member.consent_details" } })).toBe(0);
    expect(await consentMessages()).toHaveLength(0);
  });

  it("sends the link to the guardian's own number, addressed to them, and records who on the person, the link and the case", async () => {
    const f = await family();
    const res = await save(f, f.priya);
    expect(res.status).toBe(200);
    const tile = res.body.case.travellers[1].consent;
    expect(tile.link).toEqual({ sentAt: expect.any(String), toMobile: "+919825055555", guardian: "Priya Mehta" });

    expect(await prisma.clientMember.findUniqueOrThrow({ where: { id: f.aarav } })).toMatchObject({ consentGuardianId: f.priya });
    expect(await prisma.consentLink.findFirstOrThrow({ where: { memberId: f.aarav } })).toMatchObject({ guardianId: f.priya, toMobile: "+919825055555" });
    const [message] = await consentMessages();
    expect(message!.toMobile).toBe("+919825055555");
    expect(message!.body).toMatch(/^Dear Priya Mehta,/);
    expect(message!.body).toMatch(/form for Aarav Mehta and tap "I agree"/);
    const [entry] = await prisma.auditLog.findMany({ where: { action: "member.consent_details" } });
    expect(entry).toMatchObject({ before: { guardian: null }, after: { guardian: "Priya Mehta", "Date of birth": yearsAgo(12) } });
    expect((await consentForm(f.staff, f.caseNo, f.travellerId)).guardianId).toBe(f.priya);
  });

  it("sends it to the client's main number for a guardian with no number of their own, addressed to the client", async () => {
    const f = await family();
    expect((await save(f, f.rakesh)).status).toBe(200);
    const [message] = await consentMessages();
    expect(message!.toMobile).toBe("+919825041234");
    expect(message!.body).toMatch(/^Dear Rakesh Mehta,/);
  });

  it("sends a new link when the guardian changes, and nothing when it stays the same", async () => {
    const f = await family();
    expect((await save(f, f.rakesh)).status).toBe(200);
    expect((await save(f, f.rakesh)).status).toBe(200);
    expect(await consentMessages()).toHaveLength(1);
    const first = await prisma.consentLink.findFirstOrThrow({ where: { memberId: f.aarav } });

    expect((await save(f, f.priya)).status).toBe(200);
    expect(await prisma.consentLink.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ replacedAt: expect.any(Date) });
    expect(await prisma.consentLink.findFirstOrThrow({ where: { memberId: f.aarav, replacedAt: null } })).toMatchObject({ guardianId: f.priya });
    expect(await consentMessages()).toHaveLength(2);
  });

  it("drops the guardian of someone entered as an adult, and replaces a link that went to one", async () => {
    const f = await family();
    expect((await save(f, f.priya)).status).toBe(200);
    // The date of birth was a typing mistake: Aarav is 30.
    const res = await save(f, f.priya, { ...AARAV, "Date of birth": yearsAgo(30) });
    expect(res.status).toBe(200);
    expect(res.body.case.travellers[1].consent.link).toMatchObject({ guardian: null, toMobile: "+919825041234" });
    expect(await prisma.clientMember.findUniqueOrThrow({ where: { id: f.aarav } })).toMatchObject({ consentGuardianId: null });
    expect(await prisma.consentLink.count({ where: { memberId: f.aarav, replacedAt: { not: null } } })).toBe(1);
    expect((await consentMessages()).at(-1)!.body).toMatch(/^Dear Rakesh Mehta,/);
  });

  it("follows the adult-from age in Settings → Visa", async () => {
    const f = await family();
    await prisma.setting.upsert({ where: { key: "visa.childAge" }, update: { value: { adultFrom: 10 } }, create: { key: "visa.childAge", value: { adultFrom: 10 } } });
    const form = await consentForm(f.staff, f.caseNo, f.travellerId);
    expect(form).toMatchObject({ adultFrom: 10 });
    // At 12, Aarav counts as an adult: no guardian, and Kiara (8) still can't be one.
    expect((await save(f, null)).status).toBe(200);
    expect(await prisma.consentLink.findFirstOrThrow({ where: { memberId: f.aarav } })).toMatchObject({ guardianId: null });
  });
});

describe("the guardian agreeing", () => {
  it("is shown on the page, and the consent, the case and the record keep who agreed", async () => {
    const f = await family();
    expect((await save(f, f.priya)).status).toBe(200);
    const [message] = await consentMessages();
    const token = /consent#([A-Za-z0-9_-]+)/.exec(message!.body)![1]!;
    const opened = await agreeThroughLink(token);
    expect(opened.person).toMatchObject({ name: "Aarav Mehta", relation: "Son", guardian: { name: "Priya Mehta", relation: "Spouse" } });

    const consent = await prisma.consent.findUniqueOrThrow({ where: { memberId: f.aarav } });
    expect(consent).toMatchObject({ source: "LINK", guardianId: f.priya, details: opened.person });
    const c = (await f.staff.get(`/api/visa/cases/${f.caseNo}`)).body.case;
    expect(c.travellers[1].consent).toMatchObject({ state: "ON_FILE", guardian: "Priya Mehta" });
    const record = await f.staff.get(`/api/clients/${f.clientId}/members/${f.aarav}/consent`);
    expect(record.body.record.person.guardian).toEqual({ name: "Priya Mehta", relation: "Spouse" });
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "consent.agree" } })).toMatchObject({ after: { guardianId: f.priya } });
  });

  it("keeps an adult's page as it was: they agree for themselves", async () => {
    const f = await family();
    expect((await save(f, null, { ...AARAV, "Date of birth": yearsAgo(30) })).status).toBe(200);
    const [message] = await consentMessages();
    const opened = await agreeThroughLink(/consent#([A-Za-z0-9_-]+)/.exec(message!.body)![1]!);
    expect(opened.person.guardian).toBeNull();
    expect(await prisma.consent.findUniqueOrThrow({ where: { memberId: f.aarav } })).toMatchObject({ guardianId: null });
  });
});

describe("the database", () => {
  it("refuses anyone as their own guardian, and a guardian on a paper consent", async () => {
    const f = await family();
    await expect(prisma.clientMember.update({ where: { id: f.aarav }, data: { consentGuardianId: f.aarav } })).rejects.toThrow();
    const marker = await prisma.user.findFirstOrThrow();
    await expect(
      prisma.consent.create({ data: { memberId: f.aarav, source: "PAPER", agreedAt: new Date(), paperYear: 2025, markedById: marker.id, guardianId: f.priya } }),
    ).rejects.toThrow();
  });
});
