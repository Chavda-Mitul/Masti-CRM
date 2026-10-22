import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiProvider, AiReply, AiRequest } from "../src/lib/ai";
import { fakeProvider } from "../src/lib/ai/fake";
import { normaliseLetter, PURPOSE_MARK } from "../src/modules/coveringLetters/coveringLetters.schemas";
import { SAMPLE_LETTERS, seedCoveringLetters } from "../src/modules/coveringLetters/coveringLetters.seed";
import { draftLetter, type LetterFacts } from "../src/modules/coveringLetters/fill";
import { letterAsk, MAX_AI_LETTER_CHARS, tidyLetter, type TidiedLetter, type TripFacts } from "../src/modules/coveringLetters/letterAi";
import { swapLetter, type PrivateFacts } from "../src/modules/coveringLetters/placeholders";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { loginAs, prisma, resetDb } from "./helpers";
import { letterCase, letterOthers } from "./visaHelpers";

// "Write the whole letter with AI" on a visa case's covering letter (docs/decisions/0019-covering-letters.md amendment
// 4): the placeholders that keep every personal detail on the server, what the AI is asked, how its answer is checked,
// and who may ask. The AI is a stand-in that records what it was sent, so nothing is ever sent or billed.

const stub = vi.hoisted(() => ({ provider: null as AiProvider | null, asked: [] as AiRequest[] }));
vi.mock("../src/lib/ai/provider", () => ({ aiProvider: () => stub.provider }));

/** An AI that answers what `answer` makes of the request, and remembers what it was asked. */
function answering(answer: (request: AiRequest) => string, reply: Partial<AiReply> = {}): AiProvider {
  return {
    name: "anthropic",
    async complete(request) {
      stub.asked.push(request);
      return { text: answer(request), model: "claude-haiku-5-5", inputTokens: 2_000, outputTokens: 900, stopReason: "DONE", ...reply };
    },
  };
}
/** The letter it was sent, as it was sent. */
const sentLetter = (request: AiRequest) => /<letter>[\s\S]*?<\/letter>/.exec(request.prompt)![0];
/** An answer: the letter, then its reasons for the notes it left (amendment 5). */
const answerOf = (letter: string, reasons = "") => `<letter>\n${letter}\n</letter>${reasons}`;
const leftBecause = (note: string, why: string) => `<not_done><note>${note}</note><why>${why}</why></not_done>`;

const FACTS: PrivateFacts = {
  caseNo: "VISA-2026-0010",
  client: {
    name: "Rakesh Mehta",
    contactPerson: "Suresh Patel",
    address: "12 Shanti Park, Vesu, Surat 395007",
    addressLine: "12 Shanti Park",
    pincode: "395007",
    mobile: "9825041234",
    phones: ["9898012345"],
    email: "rakesh@example.com",
    pan: "ABCDE1234F",
    gstin: null,
  },
  travellers: [
    { name: "RAKESH MEHTA", label: "Adult 1", passportNumber: "Z1234567", dateOfBirth: "1980-03-12", passportExpiry: "2030-09-05", mobile: null, homeAddress: null, officeAddress: null },
    { name: "HAPPY D'SOUZA", label: "Adult 2", passportNumber: "Z7654321", dateOfBirth: "1985-09-05", passportExpiry: null, mobile: "9712345678", homeAddress: null, officeAddress: null },
    { name: "રમેશ પટેલ", label: "Adult 3", passportNumber: null, dateOfBirth: null, passportExpiry: null, mobile: null, homeAddress: null, officeAddress: null },
  ],
  dates: { today: "2026-10-22", madeOn: null, departOn: "2026-11-21", returnOn: "2026-12-02" },
};

