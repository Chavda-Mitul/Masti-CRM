import fontkit from "@pdf-lib/fontkit";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import { amountInWords } from "../../lib/amountInWords";
import type { BankDetails } from "../company/company.schemas";

// The visa tax invoice as a PDF (docs/decisions/0009-visa-invoice.md Decision 7): A4, in the layout of Masti's current
// voucher (Masti-CRM-Handover/references/invoices/), made once when the invoice is raised and never regenerated. It
// only draws a snapshot: every word and amount on it was decided before it is called.

// ---------------------------------------------------------------------------
// Fonts: Noto Sans (SIL Open Font Licence, Backend/assets/fonts/OFL.txt), for the ₹ sign and clean text. It covers Latin
// (and Greek, Cyrillic) but not Gujarati, so raising checks every printed text first (unprintable below).
// ---------------------------------------------------------------------------

/** src/modules/visa when run with tsx, dist/src/modules/visa when built: the fonts sit in Backend/assets/fonts. */
const FONT_DIR = [resolve(__dirname, "../../../assets/fonts"), resolve(__dirname, "../../../../assets/fonts")].find((dir) =>
  existsSync(resolve(dir, "NotoSans-Regular.ttf")),
);

let fontBytes: { regular: Buffer; bold: Buffer } | undefined;
function fonts() {
  if (!FONT_DIR) throw new Error("The invoice fonts are missing: Backend/assets/fonts/NotoSans-*.ttf");
  fontBytes ??= {
    regular: readFileSync(resolve(FONT_DIR, "NotoSans-Regular.ttf")),
    bold: readFileSync(resolve(FONT_DIR, "NotoSans-Bold.ttf")),
  };
  return fontBytes;
}

let glyphs: { hasGlyphForCodePoint(codePoint: number): boolean } | undefined;

/** The characters of `text` the invoice font can't print (e.g. Gujarati letters), each once. */
export function unprintable(text: string): string[] {
  glyphs ??= fontkit.create(fonts().regular);
  const missing = new Set<string>();
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (/\s/.test(ch)) continue;
    if (!glyphs.hasGlyphForCodePoint(code)) missing.add(ch);
  }
  return [...missing];
}

// ---------------------------------------------------------------------------
// What the invoice prints
// ---------------------------------------------------------------------------

export interface InvoiceParty {
  name: string;
  contactPerson: string | null;
  addressLines: string[];
  stateCode: string | null;
  stateName: string | null;
  mobile: string | null;
  pan: string | null;
  gstin: string | null;
}

export interface InvoiceCompany {
  name: string;
  address: string;
  phone: string;
  phone2: string | null;
  email: string | null;
  website: string | null;
  pan: string | null;
  gstin: string | null;
  bank: BankDetails | null;
}

export interface InvoiceLineView {
  position: number;
  name: string;
  description: string;
  form: "LUMP_SUM" | "ITEMISED";
  lumpSumPaise: number | null;
  embassyFeePaise: number | null;
  vfsFeePaise: number | null;
  otherFeePaise: number | null;
  totalPaise: number;
}

export interface InvoiceView {
  invoiceNo: string;
  /** YYYY-MM-DD (IST) */
  issuedOn: string;
  preparedBy: string;
  company: InvoiceCompany;
  client: InvoiceParty;
  placeOfSupply: { code: string; name: string };
  taxType: "INTRA_STATE" | "INTER_STATE";
  sac: string;
  gstRatePercent: number;
  lines: InvoiceLineView[];
  grossPaise: number;
  serviceChargePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  terms: string[];
}

/**
 * Which document the layout prints: the tax invoice, or a credit note against one (docs/decisions/0011-visa-at-vendor.md
 * Decision 5). A credit note is the invoice's layout with its own title and number (`view.invoiceNo`), the invoice it
 * cancels and why, and no bank details, balance or terms: nothing is to be paid on it.
 */
export type PdfDocument =
  | {
      kind: "INVOICE";
      replaces?: { invoiceNo: string; creditNoteNo: string };
      /** An additional invoice (0011 Decision 7): the main invoice it adds to. */
      additionalTo?: { invoiceNo: string; issuedOn: string };
    }
  | { kind: "CREDIT_NOTE"; againstInvoiceNo: string; againstIssuedOn: string; reason: string };

