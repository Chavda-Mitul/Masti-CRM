import type { Db } from "../../config/prisma";

// The consent form's wording (docs/decisions/0022-consent-form.md): a draft until Masti sends its own (Q9/M12), which the
// Head or the Visa HOD then adds as a new version in Settings. Used by prisma/seed.ts, the server's start and the tests.

/** My draft of Vimal's two clauses (30 Sep meeting, 7:13–7:16 PM) and the passport authorisation. */
export const DRAFT_CONSENT_WORDING = [
  "Consent and liability form",
  "",
  "I ask Masti Tours & Travels to handle my visa applications, now and in future.",
  "",
  "1. My passport. I authorise Masti Tours & Travels to collect and keep my passport, and my old passports, to send them to the visa centre, the embassy or their agent, and to receive them back. While my passport is in transit (by courier, or at the visa centre, the embassy or their agent) it is at my own risk. Masti Tours & Travels is not responsible for any damage, loss, misplacement or delay that happens there.",
  "",
  "2. Bookings before the visa. Any ticket, hotel or other booking made before my visa is issued is made at my own risk. If the visa is refused or delayed, any loss from those bookings is mine alone.",
  "",
  "3. My details. The details shown above were given by me and are correct.",
  "",
  "4. For life. I give this consent once. It holds for all my visa applications with Masti Tours & Travels, even if my passport changes.",
].join("\n");

/** The draft, only into a database with no wording yet: wordings are never changed in place. */
export async function seedConsentWording(db: Db) {
  if ((await db.consentWording.count()) > 0) return;
  await db.consentWording.create({ data: { body: DRAFT_CONSENT_WORDING } });
}