/** The same case as the draft sees it. */
const LETTER_FACTS: LetterFacts = {
  clientName: "Rakesh Mehta",
  clientAddress: "12 Shanti Park, Vesu, Surat 395007",
  country: "France",
  visaType: "Tourist",
  trip: { departOn: "2026-11-21", returnOn: "2026-12-02", entryType: "SINGLE", hotelStay: "Hotel Lutetia, Paris" },
  travellers: [
    { name: "RAKESH MEHTA", label: "Adult 1", relation: "Self", dateOfBirth: "1980-03-12", passportNumber: "Z1234567" },
    { name: "HAPPY D'SOUZA", label: "Adult 2", relation: "Friend", dateOfBirth: "1985-09-05", passportNumber: "Z7654321" },
    { name: "રમેશ પટેલ", label: "Adult 3", relation: "Friend", dateOfBirth: null, passportNumber: null },
  ],
};

const TRIP: TripFacts = {
  country: "France",
  visaType: { code: "TOURIST", name: "Tourist" },
  clientKind: "INDIVIDUAL",
  travellers: [
    { relation: "Self", isChild: false },
    { relation: "Friend", isChild: false },
    { relation: "Friend", isChild: false },
  ],
  trip: { departOn: "2026-11-21", returnOn: "2026-12-02" },
  hotelStay: "Hotel Lutetia, Paris; call 9825041234",
};

/** A letter staff changed by hand, with every kind of detail in every kind of spelling, and text that only looks like one. */
const EDITED = [
  "22 October 2026",
  "",
  "I, the undersigned, RAKESH MEHTA, apply with Happy D’Souza (Rakeshbhai's friend) and રમેશ પટેલ. We are happy to go in May. નમસ્તે.",
  "",
  "Name | Relation | Date of birth | Passport no.",
  "RAKESH MEHTA | Self | 12 Mar 1980 | Z1234567",
  "HAPPY D'SOUZA | Friend | 5 Sept 1985 | Z7654321",
  "",
  "We travel from 21 November 2026 to 2 December 2026, also written 21/11/2026, flying from Surat. Born 05/09/1985 and 5 Sep 1985, valid to 5 Sep 2030.",
  "It costs Rs 12,000 at #302, A trip. 1. Passport, Hotel [Opera] {x}, R.K. Sharma.",
  "Call 98250 41234, +91 97123 45678 or 9876543210; write to rakesh@example.com or x@y.in. PAN ABCDE1234F, Aadhaar 1234 5678 9012, passport K7654321. Ask Suresh Patel.",
  "",
  "Rakesh Mehta",
  "12 Shanti Park, Vesu, Surat 395007",
  "Ref VISA-2026-0010",
].join("\n");

/** What may never reach the AI from EDITED or FACTS. */
const PERSONAL = [
  "RAKESH", "Rakesh", "MEHTA", "Mehta", "HAPPY", "Happy D", "SOUZA", "Souza", "રમેશ", "પટેલ", "Suresh", "Patel",
  "Z1234567", "Z7654321", "K7654321", "1980", "1985", "2030", "12 Mar", "5 Sep", "05/09",
  "98250", "41234", "9825041234", "97123", "9712345678", "9876543210", "rakesh@", "x@y.in", "ABCDE1234F", "1234 5678 9012",
  "Shanti", "395007", "Vesu", "VISA-2026-0010",
];

