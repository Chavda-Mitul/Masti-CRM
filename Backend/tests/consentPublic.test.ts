import { beforeEach, describe, expect, it } from "vitest";
import { clearOfficeNetworkCache, OFFICE_NETWORK_KEY } from "../src/modules/auth/officeNetwork";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { linkSent } from "./consentHelpers";
import { app, prisma, request, resetDb } from "./helpers";
import type { Agent } from "./visaHelpers";

// The client's side of the consent form (docs/decisions/0022-consent-form.md, part 2): the WhatsApp link opens the form
// with no login, and "I agree" records the consent with what was agreed to.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

const json = { "Content-Type": "application/json" };
const view = (token: string) => request(app).post("/api/public/consent/view").set(json).send({ token });
/** "I agree" to the form as the page showed it: its wording and its details' fingerprint. */
const agree = (token: string, opened: { wording: { id: number }; detailsHash: string }) =>
  request(app)
    .post("/api/public/consent/agree")
    .set(json)
    .set("User-Agent", "Test phone")
    .send({ token, wordingId: opened.wording.id, detailsHash: opened.detailsHash });

async function sendAgain(staff: Agent, caseNo: string, travellerId: string) {
  return staff.post(`/api/visa/cases/${caseNo}/travellers/${travellerId}/consent-link`).set(json);
}

