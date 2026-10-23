import { beforeEach, describe, expect, it } from "vitest";
import { istToday } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { agreeThroughLink, CONSENT_DETAILS, fillConsent, linkSent } from "./consentHelpers";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";
import type { Agent } from "./visaHelpers";

// Consents signed on paper before the CRM (docs/decisions/0022-consent-form.md, part 3): the Head or the Visa HOD marks
// them on file from the client page, with the year, so those people never get the "I agree" link; a mistaken mark can be
// taken off. A consent given through the link is kept for good.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

const json = { "Content-Type": "application/json" };
const thisYear = () => Number(istToday().slice(0, 4));
const mark = (agent: Agent, clientId: string, memberId: string, year: number) =>
  agent.post(`/api/clients/${clientId}/members/${memberId}/paper-consent`).send({ year });
const undo = (agent: Agent, clientId: string, memberId: string) => agent.delete(`/api/clients/${clientId}/members/${memberId}/paper-consent`).send({});
const consentMessages = () => prisma.outboundMessage.count({ where: { template: { code: "visa.consent_link" } } });

async function visaHod() {
  await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
  return loginAs("riya@masti.test");
}

/** Saves the traveller's details again, as staff would after a change. */
function saveDetailsAgain(staff: Agent, caseNo: string, travellerId: string) {
  return fillConsent(staff, caseNo, travellerId, { ...CONSENT_DETAILS, Profession: "Retired" });
}

describe("marking a consent signed on paper", () => {
  it("puts it on file with the year: audited, the open link closed, and no link goes to them after", async () => {
    const { staff, caseNo, clientId, memberId, travellerId, token } = await linkSent();
    const riya = await visaHod();
    const res = await mark(riya, clientId, memberId, 2025);
    expect(res.status).toBe(200);
    expect(res.body.member.consent).toMatchObject({ id: expect.any(String), agreedAt: expect.any(String), paperYear: 2025 });

    const consent = await prisma.consent.findUniqueOrThrow({ where: { memberId } });
    const hod = await prisma.user.findUniqueOrThrow({ where: { email: "riya@masti.test" } });
    expect(consent).toMatchObject({ source: "PAPER", paperYear: 2025, markedById: hod.id, wordingId: null, linkId: null, details: null, ip: null });
    expect(await prisma.consentLink.count({ where: { memberId, usedAt: null, replacedAt: null } })).toBe(0);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "consent.paper.mark" } });
    expect(entry).toMatchObject({ actorId: hod.id, entityId: consent.id, clientId, after: { memberId, year: 2025 } });

    // The client page, the case and the client's old link all show it on file.
    const page = (await riya.get(`/api/clients/${clientId}`)).body.client;
    expect(page.members.find((m: { id: string }) => m.id === memberId).consent).toMatchObject({ id: consent.id, paperYear: 2025 });
    const c = (await staff.get(`/api/visa/cases/${caseNo}`)).body.case;
    expect(c.travellers[0].consent).toMatchObject({ state: "ON_FILE", id: consent.id, paperYear: 2025 });
    const old = await request(app).post("/api/public/consent/view").set(json).send({ token });
    expect(old.body.consent).toMatchObject({ state: "AGREED", name: "Rakesh Mehta" });

    // Saving the details sends nothing, and there's no link to send again.
    const before = await consentMessages();
    expect((await saveDetailsAgain(staff, caseNo, travellerId)).status).toBe(200);
    expect(await consentMessages()).toBe(before);
    const again = await staff.post(`/api/visa/cases/${caseNo}/travellers/${travellerId}/consent-link`).set(json);
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/already on file/);
  });

  it("is for the Head and the Visa HOD only, with a year from 1990 to this one, once", async () => {
    const { staff, clientId, memberId } = await linkSent();
    const refused = await mark(staff, clientId, memberId, 2025);
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/Head or the Visa HOD/);
    await createUser({ name: "Kiran", email: "kiran@masti.test", departments: [{ code: "HOTELS", role: "HOD" }] });
    expect((await mark(await loginAs("kiran@masti.test"), clientId, memberId, 2025)).status).toBe(403);

    const riya = await visaHod();
    for (const year of [thisYear() + 1, 1989, 2025.5]) expect((await mark(riya, clientId, memberId, year)).status).toBe(400);
    expect((await riya.post(`/api/clients/${clientId}/members/${memberId}/paper-consent`).send({})).status).toBe(400);
    expect(await prisma.consent.count()).toBe(0);

    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    expect((await mark(await loginAs("vimal@masti.test"), clientId, memberId, thisYear())).status).toBe(200);
    const twice = await mark(riya, clientId, memberId, 2020);
    expect(twice.status).toBe(409);
    expect(twice.body.message).toMatch(/already on file/);
  });

  it("refuses a person on another client or taken off the list, and a client the Visa HOD can't see", async () => {
    const { staff, clientId, memberId } = await linkSent();
    const riya = await visaHod();
    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    const head = await loginAs("vimal@masti.test");
    const other = (await head.post("/api/clients").send({ mobile: "98250 77777", name: "Sunita Patel" })).body.client;
    expect((await mark(riya, other.id, memberId, 2025)).status).toBe(404);

    const relationId = (await prisma.relation.findUniqueOrThrow({ where: { code: "SPOUSE" } })).id;
    const anita = (await staff.post(`/api/clients/${clientId}/members`).send({ name: "Anita Mehta", relationId })).body.member;
    expect((await staff.post(`/api/clients/${clientId}/members/${anita.id}/archive`).set(json)).status).toBe(200);
    const archived = await mark(riya, clientId, anita.id, 2025);
    expect(archived.status).toBe(409);
    expect(archived.body.message).toMatch(/taken off the family list/);

    // Sunita has only a holiday enquiry (straight in the database: Holidays comes in Stage 2), so the Visa HOD can't see her.
    const sunita = (await head.post(`/api/clients/${other.id}/members`).send({ name: "Sunita Patel", relationId })).body.member;
    const holidays = await prisma.department.findUniqueOrThrow({ where: { code: "HOLIDAYS" } });
    const stage = await prisma.departmentStage.create({
      data: { departmentId: holidays.id, flow: "HOLIDAYS", code: "ENQUIRY", name: "Enquiry", sortOrder: 1, statusLabel: "Enquiry saved", nextStepLabel: "Send a quote" },
    });
    const source = await prisma.enquirySource.findFirstOrThrow();
    await prisma.enquiry.create({ data: { caseNo: "HOL-2026-0001", departmentId: holidays.id, clientId: other.id, sourceId: source.id, stageId: stage.id } });
    const unseen = await mark(riya, other.id, sunita.id, 2025);
    expect(unseen.status).toBe(403);
    expect(unseen.body.message).toMatch(/isn't on any of your cases/);
    expect(await prisma.consent.count()).toBe(0);
  });
});