describe("the placeholders", () => {
  it("give every letter back exactly as it was: the samples as drafted, and a letter changed by hand", () => {
    const letters = [...SAMPLE_LETTERS.map((s) => draftLetter(s.body, LETTER_FACTS, "2026-10-22").letter), EDITED];
    for (const letter of letters) {
      const swap = swapLetter(letter, FACTS);
      expect(swap.fill(swap.text).text, letter.slice(0, 60)).toBe(letter);
    }
  });

  it("swap every personal detail, in every spelling, and leave what only looks like one", () => {
    const { text } = swapLetter(EDITED, FACTS);
    for (const value of PERSONAL) expect(text, value).not.toContain(value);
    for (const kept of ["happy to go in May", "નમસ્તે", "flying from Surat", "Rs 12,000", "#302", "A trip", "1. Passport", "Hotel [Opera] {x}", "R.K. Sharma"]) {
      expect(text, kept).toContain(kept);
    }
    expect(text).toContain("I, the undersigned, {t1Name}, apply with {t2Name} ({t1Given}bhai's friend) and {t3Name}.");
    expect(text).toContain("Born {t2BirthAlt} and {t2BirthAlt2}, valid to {t1Expiry}.");
    expect(text).toContain("Call {clientMobile}, {t2Mobile} or {mobile1}; write to {clientEmail} or {email1}. PAN {clientPan}, Aadhaar {number2}, passport {number1}. Ask {contactName}.");
    expect(text.split("\n").slice(-3)).toEqual(["{t1NameTitle}", "{clientAddress}", "Ref {caseNo}"]);
  });

  it("send each table as one placeholder, its lines in the key with the details swapped", () => {
    const swap = swapLetter(EDITED, FACTS);
    expect(swap.text.split("\n")[4]).toBe("{table1}");
    expect(swap.tables).toEqual([
      {
        name: "table1",
        lines: "Name | Relation | Date of birth | Passport no.\n{t1Name} | Self | {t1Birth} | {t1Passport}\n{t2NameCaps} | Friend | {t2Birth} | {t2Passport}",
        original: EDITED.split("\n").slice(4, 7).join("\n"),
      },
    ]);
  });

  it("name each placeholder for what it is, give one meaning per spelling, and keep the trip's dates with their values", () => {
    const { slots } = swapLetter(EDITED, FACTS);
    const meaning = (name: string) => slots.find((s) => s.name === name)?.meaning;
    expect(meaning("t1Name")).toBe("traveller 1's name (the applicant), also the client's name");
    expect(meaning("t2NameCaps")).toBe("traveller 2's name, written another way");
    expect(meaning("t1Passport")).toBe("traveller 1's passport number");
    expect(meaning("departOn")).toBe("the day they travel out: 21 November 2026");
    expect(meaning("number1")).toBe("a passport number typed in the letter");
    for (const slot of slots.filter((s) => s.personal)) {
      for (const value of PERSONAL) expect(slot.meaning, slot.name).not.toContain(value);
    }
  });

  it("offer the travellers' names, passport numbers and dates of birth even when the letter doesn't hold them", () => {
    const swap = swapLetter("Dear Sir,", FACTS);
    expect(swap.text).toBe("Dear Sir,");
    expect(swap.slots.map((s) => s.name)).toEqual(["t1Name", "t1Passport", "t1Birth", "t2Name", "t2Passport", "t2Birth", "t3Name"]);
    expect(swap.fill("{t1Name} | {t1Passport} | {t1Birth}").text).toBe("RAKESH MEHTA | Z1234567 | 12 Mar 1980");
    expect(swap.sent.size).toBe(0);
  });

  it("swap the hotel stay the same way", () => {
    expect(swapLetter("Dear Sir,", FACTS).swapMore("Hotel Lutetia, Paris; call 9825041234")).toBe("Hotel Lutetia, Paris; call {clientMobile}");
  });

  it("fill back a placeholder the AI retyped, keep braces staff typed, and mark one it made up", () => {
    const swap = swapLetter("Dear {x}, {t1Name}", { ...FACTS, travellers: FACTS.travellers.slice(0, 1) });
    expect(swap.text).toBe("Dear {x}, {t1Name}");
    expect(swap.fill("{T1 NAME}, {t1_name}, {t1’name}, {x} and {the hotel}").text).toBe("RAKESH MEHTA, RAKESH MEHTA, RAKESH MEHTA, {x} and ⟦the hotel⟧");
  });
});

