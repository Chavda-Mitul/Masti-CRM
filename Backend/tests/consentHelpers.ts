import { expect } from "vitest";
import { app, prisma, request } from "./helpers";
import { saveCase, visaStaff, type Agent } from "./visaHelpers";

// Shared by the consent tests (docs/decisions/0022-consent-form.md): a traveller whose details are filled in, so their
// "I agree" link went out, and the client agreeing through it.

const json = { "Content-Type": "application/json" };

/** Rakesh's consent details, as staff fill them in: answers by the field's label (amendment 1); the rest stay empty. */
export const CONSENT_DETAILS: Record<string, string | null> = {
  "Date of birth": "1980-05-14",
  "Home address": "B-702, Raghuvir Residency, Vesu, Surat",
  Profession: "Diamond trader",
  "Annual income (₹)": "1200000",
};

/** The consent form for a named traveller, as the dialog loads it: the fields in use and the person's answers. */
export async function consentForm(agent: Agent, caseNo: string, travellerId: string) {
  const res = await agent.get(`/api/visa/cases/${caseNo}/travellers/${travellerId}/consent-details`);
  expect(res.status).toBe(200);
  return res.body.form as {
    fields: { id: number; label: string; kind: string; required: boolean; fixed: string | null }[];
    answers: Record<string, string | null>;
    adultFrom: number;
    guardianId: string | null;
    guardianChoices: { id: string; name: string; relation: string; age: number | null }[];
    personUpdatedAt: string;
  };
}

/**
 * Saves the consent form as the dialog would: an answer for every field in use, by label (any not given is left
 * empty), with the person's updatedAt as loaded. `extra` changes the body after (e.g. an old updatedAt).
 */
export async function fillConsent(
  agent: Agent,
  caseNo: string,
  travellerId: string,
  byLabel: Record<string, string | null> = CONSENT_DETAILS,
  extra: Record<string, unknown> = {},
) {
  const form = await consentForm(agent, caseNo, travellerId);
  const answers = Object.fromEntries(form.fields.map((f) => [String(f.id), byLabel[f.label] ?? null]));
  return agent
    .put(`/api/visa/cases/${caseNo}/travellers/${travellerId}/consent-details`)
    .send({ answers, updatedAt: form.personUpdatedAt, ...extra });
}

/** A seeded field's id, by its label. */
export async function fieldId(label: string) {
  return (await prisma.consentField.findFirstOrThrow({ where: { label } })).id;
}

/** The person's details as the client's page shows them: label and value, in the form's order. */
export const rowsOf = (person: { rows: { label: string; value: string }[] }) => person.rows.map((r) => [r.label, r.value]);

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
  const filled = await fillConsent(staff, saved.caseNo, traveller.id);
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
