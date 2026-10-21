import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normaliseMobile } from "../src/lib/contact";
import { PASSPORT_PATTERN } from "../src/modules/clients/clients.schemas";
import { GSTIN_PATTERN, gstinChecksumOk, PAN_PATTERN } from "../src/lib/shared.schemas";
import {
  LETTER_BLANKS,
  MARK_CLOSE,
  MARK_OPEN,
  MAX_LETTER_CELL_CHARS,
  MAX_LETTER_CHARS,
  MAX_LETTER_COLUMNS,
  MAX_LETTER_COUNTRIES,
  MAX_LETTER_HEADING_CHARS,
  MAX_LETTER_PART_CHARS,
  MAX_LETTER_ROWS,
  marksIn,
  normaliseWording,
  wordingProblem,
  type LetterText,
} from "../src/modules/coveringLetters/coveringLetters.schemas";
import { MAX_CONSENT_WORDING_CHARS } from "../src/modules/consent/consent.schemas";
import { MAX_RANGE_DAYS, MAX_TARGETS } from "../src/modules/holidays/holidays.schemas";
import { MAX_VENDOR_COUNTRIES } from "../src/modules/vendors/vendors.schemas";
import { MAX_CHECKLIST_ITEMS } from "../src/modules/visaMasters/visaMasters.schemas";
import { childAgeSchema, collectionCheckSchema, firstFollowUpSchema, passportValiditySchema } from "../src/modules/visa/visa.schemas";

// The client forms repeat some backend rules so they can show errors before saving
// (Frontend/src/pages/clients/schemas.ts). This keeps the two copies from drifting apart.
// The path is a variable so the backend typecheck doesn't pull in Frontend sources; Vitest loads it at runtime.

const frontendSchemas = resolve(__dirname, "../../Frontend/src/pages/clients/schemas.ts");
const frontendMasterSchemas = resolve(__dirname, "../../Frontend/src/pages/settings/masters/schemas.ts");
const frontendLetter = resolve(__dirname, "../../Frontend/src/lib/letter.ts");
const frontendInstalled = existsSync(resolve(__dirname, "../../Frontend/node_modules/zod"));

interface FrontendRules {
  normaliseMobile(input: string): string | null;
  gstinChecksumOk(gstin: string): boolean;
  PAN_PATTERN: RegExp;
  GSTIN_PATTERN: RegExp;
  PASSPORT_PATTERN: RegExp;
}

const MOBILES = ["98250 41234", "098250-41234", "+91 98250 41234", "919825041234", "5825041234", "98250", "9825041234567", "", "abc"];
const GSTINS = ["24AAACS1234K1Z5", "24AAACS1234K1ZA", "27AAPFU0939F1ZV", "27AAPFU0939F1Z0", "24aaacs1234k1z5"];
const PANS = ["ABCDE1234F", "ABCD1234F", "abcde1234f", "ABCDE12345"];
const PASSPORTS = ["Z1234567", "N12345", "ABC12", "A1234567890123"];
const WORDINGS = [
  "Dear Sir,\r\n\r\n{travellers}\r\nThanks ",
  "  {travellers}  \nI, {applicant}, holding {passportNo}",
  "The travellers: {travellers}",
  "{travellers}\n{travellers}",
  "I, {APPLICANT}",
  "I, {{applicant}}",
  "Empty {} here",
  "Half {applicant",
  "Half applicant}",
  "{ applicant }",
  "From {departOn} to {returnOn}, {days} days, {entry} entry, at {hotel}.",
  "",
];