describe("what the AI is asked", () => {
  it("the trip with placeholders for the travellers, the key with meanings only, and the letter", () => {
    const swap = swapLetter(EDITED, FACTS);
    const { system, prompt } = letterAsk(TRIP, swap);
    const sent = `${system}\n${prompt}`;
    for (const value of PERSONAL) expect(sent, value).not.toContain(value);
    expect(prompt).toContain("- Travellers: 3\n  1. {t1Name}, the applicant (Self, adult)\n  2. {t2Name} (Friend, adult)\n  3. {t3Name} (Friend, adult)");
    expect(prompt).toContain("- Dates: {departOn} to {returnOn} (12 days)");
    expect(prompt).toContain("- Hotel stay: <hotel_stay>Hotel Lutetia, Paris; call {clientMobileAlt}</hotel_stay>");
    expect(prompt).toContain("- {t1Passport}: traveller 1's passport number");
    expect(prompt).toContain("- {table1}: a table, kept as it is when you keep {table1} on its line. Its lines:\n    Name | Relation | Date of birth | Passport no.");
    expect(prompt).toContain(`<letter>\n${swap.text}\n</letter>`);
    expect(system).toContain("small detail you don't know");
    expect(system).not.toMatch(/Surat|Masti/);
  });

  it("each visa type's own words, and general words for any other", () => {
    const swap = swapLetter("Dear Sir,", FACTS);
    const systemFor = (code: string, name: string) => letterAsk({ ...TRIP, visaType: { code, name } }, swap).system;
    expect(systemFor("TOURIST", "Tourist")).toContain("famous places and natural sights");
    expect(systemFor("BUSINESS", "Business")).toContain("⟦name of the company we are visiting⟧");
    expect(systemFor("VISITOR", "Visitor")).toContain("⟦name and relation of the person we are visiting⟧");
    expect(systemFor("STUDENT", "Student")).toContain("For a Student visa, the paragraph on why they travel says in general words why they are going.");
    expect(systemFor("TOURIST", "Tourist")).not.toMatch(/This is a/);
  });

  it("says what isn't known yet, a traveller with no name, and when a company books", () => {
    const facts = { ...FACTS, travellers: [{ ...FACTS.travellers[0]!, name: null }] };
    const swap = swapLetter("Dear Sir,", facts);
    const { prompt } = letterAsk({ ...TRIP, clientKind: "CORPORATE", travellers: [{ relation: null, isChild: false }], trip: { departOn: null, returnOn: null }, hotelStay: null }, swap);
    expect(prompt).toContain("- Booked by: a company, for its people");
    expect(prompt).toContain("  1. traveller 1, no name yet, the applicant (relation not recorded, adult)");
    expect(prompt).toContain("- Dates: not known yet");
    expect(prompt).toContain("- Hotel stay: none given yet");
  });
});

describe("checking the answer", () => {
  const swap = () => swapLetter(EDITED, FACTS);
  const answer = (letter: string) => `<letter>\n${letter}\n</letter>`;

  it("takes one whole letter, and only that", () => {
    const s = swap();
    expect(tidyLetter("Here it is.", s)).toMatchObject({ error: { message: "The AI's answer wasn't a whole letter. Please try again.", retryable: true } });
    expect(tidyLetter(`${answer("A")}${answer("B")}`, s)).toHaveProperty("error");
    expect(tidyLetter(answer("  \n "), s)).toMatchObject({ error: { message: "The AI gave an empty answer. Please try again." } });
    expect(tidyLetter(answer("x".repeat(60_001)), s)).toMatchObject({ error: { message: "The AI's letter was too long. Please try again." } });
  });

  it("fills every placeholder back, keeps a table it kept, and drops only the code fence, headings and bold it added", () => {
    const s = swap();
    expect(tidyLetter(`Sure!\n<letter>\n\`\`\`\n${s.text}\n\`\`\`\n</letter>`, s)).toEqual({ letter: EDITED, removed: [], done: [], notDone: [] });
    expect(tidyLetter(answer(`## Covering letter\n**Dear Sir,**\n\n{table1}`), s)).toMatchObject({
      letter: `Covering letter\nDear Sir,\n\n${EDITED.split("\n").slice(4, 7).join("\n")}`,
    });
  });

  it("marks what the AI made up: a [placeholder], or a number, mobile or email it can't know", () => {
    const s = swap();
    const { letter } = tidyLetter(answer("We will see [the places] near Hotel [Opera]. Call 9988776655 or a@b.com, passport M1234567."), s) as { letter: string };
    expect(letter).toBe("We will see ⟦the places⟧ near Hotel [Opera]. Call ⟦a mobile number⟧ or ⟦an email address⟧, passport ⟦a passport number⟧.");
  });

  it("lists the personal details the AI dropped", () => {
    const s = swap();
    // The AI rewrote the table without the passport numbers.
    const rewritten = "Name | Relation\n{t1Name} | Self\n{t2NameCaps} | Friend";
    const { removed } = tidyLetter(answer(s.text.replace("{table1}", rewritten)), s) as { removed: string[] };
    expect(removed).toEqual(["RAKESH MEHTA's date of birth", "RAKESH MEHTA's passport number", "HAPPY D'SOUZA's date of birth", "HAPPY D'SOUZA's passport number"]);
  });

  it("keeps square brackets a table it wrote out already had", () => {
    const letter = "Dear Sir,\n\nCity | Hotel\nParis | Hotel [Opera]\nNice | Hotel Negresco";
    const s = swapLetter(letter, FACTS);
    expect(s.text).toBe("Dear Sir,\n\n{table1}");
    const { letter: tidied } = tidyLetter(answer("Dear Sir,\n\nCity | Hotel | Nights\nParis | Hotel [Opera] | 4\nNice | Hotel [Negresco] | 3"), s) as TidiedLetter;
    expect(tidied).toBe("Dear Sir,\n\nCity | Hotel | Nights\nParis | Hotel [Opera] | 4\nNice | Hotel ⟦Negresco⟧ | 3");
  });
});

