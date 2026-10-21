import { beforeEach, describe, expect, it } from "vitest";
import { addDays, fullDate, istToday, toDbDate } from "../src/lib/dates";
import { MAX_LETTER_ROWS, marksIn, type LetterText } from "../src/modules/coveringLetters/coveringLetters.schemas";
import { draftLetter, namesInASentence, type LetterFacts } from "../src/modules/coveringLetters/fill";
import { seedCoveringLetters } from "../src/modules/coveringLetters/coveringLetters.seed";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { MAX_ADULTS, MAX_CHILDREN } from "../src/modules/visa/visa.schemas";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { maturedCase, type Agent } from "./visaHelpers";

// The covering letter on a visa case (docs/decisions/0019-covering-letters.md Decisions 8–12, amendment 1): which letters
// fit, the draft with its marks, "Make the letter" with the text as staff left it, and the print of the letter made.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
  await seedCoveringLetters(prisma);
});

const FAMILY = "Schengen · tourist · family (sample)";
const ONE_PERSON = "Schengen · tourist · one person (sample)";
const HOTEL = "Hotel Lutetia, Paris";
const COLUMNS = ["Name", "Relation", "Date of birth", "Passport no."];

/**
 * A matured France case (Neha's, at File preparation) whose travellers are linked to the Mehtas on the family list, with
 * the trip details and the client's address: everything the sample letters need, unless told otherwise.
 */
