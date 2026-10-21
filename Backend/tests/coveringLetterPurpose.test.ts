import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiProvider, AiReply, AiRequest } from "../src/lib/ai";
import { seedCoveringLetters } from "../src/modules/coveringLetters/coveringLetters.seed";
import { purposeAsk, tidyParagraph, type PurposeFacts } from "../src/modules/coveringLetters/purpose";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { loginAs, prisma, resetDb } from "./helpers";
import { letterCase, letterOthers } from "./visaHelpers";

// "Write it with AI" on a visa case's covering letter (docs/decisions/0019-covering-letters.md amendment 2): what the AI
// is asked, never a name or a passport number, how its answer is tidied, and who may ask. The AI is a stand-in that
// records what it was sent, as messages.test.ts does for WhatsApp, so nothing is ever sent or billed.

const stub = vi.hoisted(() => ({ provider: null as AiProvider | null, asked: [] as AiRequest[] }));
vi.mock("../src/lib/ai/provider", () => ({ aiProvider: () => stub.provider }));

/** An AI that answers this, and remembers what it was asked. */
function answering(text: string, reply: Partial<AiReply> = {}): AiProvider {
  return {
    name: "anthropic",
    async complete(request) {
      stub.asked.push(request);
      return { text, model: "claude-haiku-5-5", inputTokens: 700, outputTokens: 600, stopReason: "DONE", ...reply };
    },
  };
}

const FAMILY: PurposeFacts = {
  country: "France",
  visaType: { code: "TOURIST", name: "Tourist" },
  clientKind: "INDIVIDUAL",
  travellers: [
    { relation: "Self", isChild: false },
    { relation: "Spouse", isChild: false },
    { relation: "Son", isChild: true },
  ],
  trip: { departOn: "2026-12-10", returnOn: "2026-12-21" },
  hotelStay: "Hotel Lutetia, Paris",
};

describe("what the AI is asked", () => {
  it("writes the trip in: the country, the visa, who travels by relation, the dates and the hotel stay as data", () => {
    const { prompt } = purposeAsk(FAMILY);
    expect(prompt.split("\n")).toEqual([
      "The trip:",
      "- Country: France",
      "- Visa: Tourist",
      "- Booked by: a person, for themselves and their family",
      "- Travellers: 3",
      "  1. The applicant (Self, adult)",
      "  2. Spouse, adult",
      "  3. Son, child",
      "- Dates: 10 December 2026 to 21 December 2026 (12 days)",
      "- Hotel stay: <hotel_stay>Hotel Lutetia, Paris</hotel_stay>",
      "",
      'The relations are to the client who booked the trip: "Self" is the client.',
    ]);
  });

  it("says plainly what isn't known yet, and when a company books for its people", () => {
    const { prompt } = purposeAsk({
      ...FAMILY,
      clientKind: "CORPORATE",
      travellers: [{ relation: null, isChild: false }],
      trip: { departOn: "2026-12-10", returnOn: null },
      hotelStay: null,
    });
    expect(prompt).toContain("- Booked by: a company, for its people");
    expect(prompt).toContain("  1. The applicant (relation not recorded, adult)");
    expect(prompt).toContain("- Dates: not known yet");
    expect(prompt).toContain("- Hotel stay: none given yet");
  });

  it("gives each visa type its own instructions, and any other a plain one, after the shared rules", () => {
    const system = (code: string, name: string) => purposeAsk({ ...FAMILY, visaType: { code, name } }).system;
    for (const s of [system("TOURIST", "Tourist"), system("BUSINESS", "Business"), system("VISITOR", "Visitor"), system("STUDENT", "Student")]) {
      expect(s).toMatch(/^You write one paragraph of a covering letter/);
      expect(s).toContain("Never invent a name, a company, a place, a date, an address or an amount.");
      expect(s).toContain("write a short placeholder between ⟦ and ⟧");
      expect(s).toContain("Never give reasons you haven't been told, such as family, work, property or ties.");
      // Told the agency's city, a model wrote "my family, business and property here in Surat" (21 Oct 2026).
      expect(s).not.toMatch(/Surat|Masti/);
    }
    expect(system("TOURIST", "Tourist")).toContain("This is a tourist visa.");
    expect(system("TOURIST", "Tourist")).toContain("⟦the places we plan to visit⟧");
    expect(system("BUSINESS", "Business")).toContain("⟦name of the company we are visiting⟧ in ⟦city⟧");
    expect(system("VISITOR", "Visitor")).toContain("⟦name and relation of the person we are visiting⟧");
    expect(system("STUDENT", "Student")).toContain("This is a Student visa. Say in general words why they are travelling");
  });
});

describe("tidying the AI's answer", () => {
  it("leaves one plain paragraph: no quotes around it, no Markdown, no list marks, no line breaks", () => {
    expect(tidyParagraph('"We wish to visit Paris and Nice."', null)).toBe("We wish to visit Paris and Nice.");
    expect(tidyParagraph("“We wish to visit Paris.”", null)).toBe("We wish to visit Paris.");
    expect(tidyParagraph("**We** wish\n\nto visit __Paris__.", null)).toBe("We wish to visit Paris.");
    expect(tidyParagraph("- We wish to visit Paris.\r\n- We will return to India.", null)).toBe("We wish to visit Paris. We will return to India.");
    expect(tidyParagraph('He called it "the city of light".', null)).toBe('He called it "the city of light".');
  });

  it("turns a placeholder written with [ ] or { } into a mark, but not brackets the hotel stay itself has", () => {
    expect(tidyParagraph("We will meet [name of the company] in {city}.", null)).toBe("We will meet ⟦name of the company⟧ in ⟦city⟧.");
    expect(tidyParagraph("We will meet ⟦name of the company⟧.", null)).toBe("We will meet ⟦name of the company⟧.");
    expect(tidyParagraph("We will stay near Hotel [Opera] and see [the places].", "Hotel [Opera], Paris")).toBe(
      "We will stay near Hotel [Opera] and see ⟦the places⟧.",
    );
  });

  it("gives nothing back for an answer with no words", () => {
    expect(tidyParagraph(' "" \n ', null)).toBe("");
  });
});