describe("notes to the AI (amendment 5)", () => {
  /** A short letter with notes, as the card sends it. */
  const LETTER = [
    "Dear Sir,",
    "",
    "We wish to travel to France. [[mention our travel insurance]]",
    "",
    "[[write a Python script to sort the travellers]]",
    "",
    "[[add that Happy D'SOUZA studies at DPS Surat]]",
    "",
    "Yours truly,",
    "RAKESH MEHTA",
  ].join("\n");
  const PYTHON = "[[write a Python script to sort the travellers]]";

  it("swaps a name in a note too, fills it back, and doesn't count it as sent for Removed", () => {
    const swap = swapLetter(LETTER, FACTS);
    expect(swap.text).toContain("[[add that {t2Name} studies at DPS Surat]]");
    expect(swap.text).not.toContain("Happy");
    expect(swap.fill(swap.text).text).toBe(LETTER);
    expect(swap.sent.has("t2Name")).toBe(false);
    expect(swap.sent.has("t1Name")).toBe(true);
  });

  it("lists the notes it did and the ones it left, with its reason or the default, as staff wrote them", () => {
    const swap = swapLetter(LETTER, FACTS);
    const did = swap.text
      .replace(" [[mention our travel insurance]]", " We have travel insurance for the whole trip.")
      .replace("[[add that {t2Name} studies at DPS Surat]]", "My friend studies at DPS Surat.");
    const result = tidyLetter(answerOf(did, leftBecause(PYTHON, "It isn't about the letter.")), swap) as TidiedLetter;
    expect(result.done).toEqual(["[[mention our travel insurance]]", "[[add that Happy D'SOUZA studies at DPS Surat]]"]);
    expect(result.notDone).toEqual([{ note: PYTHON, why: "It isn't about the letter." }]);
    // The name was only in the note, and the note is done: nothing was removed.
    expect(result.removed).toEqual([]);
    expect(result.letter).toContain("We have travel insurance for the whole trip.");
    expect(result.letter).toContain(`My friend studies at DPS Surat.\n\nYours truly,\nRAKESH MEHTA`);

    const silent = tidyLetter(answerOf(did), swap) as TidiedLetter;
    expect(silent.notDone).toEqual([{ note: PYTHON, why: "The AI left it as it is." }]);
  });

  it("puts back, once and at the end, a note it says it left but dropped", () => {
    const swap = swapLetter(LETTER, FACTS);
    const dropped = swap.text.replace(PYTHON, "");
    const result = tidyLetter(answerOf(dropped, leftBecause(PYTHON.slice(2, -2), "Not about the letter.")), swap) as TidiedLetter;
    expect(result.letter.match(/write a Python script/g)).toHaveLength(1);
    expect(result.letter.endsWith(`RAKESH MEHTA\n\n${PYTHON}`)).toBe(true);
    expect(result.notDone).toContainEqual({ note: PYTHON, why: "Not about the letter." });
    expect(result.done).toEqual([]);
  });

  it("keeps a note it retyped as staff wrote it: neither a mark nor done", () => {
    const swap = swapLetter(LETTER, FACTS);
    const retyped = swap.text.replace(PYTHON, "[[ Write a python  script to sort the travellers ]]");
    const result = tidyLetter(answerOf(retyped), swap) as TidiedLetter;
    expect(result.letter).toBe(LETTER);
    expect(result.done).toEqual([]);
    expect(result.notDone.map((n) => n.note)).toEqual(["[[mention our travel insurance]]", PYTHON, "[[add that Happy D'SOUZA studies at DPS Surat]]"]);
  });

  it("marks a note of its own, however long", () => {
    const swap = swapLetter("Dear Sir,", FACTS);
    const long = "please check this ".repeat(6).trim();
    const result = tidyLetter(answerOf(`Dear Sir,\n\n[[check the dates]] [[${long}]]`), swap) as TidiedLetter;
    expect(result.letter).toBe(`Dear Sir,\n\n⟦check the dates⟧ ⟦${long}⟧`);
    expect(result.done).toEqual([]);
    expect(result.notDone).toEqual([]);
  });

  it("takes its reasons out of the letter, and does without them when they're malformed", () => {
    const swap = swapLetter("Dear Sir,\n\n[[write a poem]]", FACTS);
    const inside = tidyLetter(answerOf(`Dear Sir,\n\n[[write a poem]]\n${leftBecause("[[write a poem]]", "Not about the letter.")}`), swap) as TidiedLetter;
    expect(inside.letter).toBe("Dear Sir,\n\n[[write a poem]]");
    expect(inside.notDone).toEqual([{ note: "[[write a poem]]", why: "Not about the letter." }]);

    const malformed = tidyLetter(answerOf("Dear Sir,\n\n[[write a poem]]", "<not_done><note>[[write a poem]]"), swap) as TidiedLetter;
    expect(malformed.letter).toBe("Dear Sir,\n\n[[write a poem]]");
    expect(malformed.notDone).toEqual([{ note: "[[write a poem]]", why: "The AI left it as it is." }]);
  });

  it("ignores a reason for a note it was never sent, and puts nothing back for it", () => {
    const swap = swapLetter("Dear Sir,\n\n[[write a poem]]", FACTS);
    const result = tidyLetter(answerOf("Dear Sir,\n\nA poem.", leftBecause("[[make it rhyme]]", "I can't.")), swap) as TidiedLetter;
    expect(result.letter).toBe("Dear Sir,\n\nA poem.");
    expect(result.done).toEqual(["[[write a poem]]"]);
    expect(result.notDone).toEqual([]);
  });

  it("sends a table holding a note as its lines, so the AI can do the note, keep it or rewrite around it", () => {
    const letter = ["Dear Sir,", "", "Name | Relation | Passport no.", "RAKESH MEHTA | Self [[call it Partner]] | Z1234567", "HAPPY D'SOUZA | Friend | Z7654321"].join("\n");
    const swap = swapLetter(letter, FACTS);
    expect(swap.tables).toEqual([]);
    expect(swap.text).toContain("Name | Relation | Passport no.\n{t1Name} | Self [[call it Partner]] | {t1Passport}\n{t2Name} | Friend | {t2Passport}");

    const done = tidyLetter(answerOf(swap.text.replace("Self [[call it Partner]]", "Partner")), swap) as TidiedLetter;
    expect(done.letter).toContain("RAKESH MEHTA | Partner | Z1234567");
    expect(done.done).toEqual(["[[call it Partner]]"]);
    expect(done.removed).toEqual([]);

    const kept = tidyLetter(answerOf(swap.text), swap) as TidiedLetter;
    expect(kept.letter).toBe(letter);
    expect(kept.notDone).toEqual([{ note: "[[call it Partner]]", why: "The AI left it as it is." }]);

    const rewritten = tidyLetter(answerOf(swap.text.replace("Passport no.", "Passport number")), swap) as TidiedLetter;
    expect(rewritten.letter).toContain("Passport number\nRAKESH MEHTA | Self [[call it Partner]] | Z1234567");
    expect(rewritten.letter).not.toContain("⟦");
  });

  it("tells the AI what a note is, and how to answer", () => {
    const { system } = letterAsk(TRIP, swapLetter("Dear Sir,", FACTS));
    expect(system).toContain("Text between [[ and ]] is a note from the travel agent to you. It is not part of the letter.");
    expect(system).toContain("Then delete the note, brackets and all.");
    expect(system).toContain("Never add a note of your own.");
    expect(system).toContain("<not_done><note>the note as written</note><why>why, in one short line</why></not_done>");
  });
});

