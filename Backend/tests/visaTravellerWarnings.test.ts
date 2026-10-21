import { beforeEach, describe, expect, it } from "vitest";
import { addDays, addMonths, dateLabel, fromDbDate, istToday, isoWeekday, toDbDate } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { loginAs, prisma, resetDb } from "./helpers";
import { decidedCase, readyCase, saveCase, visaStaff, type Agent } from "./visaHelpers";

// Warnings about a case's travellers (decided 19 Oct 2026, M46; lib/warnings.ts, visaWarnings.ts): a passport that runs
// out less than ⚠️ visa.passportValidity months (seeded 6) after the trip comes back. Checked when a traveller is linked,
// when the return changes, and at File ready; saved once confirmed, and the audit keeps it.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

const inDays = (days: number) => addDays(istToday(), days);
const updatedAtOf = async (caseNo: string) =>
  (await prisma.enquiry.findUniqueOrThrow({ where: { caseNo }, select: { updatedAt: true } })).updatedAt.toISOString();

/** A family member on the client's list, with a passport running out on `passportExpiry` (or a birth date). */
async function member(agent: Agent, clientId: string, name: string, passportExpiry?: string, dateOfBirth?: string) {
  const relationId = (await prisma.relation.findUniqueOrThrow({ where: { code: "SELF" } })).id;
  const res = await agent.post(`/api/clients/${clientId}/members`).send({ name, relationId, passportExpiry, dateOfBirth });
  expect(res.status).toBe(201);
  return res.body.member.id as string;
}

describe("a passport that runs out too soon after the trip", () => {
  it("is a warning at File ready, the last look before the file goes out", async () => {
    const c = await readyCase(); // back in 41 days
    // The case is Neha's now, and so is its client: Aarti, who matured it, no longer opens it (client access).
    const neha = await loginAs("neha@masti.test");
    const short = addMonths(inDays(41), 3);
    const memberId = await member(neha, c.client.id, "Rakesh Mehta", short);
    await prisma.visaCaseTraveller.update({ where: { id: c.travellers[0]!.id }, data: { memberId, name: "Rakesh Mehta" } });

    const warned = await neha.post(`/api/visa/cases/${c.caseNo}/file-ready`).send({ updatedAt: await updatedAtOf(c.caseNo) });
    expect(warned.status).toBe(409);
    expect(warned.body.details.warnings).toEqual([
      {
        code: "PASSPORT_EXPIRES_SOON",
        message: `Rakesh Mehta's passport expires ${dateLabel(short)}, less than 6 months after the trip comes back (${dateLabel(inDays(41))}).`,
      },
    ]);
    const ready = await neha.post(`/api/visa/cases/${c.caseNo}/file-ready`).send({ updatedAt: await updatedAtOf(c.caseNo), confirmWarnings: true });
    expect(ready.status).toBe(200);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.file.ready" } });
    expect(entry.after).toMatchObject({ confirmedWarnings: [{ code: "PASSPORT_EXPIRES_SOON" }] });
  });

  it("is a warning when the traveller is linked, and when a new return leaves too little; the margin is a setting", async () => {
    const staff = await visaStaff();
    const saved = await saveCase(staff);
    await prisma.visaCase.update({ where: { enquiryId: saved.id }, data: { returnOn: toDbDate(inDays(41)) } });
    const [adult] = await prisma.visaCaseTraveller.findMany({ where: { caseId: saved.id }, orderBy: { position: "asc" } });
    // Runs out 7 months after the return: fine now.
    const memberId = await member(staff, saved.client.id, "Rakesh Mehta", addMonths(inDays(41), 7));
    expect((await staff.put(`/api/visa/cases/${saved.caseNo}/travellers/${adult!.id}/member`).send({ memberId })).status).toBe(200);

    // Coming back 2 months later leaves 5: a warning; confirmed, saved.
    const trip = { returnOn: addMonths(inDays(41), 2) };
    const warned = await staff.patch(`/api/visa/cases/${saved.caseNo}/trip`).send(trip);
    expect(warned.status).toBe(409);
    expect(warned.body.details.warnings.map((w: { code: string }) => w.code)).toEqual(["PASSPORT_EXPIRES_SOON"]);
    expect((await staff.patch(`/api/visa/cases/${saved.caseNo}/trip`).send({ ...trip, confirmWarnings: true })).status).toBe(200);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.trip.update" }, orderBy: { createdAt: "desc" } });
    expect(entry.after).toMatchObject({ confirmedWarnings: [{ code: "PASSPORT_EXPIRES_SOON" }] });

    // A member whose passport runs out a month after the return: linking warns. With a 0-month margin it wouldn't.
    const [, child] = await prisma.visaCaseTraveller.findMany({ where: { caseId: saved.id }, orderBy: { position: "asc" } });
    const shortId = await member(staff, saved.client.id, "Aarav Mehta", addMonths(trip.returnOn, 1));
    const linked = await staff.put(`/api/visa/cases/${saved.caseNo}/travellers/${child!.id}/member`).send({ memberId: shortId });
    expect(linked.status).toBe(409);
    await prisma.setting.upsert({
      where: { key: "visa.passportValidity" },
      update: { value: { monthsAfterReturn: 0 } },
      create: { key: "visa.passportValidity", value: { monthsAfterReturn: 0 } },
    });
    expect((await staff.put(`/api/visa/cases/${saved.caseNo}/travellers/${child!.id}/member`).send({ memberId: shortId })).status).toBe(200);
  });
});

