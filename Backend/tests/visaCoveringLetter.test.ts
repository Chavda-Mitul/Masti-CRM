import { beforeEach, describe, expect, it } from "vitest";
import { addDays, fullDate, istToday, toDbDate } from "../src/lib/dates";
import { fillLetter, namesInASentence, type LetterFacts } from "../src/modules/coveringLetters/fill";
import { seedCoveringLetters } from "../src/modules/coveringLetters/coveringLetters.seed";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { maturedCase, type Agent } from "./visaHelpers";

// The covering letter on a visa case (docs/decisions/0019-covering-letters.md Decisions 8–12): which letters fit, filling
// them in, "Make the letter" at File preparation, and the print of the letter made.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
  await seedCoveringLetters(prisma);
});

const FAMILY = "Schengen · tourist · family (sample)";
const ONE_PERSON = "Schengen · tourist · one person (sample)";
const HOTEL = "Hotel Lutetia, Paris";

/**
 * A matured France case (Neha's, at File preparation) whose travellers are linked to the Mehtas on the family list, with
 * the trip details and the client's address: everything the sample letters need, unless told otherwise.
 */
async function letterCase({ children = 1, hotel = true, childPassport = true } = {}) {
  const c = await maturedCase({ extra: { children } });
  const aarti = await prisma.user.findUniqueOrThrow({ where: { email: "aarti@masti.test" } });
  const relation = async (code: string) => (await prisma.relation.findUniqueOrThrow({ where: { code } })).id;
  const family = [
    { name: "RAKESH MEHTA", relationId: await relation("SELF"), dateOfBirth: toDbDate("1980-03-12"), passportNumber: "Z1234567" },
    { name: "AARAV MEHTA", relationId: await relation("SON"), dateOfBirth: toDbDate("2014-01-19"), passportNumber: childPassport ? "Z1234569" : null },
  ];
  const travellers = await prisma.visaCaseTraveller.findMany({ where: { caseId: c.id }, orderBy: { position: "asc" } });
  for (const [i, t] of travellers.entries()) {
    const member = await prisma.clientMember.create({ data: { ...family[i]!, clientId: c.client.id, createdById: aarti.id } });
    await prisma.visaCaseTraveller.update({ where: { id: t.id }, data: { memberId: member.id, name: member.name } });
  }
  await prisma.client.update({ where: { id: c.client.id }, data: { addressLine: "12 Shanti Park", area: "Vesu", city: "Surat", pincode: "395007" } });
  await prisma.visaCase.update({
    where: { enquiryId: c.id },
    data: {
      departOn: toDbDate(addDays(istToday(), 30)),
      returnOn: toDbDate(addDays(istToday(), 41)),
      entryType: "SINGLE",
      hotelStay: hotel ? HOTEL : null,
    },
  });
  return c;
}

const neha = () => loginAs("neha@masti.test");

async function others() {
  await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
  await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
  await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
  return { hod: await loginAs("riya@masti.test"), head: await loginAs("vimal@masti.test"), viewer: await loginAs("meena@masti.test") };
}

const view = async (agent: Agent, caseNo: string, formatId?: number) =>
  agent.get(`/api/visa/cases/${caseNo}/covering-letter${formatId ? `?formatId=${formatId}` : ""}`);
const make = (agent: Agent, caseNo: string, formatId: number) => agent.post(`/api/visa/cases/${caseNo}/covering-letter`).send({ formatId });
const print = (agent: Agent, caseNo: string) => agent.get(`/api/visa/cases/${caseNo}/covering-letter/print`);
const formatId = async (name: string) => (await prisma.coveringLetterFormat.findFirstOrThrow({ where: { name } })).id;

describe("which covering letters fit a case", () => {
  it("offers a 2-traveller France tourist case the Schengen family letter, and a 1-traveller case the one-person letter", async () => {
    const family = await letterCase();
    const res = await view(await neha(), family.caseNo);
    expect(res.status).toBe(200);
    expect(res.body.letter.letters).toEqual([{ id: await formatId(FAMILY), name: FAMILY, sample: true }]);
    expect(res.body.letter.selected).toMatchObject({ formatId: await formatId(FAMILY), sample: true });
    expect(res.body.letter.made).toBeNull();

    await resetDb();
    await seedVisaMasters(prisma);
    await seedEnquiryMasters(prisma);
    await seedCoveringLetters(prisma);
    const alone = await letterCase({ children: 0 });
    expect((await view(await neha(), alone.caseNo)).body.letter.letters.map((l: { name: string }) => l.name)).toEqual([ONE_PERSON]);
  });

  it("leaves out letters switched off, of another visa type, or with only a wording still to come", async () => {
    const c = await letterCase();
    const tourist = await prisma.visaType.findUniqueOrThrow({ where: { code: "TOURIST" } });
    const fr = await prisma.country.findUniqueOrThrow({ where: { code: "FR" } });
    const business = await prisma.visaType.create({ data: { code: "BUSINESS", name: "Business" } });
    const otherType = { name: "Business family", visaTypeId: business.id, party: "SEVERAL" as const };
    const later = { name: "Starts later", visaTypeId: tourist.id, party: "SEVERAL" as const };
    for (const [format, day] of [
      [otherType, istToday()],
      [later, addDays(istToday(), 3)],
    ] as const) {
      await prisma.coveringLetterFormat.create({
        data: { ...format, countries: { create: { countryId: fr.id } }, versions: { create: { effectiveFrom: toDbDate(day), body: "Dear Sir," } } },
      });
    }
    await prisma.coveringLetterFormat.update({ where: { id: await formatId(FAMILY) }, data: { isActive: false } });

    const res = await view(await neha(), c.caseNo);
    expect(res.body.letter.letters).toEqual([]);
    expect(res.body.letter.selected).toBeNull();
    expect(res.body.letter.fits).toEqual({ visaType: "Tourist", country: "France", travellers: 2 });
  });

  it("still offers a letter whose visa type was switched off since, so open cases keep it", async () => {
    const c = await letterCase();
    await prisma.visaType.update({ where: { code: "TOURIST" }, data: { isActive: false } });
    expect((await view(await neha(), c.caseNo)).body.letter.letters).toHaveLength(1);
  });
});

