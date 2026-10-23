import { beforeEach, describe, expect, it } from "vitest";
import { CONSENT_FIELDS } from "../src/modules/consent/consent.seed";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { consentForm, fieldId, fillConsent } from "./consentHelpers";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { saveCase, visaStaff, type Agent } from "./visaHelpers";

// The consent & liability form, part 1 (docs/decisions/0022-consent-form.md): staff fill in a traveller's details from
// the case, saved on the person for life. The form's fields are a master (amendment 1).

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

type Traveller = { id: string; member: { id: string } | null; consent: { state: string; details?: { filledAt: string | null; filledBy: { name: string } | null } } };

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

/** Rakesh's answers, by label: some of each kind, typed as staff would. */
const RAKESH: Record<string, string> = {
  "Date of birth": "1980-05-14",
  "Spouse’s date of birth": "1983-02-02",
  Anniversary: "2005-12-10",
  "Father’s date of birth": "1950-01-01",
  "Home address": "B-702, Raghuvir Residency, Vesu, Surat",
  "Office address": "",
  Profession: "Diamond trader",
  "Annual income (₹)": "12,00,000",
  Education: "B.Com",
  Instagram: "instagram.com/rakesh.mehta",
};

const save = (agent: Agent, caseNo: string, traveller: Traveller, byLabel: Record<string, string | null> = RAKESH, extra: Record<string, unknown> = {}) =>
  fillConsent(agent, caseNo, traveller.id, byLabel, extra);

const url = (caseNo: string, traveller: Traveller) => `/api/visa/cases/${caseNo}/travellers/${traveller.id}/consent-details`;

