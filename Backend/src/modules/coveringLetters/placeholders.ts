import { dateLabel, fullDate } from "../../lib/dates";
import { isTableLine, mark, NOTE } from "./coveringLetters.schemas";

// Keeping a covering letter's personal details on Masti's server while the AI writes it (docs/decisions/
// 0019-covering-letters.md amendment 4, docs/decisions/0023-ai.md). Before the letter goes, every detail of the case it
// holds becomes a placeholder named for what it is, never for its value ({t2Passport}); the AI writes around them, and
// each is filled back exactly as it was written. A table goes as one placeholder ({table1}), so the AI needn't copy it.
// No queries here: the swap is tested on its own (tests/coveringLetterAi.test.ts).
//
// - One pass: every match is found on the letter as it is, the longest that don't overlap are kept, and all are
//   replaced at once, so a value can't match inside a placeholder already put in.
// - A match needs an edge that isn't a letter, mark or digit, and isn't followed by "," or "." and a digit, so the
//   address line "12" doesn't take "Rs 12,000".
// - A single word of a name only counts with 3 letters or more, in capitals or Title Case ("Happy" in prose stays),
//   and may carry -bhai, -ben, -ji or a plural s, which stay as text.
// - Dates are read, not listed: any date-like text that is a known date of birth or expiry is swapped, however it's
//   written. The city and the area alone aren't personal: they go only as part of the whole address.
// - Anything shaped like an Indian passport number, a PAN, a GSTIN, an Aadhaar number, an Indian mobile or an email is
//   swapped too, even typed by hand.

/** What the case knows that a letter may hold. Dates are YYYY-MM-DD (India). */
export interface PrivateFacts {
  caseNo: string;
  client: {
    name: string;
    contactPerson: string | null;
    /** Whole, as the letter prints it: "12 Shanti Park, Vesu, Surat 395007". */
    address: string;
    addressLine: string | null;
    pincode: string | null;
    mobile: string;
    phones: string[];
    email: string | null;
    pan: string | null;
    gstin: string | null;
  };
  /** In their order on the case: the first is the applicant. */
  travellers: {
    name: string | null;
    /** "Adult 2": what the case calls a traveller with no name yet. */
    label: string;
    passportNumber: string | null;
    dateOfBirth: string | null;
    passportExpiry: string | null;
    mobile: string | null;
    homeAddress: string | null;
    officeAddress: string | null;
  }[];
  /** Not personal, but swapped too so the AI can't change them: the letter's possible dates, and the trip's. */
  dates: { today: string; madeOn: string | null; departOn: string | null; returnOn: string | null };
}

/** One placeholder: what it stands for, and what it's filled back with. */
export interface Slot {
  /** Without the braces: "t2Passport". */
  name: string;
  /** For the AI's key. A personal one never holds its value. */
  meaning: string;
  /** What it's filled back with: exactly as the letter had it, or as the CRM writes it. */
  text: string;
  /** Its value never goes to the AI, and the AI dropping it is reported. The dates aren't personal. */
  personal: boolean;
  /** What "Removed by the AI" calls it: "AARAV MEHTA's passport number". */
  label: string;
}

export interface Swap {
  /** The letter as the AI gets it. */
  text: string;
  /** Each table as one placeholder, with its lines as the AI may read them and as the letter had them. */
  tables: { name: string; lines: string; original: string }[];
  /** Every placeholder, the travellers' names, passport numbers and dates of birth included even when not in the letter. */
  slots: Slot[];
  /** The personal placeholders in what was sent, its tables included. */
  sent: Set<string>;
  /** The same swap for other text the AI is given (the hotel stay). */
  swapMore(text: string): string;
  /** The AI's text with every placeholder filled back; the personal placeholders it held, its tables' included. */
  fill(answer: string): { text: string; present: Set<string> };
}

/** A detail the case knows, as it's looked for in the letter. */
interface Detail {
  base: string;
  meaning: string;
  label: string;
  personal: boolean;
  /** How the CRM writes it, when the AI asks for it and the letter doesn't hold it. */
  standard: string;
  /** A name's spellings get their names by form ({t1NameCaps}); others by number. */
  isName: boolean;
}

interface Hit {
  start: number;
  end: number;
  detail: Detail;
  /** Lower wins a tie: a known detail over a shape. */
  rank: number;
}

