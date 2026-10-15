import { PDFPage, type PDFFont } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInvoicePdf, type InvoiceView } from "../src/modules/visa/invoicePdf";

// The invoice PDF's layout (docs/decisions/0009-visa-invoice.md): whatever the terms setting allows, every line lands
// inside the page's margins. A raised invoice can never be made again, so nothing may fall off it.

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 36;

interface Drawn {
  page: PDFPage;
  text: string;
  /** The baseline, from the page's bottom (pdf-lib's coordinates). */
  y: number;
  left: number;
  right: number;
}

let drawn: Drawn[] = [];
beforeEach(() => {
  drawn = [];
  const original = PDFPage.prototype.drawText;
  vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, text, options) {
    const font = options!.font as PDFFont;
    const left = options!.x ?? 0;
    drawn.push({ page: this, text, y: options!.y ?? 0, left, right: left + font.widthOfTextAtSize(text, options!.size ?? 9) });
    return original.call(this, text, options);
  });
});
afterEach(() => vi.restoreAllMocks());

/** The most the terms setting allows: 10 terms of 200 characters, each wrapping onto three lines. */
const sentence =
  "Visa fees, embassy charges and VFS service charges once paid are not refundable under any circumstances, including refusal of the visa, delay in processing or a change in the travel plans.";
const LONGEST_TERMS = Array.from({ length: 10 }, (_, i) => `Term ${i + 1}. ${sentence}`.slice(0, 200));

function view(terms: string[], travellers: number): InvoiceView {
  return {
    invoiceNo: "MVI00000001",
    issuedOn: "2026-10-15",
    preparedBy: "Aarti Patel",
    company: {
      name: "MASTI TOUR AND TRAVEL",
      address: "12, Example Complex, Ring Road, Surat 395002, Gujarat",
      phone: "0261 1234567",
      phone2: "98250 00000",
      email: "info@example.test",
      website: "www.example.test",
      pan: "ABCDE1234F",
      gstin: "24ABCDE1234F1Z5",
      bank: { accountName: "Test Travels", accountNo: "123456789012", bankName: "Test Bank", branch: "Varachha", ifsc: "TEST0000123", swift: null },
    },
    client: {
      name: "Rakesh Mehta",
      contactPerson: null,
      addressLines: ["12, Test Society", "Surat 395007"],
      stateCode: "24",
      stateName: "Gujarat",
      mobile: "+919825041234",
      pan: null,
      gstin: null,
    },
    placeOfSupply: { code: "24", name: "Gujarat" },
    taxType: "INTRA_STATE",
    sac: "998559",
    gstRatePercent: 18,
    lines: Array.from({ length: travellers }, (_, i) => ({
      position: i + 1,
      name: `Traveller ${i + 1}`,
      description: "FRANCE(TOURIST)(NORMAL)(SINGLE)",
      form: "LUMP_SUM" as const,
      lumpSumPaise: 200_000,
      embassyFeePaise: null,
      vfsFeePaise: null,
      otherFeePaise: null,
      totalPaise: 200_000,
    })),
    grossPaise: travellers * 200_000,
    serviceChargePaise: 50_000,
    cgstPaise: 4_500,
    sgstPaise: 4_500,
    igstPaise: 0,
    totalPaise: travellers * 200_000 + 59_000,
    terms,
  };
}

const render = (terms: string[], travellers: number) => renderInvoicePdf(view(terms, travellers), { logo: null, signature: null });

/** Lines drawn outside the margins: below the bottom one, or past the right one. */
const outside = () => drawn.filter((d) => d.y < MARGIN || d.y > A4.height || d.right > A4.width - MARGIN + 0.5).map((d) => d.text);

describe("the invoice PDF's layout", () => {
  it("keeps the longest terms the setting allows inside the page, whatever fills it before them", async () => {
    // These travellers' counts once left the terms partly below the page (the room kept was one line per term).
    for (const travellers of [2, 4, 6, 8, 10, 12]) {
      drawn = [];
      const { pageCount } = await render(LONGEST_TERMS, travellers);
      expect(outside(), `${travellers} travellers`).toEqual([]);
      for (let i = 1; i <= 10; i++) expect(drawn.some((d) => d.text.startsWith(`# Term ${i}.`)), `term ${i}, ${travellers} travellers`).toBe(true);
      // The terms and their heading stay together on one page.
      const heading = drawn.find((d) => d.text === "Terms :")!;
      const termPages = new Set(drawn.filter((d) => d.text.startsWith("# Term")).map((d) => d.page));
      expect([...termPages], `${travellers} travellers`).toEqual([heading.page]);
      expect(pageCount).toBeGreaterThanOrEqual(1);
    }
  });

  it("breaks a word too long for its line (a long web address) instead of running off the right edge", async () => {
    const address = `https://www.example.test/${"visa-refund-policy-".repeat(9)}`;
    await render([`Read the full policy at ${address}`], 2);
    expect(outside()).toEqual([]);
    const termLines = drawn.filter((d) => d.left === MARGIN && /refund|policy|https/.test(d.text)).map((d) => d.text);
    expect(termLines.length).toBeGreaterThan(1);
    expect(termLines.join("").replace("# Read the full policy at", "")).toBe(address);
  });
});
