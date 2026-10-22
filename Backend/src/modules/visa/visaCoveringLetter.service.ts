import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../config/prisma";
import { askAi, AiError } from "../../lib/ai";
import { audit } from "../../lib/audit";
import { fromDbDate, istTimestamp, istToday, toDbDate } from "../../lib/dates";
import { conflict, fieldError, HttpError } from "../../lib/httpError";
import { inForce } from "../coveringLetters/coveringLetter";
import { marksIn } from "../coveringLetters/coveringLetters.schemas";
import { draftLetter, type LetterFacts } from "../coveringLetters/fill";
import { letterAsk, MAX_AI_LETTER_CHARS, tidyLetter, type TripFacts } from "../coveringLetters/letterAi";
import { swapLetter, type PrivateFacts } from "../coveringLetters/placeholders";
import type { Actor, UserWithDepartments } from "../users/user";
import { findVisibleCase, loadCase, lockCase, PREPARING } from "./caseLock";
import type { MakeCoveringLetterInput, WriteLetterInput } from "./visa.schemas";
import { getVisaSettings } from "./visa.settings";
import { clientAddress, countTravellers, travellerLabel } from "./visaCase";

// The covering letter on a visa case (docs/decisions/0019-covering-letters.md Decisions 8–12, amendments 1 and 3): the
// letters that fit the case, one drafted from it, "Make the letter" at File preparation, and the print of the letter made.
// - A letter fits a case: active, the case's visa type, one of its countries, and one traveller or two or more, with a
//   wording in use today. A visa type or country switched off since still fits, so open cases keep their letters.
// - The draft writes the case's values in and marks what it lacks (⟦the hotel stay⟧). The letter is one text, its tables
//   lines with | between the columns. Staff may change any of it and type over the marks; "Make the letter" waits while
//   a mark is left: 409 LETTER_INCOMPLETE.
// - Made at File preparation by the owner, the HOD or the Head; again as often as needed while there. The case keeps the
//   letter's text as made, so a later print is the same letter (Decision 10), and the audit keeps each text made. Anyone
//   who can open the case may print it; printing changes nothing, so it isn't audited (as the sticker, 0008 Decision 5).
// - "Write the whole letter with AI" (amendment 4) rewrites the letter as it stands, with every personal detail as a
//   placeholder the CRM fills back. It saves nothing on the case; the AI call is recorded in AiCall (0023).

const personSelect = { select: { id: true, name: true } } as const;

