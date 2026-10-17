// Names for the files the CRM keeps (a refusal letter, a client's scan): what a file opens and saves under.

/**
 * Text made safe for a file name: letters and digits, with one dash for anything between them ("Aarav Mehta" →
 * "Aarav-Mehta", "Bank statement, last 6 months" → "Bank-statement-last-6-months"). Accents are dropped first. Text with
 * no Latin letters or digits at all (a name in Gujarati) becomes "", so callers leave that part out.
 */
export function fileNamePart(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
