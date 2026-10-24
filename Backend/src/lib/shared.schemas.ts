import { z } from "zod";

// Fields several modules' schemas validate the same way: the client's and Masti's own PAN, GSTIN and state, a person's
// name (clients, vendors), a time of day (settings, time slots), the soft-warning confirmation and the client's one-time
// code. Zod only, like every *.schemas.ts, so any module's schemas may import it and it can later be shared with the
// frontend.

/** Saving again past a soft warning (Backend/src/lib/warnings.ts): false on the first try. */
export const confirmWarnings = z.boolean().default(false);

const SIX_DIGITS = "Type the 6 digits the client reads out.";

/**
 * The code the client reads out (Backend/src/lib/oneTimeCode.ts), at the door (0015 Decision 4) or the office handover
 * (0014 Decision 2, amended 23 Oct 2026): six digits. A typo in the form isn't counted as a wrong try.
 */
export const oneTimeCodeSchema = z.object({
  code: z.string(SIX_DIGITS).trim().regex(/^\d{6}$/, SIX_DIGITS),
});

/** GST state codes (statutory, not business config). Decides the place of supply on invoices. */
export const GST_STATES = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
  { code: "97", name: "Other Territory" },
] as const;

const STATE_CODES = new Set<string>(GST_STATES.map((s) => s.code));

export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
/** Regular GSTIN: state code, PAN, entity number, "Z", check character. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * A person's name: letters in any script (with its vowel signs, so Gujarati works), and spaces, ".", "'" and "-"
 * between them. Digits and other symbols are almost always typos (decided 9 Oct 2026).
 */
export const PERSON_NAME_PATTERN = /^\p{L}[\p{L}\p{M} .'-]*$/u;
export const PERSON_NAME_MESSAGE = "Use letters only (spaces and . ' - are fine).";

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The 15th character of a GSTIN is a check character over the first 14 (base-36, alternating weights 1 and 2). */
export function gstinChecksumOk(gstin: string): boolean {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(gstin.charAt(i)) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS.charAt((36 - (sum % 36)) % 36) === gstin.charAt(14);
}

/** An email address, as loosely as mail servers accept them: something@something.something, no spaces. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Spaces dropped and capitals: how PAN, GSTIN, IFSC and the like are typed and stored. */
export const upperNoSpaces = z.string().transform((s) => s.replace(/\s+/g, "").toUpperCase());

/** The client's, and Masti's own (docs/decisions/0009-visa-invoice.md). */
export const pan = upperNoSpaces.pipe(z.string().regex(PAN_PATTERN, "Enter a valid PAN, e.g. ABCDE1234F."));
export const gstin = upperNoSpaces.pipe(
  z
    .string()
    .regex(GSTIN_PATTERN, "Enter a valid 15-character GSTIN.")
    .refine(gstinChecksumOk, "This GSTIN's last character doesn't match. Check it for a typo."),
);
export const stateCode = z.string().trim().refine((code) => STATE_CODES.has(code), "Pick a state from the list.");

/** A time of day in India, 24-hour "HH:mm": when a setting's work falls due, a field slot's start and end. */
export const timeOfDay = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour time, e.g. 11:00.");