describe("filling a letter in", () => {
  it("fills every blank from the case: names, passports, the trip and the travellers' table", async () => {
    const c = await letterCase();
    const { selected } = (await view(await neha(), c.caseNo)).body.letter;
    expect(selected.missing).toEqual([]);
    expect(selected.values).toEqual({
      date: fullDate(istToday()),
      clientAddress: "12 Shanti Park, Vesu, Surat 395007",
      applicant: "RAKESH MEHTA",
      travellerCount: "2",
      country: "France",
      visaType: "Tourist",
      departOn: fullDate(addDays(istToday(), 30)),
      returnOn: fullDate(addDays(istToday(), 41)),
      days: "12",
      entry: "single",
      hotel: HOTEL,
    });
    expect(selected.travellers).toEqual([
      { name: "RAKESH MEHTA", relation: "Self", dateOfBirth: "12 Mar 1980", passportNo: "Z1234567" },
      { name: "AARAV MEHTA", relation: "Son", dateOfBirth: "19 Jan 2014", passportNo: "Z1234569" },
    ]);
  });

  it("lists what's missing in plain words, and only for the blanks the wording uses", async () => {
    const c = await letterCase({ hotel: false, childPassport: false });
    const { selected } = (await view(await neha(), c.caseNo)).body.letter;
    expect(selected.missing).toEqual(["the hotel stay", "AARAV MEHTA's passport number"]);
    expect(selected.values.hotel).toBeUndefined();

    const facts: LetterFacts = {
      clientName: "Rakesh Mehta",
      clientAddress: "",
      country: "France",
      visaType: "Tourist",
      trip: { departOn: null, returnOn: "2026-12-21", entryType: null, hotelStay: null },
      travellers: [{ name: null, label: "Adult 1", relation: null, dateOfBirth: null, passportNumber: null }],
    };
    expect(fillLetter("Dear Sir, {clientName}.", facts, "2026-10-20").missing).toEqual([]);
    expect(fillLetter("{days} days, {entry} entry, {clientAddress}", facts, "2026-10-20").missing).toEqual([
      "the client's address",
      "travelling out",
      "the entry type",
    ]);
    expect(fillLetter("{passportNo}\n{travellers}", facts, "2026-10-20").missing).toEqual([
      "Adult 1's passport number",
      "Adult 1's name",
      "Adult 1's date of birth",
    ]);
  });

  it("writes dates in full and joins names as a sentence", () => {
    expect(fullDate("2026-12-10")).toBe("10 December 2026");
    expect(namesInASentence(["A"])).toBe("A");
    expect(namesInASentence(["A", "B"])).toBe("A and B");
    expect(namesInASentence(["A", "B", "C"])).toBe("A, B and C");
  });
});

