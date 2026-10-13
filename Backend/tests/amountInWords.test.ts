import { describe, expect, it } from "vitest";
import { amountInWords } from "../src/lib/amountInWords";

// The invoice's amount in words (docs/decisions/0009-visa-invoice.md Decision 7), Indian numbering.

describe("amount in words", () => {
  it("reads whole rupees the way Masti's invoices do", () => {
    expect(amountInWords(400_000)).toBe("Four Thousand Rupees");
    expect(amountInWords(1_350_000)).toBe("Thirteen Thousand Five Hundred Rupees");
    expect(amountInWords(0)).toBe("Zero Rupees");
    expect(amountInWords(100)).toBe("One Rupee");
    expect(amountInWords(500)).toBe("Five Rupees");
  });

  it("uses lakh and crore", () => {
    expect(amountInWords(10_000_000)).toBe("One Lakh Rupees");
    expect(amountInWords(12_345_600)).toBe("One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees");
    expect(amountInWords(12_345_678_950)).toBe(
      "Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Rupees and Fifty Paise",
    );
    expect(amountInWords(1_000_000_000_000)).toBe("One Thousand Crore Rupees");
  });

  it("adds the paise", () => {
    expect(amountInWords(200_050)).toBe("Two Thousand Rupees and Fifty Paise");
    expect(amountInWords(5)).toBe("Zero Rupees and Five Paise");
    expect(amountInWords(941_050)).toBe("Nine Thousand Four Hundred Ten Rupees and Fifty Paise");
  });
});