const EDGE_BEFORE = String.raw`(?<![\p{L}\p{M}\p{N}])`;
const EDGE_AFTER = String.raw`(?![\p{L}\p{M}\p{N}])(?![.,]\d)`;
const NAME_SUFFIX = String.raw`(?=(?:bhai|ben|ji|s)?(?![\p{L}\p{M}\p{N}]))`;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A value as a pattern: spaces as any run of spaces on the line, and ' as either apostrophe. */
const valuePattern = (value: string) =>
  value
    .trim()
    .split(/\s+/)
    .map((part) => escape(part).replace(/'|’/g, "['’]"))
    .join(String.raw`[ \t]+`);
const sameName = (a: string, b: string) => a.replace(/’/g, "'").toLowerCase() === b.replace(/’/g, "'").toLowerCase();
const letters = (text: string) => (text.match(/\p{L}/gu) ?? []).length;
const isCaps = (text: string) => text === text.toUpperCase() && text !== text.toLowerCase();
/** Each word starting with a capital, and not all capitals: "Rakesh Mehta", "D'Souza". */
const isTitle = (text: string) => !isCaps(text) && text.split(/\s+/).every((word) => /^\p{Lu}/u.test(word));
/** The last 10 digits of an Indian number, however it's written. */
const digitsOf = (text: string) => text.replace(/\D/g, "").slice(-10);

// ---------------------------------------------------------------------------------------------------------------------
// The details the case knows.
// ---------------------------------------------------------------------------------------------------------------------

interface Known {
  /** Exact text, found ignoring capitals: names, addresses, passport numbers, the case number. */
  texts: { value: string; detail: Detail }[];
  /** Single words of names. */
  words: { value: string; detail: Detail }[];
  dates: Map<string, Detail>;
  /** By their last 10 digits. */
  phones: Map<string, Detail>;
  /** By their capitals: passport numbers, PAN, GSTIN. */
  ids: Map<string, Detail>;
  /** By their small letters. */
  emails: Map<string, Detail>;
  /** The travellers' names, passport numbers and dates of birth, for the key even when the letter doesn't hold them. */
  core: Detail[];
}

function knownOf(facts: PrivateFacts): Known {
  const known: Known = { texts: [], words: [], dates: new Map(), phones: new Map(), ids: new Map(), emails: new Map(), core: [] };
  const detail = (d: Omit<Detail, "personal" | "isName"> & { personal?: boolean; isName?: boolean }): Detail => ({
    personal: true,
    isName: false,
    ...d,
  });
  /** A text the case knows; the same text twice is one detail, both meanings kept (the client is the applicant). */
  const addText = (value: string | null, d: Detail) => {
    if (!value || letters(value) + (value.match(/\d/g) ?? []).length < 3) return null;
    const same = known.texts.find((t) => sameName(t.value, value));
    if (same) {
      same.detail.meaning = `${same.detail.meaning}, also ${d.meaning}`;
      return same.detail;
    }
    known.texts.push({ value, detail: d });
    return d;
  };
  /** A person's name, and each word of it. `who`: "traveller 2", "the client". */
  const addName = (name: string | null, base: string, who: string, note = "") => {
    if (!name) return null;
    const full = addText(name, detail({ base: `${base}Name`, meaning: `${who}'s name${note}`, label: `${name}'s name`, standard: name, isName: true }));
    const words = name.split(/\s+/).filter((w) => letters(w) >= 3);
    if (words.length > 1) {
      words.forEach((word, i) => {
        const part = i === 0 ? "Given" : i === words.length - 1 ? "Surname" : "Middle";
        const partMeaning = { Given: "given name", Surname: "surname", Middle: "middle name" }[part];
        // A surname the family shares is one placeholder, the first traveller's.
        if (known.words.some((w) => sameName(w.value, word))) return;
        known.words.push({
          value: word,
          detail: detail({ base: `${base}${part}`, meaning: `${who}'s ${partMeaning}`, label: `${name}'s ${partMeaning}`, standard: word, isName: true }),
        });
      });
    }
    return full;
  };
  const addDate = (value: string | null, d: Detail) => {
    if (value && !known.dates.has(value)) known.dates.set(value, d);
    return value ? (known.dates.get(value) ?? null) : null;
  };
  const addPhone = (value: string | null, d: Detail) => {
    if (value && digitsOf(value).length === 10 && !known.phones.has(digitsOf(value))) known.phones.set(digitsOf(value), d);
  };
  const addId = (value: string | null, d: Detail) => {
    if (!value) return;
    known.ids.set(value.toUpperCase(), d);
    addText(value, d);
  };

  facts.travellers.forEach((t, i) => {
    const n = i + 1;
    const who = t.name ?? t.label;
    const name = addName(t.name, `t${n}`, `traveller ${n}`, n === 1 ? " (the applicant)" : "");
    if (name) known.core.push(name);
    const passport = detail({ base: `t${n}Passport`, meaning: `traveller ${n}'s passport number`, label: `${who}'s passport number`, standard: t.passportNumber ?? "" });
    if (t.passportNumber) {
      addId(t.passportNumber, passport);
      known.core.push(passport);
    }
    const birth = addDate(
      t.dateOfBirth,
      detail({ base: `t${n}Birth`, meaning: `traveller ${n}'s date of birth`, label: `${who}'s date of birth`, standard: t.dateOfBirth ? dateLabel(t.dateOfBirth) : "" }),
    );
    if (birth) known.core.push(birth);
    addDate(
      t.passportExpiry,
      detail({ base: `t${n}Expiry`, meaning: `traveller ${n}'s passport expiry date`, label: `${who}'s passport expiry`, standard: t.passportExpiry ? dateLabel(t.passportExpiry) : "" }),
    );
    addPhone(t.mobile, detail({ base: `t${n}Mobile`, meaning: `traveller ${n}'s mobile number`, label: `${who}'s mobile`, standard: t.mobile ?? "" }));
    addText(t.homeAddress, detail({ base: `t${n}Home`, meaning: `traveller ${n}'s home address`, label: `${who}'s home address`, standard: t.homeAddress ?? "" }));
    addText(t.officeAddress, detail({ base: `t${n}Office`, meaning: `traveller ${n}'s office address`, label: `${who}'s office address`, standard: t.officeAddress ?? "" }));
  });

  const { client } = facts;
  addName(client.name, "client", "the client");
  addName(client.contactPerson, "contact", "the client's contact person");
  addText(client.address, detail({ base: "clientAddress", meaning: "the client's address", label: "the client's address", standard: client.address }));
  // The line alone only when it has a word in it ("12" alone would take any 12), and the pincode alone.
  if (client.addressLine && letters(client.addressLine) > 0) {
    addText(client.addressLine, detail({ base: "addressLine", meaning: "the first line of the client's address", label: "the client's address line", standard: client.addressLine }));
  }
  if (client.pincode && /^\d{6}$/.test(client.pincode)) {
    known.texts.push({ value: client.pincode, detail: detail({ base: "pincode", meaning: "the client's pincode", label: "the client's pincode", standard: client.pincode }) });
  }
  addPhone(client.mobile, detail({ base: "clientMobile", meaning: "the client's mobile number", label: "the client's mobile", standard: client.mobile }));
  client.phones.forEach((phone, i) =>
    addPhone(phone, detail({ base: `clientPhone${i + 1}`, meaning: "another of the client's phone numbers", label: "a client's phone number", standard: phone })),
  );
  if (client.email) {
    known.emails.set(client.email.toLowerCase(), detail({ base: "clientEmail", meaning: "the client's email", label: "the client's email", standard: client.email }));
  }
  addId(client.pan, detail({ base: "clientPan", meaning: "the client's PAN", label: "the client's PAN", standard: client.pan ?? "" }));
  addId(client.gstin, detail({ base: "clientGstin", meaning: "the client's GSTIN", label: "the client's GSTIN", standard: client.gstin ?? "" }));
  addText(facts.caseNo, detail({ base: "caseNo", meaning: "the travel agency's case number", label: "the case number", standard: facts.caseNo }));

  const { dates } = facts;
  const tripDate = (value: string | null, base: string, what: string) =>
    value && addDate(value, detail({ base, meaning: `${what}: ${fullDate(value)}`, label: what, standard: fullDate(value), personal: false }));
  tripDate(dates.today, "date", "today's date, the letter's date");
  if (dates.madeOn !== dates.today) tripDate(dates.madeOn, "madeOn", "the day the letter was made");
  tripDate(dates.departOn, "departOn", "the day they travel out");
  tripDate(dates.returnOn, "returnOn", "the day they come back");
  return known;
}

// ---------------------------------------------------------------------------------------------------------------------
// Finding them in a text.
// ---------------------------------------------------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH = String.raw`(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)`;
const ORD = "(?:st|nd|rd|th)?";
const DATE_FORMS: { pattern: RegExp; read: (m: RegExpExecArray) => [number, number, number][] }[] = [
  // 5 Sep 1985, 5th September, 1985
  {
    pattern: new RegExp(String.raw`${EDGE_BEFORE}(\d{1,2})${ORD}[ \t]+${MONTH}\.?,?[ \t]+(\d{4})${EDGE_AFTER}`, "giu"),
    read: (m) => [[Number(m[3]), monthOf(m[2]!), Number(m[1])]],
  },
  // Sep 5, 1985
  {
    pattern: new RegExp(String.raw`${EDGE_BEFORE}${MONTH}\.?[ \t]+(\d{1,2})${ORD},?[ \t]+(\d{4})${EDGE_AFTER}`, "giu"),
    read: (m) => [[Number(m[3]), monthOf(m[1]!), Number(m[2])]],
  },
  // 1985-09-05
  { pattern: new RegExp(String.raw`${EDGE_BEFORE}(\d{4})-(\d{2})-(\d{2})${EDGE_AFTER}`, "gu"), read: (m) => [[Number(m[1]), Number(m[2]), Number(m[3])]] },
  // 05/09/1985, 5-9-85, 05.09.1985: day first in India, but month first is checked too, and a short year either century.
  {
    pattern: new RegExp(String.raw`${EDGE_BEFORE}(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})(?![\p{L}\p{M}\p{N}])`, "gu"),
    read: (m) => {
      const years = m[4]!.length === 4 ? [Number(m[4])] : [1900 + Number(m[4]), 2000 + Number(m[4])];
      return years.flatMap((y) => [
        [y, Number(m[3]), Number(m[1])],
        [y, Number(m[1]), Number(m[3])],
      ]);
    },
  },
];

function monthOf(word: string): number {
  return MONTHS[word.toLowerCase().slice(0, word.toLowerCase().startsWith("sept") ? 4 : 3)] ?? 0;
}

const iso = ([y, m, d]: [number, number, number]) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Shapes typed by hand: the kind, and what a mark says when only the AI's answer holds one. */
export const SHAPES = [
  { kind: "email", pattern: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu, mark: "an email address" },
  { kind: "gstin", pattern: new RegExp(String.raw`${EDGE_BEFORE}\d{2}[A-Za-z]{5}\d{4}[A-Za-z][A-Za-z\d][Zz][A-Za-z\d]${EDGE_AFTER}`, "gu"), mark: "a GSTIN" },
  { kind: "pan", pattern: new RegExp(String.raw`${EDGE_BEFORE}[A-Za-z]{5}\d{4}[A-Za-z]${EDGE_AFTER}`, "gu"), mark: "a PAN" },
  { kind: "passport", pattern: new RegExp(String.raw`${EDGE_BEFORE}[A-Za-z]\d{7}${EDGE_AFTER}`, "gu"), mark: "a passport number" },
  { kind: "mobile", pattern: new RegExp(String.raw`(?<![\p{N}+])(?:\+?91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?![\p{N}])`, "gu"), mark: "a mobile number" },
  { kind: "aadhaar", pattern: new RegExp(String.raw`(?<![\p{N}])\d{4}[ -]?\d{4}[ -]?\d{4}(?![\p{N}])`, "gu"), mark: "an Aadhaar number" },
] as const;

/** Every place a known detail, or a shape, is in a text. Overlaps are left to `choose`. */
function hitsIn(text: string, known: Known, neutral: (kind: string, value: string) => Detail): Hit[] {
  const hits: Hit[] = [];
  for (const { value, detail } of known.texts) {
    for (const m of text.matchAll(new RegExp(EDGE_BEFORE + valuePattern(value) + EDGE_AFTER, "giu"))) {
      hits.push({ start: m.index, end: m.index + m[0].length, detail, rank: 0 });
    }
  }
  for (const { value, detail } of known.words) {
    for (const m of text.matchAll(new RegExp(EDGE_BEFORE + valuePattern(value) + NAME_SUFFIX, "giu"))) {
      // In capitals, Title Case, or spelled exactly as the case has it (a script with no capitals): "happy" in prose stays.
      const asStored = m[0].replace(/’/g, "'") === value.replace(/’/g, "'");
      if (isCaps(m[0]) || isTitle(m[0]) || asStored) hits.push({ start: m.index, end: m.index + m[0].length, detail, rank: 1 });
    }
  }
  for (const form of DATE_FORMS) {
    for (const m of text.matchAll(form.pattern)) {
      const detail = form
        .read(m)
        .map((ymd) => known.dates.get(iso(ymd)))
        .find(Boolean);
      if (detail) hits.push({ start: m.index, end: m.index + m[0].length, detail, rank: 0 });
    }
  }
  for (const shape of SHAPES) {
    for (const m of text.matchAll(shape.pattern)) {
      const value = m[0];
      const detail =
        shape.kind === "email"
          ? known.emails.get(value.toLowerCase())
          : shape.kind === "mobile"
            ? known.phones.get(digitsOf(value))
            : shape.kind === "aadhaar"
              ? undefined
              : known.ids.get(value.toUpperCase());
      hits.push({ start: m.index, end: m.index + value.length, detail: detail ?? neutral(shape.kind, value), rank: detail ? 0 : 2 });
    }
  }
  return hits;
}

/** The longest hits that don't overlap, a known detail before a shape; in the order of the text. */
function choose(hits: Hit[]): Hit[] {
  const chosen: Hit[] = [];
  const order = [...hits].sort((a, b) => b.end - b.start - (a.end - a.start) || a.rank - b.rank || a.start - b.start);
  for (const hit of order) {
    if (!chosen.some((c) => hit.start < c.end && c.start < hit.end)) chosen.push(hit);
  }
  return chosen.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------------------------------------------------
// The swap, and the fill-back.
// ---------------------------------------------------------------------------------------------------------------------

/** A placeholder's name as it's compared: a retyped {T2 passport} or {t2_passport} is still {t2Passport}. */
export const keyOf = (name: string) => name.toLowerCase().replace(/[\s'’_-]/g, "");
export const PLACEHOLDER = /\{([^{}\n]{1,60})\}/g;

/**
 * Two or more lines in a row that each hold a | outside a note are a table (amendments 3 and 5; Frontend/src/lib/letter.ts
 * draws them by the same rule).
 */
export function tableRuns(lines: string[]): [number, number][] {
  const runs: [number, number][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isTableLine(lines[i]!)) continue;
    let end = i + 1;
    while (end < lines.length && isTableLine(lines[end]!)) end++;
    if (end - i >= 2) runs.push([i, end]);
    i = end - 1;
  }
  return runs;
}

/** The letter with each detail of the case it holds, and each table, as a placeholder. */
export function swapLetter(letter: string, facts: PrivateFacts): Swap {
  const known = knownOf(facts);
  const slots: Slot[] = [];
  const byDetail = new Map<Detail, Map<string, Slot>>();
  const taken = new Set<string>();
  // A shape the case doesn't know gets a neutral name, numbered by kind: {number1}, {mobile1}, {email1}.
  const counts = new Map<string, number>();
  const neutrals = new Map<string, Detail>();
  const neutral = (kind: string, value: string) => {
    const key = `${kind}:${value.toUpperCase()}`;
    let d = neutrals.get(key);
    if (!d) {
      const what = SHAPES.find((s) => s.kind === kind)!.mark;
      const prefix = kind === "email" || kind === "mobile" ? kind : "number";
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
      d = { base: `${prefix}${counts.get(prefix)}`, meaning: `${what} typed in the letter`, label: what, personal: true, standard: value, isName: false };
      neutrals.set(key, d);
    }
    return d;
  };
  /** The placeholder for this detail as written here: a second spelling gets its own, named by its form. */
  const slotFor = (detail: Detail, text: string) => {
    const spellings = byDetail.get(detail) ?? new Map<string, Slot>();
    byDetail.set(detail, spellings);
    const found = spellings.get(text);
    if (found) return found;
    const form =
      spellings.size === 0
        ? ""
        : detail.isName && isCaps(text)
          ? "Caps"
          : detail.isName && isTitle(text)
            ? "Title"
            : detail.isName && text === text.toLowerCase()
              ? "Lower"
              : "Alt";
    let name = `${detail.base}${form}`;
    for (let n = 2; taken.has(keyOf(name)); n++) name = `${detail.base}${form || "Alt"}${n}`;
    taken.add(keyOf(name));
    const slot: Slot = {
      name,
      meaning: spellings.size > 0 ? `${detail.meaning}, written another way` : detail.meaning,
      text,
      personal: detail.personal,
      label: detail.label,
    };
    spellings.set(text, slot);
    slots.push(slot);
    return slot;
  };
  const swapText = (text: string, sent?: Set<string>) => {
    // A detail inside a note (amendment 5) is swapped too, but isn't "sent" for Removed: a note done may drop it.
    const notes = [...text.matchAll(NOTE)].map((m) => [m.index, m.index + m[0].length] as const);
    let out = "";
    let at = 0;
    for (const hit of choose(hitsIn(text, known, neutral))) {
      const slot = slotFor(hit.detail, text.slice(hit.start, hit.end));
      const inNote = notes.some(([start, end]) => hit.start >= start && hit.end <= end);
      if (sent && slot.personal && !inNote) sent.add(slot.name);
      out += `${text.slice(at, hit.start)}{${slot.name}}`;
      at = hit.end;
    }
    return out + text.slice(at);
  };

  const original = letter.replace(/\r\n?/g, "\n");
  const sent = new Set<string>();
  // Matches never cross a line, so the swapped letter's lines are the letter's, one for one.
  const swappedLines = swapText(original, sent).split("\n");
  const originalLines = original.split("\n");
  // The travellers' names, passport numbers and dates of birth are in the key even when the letter doesn't hold them,
  // so "a table of the travellers" can be written; they're filled back as the CRM writes them.
  for (const detail of known.core) if (!byDetail.get(detail)?.size) slotFor(detail, detail.standard);

  const tables: Swap["tables"] = [];
  const tableNames = new Map<string, Swap["tables"][number]>();
  const tablePersonal = new Map<string, Set<string>>();
  const lines: string[] = [];
  let at = 0;
  for (const [start, end] of tableRuns(originalLines)) {
    // A table holding a note goes as its lines: the AI writes it out to do the note, or to delete it (amendment 5).
    if (originalLines.slice(start, end).some((line) => line.match(NOTE))) continue;
    lines.push(...swappedLines.slice(at, start));
    const table = { name: `table${tables.length + 1}`, lines: swappedLines.slice(start, end).join("\n"), original: originalLines.slice(start, end).join("\n") };
    tables.push(table);
    tableNames.set(keyOf(table.name), table);
    tablePersonal.set(table.name, new Set([...table.lines.matchAll(PLACEHOLDER)].map((m) => m[1]!).filter((n) => sent.has(n))));
    lines.push(`{${table.name}}`);
    at = end;
  }
  lines.push(...swappedLines.slice(at));

  const typedBraces = new Set(original.match(PLACEHOLDER) ?? []);
  return {
    text: lines.join("\n"),
    tables,
    slots,
    sent,
    swapMore: (text) => swapText(text.replace(/\r\n?/g, "\n")),
    fill(answer) {
      const present = new Set<string>();
      const byKey = new Map(slots.map((s) => [keyOf(s.name), s]));
      // Placeholders first, then the tables, so a table's own text isn't read for placeholders.
      const filled = answer.replace(PLACEHOLDER, (whole, inner: string) => {
        const key = keyOf(inner);
        if (tableNames.has(key)) return whole;
        const slot = byKey.get(key);
        if (slot) {
          if (slot.personal) present.add(slot.name);
          return slot.text;
        }
        // Braces staff typed stay; one the AI made up is a gap to fill in.
        return typedBraces.has(whole) ? whole : mark(inner.trim());
      });
      const text = filled.replace(PLACEHOLDER, (whole, inner: string) => {
        const table = tableNames.get(keyOf(inner));
        if (!table) return whole;
        for (const name of tablePersonal.get(table.name)!) present.add(name);
        return table.original;
      });
      return { text, present };
    },
  };
}

/** A shape (an email, a passport number…) only the AI's answer holds becomes a mark: it can't know one. */
export function markNewShapes(answer: string, sent: string): string {
  let text = answer;
  for (const shape of SHAPES) {
    text = text.replace(shape.pattern, (value) => (sent.includes(value) ? value : mark(shape.mark)));
  }
  return text;
}
