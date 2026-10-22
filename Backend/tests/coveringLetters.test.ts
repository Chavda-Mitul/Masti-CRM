import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, addMonths, istToday } from "../src/lib/dates";
import { inForce } from "../src/modules/coveringLetters/coveringLetter";
import { LETTER_BLANKS, wordingProblem } from "../src/modules/coveringLetters/coveringLetters.schemas";
import { SAMPLE_LETTERS, seedCoveringLetters } from "../src/modules/coveringLetters/coveringLetters.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";

// The covering-letter formats (docs/decisions/0019-covering-letters.md): who changes them, their checks, and which
// wording is in use on a day.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
});

afterEach(() => {
  vi.useRealTimers();
});

type Agent = Awaited<ReturnType<typeof loginAs>>;

async function visaHod() {
  await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
  return loginAs("riya@masti.test");
}

async function visaStaff(access: "VIEW" | "EDIT" = "EDIT") {
  await createUser({ name: "Aarti", email: "aarti@masti.test", departments: [{ code: "VISA", access }] });
  return loginAs("aarti@masti.test");
}

const countryId = async (code: string) => (await prisma.country.findUniqueOrThrow({ where: { code } })).id;
const visaTypeId = async (code = "TOURIST") => (await prisma.visaType.findUniqueOrThrow({ where: { code } })).id;

const WORDING = `{date}

To,
The Visa Officer,
Consulate General of {country}, Mumbai

I, {applicant}, request a {visaType} visa from {departOn} to {returnOn}.

{travellers}

Yours faithfully,
{applicant}`;

/** "Schengen · tourist · family": France, Tourist, two or more travellers, its wording used from today. */
async function addLetter(agent: Agent, body: Record<string, unknown> = {}) {
  return agent.post("/api/masters/covering-letters").send({
    name: "Schengen · tourist · family",
    visaTypeId: await visaTypeId(),
    party: "SEVERAL",
    countryIds: [await countryId("FR")],
    body: WORDING,
    effectiveFrom: istToday(),
    ...body,
  });
}

interface Wording {
  id: number;
  effectiveFrom: string;
  body: string;
  status: string;
}

/** Adds a letter and returns its id, its first wording and the token the next write sends back. */
async function letter(agent: Agent, body: Record<string, unknown> = {}) {
  const res = await addLetter(agent, body);
  expect(res.status).toBe(201);
  const format = res.body.format as { id: number; updatedAt: string; versions: Wording[] };
  return { id: format.id, updatedAt: format.updatedAt, first: format.versions[0]! };
}

const addWording = (agent: Agent, id: number, body: Record<string, unknown>) => agent.post(`/api/masters/covering-letters/${id}/versions`).send(body);

describe("who can see and change covering letters", () => {
  it("needs a login, and refuses field staff and other departments", async () => {
    expect((await request(app).get("/api/masters/covering-letters")).status).toBe(401);
    await createUser({ name: "Ravi", mobile: "+919876500001", type: "FIELD" });
    expect((await (await loginAs("9876500001")).get("/api/masters/covering-letters")).status).toBe(403);
    await createUser({ email: "hotels@masti.test", departments: [{ code: "HOTELS", access: "EDIT" }] });
    expect((await (await loginAs("hotels@masti.test")).get("/api/masters/covering-letters")).status).toBe(403);
  });

  it("lets Visa staff read, but only the Visa HOD or the Head add and change them", async () => {
    const hod = await visaHod();
    const { id, updatedAt, first } = await letter(hod);

    const staff = await visaStaff("EDIT");
    expect((await staff.get("/api/masters/covering-letters")).body.formats).toHaveLength(1);
    expect((await staff.get(`/api/masters/covering-letters/${id}`)).body.format.versions).toHaveLength(1);
    const refused = await addLetter(staff, { name: "Another" });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/Visa HOD/);
    expect((await staff.patch(`/api/masters/covering-letters/${id}`).send({ isActive: false, updatedAt })).status).toBe(403);
    expect((await addWording(staff, id, { body: `${WORDING}\nP.S.`, effectiveFrom: istToday(), updatedAt })).status).toBe(403);
    expect((await staff.delete(`/api/masters/covering-letters/${id}/versions/${first.id}`).send({ updatedAt })).status).toBe(403);

    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    const viewOnly = await loginAs("meena@masti.test");
    expect((await viewOnly.get("/api/masters/covering-letters")).status).toBe(200);
    expect((await addLetter(viewOnly, { name: "Another" })).status).toBe(403);

    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    expect((await addLetter(await loginAs("vimal@masti.test"), { name: "Another" })).status).toBe(201);
  });
});