async function letterCase({ children = 1, hotel = HOTEL as string | null, childPassport = true } = {}) {
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
      hotelStay: hotel,
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
const print = (agent: Agent, caseNo: string) => agent.get(`/api/visa/cases/${caseNo}/covering-letter/print`);
const formatId = async (name: string) => (await prisma.coveringLetterFormat.findFirstOrThrow({ where: { name } })).id;

/** What the card shows for a letter, as its owner sees it: the draft, the wording it came from, what the case lacks. */
async function draftOf(caseNo: string, format: number) {
  const { selected } = (await view(await neha(), caseNo, format)).body.letter;
  return selected as { formatId: number; versionId: number; draft: LetterText; missing: string[] };
}

/** "Make the letter": the draft as it stands, or as `edit` changes it. */
async function make(agent: Agent, caseNo: string, format: number, edit: (letter: LetterText) => LetterText = (l) => l) {
  const { versionId, draft } = await draftOf(caseNo, format);
  return agent.post(`/api/visa/cases/${caseNo}/covering-letter`).send({ formatId: format, versionId, letter: edit(draft) });
}

/** A copy of a letter with the table's cell changed. */
const withCell = (letter: LetterText, row: number, column: number, value: string): LetterText => ({
  ...letter,
  table: letter.table && { ...letter.table, rows: letter.table.rows.map((cells, r) => (r === row ? cells.map((c, i) => (i === column ? value : c)) : cells)) },
});

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

describe("drafting a letter", () => {
  it("writes the case's values in, with the table of travellers from the family list", async () => {
    const c = await letterCase();
    const { draft, missing } = await draftOf(c.caseNo, await formatId(FAMILY));
    expect(missing).toEqual([]);
    expect(marksIn(draft)).toEqual([]);
    expect(draft.top).toMatch(
      new RegExp(`^${fullDate(istToday())}\n\nTo,\nThe Visa Officer,\nConsulate General of France,\nMumbai\n\nSubject: Short-stay Tourist visa for RAKESH MEHTA and family \\(2 travellers\\)`),
    );
    expect(draft.top).toContain(`travel from ${fullDate(addDays(istToday(), 30))} to ${fullDate(addDays(istToday(), 41))}, a stay of 12 days, and request a single-entry visa.`);
    expect(draft.top.endsWith("The travellers are:")).toBe(true);
    expect(draft.table).toEqual({
      columns: COLUMNS,
      rows: [
        ["RAKESH MEHTA", "Self", "12 Mar 1980", "Z1234567"],
        ["AARAV MEHTA", "Son", "19 Jan 2014", "Z1234569"],
      ],
    });
    expect(draft.bottom).toMatch(/^We will stay at Hotel Lutetia, Paris\./);
    expect(draft.bottom.endsWith("Yours faithfully,\n\nRAKESH MEHTA\n12 Shanti Park, Vesu, Surat 395007")).toBe(true);
  });

  it("marks what the case lacks in plain words, for staff to type over, and lists it", async () => {
    const c = await letterCase({ hotel: null, childPassport: false });
    const { draft, missing } = await draftOf(c.caseNo, await formatId(FAMILY));
    expect(missing).toEqual(["AARAV MEHTA's passport number", "the hotel stay"]);
    expect(draft.table!.rows[1]![3]).toBe("⟦AARAV MEHTA's passport number⟧");
    expect(draft.bottom).toMatch(/^We will stay at ⟦the hotel stay⟧\./);
    expect(marksIn(draft)).toEqual(["AARAV MEHTA's passport number", "the hotel stay"]);

    const facts: LetterFacts = {
      clientName: "Rakesh Mehta",
      clientAddress: "",
      country: "France",
      visaType: "Tourist",
      trip: { departOn: null, returnOn: "2026-12-21", entryType: null, hotelStay: null },
      travellers: [{ name: null, label: "Adult 1", relation: null, dateOfBirth: null, passportNumber: null }],
    };
    expect(draftLetter("Dear Sir, {clientName}.", facts, "2026-10-20")).toEqual({
      letter: { top: "Dear Sir, Rakesh Mehta.", table: null, bottom: "" },
      missing: [],
    });
    expect(draftLetter("{days} days, {entry} entry, {clientAddress}", facts, "2026-10-20")).toEqual({
      letter: { top: "⟦the number of days⟧ days, ⟦the entry type⟧ entry, ⟦the client's address⟧", table: null, bottom: "" },
      missing: ["travelling out", "the entry type", "the client's address"],
    });
    expect(draftLetter("{passportNo}\n{travellers}", facts, "2026-10-20")).toEqual({
      letter: {
        top: "⟦Adult 1's passport number⟧",
        table: { columns: COLUMNS, rows: [["⟦Adult 1's name⟧", "", "⟦Adult 1's date of birth⟧", "⟦Adult 1's passport number⟧"]] },
        bottom: "",
      },
      missing: ["Adult 1's passport number", "Adult 1's name", "Adult 1's date of birth"],
    });
  });

  it("marks an unnamed traveller in the names, where the letter used to print \"Adult 2\"", () => {
    const facts: LetterFacts = {
      clientName: "Rakesh Mehta",
      clientAddress: "Surat",
      country: "France",
      visaType: "Tourist",
      trip: { departOn: null, returnOn: null, entryType: null, hotelStay: null },
      travellers: [
        { name: "RAKESH MEHTA", label: "Adult 1", relation: "Self", dateOfBirth: null, passportNumber: null },
        { name: null, label: "Adult 2", relation: null, dateOfBirth: null, passportNumber: null },
      ],
    };
    expect(draftLetter("For {travellerNames}.", facts, "2026-10-20").letter.top).toBe("For RAKESH MEHTA and ⟦Adult 2's name⟧.");
  });

  it("puts the table where {travellers} is: first, last or the only line; a wording without it has no table", () => {
    const facts: LetterFacts = {
      clientName: "Rakesh Mehta",
      clientAddress: "Surat",
      country: "France",
      visaType: "Tourist",
      trip: { departOn: null, returnOn: null, entryType: null, hotelStay: null },
      travellers: [{ name: "RAKESH MEHTA", label: "Adult 1", relation: "Self", dateOfBirth: "1980-03-12", passportNumber: "Z1234567" }],
    };
    const row = [["RAKESH MEHTA", "Self", "12 Mar 1980", "Z1234567"]];
    expect(draftLetter("{travellers}\n\nThank you.", facts, "2026-10-20").letter).toEqual({ top: "", table: { columns: COLUMNS, rows: row }, bottom: "Thank you." });
    expect(draftLetter("Dear Sir,\r\n\r\nWe travel:\r\n{travellers}", facts, "2026-10-20").letter).toEqual({
      top: "Dear Sir,\n\nWe travel:",
      table: { columns: COLUMNS, rows: row },
      bottom: "",
    });
    expect(draftLetter("  {travellers}  ", facts, "2026-10-20").letter).toEqual({ top: "", table: { columns: COLUMNS, rows: row }, bottom: "" });
  });

  it("writes dates in full and joins names as a sentence", () => {
    expect(fullDate("2026-12-10")).toBe("10 December 2026");
    expect(namesInASentence(["A"])).toBe("A");
    expect(namesInASentence(["A", "B"])).toBe("A and B");
    expect(namesInASentence(["A", "B", "C"])).toBe("A, B and C");
  });
});

describe("making the letter", () => {
  it("keeps the text as staff left it, the table's changes too; who made it and when; audited with the text", async () => {
    const c = await letterCase();
    const family = await formatId(FAMILY);
    const edited = (letter: LetterText): LetterText => ({
      top: letter.top.replace("Dear Sir or Madam,", "Respected Sir/Madam,"),
      table: {
        columns: ["Name", "Designation", "Passport no."],
        rows: [
          ["RAKESH MEHTA", "Partner", "Z1234567"],
          ["AARAV MEHTA", "Student", "Z1234569"],
        ],
      },
      bottom: `${letter.bottom}\n\nP.S. We have also attached our hotel bookings.`,
    });
    const res = await make(await neha(), c.caseNo, family, edited);
    expect(res.status).toBe(200);
    expect(res.body.letter.made).toMatchObject({ formatId: family, formatName: FAMILY, madeBy: { name: "Neha Joshi" } });

    const sent = edited((await draftOf(c.caseNo, family)).draft);
    const saved = await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id } });
    const version = await prisma.coveringLetterVersion.findFirstOrThrow({ where: { formatId: family } });
    expect(saved.coveringLetterVersionId).toBe(version.id);
    expect(saved.coveringLetterText).toEqual(sent);
    expect(res.body.letter.made.letter).toEqual(sent);

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.coveringLetter.make" } });
    expect(entry).toMatchObject({ entityType: "VisaCase", entityId: c.id, clientId: c.client.id, before: null });
    expect(entry.after).toMatchObject({ formatId: family, formatName: FAMILY, versionId: version.id, letter: sent });
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

  it("waits while a mark is left, even half deleted: 409 LETTER_INCOMPLETE with the list, and nothing saved", async () => {
    const c = await letterCase({ hotel: null });
    const family = await formatId(FAMILY);
    const agent = await neha();
    const res = await make(agent, c.caseNo, family);
    expect(res.status).toBe(409);
    expect(res.body.details).toEqual({ code: "LETTER_INCOMPLETE", missing: ["the hotel stay"] });
    expect(res.body.message).toBe("Not ready yet. Fill these in first: the hotel stay.");

    const half = await make(agent, c.caseNo, family, (l) => ({ ...l, bottom: l.bottom.replace("⟦the hotel stay⟧", "Hotel Regina⟧") }));
    expect(half.status).toBe(409);
    expect(half.body.details.missing).toEqual(["a ⟦ or ⟧ left over"]);
    expect((await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id } })).coveringLetterMadeAt).toBeNull();

    // Typed over in the letter; the case itself still has no hotel stay (the project lead, 21 Oct 2026).
    const typed = await make(agent, c.caseNo, family, (l) => ({ ...l, bottom: l.bottom.replace("⟦the hotel stay⟧", "Hotel Regina, Paris") }));
    expect(typed.status).toBe(200);
    expect((await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id } })).hotelStay).toBeNull();
  });

  it("takes square brackets that are part of the case's details: they aren't marks", async () => {
    const c = await letterCase({ hotel: "Hotel [Opera], Paris" });
    expect((await make(await neha(), c.caseNo, await formatId(FAMILY))).status).toBe(200);
  });

  it("refuses a letter that doesn't fit, a wording it can't have started from, and any change once the file is ready", async () => {
    const c = await letterCase();
    const family = await formatId(FAMILY);
    const agent = await neha();
    const { versionId, draft } = await draftOf(c.caseNo, family);
    const send = (body: object) => agent.post(`/api/visa/cases/${c.caseNo}/covering-letter`).send(body);

    const wrong = await send({ formatId: await formatId("China · tourist · family (sample)"), versionId, letter: draft });
    expect(wrong.status).toBe(400);
    expect(wrong.body.issues.formatId[0]).toMatch(/doesn't fit this case/);

    const china = await prisma.coveringLetterVersion.findFirstOrThrow({ where: { format: { name: "China · tourist · family (sample)" } } });
    const tomorrow = await prisma.coveringLetterVersion.create({ data: { formatId: family, effectiveFrom: toDbDate(addDays(istToday(), 1)), body: "Later." } });
    for (const other of [china.id, tomorrow.id]) {
      const res = await send({ formatId: family, versionId: other, letter: draft });
      expect(res.status).toBe(400);
      expect(res.body.issues.versionId[0]).toMatch(/wording has changed/);
    }

    const dispatch = await prisma.departmentStage.findFirstOrThrow({ where: { code: "DISPATCH" } });
    await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: dispatch.id } });
    const late = await send({ formatId: family, versionId, letter: draft });
    expect(late.status).toBe(409);
    expect(late.body.message).toMatch(/file preparation/);
  });

  it("checks the letter's size and shape, saying which part is wrong", async () => {
    expect(MAX_LETTER_ROWS).toBe(MAX_ADULTS + MAX_CHILDREN);
    const c = await letterCase();
    const family = await formatId(FAMILY);
    const agent = await neha();
    const refused = async (edit: (l: LetterText) => LetterText) => {
      const res = await make(agent, c.caseNo, family, edit);
      expect(res.status).toBe(400);
      return res.body.issues.letter as string[];
    };
    const table = (l: LetterText) => l.table!;

    expect(await refused((l) => ({ ...l, table: { ...table(l), rows: [[...table(l).rows[0]!, "extra"]] } }))).toEqual([
      "The table's row 1 needs one cell for each column.",
    ]);
    expect(await refused((l) => withCell(l, 1, 3, "Z".repeat(201)))).toEqual(["The table's row 2, Passport no., is over 200 characters."]);
    expect(await refused((l) => ({ ...l, table: { columns: Array(7).fill("Col"), rows: [] } }))).toEqual(["Give the table 1 to 6 columns."]);
    expect(await refused((l) => ({ ...l, table: { columns: ["Name", " "], rows: [] } }))).toEqual(["Give the table's column 2 a heading."]);
    expect(await refused((l) => ({ ...l, table: { columns: ["Name"], rows: Array(61).fill(["A"]) } }))).toEqual(["Keep the table to 60 rows."]);
    expect(await refused((l) => ({ ...l, top: "x".repeat(8001) }))).toEqual(["Keep the text above the table under 8000 characters."]);
    expect(await refused((l) => ({ ...l, table: null }))).toEqual(["Without a table, all the text goes above it."]);
    expect(await refused(() => ({ top: " \n ", table: null, bottom: "" }))).toEqual(["Write the letter."]);

    // Line breaks: Windows ones become plain, and a heading or a cell is one line.
    const res = await make(agent, c.caseNo, family, (l) => withCell({ ...l, top: l.top.replace(/\n/g, "\r\n") }, 0, 3, "Z123\n4567"));
    expect(res.status).toBe(200);
    const saved = (await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id } })).coveringLetterText as unknown as LetterText;
    expect(saved.top).not.toContain("\r");
    expect(saved.table!.rows[0]![3]).toBe("Z123 4567");
  });

  it("starts again from the letter made: making it again replaces the text, and the audit keeps both", async () => {
    const c = await letterCase();
    const family = await formatId(FAMILY);
    const agent = await neha();
    expect((await make(agent, c.caseNo, family)).status).toBe(200);
    const first = (await view(agent, c.caseNo)).body.letter.made;

    // A new wording from today doesn't stop the letter made from being made again from its own.
    await prisma.coveringLetterVersion.create({ data: { formatId: family, effectiveFrom: toDbDate(istToday()), body: "A new wording, {applicant}." } });
    const again = await agent
      .post(`/api/visa/cases/${c.caseNo}/covering-letter`)
      .send({ formatId: family, versionId: first.versionId, letter: withCell(first.letter, 0, 1, "Applicant") });
    expect(again.status).toBe(200);

    const saved = await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id } });
    expect(saved.coveringLetterVersionId).toBe(first.versionId);
    expect((saved.coveringLetterText as unknown as LetterText).table!.rows[0]![1]).toBe("Applicant");
    const entries = await prisma.auditLog.findMany({ where: { action: "visa.coveringLetter.make" }, orderBy: { id: "asc" } });
    expect(entries).toHaveLength(2);
    expect(entries[1]!.before).toMatchObject({ formatName: FAMILY, letter: first.letter });
    expect(entries[1]!.after).toMatchObject({ letter: withCell(first.letter, 0, 1, "Applicant") });
  });
});