describe("opening the link", () => {
  it("shows the form with no login: the person, their details, the wording and Masti's phone", async () => {
    const { token } = await linkSent();
    const res = await view(token);
    expect(res.status).toBe(200);
    const wording = await prisma.consentWording.findFirstOrThrow({ orderBy: { id: "desc" } });
    expect(res.body.consent).toMatchObject({
      state: "OPEN",
      person: {
        name: "Rakesh Mehta",
        relation: "Self",
        passportNumber: "Z1234567",
        dateOfBirth: "1980-05-14",
        residentialAddress: "B-702, Raghuvir Residency, Vesu, Surat",
        annualIncome: 1_200_000,
        profession: "Diamond trader",
        education: null,
      },
      detailsHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      wording: { id: wording.id, body: wording.body },
      company: { name: expect.any(String), phone: expect.any(String) },
    });
    // Masti's name, address and phones only: nothing of its PAN, GSTIN or bank details.
    expect(Object.keys(res.body.consent.company).sort()).toEqual(["address", "name", "phone", "phone2"]);
  });

  it("works even with the office-network rule on, which binds staff only", async () => {
    const { token } = await linkSent();
    const value = { enabled: true, allow: ["10.99.0.0/16"], exemptUserTypes: ["FIELD"] };
    await prisma.setting.upsert({ where: { key: OFFICE_NETWORK_KEY }, update: { value }, create: { key: OFFICE_NETWORK_KEY, value } });
    clearOfficeNetworkCache();
    expect((await view(token)).status).toBe(200);
  });

  it("says plainly when the link isn't valid or was replaced by a newer one", async () => {
    const { staff, caseNo, travellerId, token } = await linkSent();
    const unknown = await view("x".repeat(43));
    expect(unknown.status).toBe(404);
    expect(unknown.body.message).toMatch(/isn't valid/);
    expect((await view("short")).status).toBe(400);

    expect((await sendAgain(staff, caseNo, travellerId)).status).toBe(200);
    const old = await view(token);
    expect(old.status).toBe(410);
    expect(old.body.message).toMatch(/replaced by a newer one/);
  });
});

describe("I agree", () => {
  it("records the consent with the wording, the details as shown and where the tap came from", async () => {
    const { staff, caseNo, clientId, memberId, token } = await linkSent();
    const opened = (await view(token)).body.consent;
    const res = await agree(token, opened);
    expect(res.status).toBe(200);
    expect(res.body.consent).toMatchObject({ state: "AGREED", name: "Rakesh Mehta", agreedAt: expect.any(String) });

    const consent = await prisma.consent.findUniqueOrThrow({ where: { memberId } });
    expect(consent).toMatchObject({ source: "LINK", wordingId: opened.wording.id, userAgent: "Test phone", details: opened.person });
    expect(consent.ip).toBeTruthy();
    const link = await prisma.consentLink.findUniqueOrThrow({ where: { id: consent.linkId! } });
    expect(link.usedAt?.toISOString()).toBe(consent.agreedAt.toISOString());
    const entries = await prisma.auditLog.findMany({ where: { action: "consent.agree" } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorId: null, entityId: consent.id, clientId });

    // The case shows it on file, and there's no link to send any more.
    const c = (await staff.get(`/api/visa/cases/${caseNo}`)).body.case;
    expect(c.travellers[0].consent).toMatchObject({ state: "ON_FILE", id: consent.id, agreedAt: consent.agreedAt.toISOString(), paperYear: null });
    const again = await sendAgain(staff, caseNo, c.travellers[0].id);
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/already on file/);
  });

  it("is said once: agreeing again or opening the link later just shows it, with no details", async () => {
    const { token } = await linkSent();
    const opened = (await view(token)).body.consent;
    const first = (await agree(token, opened)).body.consent;
    const second = await agree(token, opened);
    expect(second.status).toBe(200);
    expect(second.body.consent.agreedAt).toBe(first.agreedAt);
    expect(await prisma.consent.count()).toBe(1);

    const later = (await view(token)).body.consent;
    expect(later).toMatchObject({ state: "AGREED", name: "Rakesh Mehta" });
    expect(later.person).toBeUndefined();
  });

  it("asks to read the form again when its wording changed meanwhile", async () => {
    const { token } = await linkSent();
    const opened = (await view(token)).body.consent;
    await prisma.consentWording.create({ data: { body: "Masti's own wording." } });
    const res = await agree(token, opened);
    expect(res.status).toBe(409);
    expect(res.body.details.code).toBe("WORDING_CHANGED");
    expect(await prisma.consent.count()).toBe(0);
  });

  it("asks to check the details again when staff changed them meanwhile, so the record holds what was read", async () => {
    const { memberId, token } = await linkSent();
    const opened = (await view(token)).body.consent;
    await prisma.clientMember.update({ where: { id: memberId }, data: { profession: "Retired" } });
    const res = await agree(token, opened);
    expect(res.status).toBe(409);
    expect(res.body.details.code).toBe("DETAILS_CHANGED");
    expect(await prisma.consent.count()).toBe(0);
    const unsigned = await request(app).post("/api/public/consent/agree").set(json).send({ token, wordingId: opened.wording.id });
    expect(unsigned.status).toBe(400);

    // Opened again, the form shows the new details, and "I agree" keeps those.
    const again = (await view(token)).body.consent;
    expect(again.person.profession).toBe("Retired");
    expect((await agree(token, again)).status).toBe(200);
    expect(await prisma.consent.findUniqueOrThrow({ where: { memberId } })).toMatchObject({ details: again.person });
  });
});

describe("the database", () => {
  it("keeps every wording as it was, and a link never both used and replaced, with one open per person", async () => {
    const { memberId } = await linkSent();
    const wording = await prisma.consentWording.findFirstOrThrow();
    await expect(prisma.consentWording.update({ where: { id: wording.id }, data: { body: "Changed" } })).rejects.toThrow();
    await expect(prisma.consentWording.delete({ where: { id: wording.id } })).rejects.toThrow();

    const open = await prisma.consentLink.findFirstOrThrow({ where: { memberId } });
    await expect(prisma.consentLink.update({ where: { id: open.id }, data: { usedAt: new Date(), replacedAt: new Date() } })).rejects.toThrow();
    await expect(
      prisma.consentLink.create({ data: { memberId, enquiryId: open.enquiryId, tokenHash: "another", toMobile: open.toMobile, createdById: open.createdById } }),
    ).rejects.toThrow();
  });
});