describe("adding a covering letter", () => {
  it("adds it with its first wording, its countries by name, audited", async () => {
    const hod = await visaHod();
    const res = await addLetter(hod, { countryIds: [await countryId("FR"), await countryId("CN")] });
    expect(res.status).toBe(201);
    const today = istToday();
    expect(res.body.format).toMatchObject({
      name: "Schengen · tourist · family",
      visaType: { code: "TOURIST", name: "Tourist", isActive: true },
      party: "SEVERAL",
      isActive: true,
      inUse: { effectiveFrom: today, addedBy: { name: "Riya" } },
      next: null,
    });
    expect(res.body.format.countries.map((c: { code: string }) => c.code)).toEqual(["CN", "FR"]);
    expect(res.body.format.versions).toEqual([expect.objectContaining({ effectiveFrom: today, body: WORDING, status: "IN_USE" })]);

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "coveringLetter.create" } });
    expect(entry).toMatchObject({ entityType: "CoveringLetterFormat", entityId: String(res.body.format.id) });
    expect(entry.after).toMatchObject({
      name: "Schengen · tourist · family",
      party: "SEVERAL",
      countryIds: [await countryId("FR"), await countryId("CN")].sort((a, b) => a - b),
      wording: { effectiveFrom: today, body: WORDING },
    });
  });

  it("needs a name, a visa type, who travels, a country and a wording", async () => {
    const hod = await visaHod();
    for (const [field, value] of [
      ["name", "   "],
      ["visaTypeId", undefined],
      ["party", "FAMILY"],
      ["countryIds", []],
      ["body", "  \n  "],
      ["effectiveFrom", "19-10-2026"],
    ] as const) {
      const res = await addLetter(hod, { [field]: value });
      expect(res.status, field).toBe(400);
      expect(res.body.issues[field], field).toBeDefined();
    }
    expect(await prisma.coveringLetterFormat.count()).toBe(0);
  });

  it("keeps the wording's line breaks, the Windows ones as plain ones, and trims its ends", async () => {
    const hod = await visaHod();
    const res = await addLetter(hod, { body: `  \r\nDear Sir,\r\n\r\n{travellers}\r\nThanks \n\n` });
    expect(res.status).toBe(201);
    expect(res.body.format.versions[0].body).toBe("Dear Sir,\n\n{travellers}\nThanks");
  });

  it("refuses the same name whatever the capitals, and the database does too", async () => {
    const hod = await visaHod();
    const { id, updatedAt } = await letter(hod);
    const twin = await addLetter(hod, { name: "  SCHENGEN · TOURIST · FAMILY " });
    expect(twin.status).toBe(400);
    expect(twin.body.issues.name[0]).toMatch(/already a covering letter\.$/);

    expect((await hod.patch(`/api/masters/covering-letters/${id}`).send({ isActive: false, updatedAt })).status).toBe(200);
    expect((await addLetter(hod, { name: "schengen · tourist · family" })).body.issues.name[0]).toMatch(/switched off\. Switch it back on/);

    const visaType = await visaTypeId();
    await expect(prisma.coveringLetterFormat.create({ data: { name: "Schengen · Tourist · Family", visaTypeId: visaType, party: "ONE" } })).rejects.toThrow();
    await expect(prisma.coveringLetterFormat.create({ data: { name: "   ", visaTypeId: visaType, party: "ONE" } })).rejects.toThrow();
  });

  it("refuses switched-off or unknown countries and visa types", async () => {
    const hod = await visaHod();
    expect((await addLetter(hod, { countryIds: [999] })).body.issues.countryIds).toBeDefined();
    expect((await addLetter(hod, { visaTypeId: 999 })).body.issues.visaTypeId).toBeDefined();
    await prisma.country.update({ where: { code: "CN" }, data: { isActive: false } });
    const country = await addLetter(hod, { countryIds: [await countryId("CN")] });
    expect(country.status).toBe(400);
    expect(country.body.issues.countryIds[0]).toBe("Pick from the active countries.");
    await prisma.visaType.update({ where: { code: "TOURIST" }, data: { isActive: false } });
    const visaType = await addLetter(hod);
    expect(visaType.status).toBe(400);
    expect(visaType.body.issues.visaTypeId[0]).toBe("Pick an active visa type.");
  });

  it("checks the blanks", async () => {
    // {travellers} and {purpose} are paragraphs of their own; every other blank can sit in a sentence.
    const every = LETTER_BLANKS.filter((b) => b !== "travellers" && b !== "purpose")
      .map((b) => `{${b}}`)
      .join(" ");
    expect(wordingProblem(`${every}\n{travellers}\n{purpose}\nThe end`)).toBeNull();
    expect(wordingProblem("No blanks at all.")).toBeNull();
    expect(wordingProblem("Dear Sir,\r\n  {travellers}  \r\nThanks")).toBeNull();

    expect(wordingProblem("Passport {passport}")).toBe("{passport} isn't one of the blanks. Pick blanks from the list.");
    expect(wordingProblem("I, {APPLICANT}")).toMatch(/\{APPLICANT\} isn't one of the blanks/);
    expect(wordingProblem("Empty {} braces")).toMatch(/\{\} isn't one of the blanks/);
    expect(wordingProblem("I, {applicant")).toMatch(/left over/);
    expect(wordingProblem("I, applicant}")).toMatch(/left over/);
    expect(wordingProblem("I, {{applicant}}")).toMatch(/left over/);
    expect(wordingProblem("{travellers}\n{travellers}")).toMatch(/only once/);
    expect(wordingProblem("The travellers: {travellers}")).toBe("Put {travellers} on a line of its own: it prints as a table.");
    expect(wordingProblem("Dear Sir,\r\n\r\n  {purpose}  \r\nThanks")).toBeNull();
    expect(wordingProblem("{purpose}\n{purpose}")).toBe("Use {purpose} only once: the AI or staff write why they travel there.");
    expect(wordingProblem("Why: {purpose}")).toBe("Put {purpose} on a line of its own: the AI or staff write why they travel there.");

    const hod = await visaHod();
    const res = await addLetter(hod, { body: "Passport {passport}" });
    expect(res.status).toBe(400);
    expect(res.body.issues.body[0]).toMatch(/\{passport\} isn't one of the blanks/);
  });

  it("keeps the wording within 6,000 characters, and the database does too", async () => {
    const hod = await visaHod();
    expect((await addLetter(hod, { body: "a".repeat(6001) })).body.issues.body).toBeDefined();
    const { id } = await letter(hod, { body: "a".repeat(6000) });
    const today = new Date(`${istToday()}T00:00:00Z`);
    await expect(prisma.coveringLetterVersion.create({ data: { formatId: id, effectiveFrom: today, body: "a".repeat(6001) } })).rejects.toThrow();
    await expect(prisma.coveringLetterVersion.create({ data: { formatId: id, effectiveFrom: today, body: "  " } })).rejects.toThrow();
  });

  it("takes a use-from day from today to a year ahead", async () => {
    const hod = await visaHod();
    const today = istToday();
    const past = await addLetter(hod, { effectiveFrom: addDays(today, -1) });
    expect(past.status).toBe(400);
    expect(past.body.issues.effectiveFrom[0]).toBe("Pick today or a later day.");
    const tooFar = await addLetter(hod, { effectiveFrom: addDays(addMonths(today, 12), 1) });
    expect(tooFar.body.issues.effectiveFrom[0]).toBe("Pick a day within a year.");
    expect((await addLetter(hod, { effectiveFrom: addMonths(today, 12) })).status).toBe(201);
  });
});

describe("which wording is in use", () => {
  it("is the latest whose day has come, the one added last on the same day, and none before the first", () => {
    const versions = [
      { id: 1, effectiveFrom: "2026-10-01" },
      { id: 2, effectiveFrom: "2026-11-01" },
      { id: 3, effectiveFrom: "2026-10-01" },
    ];
    expect(inForce(versions, "2026-09-30")).toBeNull();
    expect(inForce(versions, "2026-10-01")?.id).toBe(3);
    expect(inForce(versions, "2026-10-31")?.id).toBe(3);
    expect(inForce(versions, "2026-11-01")?.id).toBe(2);
    expect(inForce(versions, "2027-06-01")?.id).toBe(2);
    expect(inForce([], "2026-10-01")).toBeNull();
  });

  it("waits for a wording's day: the one in use stays until then", async () => {
    const hod = await visaHod();
    const { id, updatedAt, first } = await letter(hod);
    const later = addDays(istToday(), 3);
    const res = await addWording(hod, id, { body: `${WORDING}\nWith thanks.`, effectiveFrom: later, updatedAt });
    expect(res.status).toBe(201);
    expect(res.body.format.inUse.id).toBe(first.id);
    expect(res.body.format.next).toMatchObject({ effectiveFrom: later });
    expect(res.body.format.versions.map((v: Wording) => [v.effectiveFrom, v.status])).toEqual([
      [later, "SCHEDULED"],
      [istToday(), "IN_USE"],
    ]);
    const [summary] = (await hod.get("/api/masters/covering-letters")).body.formats;
    expect(summary).toMatchObject({ inUse: { id: first.id }, next: { effectiveFrom: later } });
    expect(summary.versions).toBeUndefined();
  });

  it("puts a wording from today in use at once, and keeps the earlier one to look at", async () => {
    const hod = await visaHod();
    const { id, updatedAt, first } = await letter(hod);
    const res = await addWording(hod, id, { body: `${WORDING}\nWith thanks.`, effectiveFrom: istToday(), updatedAt });
    expect(res.status).toBe(201);
    const [newer, earlier] = res.body.format.versions as Wording[];
    expect(res.body.format.inUse.id).toBe(newer!.id);
    expect(newer).toMatchObject({ status: "IN_USE", body: `${WORDING}\nWith thanks.` });
    expect(earlier).toMatchObject({ id: first.id, status: "EARLIER", body: WORDING });

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "coveringLetter.version.add" } });
    expect(entry).toMatchObject({ entityType: "CoveringLetterFormat", entityId: String(id), before: null });
    expect(entry.after).toMatchObject({ versionId: newer!.id, effectiveFrom: istToday() });
  });

  it("turns the day at midnight in India, not in UTC", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-31T18:29:00Z")); // 11:59 pm on 31 Dec in India
    const hod = await visaHod();
    const { id, updatedAt, first } = await letter(hod, { effectiveFrom: "2026-12-31" });
    const added = await addWording(hod, id, { body: `${WORDING}\nHappy new year.`, effectiveFrom: "2027-01-01", updatedAt });
    expect(added.status).toBe(201);
    expect(added.body.format.inUse.id).toBe(first.id);
    const next = added.body.format.next.id as number;

    vi.setSystemTime(new Date("2026-12-31T18:31:00Z")); // 12:01 am on 1 Jan in India, still 31 Dec in UTC
    const format = (await hod.get(`/api/masters/covering-letters/${id}`)).body.format;
    expect(format.inUse.id).toBe(next);
    expect(format.next).toBeNull();
    const removed = await hod.delete(`/api/masters/covering-letters/${id}/versions/${next}`).send({ updatedAt: format.updatedAt });
    expect(removed.status).toBe(409);
    expect(removed.body.message).toMatch(/in use since Fri 1 Jan/);
  });

  it("has none in use while its only wording is still to come", async () => {
    const hod = await visaHod();
    const later = addDays(istToday(), 5);
    const res = await addLetter(hod, { effectiveFrom: later });
    expect(res.status).toBe(201);
    expect(res.body.format).toMatchObject({ inUse: null, next: { effectiveFrom: later } });
    expect(res.body.format.versions[0].status).toBe("SCHEDULED");
  });

  it("refuses a wording that is the one already in use from that day", async () => {
    const hod = await visaHod();
    const { id, updatedAt } = await letter(hod);
    for (const day of [istToday(), addDays(istToday(), 3)]) {
      const res = await addWording(hod, id, { body: `  ${WORDING}\r\n`, effectiveFrom: day, updatedAt });
      expect(res.status, day).toBe(400);
      expect(res.body.issues.body[0]).toMatch(/already in use from that day/);
    }
  });

  it("takes one wording per later day; Change replaces it", async () => {
    const hod = await visaHod();
    const { id, updatedAt } = await letter(hod);
    const later = addDays(istToday(), 3);
    const scheduled = await addWording(hod, id, { body: `${WORDING}\nVersion 2.`, effectiveFrom: later, updatedAt });
    const v2 = scheduled.body.format.next.id as number;

    const clash = await addWording(hod, id, { body: `${WORDING}\nVersion 3.`, effectiveFrom: later, updatedAt: scheduled.body.format.updatedAt });
    expect(clash.status).toBe(400);
    expect(clash.body.issues.effectiveFrom[0]).toMatch(/^A wording already starts on .+\. Change that one instead\.$/);

    const same = await addWording(hod, id, { body: `${WORDING}\nVersion 2.`, effectiveFrom: later, replacesId: v2, updatedAt: scheduled.body.format.updatedAt });
    expect(same.body.issues.body[0]).toBe("Nothing has changed.");

    const changed = await addWording(hod, id, {
      body: `${WORDING}\nVersion 3.`,
      effectiveFrom: addDays(later, 1),
      replacesId: v2,
      updatedAt: scheduled.body.format.updatedAt,
    });
    expect(changed.status).toBe(201);
    const versions = changed.body.format.versions as Wording[];
    expect(versions.map((v) => v.id)).not.toContain(v2);
    expect(versions[0]).toMatchObject({ effectiveFrom: addDays(later, 1), status: "SCHEDULED", body: `${WORDING}\nVersion 3.` });

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "coveringLetter.version.add" }, orderBy: { id: "desc" } });
    expect(entry.before).toMatchObject({ replaced: { versionId: v2, effectiveFrom: later, body: `${WORDING}\nVersion 2.` } });
  });
});