const letterCaseSelect = {
  id: true,
  caseNo: true,
  clientId: true,
  client: {
    select: {
      name: true,
      kind: true,
      addressLine: true,
      area: true,
      city: true,
      pincode: true,
      // For the AI's placeholders: never sent, only swapped out (amendment 4).
      contactPerson: true,
      mobile: true,
      email: true,
      pan: true,
      gstin: true,
      phones: { select: { mobile: true } },
    },
  },
  visa: {
    select: {
      departOn: true,
      returnOn: true,
      entryType: true,
      hotelStay: true,
      offering: {
        select: { countryId: true, visaTypeId: true, country: { select: { name: true } }, visaType: { select: { code: true, name: true } } },
      },
      travellers: {
        orderBy: { position: "asc" },
        select: {
          position: true,
          isChild: true,
          name: true,
          member: {
            select: {
              name: true,
              dateOfBirth: true,
              passportNumber: true,
              relation: { select: { name: true } },
              passportExpiry: true,
              mobile: true,
              residentialAddress: true,
              officeAddress: true,
            },
          },
        },
      },
      coveringLetterMadeAt: true,
      coveringLetterMadeBy: personSelect,
      coveringLetterText: true,
      coveringLetterVersion: { select: { id: true, effectiveFrom: true, format: { select: { id: true, name: true } } } },
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

/**
 * What the AI may know about the trip (amendment 4): never a name, a passport number, a date of birth or an address.
 * Built from the case on its own, not from the letter's facts, which hold all of those.
 */
function tripFactsOf(row: LetterCaseRow, visa: LetterVisa): TripFacts {
  return {
    country: visa.offering.country.name,
    visaType: { code: visa.offering.visaType.code, name: visa.offering.visaType.name },
    clientKind: row.client.kind,
    travellers: visa.travellers.map((t) => ({ relation: t.member?.relation.name ?? null, isChild: t.isChild })),
    trip: { departOn: visa.departOn && fromDbDate(visa.departOn), returnOn: visa.returnOn && fromDbDate(visa.returnOn) },
    hotelStay: visa.hotelStay,
  };
}

/** Every personal detail of the case a letter may hold, for the placeholders that keep them on the server (amendment 4). */
function privateFactsOf(row: LetterCaseRow, visa: LetterVisa): PrivateFacts {
  const { client } = row;
  const { adults } = countTravellers(visa.travellers);
  const day = (date: Date | null | undefined) => (date ? fromDbDate(date) : null);
  return {
    caseNo: row.caseNo,
    client: {
      name: client.name,
      contactPerson: client.contactPerson,
      address: clientAddress(client),
      addressLine: client.addressLine,
      pincode: client.pincode,
      mobile: client.mobile,
      phones: client.phones.map((p) => p.mobile),
      email: client.email,
      pan: client.pan,
      gstin: client.gstin,
    },
    travellers: visa.travellers.map((t) => ({
      name: t.member?.name ?? t.name,
      label: travellerLabel(t, adults),
      passportNumber: t.member?.passportNumber ?? null,
      dateOfBirth: day(t.member?.dateOfBirth),
      passportExpiry: day(t.member?.passportExpiry),
      mobile: t.member?.mobile ?? null,
      homeAddress: t.member?.residentialAddress ?? null,
      officeAddress: t.member?.officeAddress ?? null,
    })),
    dates: {
      today: istToday(),
      madeOn: visa.coveringLetterMadeAt ? istToday(visa.coveringLetterMadeAt) : null,
      departOn: day(visa.departOn),
      returnOn: day(visa.returnOn),
    },
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

/** The letter made for the case, if any, with its text. */
function madeOf(visa: LetterVisa) {
  const version = visa.coveringLetterVersion;
  if (!version || !visa.coveringLetterMadeAt || !visa.coveringLetterText) return null;
  return {
    formatId: version.format.id,
    formatName: version.format.name,
    versionId: version.id,
    effectiveFrom: fromDbDate(version.effectiveFrom),
    madeAt: visa.coveringLetterMadeAt,
    madeBy: visa.coveringLetterMadeBy,
    letter: visa.coveringLetterText,
  };
}

/**
 * The card's view: the letters that fit, the one asked for (or the one made, or the first) drafted from the case today,
 * with what the case lacks, and the letter made with its text. Anyone who can open the case.
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
      ...draftOf(pick.wording.body, row, visa, today),
    },
    made,
    /** For "No covering letter fits this case yet (Tourist · France · 2 travellers)". */
    fits: { visaType: visa.offering.visaType.name, country: visa.offering.country.name, travellers: visa.travellers.length },
  };
}

/** A wording drafted from the case: the letter, and what the case lacks. */
function draftOf(body: string, row: LetterCaseRow, visa: LetterVisa, today: string) {
  const { letter, missing } = draftLetter(body, factsOf(row, visa), today);
  return { draft: letter, missing };
}

/**
 * "Make the letter" (Decision 10, amendment 1), at File preparation: with a letter that fits, its text as staff left it,
 * once no mark is left in it. `versionId` is the wording the text started from (today's draft, or the made letter's):
 * one of that letter's wordings whose day has come. Making it again replaces the text, and the audit keeps both. Like
 * the other Step 3 ticks, it doesn't move the case's updatedAt.
 */
export async function makeCoveringLetter(caseNo: string, input: MakeCoveringLetterInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, PREPARING);
  const { visa } = await loadLetterCase(enquiry.id);
  const today = istToday();
  const letter = (await fittingLetters(visa, today)).find((l) => l.id === input.formatId);
  if (!letter) throw fieldError("formatId", "This covering letter doesn't fit this case. Pick another.");
  const version = await prisma.coveringLetterVersion.findFirst({
    where: { id: input.versionId, formatId: letter.id, effectiveFrom: { lte: toDbDate(today) } },
    select: { id: true, effectiveFrom: true },
  });
  if (!version) throw fieldError("versionId", "This letter's wording has changed. Start again to draft it from the wording in use.");
  const marks = marksIn(input.letter);
  if (marks.length > 0) {
    throw new HttpError(409, `Not ready yet. Fill these in first: ${marks.join("; ")}.`, { code: "LETTER_INCOMPLETE", missing: marks });
  }
  const before = madeOf(visa);

  await prisma.$transaction(async (tx) => {
    await lockCase(tx, enquiry.id, actor, PREPARING);
    await tx.visaCase.update({
      where: { enquiryId: enquiry.id },
      data: {
        coveringLetterVersionId: version.id,
        coveringLetterMadeAt: new Date(),
        coveringLetterMadeById: actor.user.id,
        coveringLetterText: input.letter,
      },
    });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.coveringLetter.make",
        entityType: "VisaCase",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        // The text too: it's free, so the audit is the only copy of an earlier letter once it's made again.
        ...(before && {
          before: { formatName: before.formatName, versionId: before.versionId, madeAt: istTimestamp(before.madeAt), letter: before.letter },
        }),
        after: {
          formatId: letter.id,
          formatName: letter.name,
          versionId: version.id,
          effectiveFrom: fromDbDate(version.effectiveFrom),
          letter: input.letter,
        },
        ip: actor.ip,
      },
      tx,
    );
  });
  return coveringLetterView(caseNo, actor.user, letter.id);
}