describe("making the letter", () => {
  it("records the wording used, who made it and when, with what it was filled in with; audited", async () => {
    const c = await letterCase();
    const family = await formatId(FAMILY);
    const res = await make(await neha(), c.caseNo, family);
    expect(res.status).toBe(200);
    expect(res.body.letter.made).toMatchObject({ formatId: family, formatName: FAMILY, madeBy: { name: "Neha Joshi" } });

    const saved = await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id } });
    const version = await prisma.coveringLetterVersion.findFirstOrThrow({ where: { formatId: family } });
    expect(saved.coveringLetterVersionId).toBe(version.id);
    expect(saved.coveringLetterFill).toMatchObject({ values: { applicant: "RAKESH MEHTA", hotel: HOTEL }, travellers: [{ passportNo: "Z1234567" }, {}] });

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.coveringLetter.make" } });
    expect(entry).toMatchObject({ entityType: "VisaCase", entityId: c.id, clientId: c.client.id, before: null });
    expect(entry.after).toMatchObject({ formatId: family, formatName: FAMILY, versionId: version.id });
  });

  it("lets the case's owner, the Visa HOD and the Head make it; not other Visa staff or viewers", async () => {
    const c = await letterCase();
    const family = await formatId(FAMILY);
    const { hod, head, viewer } = await others();
    expect((await make(await loginAs("aarti@masti.test"), c.caseNo, family)).status).toBe(403);
    expect((await make(viewer, c.caseNo, family)).status).toBe(403);
    expect((await make(hod, c.caseNo, family)).status).toBe(200);
    expect((await make(head, c.caseNo, family)).status).toBe(200);
  });

  it("waits until nothing the letter needs is missing: 409 LETTER_INCOMPLETE with the list, and nothing saved", async () => {
    const c = await letterCase({ hotel: false });
    const res = await make(await neha(), c.caseNo, await formatId(FAMILY));
    expect(res.status).toBe(409);
    expect(res.body.details).toEqual({ code: "LETTER_INCOMPLETE", missing: ["the hotel stay"] });
    expect(res.body.message).toBe("Not ready yet. Still needed: the hotel stay.");
    expect((await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id } })).coveringLetterMadeAt).toBeNull();
  });

  it("refuses a letter that doesn't fit the case, and any change once the file is ready", async () => {
    const c = await letterCase();
    const wrong = await make(await neha(), c.caseNo, await formatId("China · tourist · family (sample)"));
    expect(wrong.status).toBe(400);
    expect(wrong.body.issues.formatId[0]).toMatch(/doesn't fit this case/);

    const dispatch = await prisma.departmentStage.findFirstOrThrow({ where: { code: "DISPATCH" } });
    await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: dispatch.id } });
    const late = await make(await neha(), c.caseNo, await formatId(FAMILY));
    expect(late.status).toBe(409);
    expect(late.body.message).toMatch(/file preparation/);
  });

  it("can be made again: the new one replaces it, and the audit keeps the earlier", async () => {
    const c = await letterCase();
    const family = await formatId(FAMILY);
    const agent = await neha();
    await make(agent, c.caseNo, family);
    await prisma.visaCase.update({ where: { enquiryId: c.id }, data: { hotelStay: "Hotel Regina, Paris" } });
    expect((await make(agent, c.caseNo, family)).status).toBe(200);

    const saved = await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id } });
    expect(saved.coveringLetterFill).toMatchObject({ values: { hotel: "Hotel Regina, Paris" } });
    const entries = await prisma.auditLog.findMany({ where: { action: "visa.coveringLetter.make" }, orderBy: { id: "asc" } });
    expect(entries).toHaveLength(2);
    expect(entries[1]!.before).toMatchObject({ formatName: FAMILY });
  });
});

describe("printing the letter made", () => {
  it("needs a letter made first; then anyone who can open the case prints it", async () => {
    const c = await letterCase();
    const { viewer } = await others();
    const before = await print(viewer, c.caseNo);
    expect(before.status).toBe(409);
    expect(before.body.message).toBe("No covering letter was made for this case yet.");

    await make(await neha(), c.caseNo, await formatId(FAMILY));
    const res = await print(viewer, c.caseNo);
    expect(res.status).toBe(200);
    expect(res.body.print).toMatchObject({ caseNo: c.caseNo, formatName: FAMILY, letterheadMm: 45, values: { date: fullDate(istToday()) } });
    expect(res.body.print.body).toContain("{travellers}");
  });

  it("prints the same letter after the wording or the case's details change", async () => {
    const c = await letterCase();
    const family = await formatId(FAMILY);
    await make(await neha(), c.caseNo, family);
    const first = (await print(await neha(), c.caseNo)).body.print;

    await prisma.coveringLetterVersion.create({ data: { formatId: family, effectiveFrom: toDbDate(istToday()), body: "A new wording, {applicant}." } });
    await prisma.clientMember.updateMany({ where: { name: "RAKESH MEHTA" }, data: { passportNumber: "Z7654321" } });
    await prisma.visaCase.update({ where: { enquiryId: c.id }, data: { hotelStay: "Hotel Regina, Paris" } });

    const again = (await print(await neha(), c.caseNo)).body.print;
    expect(again).toEqual(first);
    // The card's preview follows the case and the new wording; the letter made doesn't.
    const { selected } = (await view(await neha(), c.caseNo)).body.letter;
    expect(selected.body).toBe("A new wording, {applicant}.");
  });

  it("leaves the letterhead space Vimal or the Visa HOD set: 0–120 mm", async () => {
    const c = await letterCase();
    await make(await neha(), c.caseNo, await formatId(FAMILY));
    const { hod } = await others();
    expect((await hod.put("/api/visa/settings").send({ coveringLetter: { letterheadMm: 121 } })).status).toBe(400);
    expect((await hod.put("/api/visa/settings").send({ coveringLetter: { letterheadMm: 30 } })).status).toBe(200);
    expect((await print(hod, c.caseNo)).body.print.letterheadMm).toBe(30);
    expect((await (await loginAs("aarti@masti.test")).put("/api/visa/settings").send({ coveringLetter: { letterheadMm: 40 } })).status).toBe(403);
  });
});

describe("the database", () => {
  it("keeps a made letter's four details together", async () => {
    const c = await letterCase();
    await expect(prisma.visaCase.update({ where: { enquiryId: c.id }, data: { coveringLetterMadeAt: new Date() } })).rejects.toThrow();
  });
});