describe("wordings that have been used are kept", () => {
  it("refuses removing one whose day has come, and the database refuses changing or removing it", async () => {
    const hod = await visaHod();
    const { id, updatedAt, first } = await letter(hod);
    const res = await hod.delete(`/api/masters/covering-letters/${id}/versions/${first.id}`).send({ updatedAt });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/^This wording has been in use since .+, so it stays on record\. Add a new wording instead\.$/);

    // Replaced by a later one from the same day, it's still kept.
    const newer = await addWording(hod, id, { body: `${WORDING}\nP.S.`, effectiveFrom: istToday(), updatedAt });
    expect((await hod.delete(`/api/masters/covering-letters/${id}/versions/${first.id}`).send({ updatedAt: newer.body.format.updatedAt })).status).toBe(409);

    await expect(prisma.coveringLetterVersion.update({ where: { id: first.id }, data: { body: "Changed" } })).rejects.toThrow(/never edited/);
    await expect(prisma.coveringLetterVersion.delete({ where: { id: first.id } })).rejects.toThrow(/never removed/);
  });

  it("removes one still to come, audited with its text", async () => {
    const hod = await visaHod();
    const { id, updatedAt } = await letter(hod);
    const later = addDays(istToday(), 3);
    const scheduled = await addWording(hod, id, { body: `${WORDING}\nVersion 2.`, effectiveFrom: later, updatedAt });
    const v2 = scheduled.body.format.next.id as number;

    const res = await hod.delete(`/api/masters/covering-letters/${id}/versions/${v2}`).send({ updatedAt: scheduled.body.format.updatedAt });
    expect(res.status).toBe(200);
    expect(res.body.format.versions).toHaveLength(1);
    expect(res.body.format.next).toBeNull();
    expect(await prisma.coveringLetterVersion.count({ where: { id: v2 } })).toBe(0);

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "coveringLetter.version.remove" } });
    expect(entry).toMatchObject({ entityType: "CoveringLetterFormat", entityId: String(id), after: null });
    expect(entry.before).toMatchObject({ versionId: v2, effectiveFrom: later, body: `${WORDING}\nVersion 2.` });
  });

  it("refuses removing a letter's only wording", async () => {
    const hod = await visaHod();
    const { id, updatedAt, first } = await letter(hod, { effectiveFrom: addDays(istToday(), 2) });
    const res = await hod.delete(`/api/masters/covering-letters/${id}/versions/${first.id}`).send({ updatedAt });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/needs a wording/);
  });

  it("refuses replacing a wording in use, and touching another letter's", async () => {
    const hod = await visaHod();
    const a = await letter(hod);
    const b = await letter(hod, { name: "Schengen · tourist · one person", party: "ONE" });

    const inUse = await addWording(hod, a.id, { body: `${WORDING}\nP.S.`, effectiveFrom: istToday(), replacesId: a.first.id, updatedAt: a.updatedAt });
    expect(inUse.status).toBe(409);
    expect(inUse.body.message).toMatch(/in use since/);

    const other = await addWording(hod, a.id, { body: `${WORDING}\nP.S.`, effectiveFrom: istToday(), replacesId: b.first.id, updatedAt: a.updatedAt });
    expect(other.status).toBe(404);
    expect((await hod.delete(`/api/masters/covering-letters/${a.id}/versions/${b.first.id}`).send({ updatedAt: a.updatedAt })).status).toBe(404);
  });
});