describe.skipIf(!frontendInstalled)("frontend form rules match the backend", () => {
  it("normalises mobiles and checks PAN, GSTIN and passport numbers the same way", async () => {
    const frontend = (await import(frontendSchemas)) as FrontendRules;
    for (const m of MOBILES) expect(frontend.normaliseMobile(m), m).toBe(normaliseMobile(m));
    for (const g of GSTINS) expect(frontend.gstinChecksumOk(g), g).toBe(gstinChecksumOk(g));
    expect(frontend.PAN_PATTERN.source).toBe(PAN_PATTERN.source);
    expect(frontend.GSTIN_PATTERN.source).toBe(GSTIN_PATTERN.source);
    expect(frontend.PASSPORT_PATTERN.source).toBe(PASSPORT_PATTERN.source);
    for (const p of PANS) expect(frontend.PAN_PATTERN.test(p), p).toBe(PAN_PATTERN.test(p));
    for (const p of PASSPORTS) expect(frontend.PASSPORT_PATTERN.test(p), p).toBe(PASSPORT_PATTERN.test(p));
  });

  it("limits holidays, checklists, vendors, covering letters and the consent wording the same way (Settings → Masters)", async () => {
    const frontend = (await import(frontendMasterSchemas)) as {
      MAX_RANGE_DAYS: number;
      MAX_TARGETS: number;
      MAX_CHECKLIST_ITEMS: number;
      MAX_VENDOR_COUNTRIES: number;
      MAX_LETTER_CHARS: number;
      MAX_LETTER_COUNTRIES: number;
      MAX_CONSENT_WORDING_CHARS: number;
    };
    expect(frontend.MAX_CONSENT_WORDING_CHARS).toBe(MAX_CONSENT_WORDING_CHARS);
    expect(frontend.MAX_RANGE_DAYS).toBe(MAX_RANGE_DAYS);
    expect(frontend.MAX_TARGETS).toBe(MAX_TARGETS);
    expect(frontend.MAX_CHECKLIST_ITEMS).toBe(MAX_CHECKLIST_ITEMS);
    expect(frontend.MAX_VENDOR_COUNTRIES).toBe(MAX_VENDOR_COUNTRIES);
    expect(frontend.MAX_LETTER_CHARS).toBe(MAX_LETTER_CHARS);
    expect(frontend.MAX_LETTER_COUNTRIES).toBe(MAX_LETTER_COUNTRIES);
  });

  it("checks covering-letter wordings the same way: the same blanks and the same messages", async () => {
    const frontend = (await import(frontendMasterSchemas)) as {
      LETTER_BLANKS: readonly { token: string }[];
      normaliseWording(body: string): string;
      wordingProblem(body: string): string | null;
    };
    expect(frontend.LETTER_BLANKS.map((b) => b.token)).toEqual([...LETTER_BLANKS]);
    for (const body of WORDINGS) {
      expect(frontend.wordingProblem(body), body).toBe(wordingProblem(body));
      expect(frontend.normaliseWording(body), body).toBe(normaliseWording(body));
    }
  });
  it("finds a case letter's marks and limits it the same way (0019 amendment 1)", async () => {
    const frontend = (await import(frontendLetter)) as {
      MARK_OPEN: string;
      MARK_CLOSE: string;
      MAX_LETTER_PART_CHARS: number;
      MAX_LETTER_COLUMNS: number;
      MAX_LETTER_ROWS: number;
      MAX_LETTER_HEADING_CHARS: number;
      MAX_LETTER_CELL_CHARS: number;
      marksIn(letter: LetterText): string[];
    };
    expect([frontend.MARK_OPEN, frontend.MARK_CLOSE]).toEqual([MARK_OPEN, MARK_CLOSE]);
    expect(frontend.MAX_LETTER_PART_CHARS).toBe(MAX_LETTER_PART_CHARS);
    expect(frontend.MAX_LETTER_COLUMNS).toBe(MAX_LETTER_COLUMNS);
    expect(frontend.MAX_LETTER_ROWS).toBe(MAX_LETTER_ROWS);
    expect(frontend.MAX_LETTER_HEADING_CHARS).toBe(MAX_LETTER_HEADING_CHARS);
    expect(frontend.MAX_LETTER_CELL_CHARS).toBe(MAX_LETTER_CELL_CHARS);
    const letters: LetterText[] = [
      { top: "We stay at ⟦the hotel stay⟧ for ⟦the number of days⟧ days.", table: null, bottom: "" },
      { top: "Hotel [Opera], Paris", table: { columns: ["Name", "⟦heading⟧"], rows: [["⟦Adult 2's name⟧", "x⟧"]] }, bottom: "⟦half" },
      { top: "⟦ ⟧ and ⟦the hotel stay⟧ twice: ⟦the hotel stay⟧", table: null, bottom: "" },
      { top: "⟦a\nb⟧", table: null, bottom: "" },
      { top: "", table: null, bottom: "" },
    ];
    for (const letter of letters) expect(frontend.marksIn(letter), JSON.stringify(letter)).toEqual(marksIn(letter));
  });

  it("checks the visa timings and the warnings' values the same way (Settings → Visa)", async () => {
    type Check = { safeParse(value: unknown): { success: boolean } };
    const frontend = (await import(frontendMasterSchemas)) as { visaTimingsFormSchema: { shape: Record<string, Check> } };
    const shape = frontend.visaTimingsFormSchema.shape;
    const timings = [
      { afterDays: 0, at: "11:00" },
      { afterDays: 30, at: "23:59" },
      { afterDays: 31, at: "11:00" },
      { afterDays: -1, at: "11:00" },
      { afterDays: 1.5, at: "11:00" },
      { afterDays: 1, at: "24:00" },
      { afterDays: 1, at: "9:00" },
    ];
    for (const t of timings) {
      for (const key of ["firstFollowUp", "vendorConfirm", "arrivalCheck", "handoverCheck"]) {
        expect(shape[key]!.safeParse(t).success, `${key} ${JSON.stringify(t)}`).toBe(firstFollowUpSchema.safeParse(t).success);
      }
      const before = { daysBefore: t.afterDays, at: t.at };
      expect(shape.collectionCheck!.safeParse(before).success, JSON.stringify(before)).toBe(collectionCheckSchema.safeParse(before).success);
    }
    for (const months of [0, 6, 24, 25, -1, 2.5]) {
      const v = { monthsAfterReturn: months };
      expect(shape.passportValidity!.safeParse(v).success, `months ${months}`).toBe(passportValiditySchema.safeParse(v).success);
    }
    for (const age of [0, 1, 18, 25, 26, 17.5]) {
      const v = { adultFrom: age };
      expect(shape.childAge!.safeParse(v).success, `age ${age}`).toBe(childAgeSchema.safeParse(v).success);
    }
  });
});
