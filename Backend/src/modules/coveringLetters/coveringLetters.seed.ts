import type { CoveringLetterParty } from "../../../generated/prisma/enums";
import type { Db } from "../../config/prisma";
import { istToday, toDbDate } from "../../lib/dates";

// Sample covering letters (docs/decisions/0019-covering-letters.md Decision 7, amendment 2) until the Visa HOD replaces
// them with Masti's own (M13). Their wording follows the two letters Masti sent on 21 Oct 2026 (a France tourist and a
// France business letter), with {purpose} where "Write it with AI" writes why they travel: three tourist letters on the
// seeded France (Schengen) and China visas, and a business one for France. Their names say "(sample)" and their wording
// has no author ("set up with the system"), so the screens flag them. Added only while there are no covering letters at
// all: re-seeding never adds them again.

interface Sample {
  name: string;
  countryCodes: string[];
  visaTypeCode: string;
  party: CoveringLetterParty;
  body: string;
}

const ADDRESS = `To,
The Visa Officer,
The Consulate General of {country},
Mumbai, India.`;

const SIGN_OFF = `Thanking you in anticipation,

Yours truly,

{applicant}
{clientAddress}`;

/** A family's tourist letter, after Masti's France tourist letter. */
const familyTourist = `{date}

${ADDRESS}

Sub: Application for a {visaType} visa

Respected Sir/Madam,

I, the undersigned, {applicant}, am applying for a {visaType} visa for {country} for my family and myself.

{purpose}

The passport details are below:
{travellers}

We would like to travel to {country} from {departOn} to {returnOn}, a stay of {days} days, and we request a {entry}-entry visa.

All the expenses of our trip will be borne by me.

During our visit we will stay at {hotel}.

I have attached the visa application forms, duly filled in and signed, with our valid passports, photographs and the relevant documents for your perusal.

I kindly request you to grant us the visas at the earliest.

${SIGN_OFF}`;

export const SAMPLE_LETTERS: Sample[] = [
  {
    name: "Schengen · tourist · family (sample)",
    countryCodes: ["FR"],
    visaTypeCode: "TOURIST",
    party: "SEVERAL",
    body: familyTourist,
  },
  {
    name: "Schengen · tourist · one person (sample)",
    countryCodes: ["FR"],
    visaTypeCode: "TOURIST",
    party: "ONE",
    body: `{date}

${ADDRESS}

Sub: Application for a {visaType} visa

Respected Sir/Madam,

I, the undersigned, {applicant}, am applying for a {visaType} visa for {country}.

{purpose}

The passport details are below:
{travellers}

I would like to travel to {country} from {departOn} to {returnOn}, a stay of {days} days, and I request a {entry}-entry visa.

All the expenses of my trip will be borne by me.

During my visit I will stay at {hotel}.

I have attached the visa application form, duly filled in and signed, with my valid passport, photographs and the relevant documents for your perusal.

I kindly request you to grant me the visa at the earliest.

${SIGN_OFF}`,
  },
  {
    name: "China · tourist · family (sample)",
    countryCodes: ["CN"],
    visaTypeCode: "TOURIST",
    party: "SEVERAL",
    body: familyTourist,
  },
  {
    // After Masti's France business letter: colleagues rather than a family, and the company pays. The table's
    // "Relation" heading is changed to "Designation" on the case, as the letter is edited.
    name: "Schengen · business · group (sample)",
    countryCodes: ["FR"],
    visaTypeCode: "BUSINESS",
    party: "SEVERAL",
    body: `{date}

${ADDRESS}

Sub: Application for a {visaType} visa

Dear Sir/Madam,

I, the undersigned, {applicant}, am applying for {visaType} visas for {country} for my colleagues and myself.

{purpose}

The passport details are below:
{travellers}

We would like to travel to {country} from {departOn} to {returnOn}, a stay of {days} days, and we request a {entry}-entry visa.

All the expenses of our travel and stay will be borne by our company.

During our visit we will stay at {hotel}.

We have attached the visa application forms, duly filled in and signed, with our valid passports, photographs and the relevant documents for your perusal.

We kindly request you to consider our applications; your cooperation will be highly appreciated.

Thanking you,

Yours faithfully,

{applicant}
{clientAddress}`,
  },
];

export async function seedCoveringLetters(db: Db) {
  if ((await db.coveringLetterFormat.count()) > 0) return;
  const today = toDbDate(istToday());
  for (const [i, sample] of SAMPLE_LETTERS.entries()) {
    const [countries, visaType] = await Promise.all([
      db.country.findMany({ where: { code: { in: sample.countryCodes } }, select: { id: true } }),
      db.visaType.findUnique({ where: { code: sample.visaTypeCode }, select: { id: true } }),
    ]);
    // The visa masters' seed runs first, so these are there; the check only keeps an odd database from stopping the seed.
    if (!visaType || countries.length !== sample.countryCodes.length) continue;
    await db.coveringLetterFormat.create({
      data: {
        name: sample.name,
        visaTypeId: visaType.id,
        party: sample.party,
        sortOrder: i + 1,
        countries: { create: countries.map((c) => ({ countryId: c.id })) },
        versions: { create: { effectiveFrom: today, body: sample.body } },
      },
    });
  }
}