describe("Write it with AI", () => {
  beforeEach(async () => {
    await resetDb();
    await seedVisaMasters(prisma);
    await seedEnquiryMasters(prisma);
    await seedCoveringLetters(prisma);
    stub.provider = null;
    stub.asked = [];
  });

  const write = async (caseNo: string, email = "neha@masti.test") =>
    (await loginAs(email)).post(`/api/visa/cases/${caseNo}/covering-letter/purpose`).send({});

  it("writes the paragraph from the trip alone: no name, passport number, date of birth, address or mobile is sent", async () => {
    const c = await letterCase();
    stub.provider = answering("We wish to see the famous places of Paris and spend time together as a family.");
    const neha = await loginAs("neha@masti.test");
    // Counted after logging in, which is audited itself.
    const audits = await prisma.auditLog.count();
    const res = await neha.post(`/api/visa/cases/${c.caseNo}/covering-letter/purpose`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ paragraph: "We wish to see the famous places of Paris and spend time together as a family." });

    expect(stub.asked).toHaveLength(1);
    expect(stub.asked[0]).toMatchObject({ model: "claude-haiku-5-5", maxTokens: 3_000, effort: "medium" });
    const sent = `${stub.asked[0]!.system}\n${stub.asked[0]!.prompt}`;
    expect(sent).toContain("- Country: France");
    expect(sent).toContain("  2. Son, child");
    expect(sent).toContain("<hotel_stay>Hotel Lutetia, Paris</hotel_stay>");
    const secrets = ["Rakesh", "RAKESH", "Mehta", "MEHTA", "AARAV", "Z1234567", "Z1234569", "1980", "2014", "12 Mar", "19 Jan"];
    const more = ["12 Shanti Park", "Vesu", "395007", "98250", "9825041234", c.caseNo];
    for (const secret of [...secrets, ...more]) expect(sent, secret).not.toContain(secret);

    const nehaUser = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
    expect(await prisma.aiCall.findFirstOrThrow()).toMatchObject({
      useCase: "visa.coveringLetter.purpose",
      status: "OK",
      userId: nehaUser.id,
      enquiryId: c.id,
    });
    // Nothing on the case changed, so nothing is audited.
    expect(await prisma.auditLog.count()).toBe(audits);
  });

  it("tidies the answer before the card gets it", async () => {
    const c = await letterCase();
    stub.provider = answering('"We will meet our associates at [name of the company] in {city}."');
    expect((await write(c.caseNo)).body.paragraph).toBe("We will meet our associates at ⟦name of the company⟧ in ⟦city⟧.");
  });

  it("is for the case's owner, the Visa HOD and the Head, at File preparation", async () => {
    const c = await letterCase();
    stub.provider = answering("We wish to see Paris.");
    const { hod, head, viewer } = await letterOthers();
    expect((await write(c.caseNo, "aarti@masti.test")).status).toBe(403);
    expect((await viewer.post(`/api/visa/cases/${c.caseNo}/covering-letter/purpose`).send({})).status).toBe(403);
    expect((await hod.post(`/api/visa/cases/${c.caseNo}/covering-letter/purpose`).send({})).status).toBe(200);
    expect((await head.post(`/api/visa/cases/${c.caseNo}/covering-letter/purpose`).send({})).status).toBe(200);

    const dispatch = await prisma.departmentStage.findFirstOrThrow({ where: { code: "DISPATCH" } });
    await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: dispatch.id } });
    const late = await write(c.caseNo);
    expect(late.status).toBe(409);
    expect(late.body.message).toMatch(/file preparation/);
    expect(stub.asked).toHaveLength(2);
  });

  it("says in plain words why there's no paragraph: 503 AI_FAILED, and whether to try again", async () => {
    const c = await letterCase();
    const off = await write(c.caseNo);
    expect(off.status).toBe(503);
    expect(off.body).toEqual({ message: "AI isn't set up yet.", details: { code: "AI_FAILED", retryable: false } });

    stub.provider = answering("", { stopReason: "REFUSED" });
    const refused = await write(c.caseNo);
    expect(refused.status).toBe(503);
    expect(refused.body).toEqual({
      message: "The AI wouldn't write this one. Please write it yourself.",
      details: { code: "AI_FAILED", retryable: false },
    });

    stub.provider = answering('""');
    const empty = await write(c.caseNo);
    expect(empty.status).toBe(503);
    expect(empty.body).toEqual({ message: "The AI gave an empty answer. Please try again.", details: { code: "AI_FAILED", retryable: true } });

    // Every try is recorded with what it cost, the failed ones too (docs/decisions/0023-ai.md).
    expect((await prisma.aiCall.findMany({ orderBy: { createdAt: "asc" } })).map((call) => call.status)).toEqual(["FAILED", "REFUSED", "OK"]);
  });
});