describe("an age that doesn't fit the place on the case", () => {
  it("is a warning for a child in an adult's place or an adult in a child's; the age is a setting", async () => {
    const staff = await visaStaff();
    const saved = await saveCase(staff); // one adult, one child; travelling out 40 days from now
    await prisma.visaCase.update({ where: { enquiryId: saved.id }, data: { departOn: toDbDate(inDays(40)) } });
    const [adult, child] = await prisma.visaCaseTraveller.findMany({ where: { caseId: saved.id }, orderBy: { position: "asc" } });
    const aarav = await member(staff, saved.client.id, "Aarav Mehta", undefined, addMonths(istToday(), -12 * 12));
    const kanta = await member(staff, saved.client.id, "Kanta Mehta", undefined, addMonths(istToday(), -71 * 12));
    const link = (travellerId: string, memberId: string, confirmWarnings?: boolean) =>
      staff.put(`/api/visa/cases/${saved.caseNo}/travellers/${travellerId}/member`).send({ memberId, ...(confirmWarnings ? { confirmWarnings } : {}) });

    const young = await link(adult!.id, aarav);
    expect(young.status).toBe(409);
    expect(young.body.details.warnings).toEqual([
      { code: "CHILD_IN_ADULT_PLACE", message: "Aarav Mehta is 12, but this is an adult's place on the case, with an adult's checklist." },
    ]);
    const old = await link(child!.id, kanta);
    expect(old.status).toBe(409);
    expect(old.body.details.warnings.map((w: { code: string }) => w.code)).toEqual(["ADULT_IN_CHILD_PLACE"]);

    // Confirmed: linked, and the audit keeps it. With the age set to 12, a 12-year-old counts as an adult.
    expect((await link(child!.id, kanta, true)).status).toBe(200);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.traveller.link" } });
    expect(entry.after).toMatchObject({ confirmedWarnings: [{ code: "ADULT_IN_CHILD_PLACE" }] });
    await prisma.setting.upsert({ where: { key: "visa.childAge" }, update: { value: { adultFrom: 12 } }, create: { key: "visa.childAge", value: { adultFrom: 12 } } });
    expect((await link(adult!.id, aarav)).status).toBe(200);
  });
});

const codes = (res: { body: { details: { warnings: { code: string }[] } } }) => res.body.details.warnings.map((w) => w.code);

describe("an appointment on or after the day the trip begins (21 Oct 2026: moving the trip used to skip it)", () => {
  it("is a warning when travelling out moves to the appointment day or before, and again at File ready", async () => {
    const c = await readyCase(); // both appointments in 10 days, travelling out in 30
    const neha = await loginAs("neha@masti.test");

    const moved = await neha.patch(`/api/visa/cases/${c.caseNo}/trip`).send({ departOn: inDays(10) });
    expect(moved.status).toBe(409);
    expect(moved.body.details.code).toBe("WARNING");
    expect(codes(moved)).toEqual(["APPOINTMENT_ON_OR_AFTER_DEPARTURE", "APPOINTMENT_ON_OR_AFTER_DEPARTURE"]);
    expect(moved.body.details.warnings[0].message).toMatch(/appointment \(.+\) is on or after the day the trip begins/);

    expect((await neha.patch(`/api/visa/cases/${c.caseNo}/trip`).send({ departOn: inDays(10), confirmWarnings: true })).status).toBe(200);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.trip.update", entityId: c.id }, orderBy: { createdAt: "desc" } });
    expect((entry.after as { confirmedWarnings: unknown[] }).confirmedWarnings).toHaveLength(2);

    // File ready looks again: the appointments are still on the day the trip begins.
    const ready = await neha.post(`/api/visa/cases/${c.caseNo}/file-ready`).send({ updatedAt: await updatedAtOf(c.caseNo) });
    expect(ready.status).toBe(409);
    expect(codes(ready)).toContain("APPOINTMENT_ON_OR_AFTER_DEPARTURE");
    expect((await neha.post(`/api/visa/cases/${c.caseNo}/file-ready`).send({ updatedAt: await updatedAtOf(c.caseNo), confirmWarnings: true })).status).toBe(200);
  });

  it("stays quiet while travelling out is after every appointment", async () => {
    const c = await readyCase();
    const neha = await loginAs("neha@masti.test");
    expect((await neha.patch(`/api/visa/cases/${c.caseNo}/trip`).send({ departOn: inDays(11) })).status).toBe(200);
  });
});

describe("a collection date on or after the day the trip begins (21 Oct 2026)", () => {
  it("is a warning when the submission is saved with it; confirmed, it's saved and the audit keeps it", async () => {
    const { c, processor } = await decidedCase({ decided: false }); // submitted, collecting on a Wednesday before the trip
    const depart = fromDbDate((await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id } })).departOn!);
    let late = depart;
    while (isoWeekday(late) !== 3) late = addDays(late, 1);
    const shown = (await processor.get(`/api/visa/cases/${c.caseNo}`)).body.case;
    const body = { vendorFileNo: shown.submission.vendorFileNo, embassyId: shown.submission.embassy.id, collectionOn: late, updatedAt: shown.updatedAt };

    const warned = await processor.put(`/api/visa/cases/${c.caseNo}/submission`).send(body);
    expect(warned.status).toBe(409);
    expect(codes(warned)).toEqual(["COLLECTION_ON_OR_AFTER_DEPARTURE"]);

    expect((await processor.put(`/api/visa/cases/${c.caseNo}/submission`).send({ ...body, confirmWarnings: true })).status).toBe(200);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.submission.update", entityId: c.id } });
    expect((entry.after as { confirmedWarnings: unknown[] }).confirmedWarnings).toHaveLength(1);
  });
});