/**
 * "Write the whole letter with AI" (amendment 4), at File preparation, for the owner, the HOD or the Head: the letter as
 * it stands on the card, rewritten for the trip. Every personal detail and table goes as a placeholder and is filled
 * back; what the AI dropped is listed. Nothing is saved on the case: the card shows the letter, and staff read it before
 * making it. The call is never inside a transaction (it can take a while), and an AiError reaches the client as 503
 * AI_FAILED (middleware/error.ts).
 */
export async function writeLetter(caseNo: string, input: WriteLetterInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, PREPARING);
  const { row, visa } = await loadLetterCase(enquiry.id);
  const swap = swapLetter(input.letter, privateFactsOf(row, visa));
  // Too long to rewrite in time: refused before any call, and trying again wouldn't help.
  if (swap.text.length > MAX_AI_LETTER_CHARS) {
    throw new AiError("This letter is too long for the AI to write. Shorten it, or change it by hand.", false);
  }
  const { system, prompt } = letterAsk(tripFactsOf(row, visa), swap);
  const { text } = await askAi({
    useCase: "visa.coveringLetter.write",
    system,
    prompt,
    userId: actor.user.id,
    enquiryId: enquiry.id,
    accept: (answer) => {
      const tidied = tidyLetter(answer, swap);
      return "error" in tidied ? tidied.error : null;
    },
  });
  const tidied = tidyLetter(text, swap);
  if ("error" in tidied) throw tidied.error;
  return tidied;
}

/**
 * The letter made, to print (Decision 10): its text as made, so every print is the same letter, and the letterhead space
 * (Decision 11). Anyone who can open the case; 409 before one is made.
 */
export async function coveringLetterPrint(caseNo: string, user: UserWithDepartments) {
  const { id } = await findVisibleCase(caseNo, user);
  const [{ row, visa }, settings] = await Promise.all([loadLetterCase(id), getVisaSettings()]);
  const made = madeOf(visa);
  if (!made) throw conflict("No covering letter was made for this case yet.");
  return { caseNo: row.caseNo, ...made, letterheadMm: settings.coveringLetter.letterheadMm };
}