describe("undoing a paper mark", () => {
  it("takes it off, audited, and the person can be sent the link again", async () => {
    const { staff, caseNo, clientId, memberId, travellerId } = await linkSent();
    const riya = await visaHod();
    expect((await mark(riya, clientId, memberId, 2025)).status).toBe(200);
    const res = await undo(riya, clientId, memberId);
    expect(res.status).toBe(200);
    expect(res.body.member.consent).toBeNull();
    expect(await prisma.consent.count()).toBe(0);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "consent.paper.remove" } });
    expect(entry).toMatchObject({ clientId, before: { memberId, year: 2025 } });

    // The mark closed the old link, so saving the details sends a new one.
    const before = await consentMessages();
    expect((await saveDetailsAgain(staff, caseNo, travellerId)).status).toBe(200);
    expect(await consentMessages()).toBe(before + 1);
    expect((await undo(riya, clientId, memberId)).status).toBe(409);
    expect((await undo(staff, clientId, memberId)).status).toBe(403);
  });

  it("never touches a consent given through the link, by the API or in the database", async () => {
    const { clientId, memberId, token } = await linkSent();
    await agreeThroughLink(token);

    const res = await undo(await visaHod(), clientId, memberId);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/kept for good/);
    const consent = await prisma.consent.findUniqueOrThrow({ where: { memberId } });
    await expect(prisma.consent.delete({ where: { id: consent.id } })).rejects.toThrow();
    await expect(prisma.consent.update({ where: { id: consent.id }, data: { ip: null } })).rejects.toThrow();
  });
});

describe("the database", () => {
  it("keeps each kind of consent to its own fields, and never changes one", async () => {
    const { memberId } = await linkSent();
    const hod = await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const agreedAt = new Date();
    const paper = { memberId, source: "PAPER" as const, agreedAt, markedById: hod.id };
    await expect(prisma.consent.create({ data: paper })).rejects.toThrow();
    await expect(prisma.consent.create({ data: { ...paper, paperYear: 1989 } })).rejects.toThrow();
    await expect(prisma.consent.create({ data: { ...paper, paperYear: 2025, details: { name: "Rakesh Mehta" } } })).rejects.toThrow();
    await expect(prisma.consent.create({ data: { memberId, agreedAt } })).rejects.toThrow();

    const kept = await prisma.consent.create({ data: { ...paper, paperYear: 2025 } });
    await expect(prisma.consent.update({ where: { id: kept.id }, data: { paperYear: 2024 } })).rejects.toThrow();
    await prisma.consent.delete({ where: { id: kept.id } });
    expect(await prisma.consent.count()).toBe(0);
  });
});
