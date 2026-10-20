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
   format says, and staff can't type into it. A wrong detail is fixed on the case (trip details, a family member's
   passport) and the letter is made again. No free text (§7 rule 2).
3. **A format** has:
   - a **name**, which staff pick it by and which is never printed;
   - **one visa type**, the "process" (Tourist, Business…);
   - **a set of countries**, as a vendor has: a Schengen letter is for each Schengen country ticked;
   - **who travels**, the "family type": one traveller (`ONE`) or two or more (`SEVERAL`).

   A case is offered only the formats that fit its visa type, country and number of travellers; "Order in lists"
   decides which fitting one is picked first. Family, friends, or a parent travelling with a child are separate formats,
   told apart by name. A format is switched off, never deleted.
4. **The wording** is plain text with `{blanks}`, filled in from the case when the letter is made:

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
   person (France), and China · tourist · family. They are named "(sample)", their wording has no author ("Set up with
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
9. **Missing details block** (project lead, 19 Oct 2026). A blank the wording uses that the case can't fill is listed in
   plain words ("Still needed: the hotel stay; AARAV MEHTA's passport number"), and Make the letter waits; the server
   refuses with 409 `LETTER_INCOMPLETE` too. Only the blanks a wording uses count.
10. **Made at File preparation, printed again later** (project lead, 19 Oct 2026).
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
- **Signed by the first traveller** in the samples ("Yours faithfully, {applicant}"). Each format can say otherwise.
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
