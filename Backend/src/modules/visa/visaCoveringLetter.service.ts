import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { fromDbDate, istTimestamp, istToday, toDbDate } from "../../lib/dates";
import { conflict, fieldError, HttpError } from "../../lib/httpError";
import { inForce } from "../coveringLetters/coveringLetter";
import { fillLetter, type LetterFacts, type LetterFill } from "../coveringLetters/fill";
import type { Actor, UserWithDepartments } from "../users/user";
import { findVisibleCase, loadCase, lockCase, PREPARING } from "./caseLock";
import type { MakeCoveringLetterInput } from "./visa.schemas";
import { getVisaSettings } from "./visa.settings";
import { clientAddress, countTravellers, travellerLabel } from "./visaCase";

// The covering letter on a visa case (docs/decisions/0019-covering-letters.md Decisions 8–12): the letters that fit the
// case, one filled in from it, "Make the letter" at File preparation, and the print of the letter made.
// - A letter fits a case: active, the case's visa type, one of its countries, and one traveller or two or more, with a
//   wording in use today. A visa type or country switched off since still fits, so open cases keep their letters.
// - Missing details block "Make the letter" (Decision 9): 409 LETTER_INCOMPLETE with the list.
// - Made at File preparation by the owner, the HOD or the Head; again as often as needed while there. The case keeps the
//   wording used and what it was filled in with, so a later print is the same letter (Decision 10). Anyone who can open
//   the case may print it; printing changes nothing, so it isn't audited (as the sticker, 0008 Decision 5).

const personSelect = { select: { id: true, name: true } } as const;

const letterCaseSelect = {
  id: true,
  caseNo: true,
  clientId: true,
  client: { select: { name: true, addressLine: true, area: true, city: true, pincode: true } },
  visa: {
    select: {
      departOn: true,
      returnOn: true,
      entryType: true,
      hotelStay: true,
      offering: { select: { countryId: true, visaTypeId: true, country: { select: { name: true } }, visaType: { select: { name: true } } } },
      travellers: {
        orderBy: { position: "asc" },
        select: {
          position: true,
          isChild: true,
          name: true,
          member: { select: { name: true, dateOfBirth: true, passportNumber: true, relation: { select: { name: true } } } },
        },
      },
      coveringLetterMadeAt: true,
      coveringLetterMadeBy: personSelect,
      coveringLetterFill: true,
      coveringLetterVersion: { select: { id: true, effectiveFrom: true, body: true, format: { select: { id: true, name: true } } } },
    },
  },
} satisfies Prisma.EnquirySelect;

type LetterCaseRow = Prisma.EnquiryGetPayload<{ select: typeof letterCaseSelect }>;
type LetterVisa = NonNullable<LetterCaseRow["visa"]>;

async function loadLetterCase(enquiryId: string) {
  const row = await prisma.enquiry.findUniqueOrThrow({ where: { id: enquiryId }, select: letterCaseSelect });
  return { row, visa: row.visa! };
}

/** What the case brings to its letter: the client, the travellers (with their family-list details) and the trip. */
function factsOf(row: LetterCaseRow, visa: LetterVisa): LetterFacts {
  const { adults } = countTravellers(visa.travellers);
  return {
    clientName: row.client.name,
    clientAddress: clientAddress(row.client),
    country: visa.offering.country.name,
    visaType: visa.offering.visaType.name,
    trip: {
      departOn: visa.departOn && fromDbDate(visa.departOn),
      returnOn: visa.returnOn && fromDbDate(visa.returnOn),
      entryType: visa.entryType,
      hotelStay: visa.hotelStay,
    },
    travellers: visa.travellers.map((t) => ({
      name: t.member?.name ?? t.name,
      label: travellerLabel(t, adults),
      relation: t.member?.relation.name ?? null,
      dateOfBirth: t.member?.dateOfBirth ? fromDbDate(t.member.dateOfBirth) : null,
      passportNumber: t.member?.passportNumber ?? null,
    })),
  };
}