export interface InvoiceImages {
  logo: { bytes: Buffer; contentType: string } | null;
  signature: { bytes: Buffer; contentType: string } | null;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 36;
const RIGHT = A4.width - MARGIN;
const INK = rgb(0.12, 0.16, 0.22);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.82, 0.84, 0.87);
const SHADE = rgb(0.9, 0.91, 0.93);
/** Masti's warm orange, as on the band across the top of their voucher. */
const BRAND = rgb(0.95, 0.53, 0.2);

const MONEY = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** 341000 → "3,410.00" */
const money = (paise: number) => MONEY.format(paise / 100);
/** "+919825041238" → "+91 98250 41238"; anything else as stored. */
const mobile = (m: string) => (/^\+91\d{10}$/.test(m) ? `+91 ${m.slice(3, 8)} ${m.slice(8)}` : m);
/** "2026-10-05" → "05 Oct 2026" */
function longDate(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

interface Pen {
  doc: PDFDocument;
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
  /** Distance from the top of the page to the next line. */
  y: number;
}

interface TextOptions {
  size?: number;
  bold?: boolean;
  color?: RGB;
  align?: "left" | "right" | "center";
}

function draw(pen: Pen, text: string, x: number, y: number, { size = 9, bold = false, color = INK, align = "left" }: TextOptions = {}) {
  const font = bold ? pen.bold : pen.regular;
  const width = font.widthOfTextAtSize(text, size);
  const left = align === "right" ? x - width : align === "center" ? x - width / 2 : x;
  pen.page.drawText(text, { x: left, y: A4.height - y - size, size, font, color });
}

/** Words wrapped to `width`, one string per line. A word too wide for a line on its own (a long web address) is broken. */
function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width;
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (fits(next)) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      line = word;
      while (!fits(line)) {
        const chars = [...line];
        let n = 1;
        while (n < chars.length && fits(chars.slice(0, n + 1).join(""))) n++;
        lines.push(chars.slice(0, n).join(""));
        line = chars.slice(n).join("");
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** Line spacing, as a share of the text's size. */
const LEADING = 1.35;

/** Draws wrapped text from the pen's line and moves the pen below it. */
function para(pen: Pen, text: string, x: number, width: number, options: TextOptions & { gap?: number } = {}) {
  const size = options.size ?? 9;
  const leading = size * LEADING;
  for (const line of wrap(options.bold ? pen.bold : pen.regular, text, size, width)) {
    draw(pen, line, x, pen.y, options);
    pen.y += leading;
  }
  pen.y += options.gap ?? 0;
}

function rule(pen: Pen, y: number, x1 = MARGIN, x2 = RIGHT) {
  pen.page.drawLine({ start: { x: x1, y: A4.height - y }, end: { x: x2, y: A4.height - y }, thickness: 0.6, color: RULE });
}

function shade(pen: Pen, x: number, y: number, width: number, height: number, color: RGB = SHADE) {
  pen.page.drawRectangle({ x, y: A4.height - y - height, width, height, color });
}

/** An image scaled to fit the box, kept in proportion, aligned to the box's right edge. */
function picture(pen: Pen, image: PDFImage, right: number, top: number, maxWidth: number, maxHeight: number) {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  pen.page.drawImage(image, { x: right - width, y: A4.height - top - height, width, height });
  return height;
}

function newPage(pen: Pen) {
  pen.page = pen.doc.addPage([A4.width, A4.height]);
  shade(pen, 0, 0, A4.width, 10, BRAND);
  pen.y = MARGIN;
}

/** Starts a new page when fewer than `height` points are left above the bottom margin. */
function room(pen: Pen, height: number) {
  if (pen.y + height > A4.height - MARGIN) newPage(pen);
}

async function embed(doc: PDFDocument, image: { bytes: Buffer; contentType: string } | null) {
  if (!image) return null;
  // A plain copy: pdf-lib reads a Buffer's whole backing memory, and a small Buffer shares it with others.
  const data = new Uint8Array(image.bytes);
  return image.contentType === "image/png" ? doc.embedPng(data) : doc.embedJpg(data);
}

/** The table's columns: with any itemised line, the fee columns; otherwise just the total, like Masti's lump-sum voucher. */
function columns(itemised: boolean) {
  return itemised
    ? { desc: MARGIN + 6, service: 300, embassy: 395, vfs: 450, other: 505, total: RIGHT - 6 }
    : { desc: MARGIN + 6, service: 400, embassy: null, vfs: null, other: null, total: RIGHT - 6 };
}

/**
 * Draws the invoice, or a credit note in the same layout. Returns the PDF's bytes and its page count. Long ones (many
 * travellers) flow onto more pages; the table's header repeats.
 */
export async function renderInvoicePdf(
  view: InvoiceView,
  images: InvoiceImages,
  document: PdfDocument = { kind: "INVOICE" },
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const credit = document.kind === "CREDIT_NOTE" ? document : null;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(credit ? `Credit note ${view.invoiceNo}` : `Tax invoice ${view.invoiceNo}`);
  doc.setAuthor(view.company.name);
  doc.setCreator("Masti CRM");
  // The whole font, not a subset: pdf-lib's subsetting drops most of Noto Sans's glyphs (the text extracts but doesn't
  // show). It makes each invoice about 600 KB, which is fine to store and to send.
  const regular = await doc.embedFont(new Uint8Array(fonts().regular), { subset: false });
  const bold = await doc.embedFont(new Uint8Array(fonts().bold), { subset: false });
  const [logo, signature] = await Promise.all([embed(doc, images.logo), embed(doc, images.signature)]);

  const pen = { doc, regular, bold, y: MARGIN } as Pen;
  newPage(pen);
  const c = view.company;

  // --- Header: Masti's address and contacts on the left, the logo on the right.
  pen.y = 30;
  const headerTop = pen.y;
  para(pen, c.address, MARGIN, 300, { size: 9 });
  para(pen, [`(Ph.) ${c.phone}`, c.phone2 && `24/7: ${c.phone2}`].filter(Boolean).join("  |  "), MARGIN, 300, { size: 9 });
  if (c.email) para(pen, c.email, MARGIN, 300, { size: 9 });
  if (c.website) para(pen, c.website, MARGIN, 300, { size: 9 });
  const logoHeight = logo ? picture(pen, logo, RIGHT, headerTop, 190, 70) : 0;
  if (!logo) draw(pen, c.name, RIGHT, headerTop, { size: 14, bold: true, align: "right" });
  pen.y = Math.max(pen.y, headerTop + logoHeight) + 10;

  // --- Masti's PAN and GSTIN.
  draw(pen, `(PAN) ${c.pan ?? ""}`, MARGIN, pen.y, { size: 9 });
  draw(pen, `(GSTIN) ${c.gstin ?? ""}`, RIGHT, pen.y, { size: 9, align: "right" });
  pen.y += 14;
  rule(pen, pen.y);
  pen.y += 8;

  // --- To (the client) on the left; the TAX INVOICE box on the right.
  const blockTop = pen.y;
  const boxLeft = 370;
  shade(pen, boxLeft, blockTop, RIGHT - boxLeft, 46);
  draw(pen, credit ? "CREDIT NOTE" : "TAX INVOICE", (boxLeft + RIGHT) / 2, blockTop + 6, { size: 10.5, bold: true, align: "center" });
  draw(pen, view.invoiceNo, boxLeft + 8, blockTop + 26, { size: 10.5, bold: true });
  draw(pen, longDate(view.issuedOn), RIGHT - 8, blockTop + 26, { size: 10.5, bold: true, align: "right" });

  const cl = view.client;
  draw(pen, "To,", MARGIN, pen.y, { size: 9 });
  pen.y += 13;
  para(pen, cl.name, MARGIN, 320, { size: 10, bold: true });
  if (cl.contactPerson) para(pen, `Attn: ${cl.contactPerson}`, MARGIN, 320, { size: 9 });
  for (const line of cl.addressLines) para(pen, line, MARGIN, 320, { size: 9 });
  if (cl.stateName) para(pen, `State: ${cl.stateName} (State Code: ${cl.stateCode}), Country: India.`, MARGIN, 320, { size: 9 });
  if (cl.mobile) para(pen, `(M) ${mobile(cl.mobile)}`, MARGIN, 320, { size: 9 });
  pen.y = Math.max(pen.y, blockTop + 52) + 2;
  const supply = [cl.gstin && `(GSTIN) ${cl.gstin}`, `Place of Supply: ${view.placeOfSupply.name} (${view.placeOfSupply.code})`, cl.pan && `(PAN NO) ${cl.pan}`]
    .filter(Boolean)
    .join("   ");
  draw(pen, supply, MARGIN, pen.y, { size: 9 });
  draw(pen, `HSN/SAC Code: ${view.sac}`, boxLeft + 8, pen.y, { size: 9 });
  pen.y += 18;
  if (document.kind === "INVOICE" && document.additionalTo) {
    const a = document.additionalTo;
    para(pen, `Additional to Tax Invoice ${a.invoiceNo} dated ${longDate(a.issuedOn)}`, MARGIN, RIGHT - MARGIN, { size: 9.5, bold: true });
    pen.y += 8;
  }
  if (document.kind === "INVOICE" && document.replaces) {
    const r = document.replaces;
    para(pen, `Replaces Tax Invoice ${r.invoiceNo} (cancelled by Credit Note ${r.creditNoteNo})`, MARGIN, RIGHT - MARGIN, { size: 9.5, bold: true });
    pen.y += 8;
  }
  if (credit) {
    para(pen, `Against Tax Invoice ${credit.againstInvoiceNo} dated ${longDate(credit.againstIssuedOn)}`, MARGIN, RIGHT - MARGIN, { size: 9.5, bold: true });
    para(pen, `Reason: ${credit.reason}`, MARGIN, RIGHT - MARGIN, { size: 9 });
    pen.y += 8;
  }

  // --- The table: one row per traveller.
  const itemised = view.lines.some((l) => l.form === "ITEMISED");
  const col = columns(itemised);
  const header = () => {
    shade(pen, MARGIN, pen.y, RIGHT - MARGIN, 18);
    const y = pen.y + 4.5;
    draw(pen, "Description", col.desc, y, { size: 8.5, bold: true });
    draw(pen, "Service", col.service, y, { size: 8.5, bold: true });
    if (col.embassy !== null) draw(pen, "Embassy Fee", col.embassy, y, { size: 8.5, bold: true, align: "right" });
    if (col.vfs !== null) draw(pen, "VFS Fee", col.vfs, y, { size: 8.5, bold: true, align: "right" });
    if (col.other !== null) draw(pen, "All & Other", col.other, y, { size: 8.5, bold: true, align: "right" });
    draw(pen, "Total", col.total, y, { size: 8.5, bold: true, align: "right" });
    pen.y += 24;
  };
  header();
  for (const line of view.lines) {
    if (pen.y + 34 > A4.height - MARGIN) {
      newPage(pen);
      header();
    }
    const no = String(line.position).padStart(3, "0");
    draw(pen, no, col.desc, pen.y, { size: 9 });
    draw(pen, line.name, col.desc + 26, pen.y, { size: 9, bold: true });
    draw(pen, "Visa", col.service, pen.y, { size: 9 });
    if (line.form === "ITEMISED") {
      draw(pen, money(line.embassyFeePaise ?? 0), col.embassy!, pen.y, { size: 9, align: "right" });
      draw(pen, money(line.vfsFeePaise ?? 0), col.vfs!, pen.y, { size: 9, align: "right" });
      draw(pen, money(line.otherFeePaise ?? 0), col.other!, pen.y, { size: 9, align: "right" });
    } else if (itemised) {
      for (const x of [col.embassy!, col.vfs!, col.other!]) draw(pen, "—", x, pen.y, { size: 9, color: MUTED, align: "right" });
    }
    draw(pen, money(line.totalPaise), col.total, pen.y, { size: 9, align: "right" });
    draw(pen, line.description, col.desc + 26, pen.y + 13, { size: 8, color: MUTED });
    pen.y += 30;
  }
  rule(pen, pen.y - 4);
  pen.y += 10;

  // --- Totals on the right, the bank details on the left.
  const tax = view.cgstPaise + view.sgstPaise + view.igstPaise;
  room(pen, 120);
  const totalsLeft = 360;
  const totalsTop = pen.y;
  const totalRow = (label: string, amount: string) => {
    draw(pen, label, totalsLeft, pen.y, { size: 9 });
    draw(pen, amount, RIGHT - 6, pen.y, { size: 9, align: "right" });
    pen.y += 14;
  };
  totalRow("Gross Total", money(view.grossPaise));
  if (view.serviceChargePaise > 0) totalRow("Add Processing Charges", money(view.serviceChargePaise));
  if (tax > 0) totalRow("Add GST", money(tax));
  const totalsBottom = pen.y;

  pen.y = totalsTop;
  if (c.bank && !credit) {
    const b = c.bank;
    para(
      pen,
      `A/C NAME: ${b.accountName}. A/C NO: ${b.accountNo}. BANK: ${b.bankName}. BRANCH: ${b.branch}. IFSC CODE: ${b.ifsc}.${b.swift ? ` SWIFT CODE: ${b.swift}` : ""}`,
      MARGIN,
      totalsLeft - MARGIN - 16,
      { size: 8 },
    );
  }
  pen.y = Math.max(pen.y, totalsBottom) + 2;

  // --- The total, in words and in figures; then what's still to pay. The words wrap within their half of the row.
  const words = wrap(pen.bold, amountInWords(view.totalPaise), 9, totalsLeft - MARGIN - 20);
  const rowHeight = Math.max(18, words.length * 12 + 6);
  shade(pen, MARGIN, pen.y, RIGHT - MARGIN, rowHeight);
  words.forEach((line, i) => draw(pen, line, MARGIN + 6, pen.y + 4.5 + i * 12, { size: 9, bold: true }));
  draw(pen, credit ? "Total Credit in ₹" : "Total Amount in ₹", totalsLeft, pen.y + 4.5, { size: 9, bold: true });
  draw(pen, money(view.totalPaise), RIGHT - 6, pen.y + 4.5, { size: 9.5, bold: true, align: "right" });
  pen.y += rowHeight + 4;
  if (!credit) {
    draw(pen, "Balance Amount in ₹", totalsLeft, pen.y, { size: 9, bold: true });
    draw(pen, money(view.totalPaise), RIGHT - 6, pen.y, { size: 9.5, bold: true, align: "right" });
  }
  pen.y += 20;

  // --- The GST table, when there is GST.
  if (tax > 0) {
    room(pen, 40);
    const rate = view.taxType === "INTRA_STATE" ? view.gstRatePercent / 2 : view.gstRatePercent;
    const cells = [
      { label: "HSN/SAC Code", value: view.sac, x: MARGIN + 6, align: "left" as const },
      { label: "Taxable Value", value: money(view.serviceChargePaise), x: 205, align: "right" as const },
      { label: "CGST %", value: view.taxType === "INTRA_STATE" ? String(rate) : "", x: 250, align: "right" as const },
      { label: "CGST", value: view.cgstPaise ? money(view.cgstPaise) : "", x: 315, align: "right" as const },
      { label: "SGST %", value: view.taxType === "INTRA_STATE" ? String(rate) : "", x: 360, align: "right" as const },
      { label: "SGST", value: view.sgstPaise ? money(view.sgstPaise) : "", x: 425, align: "right" as const },
      { label: "IGST %", value: view.taxType === "INTER_STATE" ? String(rate) : "", x: 470, align: "right" as const },
      { label: "IGST", value: view.igstPaise ? money(view.igstPaise) : "", x: RIGHT - 6, align: "right" as const },
    ];
    rule(pen, pen.y);
    pen.y += 4;
    for (const cell of cells) draw(pen, cell.label, cell.x, pen.y, { size: 8, bold: true, align: cell.align });
    pen.y += 13;
    for (const cell of cells) draw(pen, cell.value, cell.x, pen.y, { size: 8.5, align: cell.align });
    pen.y += 13;
    rule(pen, pen.y);
    pen.y += 10;
  }

  // --- The terms, with their heading, on one page: the room kept is what they take once wrapped. The most the setting
  // allows (10 terms of 200 characters) is well under a page. A credit note has none.
  if (!credit) {
    const terms = view.terms.map((term) => `# ${term}`);
    const termLines = terms.reduce((n, term) => n + wrap(pen.regular, term, 8, 330).length, 0);
    room(pen, 14 + termLines * 8 * LEADING + 6);
    draw(pen, "Terms :", MARGIN, pen.y, { size: 9, bold: true });
    draw(pen, "E. & O. E.", RIGHT, pen.y, { size: 9, align: "right" });
    pen.y += 14;
    for (const term of terms) para(pen, term, MARGIN, 330, { size: 8 });
    pen.y += 6;
  }

  // --- Signatures, and who prepared it.
  room(pen, 100);
  rule(pen, pen.y);
  pen.y += 8;
  draw(pen, `for ${c.name}`, RIGHT, pen.y, { size: 9, bold: true, align: "right" });
  const signedTop = pen.y + 16;
  if (signature) picture(pen, signature, RIGHT, signedTop, 130, 42);
  pen.y = signedTop + 48;
  draw(pen, "Receiver's Signature", MARGIN, pen.y, { size: 9 });
  draw(pen, "Authorized Signatory", RIGHT, pen.y, { size: 9, align: "right" });
  pen.y += 18;
  draw(pen, `(Prepared by: ${view.preparedBy})`, MARGIN, pen.y, { size: 7.5, color: MUTED });
  draw(pen, "This is a computer generated document and does not require any signature.", A4.width / 2 + 20, pen.y, {
    size: 7.5,
    color: MUTED,
    align: "center",
  });

  const bytes = await doc.save();
  return { bytes, pageCount: doc.getPageCount() };
}
