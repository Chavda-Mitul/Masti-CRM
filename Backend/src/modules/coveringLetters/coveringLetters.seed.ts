import type { CoveringLetterParty } from "../../../generated/prisma/enums";
import type { Db } from "../../config/prisma";
import { istToday, toDbDate } from "../../lib/dates";

// Sample covering letters (docs/decisions/0019-covering-letters.md Decision 7) until Masti sends its own formats (M13):
// the demo's "3 fixed formats" ⚠️, on the seeded France (Schengen) and China Tourist visas. Their names say "(sample)"
// and their wording has no author ("set up with the system"), so the screens flag them; the Visa HOD replaces them in
// Settings before go-live. Added only while there are no covering letters at all: re-seeding never adds them again.

interface Sample {
  name: string;
  countryCodes: string[];
  visaTypeCode: string;
  party: CoveringLetterParty;
  body: string;
}

const ADDRESS = `To,
The Visa Officer,
Consulate General of {country},
Mumbai`;

const SIGN_OFF = `Yours faithfully,

{applicant}
{clientAddress}`;

export const SAMPLE_LETTERS: Sample[] = [
  {
    name: "Schengen · tourist · family (sample)",
    countryCodes: ["FR"],
    visaTypeCode: "TOURIST",
    party: "SEVERAL",
    body: `{date}

${ADDRESS}

Subject: Short-stay {visaType} visa for {applicant} and family ({travellerCount} travellers)

Dear Sir or Madam,

I, {applicant}, request a short-stay {visaType} visa for my family and myself to visit {country}. We plan to travel from {departOn} to {returnOn}, a stay of {days} days, and request a {entry}-entry visa.

The travellers are:
{travellers}

We will stay at {hotel}. I will pay for our travel and stay, and we will return to India at the end of our trip. Our documents are attached for your kind consideration.

${SIGN_OFF}`,
  },
  {
    name: "Schengen · tourist · one person (sample)",
    countryCodes: ["FR"],
    visaTypeCode: "TOURIST",
    party: "ONE",
    body: `{date}

${ADDRESS}

Subject: Short-stay {visaType} visa for {applicant}, passport no. {passportNo}

Dear Sir or Madam,

I, {applicant}, holding passport no. {passportNo}, request a short-stay {visaType} visa to visit {country} from {departOn} to {returnOn}, a stay of {days} days. I request a {entry}-entry visa.

I will stay at {hotel}. I will pay for my travel and stay, and I will return to India at the end of my trip. My documents are attached for your kind consideration.

${SIGN_OFF}`,
  },
  {
    name: "China · tourist · family (sample)",
    countryCodes: ["CN"],
    visaTypeCode: "TOURIST",
    party: "SEVERAL",
    body: `{date}

${ADDRESS}

Subject: {visaType} visa for {travellerNames}

Dear Sir or Madam,

We, the {travellerCount} travellers listed below, request a {visaType} visa to visit {country} from {departOn} to {returnOn}, a stay of {days} days, with {entry} entry.

{travellers}

We will stay at {hotel}. {applicant} will pay for our travel and stay, and we will all return to India at the end of the trip. Our documents are attached for your kind consideration.

${SIGN_OFF}`,
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