describe("filling in a traveller's consent details", () => {
  it("loads the form from the master: the fields in use, in order, and the person's answers", async () => {
    const staff = await visaStaff();
    const { caseNo, traveller } = await namedCase(staff);
    const form = await consentForm(staff, caseNo, traveller.id);
    expect(form.fields.map((f) => f.label)).toEqual(CONSENT_FIELDS.map((f) => f.label));
    expect(form.fields.filter((f) => f.required).map((f) => f.label)).toEqual(["Date of birth", "Home address"]);
    expect(form.fields.find((f) => f.label === "Instagram")).toMatchObject({ kind: "LINK", fixed: null });
    expect(form.fields.find((f) => f.label === "Home address")).toMatchObject({ kind: "LONG_TEXT", fixed: "HOME_ADDRESS" });
    expect(Object.values(form.answers).every((a) => a === null)).toBe(true);
    expect(form.personUpdatedAt).toEqual(expect.any(String));

    // A field switched off in Settings isn't on the form.
    await prisma.consentField.updateMany({ where: { label: "Facebook" }, data: { isActive: false } });
    expect((await consentForm(staff, caseNo, traveller.id)).fields.map((f) => f.label)).not.toContain("Facebook");
  });

  it("saves them on the person, audited, and the case shows who filled them in", async () => {
    const staff = await visaStaff();
    const { caseNo, clientId, memberId, traveller } = await namedCase(staff);
    expect(traveller.consent).toMatchObject({ state: "NONE", details: { filledAt: null, filledBy: null } });

    const res = await save(staff, caseNo, traveller);
    expect(res.status).toBe(200);
    const details = res.body.case.travellers[0].consent.details;
    expect(details).toEqual({ filledAt: expect.any(String), filledBy: expect.objectContaining({ name: "Aarti Patel" }) });
    expect(Math.abs(Date.parse(details.filledAt) - Date.now())).toBeLessThan(60_000);
    expect(res.body.case.travellers[0].consent.state).toBe("NONE");

    // The fixed fields are the person's columns (age and the covering letter read them); the rest are answers. A
    // number loses its commas, and a link gets https://.
    const member = await prisma.clientMember.findUniqueOrThrow({ where: { id: memberId }, include: { consentAnswers: { include: { field: true } } } });
    expect(member).toMatchObject({ residentialAddress: "B-702, Raghuvir Residency, Vesu, Surat", officeAddress: null });
    expect(member.dateOfBirth?.toISOString().slice(0, 10)).toBe("1980-05-14");
    expect(Object.fromEntries(member.consentAnswers.map((a) => [a.field.label, a.value]))).toEqual({
      "Spouse’s date of birth": "1983-02-02",
      Anniversary: "2005-12-10",
      "Father’s date of birth": "1950-01-01",
      Profession: "Diamond trader",
      "Annual income (₹)": "1200000",
      Education: "B.Com",
      Instagram: "https://instagram.com/rakesh.mehta",
    });
    const form = await consentForm(staff, caseNo, traveller.id);
    expect(form.answers[await fieldId("Annual income (₹)")]).toBe("1200000");
    expect(form.answers[await fieldId("Home address")]).toBe("B-702, Raghuvir Residency, Vesu, Surat");

    const entries = await prisma.auditLog.findMany({ where: { action: "member.consent_details" } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entityType: "ClientMember",
      entityId: memberId,
      clientId,
      before: { "Date of birth": null, "Home address": null, Profession: null },
      after: { "Date of birth": "1980-05-14", "Home address": "B-702, Raghuvir Residency, Vesu, Surat", Profession: "Diamond trader" },
    });
  });

  it("keeps them for life: the same person on the next case already has them", async () => {
    const staff = await visaStaff();
    const first = await namedCase(staff);
    expect((await save(staff, first.caseNo, first.traveller)).status).toBe(200);

    const next = await saveCase(staff);
    const { traveller } = await link(staff, next.caseNo, first.memberId);
    expect(traveller.consent.details).toMatchObject({ filledBy: { name: "Aarti Patel" } });
    const form = await consentForm(staff, next.caseNo, traveller.id);
    expect(form.answers[await fieldId("Date of birth")]).toBe("1980-05-14");
    expect(form.answers[await fieldId("Profession")]).toBe("Diamond trader");
  });

  it("needs every required field, and checks each answer against its kind, all at once", async () => {
    const staff = await visaStaff();
    const { caseNo, traveller } = await namedCase(staff);
    const refused = async (change: Record<string, string>, label: string, message: RegExp) => {
      const res = await save(staff, caseNo, traveller, { ...RAKESH, ...change });
      expect(res.status, label).toBe(400);
      expect(res.body.issues[await fieldId(label)]?.[0], label).toMatch(message);
    };
    await refused({ "Date of birth": "" }, "Date of birth", /Fill this in/);
    await refused({ "Home address": "   " }, "Home address", /Fill this in/);
    await refused({ Anniversary: "2099-01-01" }, "Anniversary", /in the future/);
    await refused({ Anniversary: "2026-02-30" }, "Anniversary", /valid date/);
    await refused({ "Annual income (₹)": "-5" }, "Annual income (₹)", /Digits only/);
    await refused({ "Annual income (₹)": "12.5" }, "Annual income (₹)", /Digits only/);
    await refused({ "Annual income (₹)": "3000000000" }, "Annual income (₹)", /too large/);
    await refused({ Profession: "x".repeat(101) }, "Profession", /At most 100/);
    await refused({ "Office address": "x".repeat(301) }, "Office address", /At most 300/);
    await refused({ Instagram: "rakesh mehta" }, "Instagram", /web address/);
    await refused({ Instagram: "instagram" }, "Instagram", /web address/);

    // Every problem comes back at once, each next to its own field.
    const both = await save(staff, caseNo, traveller, { ...RAKESH, "Date of birth": "", Anniversary: "2099-01-01" });
    expect(Object.keys(both.body.issues).sort()).toEqual([String(await fieldId("Date of birth")), String(await fieldId("Anniversary"))].sort());

    // Required in Settings: needed here too.
    await prisma.consentField.updateMany({ where: { label: "Institute" }, data: { required: true } });
    await refused({}, "Institute", /Fill this in/);
    expect(await prisma.auditLog.count({ where: { action: "member.consent_details" } })).toBe(0);
  });

  it("refuses a form whose fields changed meanwhile, and keeps the answers to a field switched off", async () => {
    const staff = await visaStaff();
    const { caseNo, memberId, traveller } = await namedCase(staff);
    expect((await save(staff, caseNo, traveller)).status).toBe(200);

    // The dialog loaded the form; then Education is switched off in Settings.
    const loaded = await consentForm(staff, caseNo, traveller.id);
    await prisma.consentField.updateMany({ where: { label: "Education" }, data: { isActive: false } });
    const stale = await staff.put(url(caseNo, traveller)).send({ answers: loaded.answers, updatedAt: loaded.personUpdatedAt });
    expect(stale.status).toBe(409);
    expect(stale.body.details.code).toBe("FIELDS_CHANGED");

    // Saved again on the new form: the switched-off field's answer stays, for when it's switched back on.
    expect((await save(staff, caseNo, traveller, { ...RAKESH, Profession: "Retired" })).status).toBe(200);
    const education = await fieldId("Education");
    expect(await prisma.consentAnswer.findUnique({ where: { memberId_fieldId: { memberId, fieldId: education } } })).toMatchObject({ value: "B.Com" });
    await prisma.consentField.update({ where: { id: education }, data: { isActive: true } });
    expect((await consentForm(staff, caseNo, traveller.id)).answers[education]).toBe("B.Com");

    // A field added meanwhile, the same.
    const before = await consentForm(staff, caseNo, traveller.id);
    await prisma.consentField.create({ data: { label: "Twitter / X", kind: "LINK", sortOrder: 99 } });
    const added = await staff.put(url(caseNo, traveller)).send({ answers: before.answers, updatedAt: before.personUpdatedAt });
    expect(added.status).toBe(409);
    expect(added.body.details.code).toBe("FIELDS_CHANGED");
  });

  it("empties an answer cleared on the form", async () => {
    const staff = await visaStaff();
    const { caseNo, memberId, traveller } = await namedCase(staff);
    expect((await save(staff, caseNo, traveller)).status).toBe(200);
    expect((await save(staff, caseNo, traveller, { ...RAKESH, Instagram: "", "Spouse’s date of birth": "" })).status).toBe(200);
    const labels = (await prisma.consentAnswer.findMany({ where: { memberId }, include: { field: true } })).map((a) => a.field.label);
    expect(labels).not.toContain("Instagram");
    expect(labels).not.toContain("Spouse’s date of birth");
    expect(labels).toContain("Profession");
  });

  it("refuses an unnamed traveller, a stale form, and a case before Documents or after the handover", async () => {
    const staff = await visaStaff();
    const { caseNo, traveller } = await namedCase(staff);
    const child = (await staff.get(`/api/visa/cases/${caseNo}`)).body.case.travellers[1] as Traveller;
    for (const res of [await staff.get(url(caseNo, child)), await staff.put(url(caseNo, child)).send({ answers: {}, updatedAt: new Date().toISOString() })]) {
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/Name this traveller first/);
    }

    const stale = await save(staff, caseNo, traveller, RAKESH, { updatedAt: "2026-01-01T00:00:00.000Z" });
    expect(stale.status).toBe(409);
    expect(stale.body.details.code).toBe("STALE");

    const form = await consentForm(staff, caseNo, traveller.id);
    const enquiry = await prisma.enquiry.findUniqueOrThrow({ where: { caseNo } });
    for (const code of ["ENQUIRY", "DELIVERED"]) {
      const stage = await prisma.departmentStage.findFirstOrThrow({ where: { code } });
      await prisma.enquiry.update({ where: { id: enquiry.id }, data: { stageId: stage.id } });
      for (const res of [await staff.get(url(caseNo, traveller)), await staff.put(url(caseNo, traveller)).send({ answers: form.answers, updatedAt: form.personUpdatedAt })]) {
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/from Documents until the passports are handed over/);
      }
    }
  });

  it("lets only the owner, the Visa HOD and the Head see and fill them in", async () => {
    const staff = await visaStaff();
    const { caseNo, traveller } = await namedCase(staff);
    await createUser({ name: "Neha", email: "neha@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    const neha = await loginAs("neha@masti.test");
    expect((await neha.get(url(caseNo, traveller))).status).toBe(403);
    const form = await consentForm(staff, caseNo, traveller.id);
    expect((await neha.put(url(caseNo, traveller)).send({ answers: form.answers, updatedAt: form.personUpdatedAt })).status).toBe(403);

    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const byHod = await save(await loginAs("riya@masti.test"), caseNo, traveller);
    expect(byHod.status).toBe(200);
    expect(byHod.body.case.travellers[0].consent.details.filledBy).toMatchObject({ name: "Riya" });

    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    expect((await save(await loginAs("vimal@masti.test"), caseNo, traveller, { ...RAKESH, Profession: "Retired" })).status).toBe(200);
  });
});

