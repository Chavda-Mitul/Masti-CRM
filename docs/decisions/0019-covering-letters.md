# 0019 · Covering letters: fixed formats, filled in from the case

- **Status:** decided 19 Oct 2026 (project lead). The lead chose to build it now with sample formats, and answered the
  three open points with "use your best guess"; the guesses are Decisions 2–3 and the defaults below. The lead answered
  component 2's four questions the same day (Decisions 9–12). Both components are built: the formats in Settings, and
  the case card with its print page.
- **Date:** 19 Oct 2026
- **Scope:** the covering letter of demo screen 08 and the "Covering letters" master of screen 29. It replaces the
  pending item "the covering letter" in [0007](0007-visa-file-prep.md) Decision 2. Builds on
  [0005](0005-system-masters.md) (the visa masters), 0007 Decision 4 (trip details) and
  [0008](0008-visa-docket-dispatch.md) Decision 5 (the sticker's print page).

## Context

| Source | What it says |
| --- | --- |
| Meeting ✅ (30 Sep, 7:20–7:22 PM) | Vimal keeps a format "for every process, every type of family, every possibility": enter the name, passport number, number of days, in and out dates, and the whole letter comes out; print it on the **customer's letterhead**, sign and stamp. "If we change the format, the change applies from that date forward." The formats are with Riya ("take its 100 subscription"), or Vimal will make them. |
| Contract (PID) | Visa: "covering letters". Settings masters: "covering-letter formats". Masti provides the formats. |
| Demo ⚠️ (screen 08) | A "Covering letter" card: a format box "Schengen · tourist · family (fixed format)", a serif preview ("To, The Visa Officer, Consulate General of France, Mumbai — Short-stay tourist visa for Mr Rakesh Mehta and family (4)… [fills itself from the case]") and **Make the letter**. |
| Demo ⚠️ (screen 29, notice board, login popup) | "Covering letters · 3 fixed formats". "New covering-letter format for Schengen: all Schengen family files from today use the new fixed format." |
| PROJECT_KNOWLEDGE.md §10.12, §12.4 | Effective-dated: a change applies only from its effective date. The formats are with Riya and Vimal (Q10). |
| M13 / Q10 | Unanswered: which formats, who sends them, what the "₹100 subscription" was. |

## Decisions

1. **Built now, with sample formats.** The wording lives in Settings, so Masti's own formats replace the samples by
   typing, not code. Two components, one at a time:
   1. the formats in Settings → Masters (this record's Schema, API and Screens);
   2. the card on the case at File preparation, and its print page (Decision 8), planned on its own.
2. **One letter per case**, listing every traveller (the demo's "… and family (4)"). It is **locked**: it prints as the
   format says, and staff can't type into it. *Changed 21 Oct 2026, amendment 1: staff may change all of its text.* A wrong detail is fixed on the case (trip details, a family member's
   passport) and the letter is made again. No free text (§7 rule 2).
3. **A format** has:
   - a **name**, which staff pick it by and which is never printed;
   - **one visa type**, the "process" (Tourist, Business…);
   - **a set of countries**, as a vendor has: a Schengen letter is for each Schengen country ticked;
   - **who travels**, the "family type": one traveller (`ONE`) or two or more (`SEVERAL`).

   A case is offered only the formats that fit its visa type, country and number of travellers; "Order in lists"
   decides which fitting one is picked first. Family, friends, or a parent travelling with a child are separate formats,
   told apart by name. A format is switched off, never deleted.
4. **The wording** is plain text with `{blanks}`, filled in from the case when the letter is made (and `{purpose}`,
   the AI's paragraph, since amendment 2):

   | Blank | Prints |
   | --- | --- |
   | `{date}` | the letter's date |
   | `{clientName}`, `{clientAddress}` | the client, and the client's address |
   | `{applicant}`, `{passportNo}` | the first traveller, and their passport number |
   | `{travellerNames}`, `{travellerCount}` | every traveller in a sentence ("A, B and C"), and how many |
   | `{travellers}` | the table of travellers (name, relation, date of birth, passport no.), on a line of its own |
   | `{country}`, `{visaType}` | the case's country and visa type |
   | `{departOn}`, `{returnOn}`, `{days}`, `{entry}`, `{hotel}` | the trip details (0007 Decision 4) |

   A blank line starts a new paragraph. Saving refuses an unknown blank, a stray `{` or `}`, and a `{travellers}` that
   isn't alone on its line or is used twice. A wording is at most 6,000 characters.
5. **The wording is effective-dated.**
   - Changing the wording adds a new version with a **Use from** day, from today to a year ahead (India time). The
     version in use on a day is the latest whose day has come; of two from the same day, the one added last.
   - A version whose day has come is **never changed or removed**, and stays viewable as an earlier wording. A database
     trigger refuses it too.
   - A version still to come can be **changed** (replaced in one step) or **removed**. There is at most one per day still
     to come.
   - A wording identical to the one in use from that day is refused, and a format always keeps at least one wording.
   - The details (name, countries, visa type, who travels) change at once: only the wording is dated.
6. **Who:** the Head or the Visa HOD add and change formats, as for the other visa masters; Visa staff read them.
   - Every change is audited under the format: `coveringLetter.create`, `coveringLetter.update`,
     `coveringLetter.version.add` and `coveringLetter.version.remove` (which keeps the removed text).
   - Every write sends the format's `updatedAt`; an old one gets 409 STALE. The wording editor keeps its draft until
     Reload.
7. **Three sample formats** (the demo's "3 fixed formats" ⚠️): Schengen · tourist · family and Schengen · tourist · one
   person (France), and China · tourist · family. *Since amendment 2 (21 Oct 2026) they follow Masti's own letters, and a
   fourth is for France business.* They are named "(sample)", their wording has no author ("Set up with
   the system"), and the screens say so. The seed adds them only to a database with no formats. **They must be replaced
   with Masti's formats before go-live (M13).**
8. **Component 2: the card on the case**, beside "Saved file — kept as proof" as in the demo, once the case has matured.
   - **The letters that fit:** active, the case's visa type, one of its countries, and one traveller or two or more, with
     a wording in use today. A visa type or country switched off since still fits. The first in "Order in lists" is
     picked; staff can pick another.
   - **The preview:** the server fills the wording in from the case: dates written in full ("10 December 2026"), names as
     a sentence ("A, B and C"), the number of days counting both ends, "single", "double" or "multiple", the hotel stay,
     the client's address, and the travellers' table from the family list. "See the whole letter" shows it all.
   - A sample wording says so on the card.
9. **Missing details block** (project lead, 19 Oct 2026). *Changed 21 Oct 2026, amendment 1: they become marks staff
   type over.* A blank the wording uses that the case can't fill is listed in
   plain words ("Still needed: the hotel stay; AARAV MEHTA's passport number"), and Make the letter waits; the server
   refuses with 409 `LETTER_INCOMPLETE` too. Only the blanks a wording uses count.
10. **Made at File preparation, printed again later** (project lead, 19 Oct 2026). *Since amendment 1 the case keeps the
    letter's text as made, not what its wording was filled in with.*
    - The owner, the Visa HOD or the Head make it at File preparation, again as often as needed there; each time is
      audited (`visa.coveringLetter.make`).
    - The case keeps the wording used, who made it, when, and **what it was filled in with** (a snapshot). Every print is
      that same letter, even after the wording or a passport number changes; the letter's date is the day it was made.
    - After File preparation the card is read-only: anyone who can open the case prints the letter again, but no one
      changes it. Printing changes nothing, so it isn't audited (as the sticker, 0008 Decision 5).
11. **The letterhead space is a setting** (project lead, 19 Oct 2026): `visa.coveringLetter.letterheadMm`, 45 mm ⚠️, 0–120,
    changed by Vimal or the Visa HOD in Settings → Masters → Covering letters → Printing. The print page is A4 with
    18 mm margins; the first page's top is the letterhead space, and "Plain paper" uses the usual 18 mm instead.
12. **"File ready" doesn't need the letter** (project lead, 19 Oct 2026): some countries may have no format yet. The card
    shows whether it was made.

### Defaults (not asked; say if any is wrong)

- **No `{embassy}` blank.** The embassy is only picked at Step 5 (0011 Decision 3), after the file is ready, so each
  format's own text holds the address: "Consulate General of {country}, Mumbai".
- **No titles.** There's no Mr/Mrs field, so names print without one.
- **Signed by the first traveller** in the samples ("Yours faithfully, {applicant}"; "Yours truly," since amendment 2).
  Each format can say otherwise.
- **The relation** in the table is the one on the client's family list (Self, Spouse, Son…).
- **English only**, as on the invoice.

## Schema

- **`CoveringLetterParty { ONE, SEVERAL }`.**
- **`CoveringLetterFormat`:** the name (unique whatever the capitals), the visa type, the party, the order, active, and
  `updatedAt`, the lock token every write moves on.
- **`CoveringLetterCountry`:** format × country, replaced as a set.
- **`CoveringLetterVersion`:** the format, `effectiveFrom` (a date), the body, and `addedById` (null only for the
  seed's samples, as `Holiday.addedById`).
- **Hand-written in the migration:**
  - the `lower(name)` unique index;
  - CHECKs that the name and body aren't blank, and that the body is at most 6,000 characters;
  - the trigger `CoveringLetterVersion_kept`: no UPDATE, and DELETE only before the version's day in India.
- **Migration** `20261019190000_covering_letters`. New tables only: run `npm run db:deploy`, then `npm run db:seed` adds
  the samples.

## API (component 1)

| Endpoint | Who | What |
| --- | --- | --- |
| `GET /api/masters/covering-letters?active=` | Visa VIEW | `{ formats }`: the details, the wording in use (`inUse`, null before the first one starts) and the next (`next`), without their texts |
| `GET /api/masters/covering-letters/:id` | Visa VIEW | `{ format }` with every wording, newest day first, each `IN_USE`, `SCHEDULED` or `EARLIER` (worked out on the server, by today in India) |
| `POST /api/masters/covering-letters` | Head, Visa HOD | The details and the first wording (`body`, `effectiveFrom`) |
| `PATCH /api/masters/covering-letters/:id` | Head, Visa HOD | The details or `isActive`, with `updatedAt` |
| `POST /api/masters/covering-letters/:id/versions` | Head, Visa HOD | `body`, `effectiveFrom`, an optional `replacesId` (a wording still to come) and `updatedAt` |
| `DELETE /api/masters/covering-letters/:id/versions/:versionId` | Head, Visa HOD | `{ updatedAt }`. Only a wording still to come, never the only one |

## Screens (component 1)

- **Settings → Masters:** a "Covering letters · Fixed formats" card for the Visa team replaces the "Soon" one.
- **The list:** each letter's visa type and countries, who it's for, "In use since" (or "Starts"), the next wording, a
  "Sample" chip, Switch off / on, and "Show switched-off".
- **A letter's page:**
  - the wording in use, drawn like the letter;
  - **Change the wording**: the blanks are clicked into place, and a preview is filled in for an example family;
  - **Coming up** (Change, Remove) and **Earlier wordings**;
  - Edit details and Switch off.
- **Add a covering letter**, starting from the frame every covering letter has.
- `components/LetterPaper.tsx` draws a wording; the case's letter will use it too.

## Tests

- **`tests/coveringLetters.test.ts`** (28 tests) covers:
  - who may read and change the formats;
  - adding a format, with its checks: blanks, length, name, countries, visa type, Use from;
  - which wording is in use: the unit rule, later days, today, midnight in India rather than UTC, and none yet;
  - that started wordings are kept, by the service and by the database;
  - changing details, switching off, stale writes, and two saves at the same moment;
  - the samples.
- **`tests/frontendRules.test.ts`:** the browser's blanks, limits and messages match the server's.

## Component 2: schema, API and screens

- **Schema:** on `VisaCase`, `coveringLetterVersionId` (the wording used), `coveringLetterMadeAt`,
  `coveringLetterMadeById` and `coveringLetterFill` (`{ values, travellers }`), all four set or none (a CHECK). Migration
  `20261019235000_covering_letter_made`: new nullable columns only.
- **API:**

  | Endpoint | Who | What |
  | --- | --- | --- |
  | `GET /api/visa/cases/:caseNo/covering-letter?formatId=` | anyone who can open the case | `{ letter }`: the letters that fit, the one asked for (or the one made, or the first) filled in with what's missing, the letter made, and the case's visa type, country and travellers |
  | `POST /api/visa/cases/:caseNo/covering-letter` | owner, Visa HOD, Head, at File preparation | `{ formatId }`. 400 if it doesn't fit; 409 `LETTER_INCOMPLETE` with `details.missing` |
  | `GET /api/visa/cases/:caseNo/covering-letter/print` | anyone who can open the case | the letter made: its wording, what it was filled in with, and the letterhead space. 409 before one is made |
  | `PUT /api/visa/settings` | Head, Visa HOD | `{ coveringLetter: { letterheadMm } }` |

- **Screens:** `CoveringLetterCard` on the case (paired with the saved file), `/print/covering-letter/:caseNo`, and the
  Printing card on the covering letters page. `fillLetter` (`coveringLetters/fill.ts`) holds the filling rules.
- **Tests:** `tests/visaCoveringLetter.test.ts` (15): which letters fit, filling in, what's missing, who may make it and
  when, the 409 list, making it again, printing the same letter after changes, the letterhead setting, and the CHECK.

## Built

- **Component 1:** built 19 Oct 2026 on `feat/covering-letter` (PR #40).
- **Component 2:** built 19 Oct 2026 on `feat/covering-letter-case`.

## Not in this record

- Whether "Covering letter" becomes a next step on the visa board.
- Masti's own formats (M13), and the details in M47: titles, who signs, the letterhead's margin, the consulate address
  per country.

## Amendment 1 (21 Oct 2026): the letter is editable

- **Why:** on 21 Oct 2026 Masti sent two of their letters (France tourist, France business) and said they write every
  letter in ChatGPT, because each one is different. The project lead chose to have the CRM write the paragraph on why
  they travel with AI ([change request 11](../change-requests.md), [0023](0023-ai.md)). That paragraph must be
  editable, so the letter comes first. The lead decided (21 Oct 2026):
  - staff may change **everything**, the travellers' table included;
  - a detail the case lacks becomes a marked blank staff type over, instead of blocking;
  - edits are kept only when "Make the letter" is clicked: a reload loses them.
- **Changes Decisions 2, 9 and 10.** The rest stands: who makes it and when, making it again, read-only printing after
  File preparation, the letterhead space, "File ready" not needing it, and the wordings in Settings with their blanks.

1. **A made letter is its text**, not a wording plus values: the text above the table, the table (its headings and
   rows; null when the wording has no `{travellers}`), and the text below.
   - The case keeps it in `VisaCase.coveringLetterText` (renamed from `coveringLetterFill`), with the wording it started
     from, who made it and when. Every print is that text.
   - The text is free, but it doesn't break §7 rule 2 (no free text): it's a letter to an embassy, not a reason, an
     outcome or a status, and no report reads it.
2. **The draft** (`draftLetter`, replacing `fillLetter`) writes the case's values into the wording.
   - A value the case lacks becomes a **mark** with Decision 9's plain words: `⟦the hotel stay⟧`, `⟦Diya Mehta's
     passport number⟧`, `⟦the number of days⟧` (for `{days}` without both dates).
   - An unnamed traveller is `⟦Adult 2's name⟧` in `{travellerNames}` and in the table, where "Adult 2" used to reach
     the letter.
   - The table starts as Name · Relation · Date of birth · Passport no., a row per traveller. `{travellers}` may be the
     first, last or only line.
3. **Everything is editable** before "Make the letter":
   - the text above and below the table;
   - the table's headings and cells, with rows and columns added or removed (1–6 columns, at most 60 rows: a row per
     traveller a case can have), e.g. "Designation" for "Relation" on a business trip.
   - Adding or removing the table itself isn't offered.
4. **A mark stops "Make the letter"** until it's typed over or deleted. Any `⟦` or `⟧` left anywhere counts, which also
   catches a mark only half deleted.
   - These two characters are written by nothing else in the CRM, unlike square brackets, which a hotel or an address
     may hold.
   - The card lists the marks; the server refuses too: 409 `LETTER_INCOMPLETE` with `details.missing`.
   - The case itself isn't changed: the card still says what the case lacks, so it can be added there too.
5. **Edits live on the card until "Make the letter".**
   - Leaving the page, reloading, picking another letter or "Start again" asks first ("Discard your changes?").
   - Print waits until the edits are made into the letter.
   - Once made, the card starts from the letter made, with its date. "Start again" drafts it fresh, dated today.
6. **Make sends `{ formatId, versionId, letter }`.**
   - `versionId` is the wording the text started from: today's draft, or the made letter's. It must be one of that
     letter's wordings whose day has come, and the letter must still fit the case.
   - **The audit keeps the text**, before and after (`visa.coveringLetter.make`). With free text, it's the only copy of
     an earlier letter once it's made again (golden rule 5).
7. **Limits** (`coveringLetters.schemas.ts`, repeated in `Frontend/src/lib/letter.ts` with a drift test):
   - the text above and below the table: at most 8,000 characters each, with some text or a table;
   - a heading: at most 60 characters; a cell: at most 200; each on one line;
   - every row has one cell per column;
   - Windows line breaks become plain ones.
   - The 400 messages say which part is wrong ("The table's row 2, Passport no., is over 200 characters.").
8. **The database:** migration `20261021200000_covering_letter_text`, hand-written.
   - It renames the column, so the four-together CHECK follows it. `prisma migrate diff` would drop the column and add a
     new one, which drops that CHECK.
   - A new CHECK keeps the text's shape (`top` and `bottom` strings, `table` an object or null) and bounds its size.
   - A dev database with letters made before this keeps them in the old shape: reset it, or make them again.

**Screens:** the card draws the letter as it stands (`LetterTextPaper`, marks as chips), with Edit the letter (a dialog:
the text boxes and the table grid), Start again, Make the letter and Print. `useLeaveGuard` moved to `components/` for it.
**Tests:** `tests/visaCoveringLetter.test.ts` (19) and `tests/frontendRules.test.ts` (the marks and the limits).

## Amendment 2 (21 Oct 2026): "Write it with AI"

- **Why:** Masti writes every letter in ChatGPT because the paragraph on why they travel differs each time ([change
  request 11](../change-requests.md)). The central AI part ([0023](0023-ai.md)) and the editable letter (amendment 1)
  came first. The project lead decided:
  - **19–21 Oct:** a button, never automatic; nothing typed first; instructions per visa type, fixed in the code;
    staff may change anything afterwards.
  - **21 Oct:** unknowns become ⟦marks⟧; the AI gets the trip and the hotel stay, never a name, a passport number or
    a date of birth; the samples follow Masti's two letters; Business and Visitor visa types are added.
- **Adds to Decision 4 and amendment 1.** The rest stands.

1. **A `{purpose}` blank**, "Why they travel, written with AI".
   - Like `{travellers}`, at most once and alone on its line ("Use {purpose} only once: the AI writes one paragraph
     there."; "Put {purpose} on a line of its own: the AI writes a paragraph there."). Settings' blank picker inserts it
     on a line of its own.
   - The draft writes it as the mark `⟦why they travel⟧` (`PURPOSE_MARK`). It's not a gap in the case, so it's not in
     `missing`, but it is a mark: the letter isn't made until the AI writes the paragraph, or staff type one.
2. **"Write it with AI"** on the card, at File preparation, for the owner, the Visa HOD and the Head (as Make).
   - It puts the paragraph where the mark is, or where the AI's last paragraph still stands unchanged; the other edits
     stay. "Write it again" does the same.
   - If the AI's paragraph was changed by hand, there's nowhere to put a new one: "Write it again" asks "Start again
     with a new paragraph?" (only with unsaved changes), and drafts afresh with the new paragraph.
   - A note says "Written by AI from the trip's details. Read it and change anything before you make the letter."
     (§7.12). Nothing is saved on the case until "Make the letter".
   - `POST /api/visa/cases/:caseNo/covering-letter/purpose` → `{ paragraph }`.
3. **What the AI is sent** (`PurposeFacts`, built from the case on its own, never from the letter's facts):
   - the country and the visa type (not the entry type: the letter states it, and a model given it said it again);
   - the travellers in order, as adult or child with their relation to the client who booked (the first is the
     applicant);
   - the dates and days, or "not known yet";
   - the hotel stay text, between markers, as data;
   - whether a person or a company booked.

   Never a name, a passport number, a date of birth, an address, a mobile or the case number; a test checks what the
   AI receives. **Accepted risk:** the hotel stay is free text that staff may have put a name in.
4. **The instructions** (`src/modules/coveringLetters/purpose.ts`), fixed in the code:
   - **Shared:** one paragraph, 60–120 words, first person from the applicant, simple formal Indian English. Don't
     repeat what the letter has (who applies for which visa, dates, entry type, hotels, names, passports, who pays).
     Make each point once. Only the facts given; returning to India said simply, with no reasons it wasn't told
     (family, work, property, ties). Others by relation ("my wife and our son"), never "the adult" or "a child". A short
     `⟦placeholder⟧` for each fact it doesn't have, at most three. No agency or city in the instructions: told "Surat",
     a model wrote "my family, business and property here in Surat".
   - **By visa type code:**
     - `TOURIST`: the famous places and nature, the cities the hotel stay names (else `⟦the places we plan to
       visit⟧`), time together, back to India after.
     - `BUSINESS`: meeting associates at `⟦name of the company we are visiting⟧` in `⟦city⟧` for `⟦purpose of the
       meetings⟧`, colleagues by number ("with my three colleagues"), back after.
     - `VISITOR`: visiting `⟦name and relation of the person we are visiting⟧` in `⟦city⟧`, back after.
     - **Any other:** why they travel in general words.
   - Tried on Claude Haiku 5.5 on 21 Oct 2026 for a tourist family, a business group, a visitor couple, a student and a
     tourist alone, and tuned until nothing was invented or repeated: 63–71 words, placeholders where facts were missing,
     about $0.0003–0.0005 and 3–4 seconds each.
5. **The call:** `askAi`, use case `visa.coveringLetter.purpose` (effort `medium`, 3,000 tokens with the thinking), with
   the user and the case; recorded in `AiCall`, not audited.
6. **Tidying** (`tidyParagraph`):
   - quotes around it, Markdown and list marks go;
   - lines are joined into one paragraph;
   - a placeholder written as `[…]` or `{…}` becomes a ⟦mark⟧, unless the hotel stay itself holds those brackets;
   - empty → "The AI gave an empty answer. Please try again."
7. **Errors:** any `AiError` reaches the client as 503 `{ message, details: { code: "AI_FAILED", retryable } }`
   (`middleware/error.ts`), and the card shows the message.
8. **The samples follow Masti's letters** (Decision 7):
   - three tourist samples (France family, France one person, China family): "To, The Visa Officer, The Consulate
     General of {country}, Mumbai, India.", "Sub: Application for a {visaType} visa", "Respected Sir/Madam,", "I, the
     undersigned, {applicant}, am applying for …", `{purpose}`, "The passport details are below:" `{travellers}`, the
     dates, who pays, the hotel, the documents attached, "Thanking you in anticipation, Yours truly,";
   - a fourth, "Schengen · business · group (sample)", for France × Business, after Masti's business letter (the
     company pays; "Yours faithfully,").
   - Settings' frame for a new letter follows the same shape, with `{purpose}`.
   - **A dev database keeps its old samples** (they're seeded only into a database with no letters): reset it, or add
     `{purpose}` to a wording in Settings.
9. **Visa types Business (`BUSINESS`) and Visitor (`VISITOR`)** are seeded, so their instructions match. As for any
   visa type, a country needs an offering with a checklist before intake can use them.
