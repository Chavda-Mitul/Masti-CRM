import { beforeEach, describe, expect, it } from "vitest";
import { CONSENT_WORDING } from "../src/modules/consent/consent.seed";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { agreeThroughLink, CONSENT_DETAILS, fillConsent, linkSent } from "./consentHelpers";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import type { Agent } from "./visaHelpers";

// The printable record of a person's consent (docs/decisions/0022-consent-form.md, part 3b): the proof, for anyone who
// can see the client. Through the link it keeps what was agreed to as it was, whatever changes after.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

const record = (agent: Agent, clientId: string, memberId: string) => agent.get(`/api/clients/${clientId}/members/${memberId}/consent`);

describe("a consent given through the link", () => {
  it("records the details and the wording as agreed, how the link went, and where the tap came from", async () => {
    const { staff, caseNo, clientId, memberId, travellerId, token } = await linkSent();
    const opened = await agreeThroughLink(token);

    // Afterwards the person's details change, a field is renamed and a new wording comes in: the record keeps what was
    // agreed to, under the labels the client read.
    const edited = await fillConsent(staff, caseNo, travellerId, { ...CONSENT_DETAILS, Profession: "Retired" });
    expect(edited.status).toBe(200);
    await prisma.consentField.updateMany({ where: { label: "Profession" }, data: { label: "Occupation" } });
    await prisma.consentWording.create({ data: { body: "Masti's own wording." } });

    const res = await record(staff, clientId, memberId);
    expect(res.status).toBe(200);
    expect(res.body.record).toMatchObject({
      source: "LINK",
      name: "Rakesh Mehta",
      agreedAt: expect.any(String),
      person: opened.person,
      wording: { id: opened.wording.id, body: CONSENT_WORDING },
      link: { toMobile: "+919825041234", sentBy: "Aarti Patel", caseNo, sentAt: expect.any(String) },
      userAgent: "Test phone",
    });
    expect(res.body.record.person.rows).toContainEqual({ label: "Profession", kind: "TEXT", value: "Diamond trader" });
    expect(res.body.record.ip).toBeTruthy();
    // Masti's name, address and phones only: nothing of its PAN, GSTIN or bank details.
    expect(Object.keys(res.body.record.company).sort()).toEqual(["address", "name", "phone", "phone2"]);
  });
});

describe("a consent signed on paper", () => {
  it("records the year, and who marked it on file when", async () => {
    const { staff, clientId, memberId } = await linkSent();
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const riya = await loginAs("riya@masti.test");
    expect((await riya.post(`/api/clients/${clientId}/members/${memberId}/paper-consent`).send({ year: 2025 })).status).toBe(200);

    const res = await record(staff, clientId, memberId);
    expect(res.status).toBe(200);
    expect(res.body.record).toMatchObject({ source: "PAPER", name: "Rakesh Mehta", paperYear: 2025, markedBy: "Riya", markedAt: expect.any(String) });
    expect(res.body.record.person).toBeUndefined();
  });
});

describe("who can open a record", () => {
  it("is anyone who can see the client: 404 with none on file or for another client's person, 403 otherwise", async () => {
    const { staff, clientId, memberId } = await linkSent();
    const none = await record(staff, clientId, memberId);
    expect(none.status).toBe(404);
    expect(none.body.message).toMatch(/No consent is on file/);

    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    const head = await loginAs("vimal@masti.test");
    const other = (await head.post("/api/clients").send({ mobile: "98250 77777", name: "Sunita Patel" })).body.client;
    expect((await record(head, other.id, memberId)).status).toBe(404);

    await createUser({ name: "Kiran", email: "kiran@masti.test", departments: [{ code: "HOTELS", access: "EDIT" }] });
    expect((await record(await loginAs("kiran@masti.test"), clientId, memberId)).status).toBe(403);
    await createUser({ name: "Ravi", mobile: "+919876500001", type: "FIELD" });
    expect((await record(await loginAs("9876500001"), clientId, memberId)).status).toBe(403);
  });
});
