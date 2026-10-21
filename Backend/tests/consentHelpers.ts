import { expect } from "vitest";
import { app, prisma, request } from "./helpers";
import { saveCase, visaStaff } from "./visaHelpers";

// Shared by the consent tests (docs/decisions/0022-consent-form.md): a traveller whose details are filled in, so their
// "I agree" link went out, and the client agreeing through it.

const json = { "Content-Type": "application/json" };

/** Rakesh's consent details, as staff fill them in. */
export const CONSENT_DETAILS = {
  dateOfBirth: "1980-05-14",
  spouseDateOfBirth: null,
  anniversary: null,
  motherDateOfBirth: null,
  fatherDateOfBirth: null,
  residentialAddress: "B-702, Raghuvir Residency, Vesu, Surat",
  officeAddress: null,
  annualIncome: 1_200_000,
  profession: "Diamond trader",
  education: null,
};

/** A case whose traveller Rakesh has his details filled in, so his link went out; the token as the message carries it. */
export async function linkSent() {
  const staff = await visaStaff();
  const saved = await saveCase(staff);
  const relationId = (await prisma.relation.findUniqueOrThrow({ where: { code: "SELF" } })).id;
  const added = await staff.post(`/api/clients/${saved.client.id}/members`).send({ name: "Rakesh Mehta", relationId, passportNumber: "Z1234567" });
  const memberId = added.body.member.id as string;
  const fresh = (await staff.get(`/api/visa/cases/${saved.caseNo}`)).body.case;
  const linked = await staff.put(`/api/visa/cases/${saved.caseNo}/travellers/${fresh.travellers[0].id}/member`).send({ memberId });
  const traveller = linked.body.case.travellers[0];
  const filled = await staff
    .put(`/api/visa/cases/${saved.caseNo}/travellers/${traveller.id}/consent-details`)
    .send({ ...CONSENT_DETAILS, updatedAt: traveller.consent.details.personUpdatedAt });
  expect(filled.status).toBe(200);
  const message = await prisma.outboundMessage.findFirstOrThrow({ where: { template: { code: "visa.consent_link" } }, orderBy: { createdAt: "desc" } });
  const token = /consent#([A-Za-z0-9_-]+)/.exec(message.body)![1]!;
  return { staff, caseNo: saved.caseNo, clientId: saved.client.id, memberId, travellerId: traveller.id as string, token };
}

/** The client opens the link and taps "I agree", from a test phone. Returns the form as the page showed it. */
export async function agreeThroughLink(token: string) {
  const opened = (await request(app).post("/api/public/consent/view").set(json).send({ token })).body.consent;
  const agreed = await request(app)
    .post("/api/public/consent/agree")
    .set(json)
    .set("User-Agent", "Test phone")
    .send({ token, wordingId: opened.wording.id, detailsHash: opened.detailsHash });
  expect(agreed.status).toBe(200);
  return opened;
}
