import type { ConsentFieldKind, ConsentFixedField } from "../../../generated/prisma/enums";
import type { Db } from "../../config/prisma";

// The consent form's wording (docs/decisions/0022-consent-form.md amendment 3): written by the project lead (23 Oct
// 2026) rather than waiting for Masti's; the Head or the Visa HOD change it as a new version in Settings. And the form's
// fields (amendment 1), which they change there too. Used by prisma/seed.ts, the server's start and the tests.

/**
 * The wording clients agree to (amendment 3): Vimal's two clauses (30 Sep meeting, 7:13–7:16 PM), the authorisation to
 * act and to handle the passport, the embassy's decision, the client's details and documents, how they're used, a child
 * agreed for by a parent or guardian (amendment 2), and once for life.
 */
export const CONSENT_WORDING = [
  "Consent and liability form",
  "",
  'I ask Masti Tours & Travels ("Masti") to handle my visa applications, now and in future, and I agree to the following.',
  "",
  "1. Acting for me. I authorise Masti to fill in and submit my visa applications, book my appointments, and deal on my behalf with the embassy, the consulate, the visa centre and their agents, using the details and documents I give.",
  "",
  "2. My passport. I authorise Masti to collect and keep my current and old passports, to send them to the visa centre, the embassy, the consulate or their agent, and to receive them back. While my passport is in transit (with a courier, or at the visa centre, the embassy, the consulate or their agent) it is at my own risk. Masti is not responsible for any damage, loss, misplacement or delay that happens there.",
  "",
  "3. Bookings before the visa. Any ticket, hotel, tour or other booking made before my visa is issued is made at my own risk. If the visa is refused, delayed or issued for different dates, any cost or loss from those bookings is mine alone.",
  "",
  "4. The visa decision. Only the embassy or consulate decides whether a visa is granted, for how long, and how quickly. Masti cannot promise a visa or a date, and is not responsible for a refusal or a delay by the embassy, the consulate or the visa centre.",
  "",
  "5. My details and documents. The details shown above were given by me and are correct, and every document I give is genuine. I will tell Masti at once if anything is wrong or changes. A refusal or delay caused by wrong or missing details or documents is my own responsibility.",
  "",
  "6. Using my details. I allow Masti to keep my details and copies of my documents for my future applications, and to share them only with the embassy, the consulate, the visa centre, their agents and couriers, as my applications need. Masti may send me updates about my applications on WhatsApp or SMS.",
  "",
  '7. For a child. If I am agreeing as a parent or guardian for a child, I confirm that I may do so. This consent is then given on the child\'s behalf, and "I", "me" and "my" mean the child wherever they refer to the traveller, their passport, their details or their applications.',
  "",
  "8. For life. I give this consent once. It holds for all my visa applications with Masti, even if my passport changes.",
].join("\n");

/** The wording, only into a database with no wording yet: wordings are never changed in place. */
export async function seedConsentWording(db: Db) {
  if ((await db.consentWording.count()) > 0) return;
  await db.consentWording.create({ data: { body: CONSENT_WORDING } });
}

/**
 * The form's fields (amendment 1): the demo's (Vimal, 30 Sep meeting), then the ones he asked for at the demo (institute,
 * pass-out year, social media). Home address required ⚠️. Education is typed text: there's no dropdown kind.
 */
export const CONSENT_FIELDS: { label: string; kind: ConsentFieldKind; fixed?: ConsentFixedField; required?: boolean }[] = [
  { label: "Date of birth", kind: "DATE", fixed: "DATE_OF_BIRTH", required: true },
  { label: "Spouse’s date of birth", kind: "DATE" },
  { label: "Anniversary", kind: "DATE" },
  { label: "Mother’s date of birth", kind: "DATE" },
  { label: "Father’s date of birth", kind: "DATE" },
  { label: "Home address", kind: "LONG_TEXT", fixed: "HOME_ADDRESS", required: true },
  { label: "Office address", kind: "LONG_TEXT", fixed: "OFFICE_ADDRESS" },
  { label: "Profession", kind: "TEXT" },
  { label: "Annual income (₹)", kind: "NUMBER" },
  { label: "Education", kind: "TEXT" },
  { label: "Institute", kind: "TEXT" },
  { label: "Pass-out year", kind: "NUMBER" },
  { label: "Instagram", kind: "LINK" },
  { label: "Facebook", kind: "LINK" },
  { label: "LinkedIn", kind: "LINK" },
];

/** The fields, only into a database with none yet: after that they're the Head's and the Visa HOD's to change. */
export async function seedConsentFields(db: Db) {
  if ((await db.consentField.count()) > 0) return;
  await db.consentField.createMany({
    data: CONSENT_FIELDS.map((f, i) => ({ label: f.label, kind: f.kind, fixed: f.fixed ?? null, required: f.required ?? false, sortOrder: i + 1 })),
  });
}
