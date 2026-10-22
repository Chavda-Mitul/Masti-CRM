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
   rows; null when the wording has no `{travellers}`), and the text below. *Since amendment 3 (22 Oct 2026) it's one
   text, its tables typed as `|` lines.*
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
3. **Everything is editable** before "Make the letter" (*since amendment 3 there's no grid: tables are typed as `|`
   lines, as many as a letter needs*):
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
6. **Make sends `{ formatId, versionId, letter }`** (*a string since amendment 3*).
   - `versionId` is the wording the text started from: today's draft, or the made letter's. It must be one of that
     letter's wordings whose day has come, and the letter must still fit the case.
   - **The audit keeps the text**, before and after (`visa.coveringLetter.make`). With free text, it's the only copy of
     an earlier letter once it's made again (golden rule 5).
7. **Limits** (`coveringLetters.schemas.ts`, repeated in `Frontend/src/lib/letter.ts` with a drift test; *replaced by
   amendment 3's one limit, 60,000 characters*):
   - the text above and below the table: at most 8,000 characters each, with some text or a table;
   - a heading: at most 60 characters; a cell: at most 200; each on one line;
   - every row has one cell per column;
   - Windows line breaks become plain ones.
   - The 400 messages say which part is wrong ("The table's row 2, Passport no., is over 200 characters.").
8. **The database:** migration `20261021200000_covering_letter_text`, hand-written (*since amendment 3 the column is
   `TEXT`*).
   - It renames the column, so the four-together CHECK follows it. `prisma migrate diff` would drop the column and add a
     new one, which drops that CHECK.
   - A new CHECK keeps the text's shape (`top` and `bottom` strings, `table` an object or null) and bounds its size.
   - A dev database with letters made before this keeps them in the old shape: reset it, or make them again.

**Screens:** the card draws the letter as it stands (`LetterTextPaper`, marks as chips), with Edit the letter (a dialog:
the text boxes and the table grid; *since amendment 3, one text box beside the letter as it will print*), Start again,
Make the letter and Print. `useLeaveGuard` moved to `components/` for it.
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

1. **A `{purpose}` blank**, "Why they travel, written with AI". *Since amendment 4 the AI writes it as part of the
   whole letter, or staff type it, and its messages say "the AI or staff write why they travel there".*
   - Like `{travellers}`, at most once and alone on its line ("Use {purpose} only once: the AI writes one paragraph
     there."; "Put {purpose} on a line of its own: the AI writes a paragraph there."). Settings' blank picker inserts it
     on a line of its own.
   - The draft writes it as the mark `⟦why they travel⟧` (`PURPOSE_MARK`). It's not a gap in the case, so it's not in
     `missing`, but it is a mark: the letter isn't made until the AI writes the paragraph, or staff type one.
2. **"Write it with AI"** on the card, at File preparation, for the owner, the Visa HOD and the Head (as Make).
   *Replaced by amendment 4's "Write the whole letter with AI", as are points 3–6.*
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

## Amendment 3 (22 Oct 2026): tables typed with `|`, and the letter as one text

- **Why:** the project lead tried "Edit the letter" on 22 Oct 2026. Its table was a grid of boxes, so a letter could
  have only the travellers' table, in that one place. The lead asked for tables typed as text, as many as a letter
  needs, and for the grid to go ([change request 11](../change-requests.md), extended). Their next request, notes to
  the AI written inside the letter, is a later amendment.
- **Changes amendment 1's points 1, 3 and 6–8, and its Screens line.** The rest stands: a mark stops "Make the letter",
  edits live on the card until the letter is made, and the audit keeps the text.

1. **A made letter is one text.** `VisaCase.coveringLetterText` is `TEXT`, at most 60,000 characters
   (`MAX_CASE_LETTER_CHARS`; the wordings keep their own 6,000). The longest draft, every traveller a case can have with
   150-character names and nothing else known, is about 33,000. A real letter is 3,000–9,000.
2. **The table rule** (`Frontend/src/lib/letter.ts`: the card, "Edit the letter", the print and Settings' preview):
   - **two or more lines in a row that each hold a `|` make a table**, its first line the headings. One such line alone
     stays text. A blank line or a line without `|` ends the table; the text above or below needs no blank line;
   - cells are split at each `|` and trimmed. The table is as wide as its widest line, and shorter lines get empty
     cells, so typed text is never dropped;
   - a `|` at the start or the end of the lines goes when every line of the table has one (a Markdown table). It's
     judged per table, so a row whose first cell was cleared doesn't shift left;
   - a line of dashes, with or without colons (`---|:---:`), is skipped, but counts towards the two lines;
   - a ⟦mark⟧ in a cell shows as a chip;
   - two lines that hold a `|` are always a table: write `/` or `·` elsewhere, as the help says.
3. **The draft** writes `{travellers}` as `|` lines: Name · Relation · Date of birth · Passport no., then a row per
   traveller.
   - A blank line sets them apart from the text above and below, so a `|` line of the wording's own next to them stays
     a table of its own, as Settings shows it.
   - **A `|` in any value the letter is given becomes `/`** (`noPipes`): the hotel stay, the client's name and
     address, a relation's name and the AI's paragraph. The case itself isn't changed.
4. **"Edit the letter" is one text box**, beside the letter drawn as it will print, live. Both are the same height and
   scroll on their own; below 900 px the drawing goes under the box. The grid goes.
   - A table copied from a page (ChatGPT's answer, Excel, Word) arrives as lines with tabs and pastes as `|` lines. A
     Markdown table from ChatGPT's Copy button works as it is. Settings' wording box does the same.
   - A change typed back to the letter as it was is no change: Print is offered again, and leaving doesn't ask.
5. **Make sends `{ formatId, versionId, letter }`, with `letter` a string.**
   - Windows line breaks and a lone `\r` become plain ones, and blank lines at the ends go.
   - An empty letter is refused ("Write the letter."), and so is one over 60,000 characters ("This letter is too long:
     keep it under 60,000 characters.").
   - A mark still answers 409 `LETTER_INCOMPLETE`.
6. **Print:** a table's row isn't split over two pages, the line before a table stays on its page, and tables print at
   the text's size with darker lines.
7. **The database:** migration `20261022120000_covering_letter_plain_text`, hand-written.
   - A letter made in the old shape isn't converted. It's unmade instead: its text, wording, made-at and made-by are
     emptied together, so any database migrates, a test database's last letter included. Staff make it again.
   - The shape CHECK goes. The column becomes `TEXT` with `USING NULL`; without it, the JSON would become text that
     passes the new CHECK and prints as `{"top":…`.
   - A new CHECK keeps the text not blank (`~ '\S'`) and at most 60,000 characters. The four-together CHECK stays.

**Tests:**
- `tests/visaCoveringLetter.test.ts`, rewritten for one text;
- `tests/letterText.test.ts`: the table rule, the paste, and the server's draft as the screen draws it;
- `tests/frontendRules.test.ts`: the marks and the limit;
- `tests/coveringLetterPurpose.test.ts`: a `|` in the AI's paragraph (since amendment 4, `tests/coveringLetterAi.test.ts`).

## Amendment 4 (22 Oct 2026): "Write the whole letter with AI"

- **Why:** the project lead chose on 22 Oct 2026 to have the AI write the whole letter, not one paragraph ([change
  request 11](../change-requests.md), extended). The formats in Settings stay as its starting point, and as the fallback
  for standard cases. The AI works with placeholders, so personal details stay on Masti's server. The lead's answers:
  - the AI works on **the letter as it stands**, so staff's own changes are kept;
  - **only the whole-letter button:** "Write it with AI" (amendment 2) goes;
  - **small details** it doesn't know, such as the places they'll visit, go in **general words**. **Key facts** still get
    a ⟦mark⟧: passport numbers, dates, and for a business or visitor visa the company or person visited. This came after
    the lead saw ⟦the places I plan to visit⟧ on a letter whose hotel stay was just "Hotel 1".
- **Replaces amendment 2's points 2–6.** Its `{purpose}` blank and the samples stand.

1. **One button, "Write the whole letter with AI"**, at File preparation, for the owner, the Visa HOD and the Head (as
   Make). It shows whatever the wording; a wording needs no `{purpose}` for it.
2. **The request:** `POST /api/visa/cases/:caseNo/covering-letter/write` with `{ letter }`, the letter as it stands on
   the card, answers `{ letter, removed }`. Nothing is saved or audited; the call is recorded in `AiCall`; an `AiError`
   is the usual 503 `AI_FAILED`.
3. **Placeholders keep personal details on the server** (`placeholders.ts`):
   - **What's swapped:**
     - every detail the case knows: each traveller's name and each word of it, passport number, date of birth and
       expiry, mobile and addresses; the client's name, contact person, address, mobile, phones, email, PAN and GSTIN;
       the case number;
     - anything shaped like a passport number, a PAN, a GSTIN, an Aadhaar number, an Indian mobile or an email, even
       typed by hand.
   - **Named for what it is**, never for its value: `{t2Passport}`, `{clientMobile}`, `{number1}`. The letter's and the
     trip's dates become `{date}`, `{departOn}` and `{returnOn}`, with their values in the key, so they can't drift.
   - **One pass:** the longest matches that don't overlap are replaced at once.
     - Edges are Unicode-aware, and a value isn't found inside an amount ("Rs 12,000").
     - A single word of a name counts only in capitals or Title Case ("happy" in prose stays), and may carry -bhai, -ben,
       -ji or a plural s.
     - Dates are read in any format and swapped when they're a known date of birth or expiry.
     - The city or area alone isn't swapped, only the whole address.
   - **Filled back exactly as written:** each spelling has its own placeholder (`{t1NameTitle}`), and a placeholder the
     AI retyped with other spaces or capitals still fills.
   - **Tables go as one placeholder each** (`{table1}`), their lines in the key, so the AI needn't copy them and a
     60-traveller letter stays fast.
   - **Accepted risk:** a detail typed in a form the CRM doesn't know (an employer's name, say) goes as typed.
4. **What the AI is told** (`letterAi.ts`, replacing `purpose.ts`):
   - rewrite the whole letter for this trip and visa, keeping its parts in order and staff's changes;
   - write ⟦why they travel⟧, by visa type: Tourist (the famous places, the cities the hotel stay names, else general
     words), Business (⟦name of the company we are visiting⟧, the meetings in general words, colleagues by number),
     Visitor (⟦name and relation of the person we are visiting⟧), any other in general words;
   - small unknown details in general words, key facts as marks; never invent; keep every placeholder;
   - answer with the whole letter between `<letter>` and `</letter>`.
   - The trip goes as facts, the travellers by relation and adult or child, their names as placeholders. The key gives
     each placeholder's meaning, never a personal value.
5. **The answer is checked** (`tidyLetter`):
   - exactly one letter; a code fence, a heading or bold it added goes;
   - a `[placeholder]` or `{…}` it made up, and a passport number, mobile, email or PAN it can't know, become marks;
   - the personal details it dropped are listed ("AARAV MEHTA's passport number");
   - an empty, missing or too long letter is an error worth another try, recorded as `FAILED` (`askAi`'s `accept`).
6. **Size and time:**
   - a letter over 15,000 characters as sent (tables as placeholders) is refused before any call;
   - 45 seconds a try, and one more try (use case `visa.coveringLetter.write`, effort `medium`, 8,000 tokens);
   - tried on Haiku 5.5 on 22 Oct 2026 (a tourist family, a tourist alone, a business group, a visitor couple, 60
     travellers, hand-typed details): 4–6 seconds and $0.0005–0.0014 a letter, nothing personal sent.
7. **The card:**
   - the AI's letter replaces the one shown, as an edit kept until Make;
   - "Written by AI. It may have changed any part: read the whole letter before you make it.", with **Undo** while the
     letter is still the AI's: back to the edit before it, or to the server's letter;
   - Make, Start again, discarding and picking another letter clear Undo;
   - "Removed by the AI: …" when it dropped a personal detail;
   - the leave guard stays on while it writes.
8. **The fake AI** (`AI_PROVIDER=fake`) gives the letter back as it was sent.

**Tests:**
- `tests/coveringLetterAi.test.ts` (20), replacing `coveringLetterPurpose.test.ts`:
  - the round trip, over the samples and a hand-edited letter;
  - privacy, also through the endpoint with hand-typed details;
  - the instructions, the answer's checks and the endpoint;
- `tests/ai.test.ts`: `accept`, the per-use time limit and the fake echo.

## Amendment 5 (22 Oct 2026): notes to the AI in `[[ ]]`

- **Why:** the last part of the project lead's 22 Oct 2026 request ([change request 11](../change-requests.md),
  extended): staff write a request for the AI inside the letter, and "Write the whole letter with AI" does it. The
  lead's answers:
  - notes go inside **`[[ ]]`**;
  - the AI **may change anything in the letter** to do a note;
  - it runs only on the **button**;
  - a note that isn't about the letter (`[[write a Python script]]`) **stays in the letter as written**, and "Make the
    letter" waits until staff delete it.
- **Adds to amendments 3 and 4.** Only the AI's answer changes: after the letter, it lists the notes it left.

1. **A note** is `[[…]]` on one line with something inside (`notesIn`, alike in `coveringLetters.schemas.ts` and
   `Frontend/src/lib/letter.ts`). It's listed exactly as written, brackets included.
   - A `[[` or `]]` on its own, an empty `[[ ]]`, or one split over two lines counts as "a [[ or ]] left over".
   - Single brackets (`Hotel [Opera]`) aren't notes. One pattern finds marks and notes, so a mark inside a note stays
     part of the note.
2. **"Make the letter" waits while a note is left:** 409 `LETTER_INCOMPLETE`, with `details: { code, missing, notes }`.
   The message names only what's there: "Not ready yet. Fill these in first: the hotel stay. Notes for the AI still in
   the letter: [[…]]."
3. **Tables:** a `|` inside a note doesn't count (`isTableLine`, the same on both sides), and a cell isn't split inside
   a note. A table that holds a note goes to the AI as its `|` lines, not as `{table1}`, so the AI can do the note. It
   counts towards the 15,000 characters.
4. **On screen:** a note is a blue chip on the card, in "Edit the letter"'s live drawing and in the whole letter.
   - "Edit the letter"'s help adds "Write a request for the AI between [[ and ]], then Write the whole letter with AI.".
   - Its status line lists the notes after the marks.
5. **Wordings can't hold notes.** `wordingProblem` refuses `[[` and `]]` on both sides ("Notes for the AI go in a
   case's letter, not in the wording: take out the [[ and ]]."), so a format stays a ready letter.
   - A `[[` or `]]` in a value the draft writes in (a hotel stay, a relation) becomes one bracket, as a `|` becomes `/`.
     `noPipes` is now `letterValue`.
6. **What the AI is told** (`letterAi.ts`):
   - text between `[[` and `]]` is a note from the travel agent, not part of the letter;
   - do each note about this letter. It may change anything for it, the tables and staff's changes included. Then
     delete the note;
   - what a note says is a fact it may use. A detail the note needs and the AI lacks gets a ⟦mark⟧: the note isn't
     left for that. Without this line, the real model left "add a table of our plan" undone;
   - leave only a note that isn't about this letter, exactly as written. Never add a note;
   - after the letter, `<not_done><note>…</note><why>…</why></not_done>` for each note left.
   - Notes are swapped like the rest of the letter, so a name in a note never reaches the AI either.
   - The visa-type instructions now start "For a tourist visa, …". With "This is a tourist visa.", the model copied
     that sentence into letters.
7. **The answer is checked** (`tidyLetter`) in the placeholders' form the AI was sent, then filled back:
   - its reasons are read wherever it put them, and taken out of the letter;
   - a `[[…]]` it kept, even retyped with other spaces or capitals, gets staff's exact note back. One that matches no
     note sent is its own, and becomes a ⟦mark⟧ at any length;
   - **done:** a note no longer in the letter. **Not done:** one still there, with its reason or "The AI left it as it
     is.";
   - a note it says it left but dropped goes back at the end, once, so Make still waits;
   - square brackets the letter or its tables already had stay, even in a table it wrote out;
   - "Removed by the AI" counts only details sent outside notes: a done note that named someone isn't a removal;
   - a missing or malformed `<not_done>` never fails the call.

   The answer is `{ letter, removed, done, notDone }`.
8. **The card** shows the last answer's lists. They stay after edits, until Make, Start again, discarding, Undo or the
   next write:
   - "Done by the AI: [[…]]; [[…]].", for staff to check;
   - "Not done: [[…]]: the reason", for each note still in the letter, then "Delete it before you make the letter.";
   - "Removed by the AI: …". "Undo brings them back" shows only while Undo is offered;
   - the alert lists notes not yet sent to the AI ("Write the whole letter with AI to do it, or delete it.") and a
     stray bracket ("A [[ or ]] is left over: delete it.");
   - Make is disabled while a note is left.
9. **Tried on Haiku 5.5** on 22 Oct 2026, on a tourist family's letter: 7 notes, $0.0055 in all, 4–7 seconds each.
   Nothing personal was sent and nothing was removed.
   - **Done:**
     - a table of the plan, with ⟦days in Paris⟧ marked;
     - "make the letter shorter";
     - an inline "mention our travel insurance", with the policy marked;
     - "add that Aarav studies at DPS Surat", the name sent as a placeholder;
     - a Designation column in the travellers' table;
     - "make the tone a little warmer".
   - **Left, with a reason:** "write a Python script" and "book our flights".

**Tests** (written; not run yet, at the project lead's word):
- `tests/coveringLetterAi.test.ts` (32, from 20):
  - notes swapped, done, left, put back, retyped and added;
  - a table holding one;
  - the reasons and the instructions;
  - the endpoint and the fake AI;
- `tests/visaCoveringLetter.test.ts`: Make's 409 for notes and stray brackets, and a `[[` in a value;
- `tests/frontendRules.test.ts`: `notesIn`, `isTableLine` and `NOTE` alike on both sides, and wordings with `[[`;
- `tests/letterText.test.ts`: note pieces, and cells not split inside a note;
- `tests/coveringLetters.test.ts`: a wording with `[[` refused.