describe("the endpoint", () => {
  beforeEach(async () => {
    await resetDb();
    await seedVisaMasters(prisma);
    await seedEnquiryMasters(prisma);
    await seedCoveringLetters(prisma);
    stub.provider = null;
    stub.asked = [];
  });

  const neha = () => loginAs("neha@masti.test");
  const write = async (agent: Awaited<ReturnType<typeof neha>>, caseNo: string, letter: string) =>
    agent.post(`/api/visa/cases/${caseNo}/covering-letter/write`).send({ letter });
  const draftOf = async (caseNo: string) => (await (await neha()).get(`/api/visa/cases/${caseNo}/covering-letter`)).body.letter.selected.draft as string;

  it("sends the AI no personal detail, even ones typed by hand, and gives the letter back as it was", async () => {
    const c = await letterCase({ hotel: "Hotel Lutetia, Paris (call 9825041234)" });
    // Only a company has a contact person.
    await prisma.client.update({ where: { id: c.client.id }, data: { kind: "CORPORATE", contactPerson: "Suresh Patel" } });
    const typed = "Born 19/01/2014 and 12 Mar 1980. Rakeshbhai will call 9876543210 or ask Suresh Patel; passport K7654321.";
    const letter = `${await draftOf(c.caseNo)}\n\n${typed}`;
    stub.provider = answering(sentLetter);

    const res = await write(await neha(), c.caseNo, letter);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ letter: normaliseLetter(letter), removed: [], done: [], notDone: [] });

    const asked = stub.asked[0]!;
    const sent = `${asked.system}\n${asked.prompt}`;
    for (const value of ["RAKESH", "Rakesh", "MEHTA", "Mehta", "AARAV", "Aarav", "Z1234567", "Z1234569", "K7654321", "1980", "2014", "12 Mar", "19 Jan", "19/01"]) {
      expect(sent, value).not.toContain(value);
    }
    for (const value of ["12 Shanti Park", "Shanti", "395007", "Vesu", "Surat", "98250", "41234", "9825041234", "9876543210", "Suresh", "Patel", c.caseNo]) {
      expect(sent, value).not.toContain(value);
    }
    expect(asked).toMatchObject({ maxTokens: 8_000, effort: "medium", timeoutMs: 45_000, maxRetries: 1 });
    expect(asked.prompt).toContain(PURPOSE_MARK);
  });

  it("records the call, audits nothing, and lists what the AI dropped", async () => {
    const c = await letterCase();
    const neha_ = await neha();
    stub.provider = answering((r) => sentLetter(r).replace(/\{table1\}/, "The table is gone."));
    const res = await write(neha_, c.caseNo, await draftOf(c.caseNo));
    expect(res.status).toBe(200);
    // AARAV MEHTA's name was only in the table; RAKESH MEHTA's is in the letter too.
    expect(res.body.removed).toEqual([
      "RAKESH MEHTA's date of birth",
      "RAKESH MEHTA's passport number",
      "AARAV MEHTA's name",
      "AARAV MEHTA's date of birth",
      "AARAV MEHTA's passport number",
    ]);
    expect(res.body.letter).toContain("The table is gone.");

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
    expect(await prisma.aiCall.findFirstOrThrow()).toMatchObject({ useCase: "visa.coveringLetter.write", status: "OK", userId: user.id, enquiryId: c.id });
    expect(await prisma.auditLog.count({ where: { action: { contains: "coveringLetter" } } })).toBe(0);
    expect((await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id } })).coveringLetterText).toBeNull();
  });

  it("lets the case's owner, the Visa HOD and the Head ask; not other Visa staff or viewers, nor after File preparation", async () => {
    const c = await letterCase();
    const letter = await draftOf(c.caseNo);
    const { hod, head, viewer } = await letterOthers();
    stub.provider = answering(sentLetter);
    expect((await write(await loginAs("aarti@masti.test"), c.caseNo, letter)).status).toBe(403);
    expect((await write(viewer, c.caseNo, letter)).status).toBe(403);
    expect((await write(hod, c.caseNo, letter)).status).toBe(200);
    expect((await write(head, c.caseNo, letter)).status).toBe(200);

    const dispatch = await prisma.departmentStage.findFirstOrThrow({ where: { code: "DISPATCH" } });
    await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: dispatch.id } });
    expect((await write(await neha(), c.caseNo, letter)).status).toBe(409);
  });

  it("refuses a letter too long to write in time, before any call", async () => {
    const c = await letterCase();
    stub.provider = answering(sentLetter);
    const res = await write(await neha(), c.caseNo, `Dear Sir,\n\n${"We travel. ".repeat(MAX_AI_LETTER_CHARS / 10)}`);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      message: "This letter is too long for the AI to write. Shorten it, or change it by hand.",
      details: { code: "AI_FAILED", retryable: false },
    });
    expect(stub.asked).toHaveLength(0);
    expect(await prisma.aiCall.count()).toBe(0);
  });

  it("answers 503 AI_FAILED in plain words when the AI is off, refuses, or doesn't give a letter", async () => {
    const c = await letterCase();
    const agent = await neha();
    const letter = await draftOf(c.caseNo);

    const off = await write(agent, c.caseNo, letter);
    expect(off.status).toBe(503);
    expect(off.body).toEqual({ message: "AI isn't set up yet.", details: { code: "AI_FAILED", retryable: false } });

    stub.provider = answering(() => "", { stopReason: "REFUSED" });
    expect((await write(agent, c.caseNo, letter)).body.details).toEqual({ code: "AI_FAILED", retryable: false });

    stub.provider = answering(() => "Here is a lovely letter for you.");
    const notALetter = await write(agent, c.caseNo, letter);
    expect(notALetter.body).toEqual({ message: "The AI's answer wasn't a whole letter. Please try again.", details: { code: "AI_FAILED", retryable: true } });
    expect(await prisma.aiCall.findFirstOrThrow({ orderBy: { createdAt: "desc" } })).toMatchObject({ status: "FAILED", error: notALetter.body.message });
  });

  it("runs on the fake AI, which gives the letter back as it was", async () => {
    const c = await letterCase();
    stub.provider = fakeProvider;
    const letter = await draftOf(c.caseNo);
    const res = await write(await neha(), c.caseNo, letter);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ letter, removed: [], done: [], notDone: [] });
  });

  it("answers which notes the AI did and which it left, and sends no name in a note", async () => {
    const c = await letterCase();
    const letter = `${await draftOf(c.caseNo)}\n\n[[add that Aarav loves trains]]\n\n[[write a Python script]]`;
    stub.provider = answering(
      (r) =>
        sentLetter(r).replace(/\[\[add that (\{\w+\}) loves trains\]\]/, "$1 loves trains.") +
        leftBecause("[[write a Python script]]", "It isn't about the letter."),
    );
    const res = await write(await neha(), c.caseNo, letter);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      letter: letter.replace("[[add that Aarav loves trains]]", "Aarav loves trains."),
      removed: [],
      done: ["[[add that Aarav loves trains]]"],
      notDone: [{ note: "[[write a Python script]]", why: "It isn't about the letter." }],
    });
    expect(stub.asked[0]!.prompt).not.toContain("Aarav");
  });

  it("leaves each note as it is on the fake AI", async () => {
    const c = await letterCase();
    stub.provider = fakeProvider;
    const letter = `${await draftOf(c.caseNo)}\n\n[[mention our travel insurance]]`;
    const res = await write(await neha(), c.caseNo, letter);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ letter, removed: [], done: [], notDone: [{ note: "[[mention our travel insurance]]", why: "The AI left it as it is." }] });
  });
});
