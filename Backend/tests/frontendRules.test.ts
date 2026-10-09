import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normaliseMobile } from "../src/lib/contact";
import { GSTIN_PATTERN, gstinChecksumOk, PAN_PATTERN, PASSPORT_PATTERN } from "../src/modules/clients/clients.schemas";

// The client forms repeat some backend rules so they can show errors before saving
// (Frontend/src/pages/clients/schemas.ts). This keeps the two copies from drifting apart.
// The path is a variable so the backend typecheck doesn't pull in Frontend sources; Vitest loads it at runtime.

const frontendSchemas = resolve(__dirname, "../../Frontend/src/pages/clients/schemas.ts");
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
});