describe("the \"I agree\" link (part 2)", () => {
  const consentMessages = () =>
    prisma.outboundMessage.findMany({ where: { template: { code: "visa.consent_link" } }, orderBy: { createdAt: "asc" } });

  it("goes with the first save, to the client's main number, and saving again sends no other", async () => {
    const staff = await visaStaff();
    const { caseNo, clientId, memberId, traveller } = await namedCase(staff);
    const saved = await save(staff, caseNo, traveller);
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

    expect((await save(staff, caseNo, traveller, { ...RAKESH, Profession: "Retired" })).status).toBe(200);
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
    expect((await save(staff, saved.caseNo, traveller)).status).toBe(200);
    const [message] = await consentMessages();
    expect(message).toMatchObject({ toMobile: "+919825055555" });
    expect(message!.body).toMatch(/^Dear Anita Mehta,/);
  });

  it("shows on the case's Sent to the client card with its secret hidden", async () => {
    const staff = await visaStaff();
    const { caseNo, traveller } = await namedCase(staff);
    await save(staff, caseNo, traveller);
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

    await save(staff, caseNo, traveller);
    const first = await prisma.consentLink.findFirstOrThrow({ where: { memberId } });
    expect((await resend()).status).toBe(200);
    expect(await prisma.consentLink.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ replacedAt: expect.any(Date) });
    expect(await prisma.consentLink.count({ where: { memberId, replacedAt: null, usedAt: null } })).toBe(1);
    expect(await consentMessages()).toHaveLength(2);
  });
});

