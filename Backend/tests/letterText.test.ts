import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { draftLetter, type LetterFacts } from "../src/modules/coveringLetters/fill";

// How a covering letter's | lines become tables (docs/decisions/0019-covering-letters.md amendment 3), in
// Frontend/src/lib/letter.ts, which draws a case's letter, its print and Settings' wording preview. The path is a variable
// so the backend typecheck doesn't pull in Frontend sources; Vitest loads it at runtime. The file imports nothing, so
// this runs without the frontend's packages.

const frontendLetter = resolve(__dirname, "../../Frontend/src/lib/letter.ts");

type Piece = { text: string } | { blank: string };
type Block = { kind: "paragraph"; lines: Piece[][] } | { kind: "table"; head: Piece[][]; rows: Piece[][][] } | { kind: "travellers" };
interface FrontendLetter {
  textBlocks(text: string): Block[];
  letterBlocks(body: string): Block[];
  tableCells(lines: string[]): string[][];
  tabsToPipes(text: string): string | null;
}
const frontend = async () => (await import(frontendLetter)) as FrontendLetter;

/** A line of pieces in plain words, each blank or mark written <like this>. */
const plain = (pieces: Piece[]) => pieces.map((p) => ("text" in p ? p.text : `<${p.blank}>`)).join("");
/** Blocks in plain words: a paragraph's lines, a table's headings and rows, or the table of travellers. */
const shape = (blocks: Block[]) =>
  blocks.map((b) =>
    b.kind === "paragraph" ? { p: b.lines.map(plain) } : b.kind === "table" ? { head: b.head.map(plain), rows: b.rows.map((r) => r.map(plain)) } : { travellers: true },
  );

describe("a case letter's | lines", () => {
  it("make a table from two or more lines in a row, the first its headings; one such line alone stays text", async () => {
    const { textBlocks } = await frontend();
    expect(shape(textBlocks("Name | Passport no.\nRAKESH MEHTA | Z1234567"))).toEqual([{ head: ["Name", "Passport no."], rows: [["RAKESH MEHTA", "Z1234567"]] }]);
    expect(shape(textBlocks("Dear Sir,\nWe stay at Hotel A | Paris.\n\nThanks"))).toEqual([{ p: ["Dear Sir,", "We stay at Hotel A | Paris."] }, { p: ["Thanks"] }]);
  });

  it("end at a blank line or a line without |, and need no blank line before or after", async () => {
    const { textBlocks } = await frontend();
    expect(shape(textBlocks("The passport details are below:\nA | B\n1 | 2\nWe travel soon.\nThanks"))).toEqual([
      { p: ["The passport details are below:"] },
      { head: ["A", "B"], rows: [["1", "2"]] },
      { p: ["We travel soon.", "Thanks"] },
    ]);
    expect(shape(textBlocks("A | B\r\n1 | 2\r\n\r\nC | D\r\n3 | 4"))).toEqual([
      { head: ["A", "B"], rows: [["1", "2"]] },
      { head: ["C", "D"], rows: [["3", "4"]] },
    ]);
  });

  it("are as wide as their widest line, so no typed text is dropped", async () => {
    const { tableCells } = await frontend();
    expect(tableCells(["A | B", "1 | 2 | 3", "4 | 5"])).toEqual([
      ["A", "B", ""],
      ["1", "2", "3"],
      ["4", "5", ""],
    ]);
  });

  it("drop a | at the ends only when every line has one, and skip Markdown's line of dashes", async () => {
    const { tableCells } = await frontend();
    expect(tableCells(["| Name | Passport no. |", "|:---|---:|", "| A | Z1 |"])).toEqual([
      ["Name", "Passport no."],
      ["A", "Z1"],
    ]);
    // A drafted row whose first cell was cleared keeps its place.
    expect(tableCells(["Name | Relation | Passport no.", "| Self | Z1", "B | Son | Z2"])).toEqual([
      ["Name", "Relation", "Passport no."],
      ["", "Self", "Z1"],
      ["B", "Son", "Z2"],
    ]);
    // The dashes count towards the two lines: headings only.
    expect(tableCells(["A | B", "--- | :---:"])).toEqual([["A", "B"]]);
    expect(tableCells(["--- | ---", "---|---"])).toEqual([]);
  });

  it("show a mark in its cell as in the text; dashes alone stay text", async () => {
    const { textBlocks } = await frontend();
    expect(shape(textBlocks("Name | Passport no.\nAARAV | ⟦AARAV's passport number⟧\n\nAt ⟦the hotel stay⟧."))).toEqual([
      { head: ["Name", "Passport no."], rows: [["AARAV", "<⟦AARAV's passport number⟧>"]] },
      { p: ["At <⟦the hotel stay⟧>."] },
    ]);
    expect(shape(textBlocks("--- | ---\n---|---"))).toEqual([{ p: ["--- | ---", "---|---"] }]);
  });
});

describe("a wording's | lines (Settings)", () => {
  it("make tables with their blanks, while {travellers} stays the table of travellers", async () => {
    const { letterBlocks } = await frontend();
    expect(shape(letterBlocks("Day | City\n1 | {country}\n{travellers}\nThanks, {applicant}"))).toEqual([
      { head: ["Day", "City"], rows: [["1", "<country>"]] },
      { travellers: true },
      { p: ["Thanks, <applicant>"] },
    ]);
  });
});

describe("pasting a table copied from a page", () => {
  it("turns lines with tabs into | lines, and leaves other text alone", async () => {
    const { tabsToPipes } = await frontend();
    expect(tabsToPipes("Date\tCity\tHotel\r\n1 Dec\tParis\tLutetia | Opera\r\n")).toBe("Date | City | Hotel\n1 Dec | Paris | Lutetia / Opera\n");
    expect(tabsToPipes("Our plan:\nDate\tCity\n1 Dec\tParis")).toBe("Our plan:\nDate | City\n1 Dec | Paris");
    expect(tabsToPipes("One line\twith a tab")).toBeNull();
    expect(tabsToPipes("No tabs at all\nhere")).toBeNull();
  });
});

describe("the server's draft, as the screen draws it", () => {
  it("gives the travellers' table its four headings and a row each, apart from a | line of the wording's own", async () => {
    const { textBlocks } = await frontend();
    const facts: LetterFacts = {
      clientName: "Rakesh Mehta",
      clientAddress: "12 Shanti Park, Vesu, Surat 395007",
      country: "France",
      visaType: "Tourist",
      trip: { departOn: null, returnOn: null, entryType: null, hotelStay: "Hotel A | Paris" },
      travellers: [
        { name: "RAKESH MEHTA", label: "Adult 1", relation: "Self", dateOfBirth: "1980-03-12", passportNumber: "Z1234567" },
        { name: "AARAV MEHTA", label: "Child 1", relation: "Son", dateOfBirth: "2014-01-19", passportNumber: null },
      ],
    };
    const { letter } = draftLetter("Dear Sir,\nWe stay at {hotel}.\nDay | City\n{travellers}\nThanks", facts, "2026-10-20");
    expect(shape(textBlocks(letter))).toEqual([
      // The wording's own | line is alone: a blank line keeps it from the travellers' table, so it stays text.
      { p: ["Dear Sir,", "We stay at Hotel A / Paris.", "Day | City"] },
      {
        head: ["Name", "Relation", "Date of birth", "Passport no."],
        rows: [
          ["RAKESH MEHTA", "Self", "12 Mar 1980", "Z1234567"],
          ["AARAV MEHTA", "Son", "19 Jan 2014", "<⟦AARAV MEHTA's passport number⟧>"],
        ],
      },
      { p: ["Thanks"] },
    ]);
  });
});