/** The covering letters that fit the case today, by "Order in lists" then name, each with the wording in use. */
async function fittingLetters(visa: LetterVisa, today: string) {
  const rows = await prisma.coveringLetterFormat.findMany({
    where: {
      isActive: true,
      visaTypeId: visa.offering.visaTypeId,
      party: visa.travellers.length === 1 ? "ONE" : "SEVERAL",
      countries: { some: { countryId: visa.offering.countryId } },
    },
    select: {
      id: true,
      name: true,
      versions: { where: { effectiveFrom: { lte: toDbDate(today) } }, select: { id: true, effectiveFrom: true, body: true, addedById: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.flatMap((f) => {
    const wording = inForce(
      f.versions.map((v) => ({ ...v, effectiveFrom: fromDbDate(v.effectiveFrom) })),
      today,
    );
    return wording ? [{ id: f.id, name: f.name, wording }] : [];
  });
}

/** The letter made for the case, if any. */
function madeOf(visa: LetterVisa) {
  const version = visa.coveringLetterVersion;
  if (!version || !visa.coveringLetterMadeAt) return null;
  return {
    formatId: version.format.id,
    formatName: version.format.name,
    versionId: version.id,
    effectiveFrom: fromDbDate(version.effectiveFrom),
    madeAt: visa.coveringLetterMadeAt,
    madeBy: visa.coveringLetterMadeBy,
  };
}

/**
 * The card's view: the letters that fit, the one asked for (or the one made, or the first) filled in from the case today,
 * with what's missing, and the letter made. Anyone who can open the case.
 */
export async function coveringLetterView(caseNo: string, user: UserWithDepartments, formatId?: number) {
  const { id } = await findVisibleCase(caseNo, user);
  const { row, visa } = await loadLetterCase(id);
  const today = istToday();
  const letters = await fittingLetters(visa, today);
  const made = madeOf(visa);
  const pick = letters.find((l) => l.id === formatId) ?? letters.find((l) => l.id === made?.formatId) ?? letters[0] ?? null;
  return {
    letters: letters.map((l) => ({ id: l.id, name: l.name, sample: l.wording.addedById === null })),
    selected: pick && {
      formatId: pick.id,
      name: pick.name,
      versionId: pick.wording.id,
      effectiveFrom: pick.wording.effectiveFrom,
      sample: pick.wording.addedById === null,
      body: pick.wording.body,
      ...fillLetter(pick.wording.body, factsOf(row, visa), today),
    },
    made,
    /** For "No covering letter fits this case yet (Tourist · France · 2 travellers)". */
    fits: { visaType: visa.offering.visaType.name, country: visa.offering.country.name, travellers: visa.travellers.length },
  };
}

/**
 * "Make the letter" (Decision 10), at File preparation: with a letter that fits, once nothing it needs is missing. Keeps
 * the wording used and what it was filled in with; making it again replaces them, and the audit keeps the earlier one.
 * Like the other Step 3 ticks, it doesn't move the case's updatedAt.
 */
export async function makeCoveringLetter(caseNo: string, input: MakeCoveringLetterInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, PREPARING);
  const { row, visa } = await loadLetterCase(enquiry.id);
  const today = istToday();
  const letter = (await fittingLetters(visa, today)).find((l) => l.id === input.formatId);
  if (!letter) throw fieldError("formatId", "This covering letter doesn't fit this case. Pick another.");
  const { values, travellers, missing } = fillLetter(letter.wording.body, factsOf(row, visa), today);
  if (missing.length > 0) {
    throw new HttpError(409, `Not ready yet. Still needed: ${missing.join("; ")}.`, { code: "LETTER_INCOMPLETE", missing });
  }
  const fill: LetterFill = { values, travellers };
  const before = madeOf(visa);

  await prisma.$transaction(async (tx) => {
    await lockCase(tx, enquiry.id, actor, PREPARING);
    await tx.visaCase.update({
      where: { enquiryId: enquiry.id },
      data: {
        coveringLetterVersionId: letter.wording.id,
        coveringLetterMadeAt: new Date(),
        coveringLetterMadeById: actor.user.id,
        coveringLetterFill: fill as unknown as Prisma.InputJsonValue,
      },
    });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.coveringLetter.make",
        entityType: "VisaCase",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        ...(before && { before: { formatName: before.formatName, versionId: before.versionId, madeAt: istTimestamp(before.madeAt) } }),
        after: { formatId: letter.id, formatName: letter.name, versionId: letter.wording.id, effectiveFrom: letter.wording.effectiveFrom },
        ip: actor.ip,
      },
      tx,
    );
  });
  return coveringLetterView(caseNo, actor.user, letter.id);
}

/**
 * The letter made, to print (Decision 10): its wording and what it was filled in with when made, so every print is the
 * same letter, and the letterhead space (Decision 11). Anyone who can open the case; 409 before one is made.
 */
export async function coveringLetterPrint(caseNo: string, user: UserWithDepartments) {
  const { id } = await findVisibleCase(caseNo, user);
  const [{ row, visa }, settings] = await Promise.all([loadLetterCase(id), getVisaSettings()]);
  const made = madeOf(visa);
  if (!made || !visa.coveringLetterVersion || !visa.coveringLetterFill) throw conflict("No covering letter was made for this case yet.");
  // Written by makeCoveringLetter only, in this shape.
  const fill = visa.coveringLetterFill as unknown as LetterFill;
  return {
    caseNo: row.caseNo,
    ...made,
    body: visa.coveringLetterVersion.body,
    values: fill.values,
    travellers: fill.travellers,
    letterheadMm: settings.coveringLetter.letterheadMm,
  };
}