describe("changing a covering letter", () => {
  it("replaces its countries, writes only real changes and audits the changed fields", async () => {
    const hod = await visaHod();
    const { id, updatedAt } = await letter(hod);
    const [fr, cn] = [await countryId("FR"), await countryId("CN")];

    const res = await hod
      .patch(`/api/masters/covering-letters/${id}`)
      .send({ name: "Schengen · tourist · family", countryIds: [fr, cn], party: "SEVERAL", updatedAt });
    expect(res.status).toBe(200);
    expect(res.body.format.countries.map((c: { code: string }) => c.code)).toEqual(["CN", "FR"]);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "coveringLetter.update" } });
    expect(entry.before).toEqual({ countryIds: [fr] });
    expect(entry.after).toEqual({ countryIds: [fr, cn].sort((a, b) => a - b) });

    const unchanged = await hod.patch(`/api/masters/covering-letters/${id}`).send({ countryIds: [cn, fr], updatedAt: res.body.format.updatedAt });
    expect(unchanged.status).toBe(200);
    expect(unchanged.body.format.updatedAt).toBe(res.body.format.updatedAt);
    expect(await prisma.auditLog.count({ where: { action: "coveringLetter.update" } })).toBe(1);
  });

  it("keeps a switched-off country or visa type it already has, and refuses adding one", async () => {
    const hod = await visaHod();
    const [fr, cn] = [await countryId("FR"), await countryId("CN")];
    const { id, updatedAt } = await letter(hod, { countryIds: [fr, cn] });
    await prisma.country.update({ where: { id: cn }, data: { isActive: false } });
    await prisma.visaType.update({ where: { code: "TOURIST" }, data: { isActive: false } });

    const renamed = await hod.patch(`/api/masters/covering-letters/${id}`).send({ name: "Schengen family", updatedAt });
    expect(renamed.status).toBe(200);
    expect(renamed.body.format.countries).toHaveLength(2);
    expect(renamed.body.format.visaType.isActive).toBe(false);

    const dropped = await hod.patch(`/api/masters/covering-letters/${id}`).send({ countryIds: [fr], updatedAt: renamed.body.format.updatedAt });
    expect(dropped.status).toBe(200);
    const readded = await hod.patch(`/api/masters/covering-letters/${id}`).send({ countryIds: [fr, cn], updatedAt: dropped.body.format.updatedAt });
    expect(readded.status).toBe(400);
    expect(readded.body.issues.countryIds[0]).toBe("Pick from the active countries.");

    const business = await prisma.visaType.findUniqueOrThrow({ where: { code: "BUSINESS" } });
    const moved = await hod.patch(`/api/masters/covering-letters/${id}`).send({ visaTypeId: business.id, updatedAt: dropped.body.format.updatedAt });
    expect(moved.status).toBe(200);
    const back = await hod.patch(`/api/masters/covering-letters/${id}`).send({ visaTypeId: await visaTypeId(), updatedAt: moved.body.format.updatedAt });
    expect(back.status).toBe(400);
    expect(back.body.issues.visaTypeId[0]).toBe("Pick an active visa type.");
  });

  it("switches off and on, never deletes", async () => {
    const hod = await visaHod();
    const { id, updatedAt } = await letter(hod);
    const off = await hod.patch(`/api/masters/covering-letters/${id}`).send({ isActive: false, updatedAt });
    expect(off.body.format.isActive).toBe(false);
    expect((await hod.get("/api/masters/covering-letters?active=true")).body.formats).toHaveLength(0);
    expect((await hod.get("/api/masters/covering-letters?active=false")).body.formats).toHaveLength(1);
    expect((await hod.get(`/api/masters/covering-letters/${id}`)).status).toBe(200);
    const on = await hod.patch(`/api/masters/covering-letters/${id}`).send({ isActive: true, updatedAt: off.body.format.updatedAt });
    expect(on.body.format.isActive).toBe(true);
    expect((await hod.delete(`/api/masters/covering-letters/${id}`).send({})).status).toBe(404);
  });

  it("refuses a change made on an old copy of the letter", async () => {
    const hod = await visaHod();
    const { id, updatedAt: old, first } = await letter(hod, { effectiveFrom: addDays(istToday(), 2) });
    expect((await hod.patch(`/api/masters/covering-letters/${id}`).send({ name: "Renamed", updatedAt: old })).status).toBe(200);

    for (const res of [
      await hod.patch(`/api/masters/covering-letters/${id}`).send({ name: "Renamed again", updatedAt: old }),
      await addWording(hod, id, { body: `${WORDING}\nP.S.`, effectiveFrom: istToday(), updatedAt: old }),
      await hod.delete(`/api/masters/covering-letters/${id}/versions/${first.id}`).send({ updatedAt: old }),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.details.code).toBe("STALE");
    }
    expect((await hod.get(`/api/masters/covering-letters/${id}`)).body.format.name).toBe("Renamed");
  });

  it("lets one of two wordings saved at the same moment through, and tells the other to reload", async () => {
    const hod = await visaHod();
    const { id, updatedAt } = await letter(hod);
    const results = await Promise.all(
      ["One.", "Two."].map((end) => addWording(hod, id, { body: `${WORDING}\n${end}`, effectiveFrom: istToday(), updatedAt })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.details.code).toBe("STALE");
    expect(await prisma.coveringLetterVersion.count({ where: { formatId: id } })).toBe(2);
  });
});

