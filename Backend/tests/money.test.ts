import { describe, expect, it } from "vitest";
import { gstPaise, lineTotalPaise, quoteTotals, splitIntraState } from "../src/lib/money";

// Money in paise (docs/decisions/0009-visa-invoice.md Decisions 2 and 3): GST on the service charge only, rounded half
// up to the paisa; CGST + SGST split with the odd paisa on CGST.

describe("GST", () => {
  it("is the rate on the amount, rounded half up to the paisa", () => {
    expect(gstPaise(50_000, 18)).toBe(9_000); // ₹500 → ₹90, Masti's October invoice
    expect(gstPaise(333, 18)).toBe(60); // 59.94 paise
    expect(gstPaise(25, 18)).toBe(5); // 4.5 paise: half up
    expect(gstPaise(36, 12.5)).toBe(5); // 4.5 paise at a 2-decimal rate
    expect(gstPaise(0, 18)).toBe(0);
    expect(gstPaise(12_345, 0)).toBe(0);
  });

  it("splits into CGST and SGST, the odd paisa on CGST", () => {
    expect(splitIntraState(9_000)).toEqual({ cgstPaise: 4_500, sgstPaise: 4_500 });
    expect(splitIntraState(61)).toEqual({ cgstPaise: 31, sgstPaise: 30 });
    expect(splitIntraState(0)).toEqual({ cgstPaise: 0, sgstPaise: 0 });
  });
});

describe("quote totals", () => {
  const itemised = { form: "ITEMISED" as const, lumpSumPaise: null, embassyFeePaise: 50_000, vfsFeePaise: 80_000, otherFeePaise: 211_000 };
  const lumpSum = { form: "LUMP_SUM" as const, lumpSumPaise: 1_350_000, embassyFeePaise: null, vfsFeePaise: null, otherFeePaise: null };

  it("adds each traveller's amounts", () => {
    expect(lineTotalPaise(itemised)).toBe(341_000);
    expect(lineTotalPaise(lumpSum)).toBe(1_350_000);
  });

  it("adds GST on the service charge only", () => {
    // The October invoice: 3,410 + processing 500 + GST 90 = 4,000.
    expect(quoteTotals([itemised], 50_000, 18)).toEqual({ travellersPaise: 341_000, serviceChargePaise: 50_000, gstPaise: 9_000, totalPaise: 400_000 });
    // The August invoice: one lump sum, no service charge, no GST.
    expect(quoteTotals([lumpSum], 0, 18)).toEqual({ travellersPaise: 1_350_000, serviceChargePaise: 0, gstPaise: 0, totalPaise: 1_350_000 });
  });
});
