import { z } from "zod";

// The client's consent page (docs/decisions/0022-consent-form.md, part 2). The token comes in the body, never the
// path, so the request log never holds it.

const token = z.string("This link isn't valid.").trim().min(20, "This link isn't valid.").max(100, "This link isn't valid.");

export const consentViewSchema = z.object({ token });

/** What the page showed: the wording's version and the details' fingerprint, so the client agrees only to what they read. */
export const consentAgreeSchema = z.object({
  token,
  wordingId: z.number("Please read the form again.").int().positive(),
  detailsHash: z.string("Please read the form again.").regex(/^[0-9a-f]{64}$/, "Please read the form again."),
});

/** The longest wording, as the database allows (ConsentWording_body_text). The frontend keeps the same limit. */
export const MAX_CONSENT_WORDING_CHARS = 8000;

/** A new version of the wording (part 2b), made from the version in use when the editor opened (basedOnId). */
export const addConsentWordingSchema = z.object({
  body: z
    .string("Write the wording.")
    .trim()
    .min(1, "Write the wording.")
    .max(MAX_CONSENT_WORDING_CHARS, `At most ${MAX_CONSENT_WORDING_CHARS.toLocaleString("en-IN")} characters.`),
  basedOnId: z.number("Reload the page and try again.").int().positive(),
});

export type AddConsentWordingInput = z.infer<typeof addConsentWordingSchema>;