describe("the sample letters", () => {
  it("are seeded once: four, after Masti's letters, used from today, set up with the system", async () => {
    await seedCoveringLetters(prisma);
    await seedCoveringLetters(prisma);
    const formats = await prisma.coveringLetterFormat.findMany({ include: { versions: true, countries: true }, orderBy: { sortOrder: "asc" } });
    expect(formats.map((f) => f.name)).toEqual(SAMPLE_LETTERS.map((s) => s.name));
    for (const f of formats) {
      expect(f.name).toMatch(/\(sample\)$/);
      expect(f.versions).toHaveLength(1);
      expect(f.versions[0]).toMatchObject({ addedById: null, effectiveFrom: new Date(`${istToday()}T00:00:00Z`) });
      expect(wordingProblem(f.versions[0]!.body), f.name).toBeNull();
    }
    expect(formats.map((f) => f.party)).toEqual(["SEVERAL", "ONE", "SEVERAL", "SEVERAL"]);
    // Every sample has {purpose}, the paragraph on why they travel (0019 amendments 2 and 4); the last is for Business.
    for (const f of formats) expect(f.versions[0]!.body, f.name).toMatch(/^\{purpose\}$/m);
    const types = await prisma.visaType.findMany({ where: { id: { in: formats.map((f) => f.visaTypeId) } } });
    expect(formats.map((f) => types.find((v) => v.id === f.visaTypeId)!.code)).toEqual(["TOURIST", "TOURIST", "TOURIST", "BUSINESS"]);

    const [first] = (await (await visaHod()).get("/api/masters/covering-letters")).body.formats;
    expect(first.inUse).toMatchObject({ effectiveFrom: istToday(), addedBy: null });
  });

  it("aren't added once any covering letter exists", async () => {
    await letter(await visaHod());
    await seedCoveringLetters(prisma);
    expect(await prisma.coveringLetterFormat.count()).toBe(1);
  });
});