describe("printing the letter made", () => {
  it("needs a letter made first; then anyone who can open the case prints its text", async () => {
    const c = await letterCase();
    const { viewer } = await others();
    const before = await print(viewer, c.caseNo);
    expect(before.status).toBe(409);
    expect(before.body.message).toBe("No covering letter was made for this case yet.");

    await make(await neha(), c.caseNo, await formatId(FAMILY));
    const made = (await view(await neha(), c.caseNo)).body.letter.made;
    const res = await print(viewer, c.caseNo);
    expect(res.status).toBe(200);
    expect(res.body.print).toMatchObject({ caseNo: c.caseNo, formatName: FAMILY, letterheadMm: 45, letter: made.letter });
    expect(res.body.print.letter.top.startsWith(fullDate(istToday()))).toBe(true);
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
    // A fresh draft follows the case and the new wording; the letter made doesn't.
    expect((await draftOf(c.caseNo, family)).draft).toEqual({ top: "A new wording, RAKESH MEHTA.", table: null, bottom: "" });
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
  it("keeps a made letter's four details together, and its text in its shape", async () => {
    const c = await letterCase();
    await expect(prisma.visaCase.update({ where: { enquiryId: c.id }, data: { coveringLetterMadeAt: new Date() } })).rejects.toThrow();

    expect((await make(await neha(), c.caseNo, await formatId(FAMILY))).status).toBe(200);
    for (const text of ["Dear Sir,", { top: "Dear Sir," }, { top: "A", table: "B", bottom: "" }, { top: "x".repeat(120_001), table: null, bottom: "" }]) {
      await expect(prisma.visaCase.update({ where: { enquiryId: c.id }, data: { coveringLetterText: text } })).rejects.toThrow();
    }
  });
});