describe("the database", () => {
  it("refuses a blank address, a filled-in time without who, and a blank or too-long answer", async () => {
    const staff = await visaStaff();
    const { memberId } = await namedCase(staff);
    const update = (data: Parameters<typeof prisma.clientMember.update>[0]["data"]) => prisma.clientMember.update({ where: { id: memberId }, data });
    await expect(update({ residentialAddress: "  " })).rejects.toThrow();
    await expect(update({ consentDetailsAt: new Date() })).rejects.toThrow();
    const profession = await fieldId("Profession");
    await expect(prisma.consentAnswer.create({ data: { memberId, fieldId: profession, value: " " } })).rejects.toThrow();
    await expect(prisma.consentAnswer.create({ data: { memberId, fieldId: profession, value: "x".repeat(301) } })).rejects.toThrow();
  });

  it("keeps the fields readable and the fixed ones as they must be", async () => {
    const field = (label: string) => prisma.consentField.findFirstOrThrow({ where: { label } });
    const birth = await field("Date of birth");
    const home = await field("Home address");
    await expect(prisma.consentField.create({ data: { label: "  ", kind: "TEXT" } })).rejects.toThrow();
    await expect(prisma.consentField.create({ data: { label: "x".repeat(101), kind: "TEXT" } })).rejects.toThrow();
    await expect(prisma.consentField.create({ data: { label: " profession ", kind: "TEXT" } })).rejects.toThrow();
    await expect(prisma.consentField.update({ where: { id: birth.id }, data: { required: false } })).rejects.toThrow();
    await expect(prisma.consentField.update({ where: { id: home.id }, data: { isActive: false } })).rejects.toThrow();
    await expect(prisma.consentField.update({ where: { id: home.id }, data: { kind: "TEXT" } })).rejects.toThrow();
    // Home address's "required" is the Head's and the Visa HOD's to change ⚠️.
    await expect(prisma.consentField.update({ where: { id: home.id }, data: { required: false } })).resolves.toBeTruthy();
  });
});
