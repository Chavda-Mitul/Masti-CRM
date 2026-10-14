# 0008 · Visa Step 4: docket, sticker and dispatch

- **Status:** decided (13 Oct 2026, project lead). Built: the Docket card and the Sticker card (13 Oct 2026); the
  courier list and dispatch (14 Oct 2026, components 4a and 4b). Next: the vendor email (4c), then e-visas. A "Built"
  note is added under each part as its component lands.
- **Date:** 13 Oct 2026
- **Scope:** everything between "File ready — add to docket" (0007 Decision 9) and the vendor having the parcel:
  - grouping ready cases into dockets, per vendor
  - the parcel sticker
  - dispatch: courier, AWB, the email to the vendor, and the next day's "Confirm vendor got it"
  - e-visas, which have no vendor and no parcel
- **Builds on:** [0007](0007-visa-file-prep.md) (the vendor master, the case lock, "File ready"),
  [0005](0005-system-masters.md) (masters and the holiday calendar), [0006](0006-visa-documents.md) (booklet counts,
  postpone and cancel).
- **Depends on:** 0009, the visa invoice (not written yet). Dispatch is never built without it (Decision 1).
- **Hand-over notes:** `docs/plans/visa-step-4-docket-dispatch.md` (the sources and the questions, answered here).

## Context

What a case looks like when it reaches Step 4 (built in 0007):

| Field | Value |
| --- | --- |
| `Enquiry.stage` | `DISPATCH` (seeded "Docket & dispatch", status label "Dispatched" ⚠️, next step "Dispatch the docket") |
| `Enquiry.ownerId` | the processor |
| `Enquiry.dueAt` | the moment it was marked file ready |
| `VisaCase.fileReadyAt` / `fileReadyById` | set together (a CHECK) |
| `VisaCase.vendorId` | an active vendor covering the country, when the visa's **Vendor needed** is on; can be empty for e-visas |
| `CaseFile` (`FINAL_FILE`) | the saved PDF |
| The chip | "File ready · to dispatch" (instead of the seeded "Dispatched", which isn't true yet) |

What the sources say:

| Source | What it says |
| --- | --- |
| Demo ⚠️ (screen 09) | Chip "Dispatched · D-121"; button "Dispatch docket D-121 →". Card "Docket D-121 · to the Mumbai vendor" with a switch **One file per docket / Several files in one** and a table Case · Passports · Invoice (V-2041 · Mehta · France · 4 · "INV-0412 · locked"; V-2047 · "Raise invoice first"). One docket can hold several countries for the same vendor. Rule copy: "A file can't leave without its invoice…". Card **Dispatch**: courier and slip, "Email to vendor: Sent with the docket list", "Tomorrow 11:00 · Neha: Confirm vendor got it". Card **Sticker**: MASTI TRAVELS · D-121 · "To: [Vendor], Mumbai" · "V-2041 (4) · V-2044 (2) · V-2047 (1) · 7 passports" · a barcode, and **Print sticker**. |
| Demo ⚠️ (board, screen 10) | The board's "Dispatched" column ("On the way to vendor") shows "Docket D-118" and "Confirm vendor got it". Step 5's timeline starts "Dispatched in D-121 · Wed 7 Oct". |
| Meeting ✅ | Print a parcel sticker from the system. The courier's docket number is typed in (no integration). The next day the processor confirms receipt with the vendor. Email the vendor the day's dockets: the docket number and each application, with names and countries (6:59 PM). Today: one docket per vendor per day; Vimal left the choice to us (Q1). |
| Meeting ✅, rule 3 | The invoice must exist before the file goes to the vendor. It is built from the quote breakup, never edited; at most one additional invoice per file. |
| PROJECT_KNOWLEDGE | §13 sketches `Docket` (number, vendor, courier, AWB, files, dispatched at, vendor confirmed at, email sent at). §10.9: vendor receipt confirmation "the day after dispatch (Tomorrow 11:00)" ⚠️. |

**No invoice code exists yet** (no fee, quote or invoice tables). The invoice is large enough for its own record, 0009.

## Decision

### 1. Build order: one component at a time

**Decided 13 Oct 2026 (project lead):** option C of the hand-over plan. Dockets and the sticker first, which don't need
the invoice; then the visa invoice (0009); then dispatch, with the invoice check from the start. Rule 3 never breaks:
no file can leave without its invoice.

**Workflow rule (project lead, 13 Oct 2026):** build strictly **one screen component at a time**. Each is planned in
plan mode, built, tested, checked in the browser and committed before the next one is started:

1. **Docket card**, the grouping table, and its backend (Decisions 2, 3, 4, 7, 10)
2. **Sticker card** (Decision 5)
3. **The visa invoice** (0009), in its own components (fees, the quote on the case, the locked invoice and its PDF)
4. **Dispatch card** (Decisions 6, 8, 9, and 3's dispatch rules)
5. **E-visas: "Submitted online"** (Decision 11)

### 2. Docket grouping (Q1)

- **One open docket per vendor.** A docket stays **open** until it is dispatched.
- **"Add to docket"** (the demo's "Several files in one", and today's practice) puts the case into its vendor's open
  docket, or starts one if there isn't one.
- **"Send on its own"** ("One file per docket") starts a new docket holding just this case, marked as such: no other
  case joins it. **Settled 13 Oct 2026 (project lead):** this is allowed while the vendor's shared docket is open, and
  that docket is unaffected. So a vendor has at most **one shared open docket**, plus any number of single-case ones.
- **One docket can hold cases for different countries,** as long as they go to the same vendor (the demo).
- **Once dispatched, a docket is locked.** The vendor's next case starts a new one.
- **A docket may stay open across days.** From the day after it was opened, the docket card shows an amber line
  "Open since 12 Oct, not sent yet" ⚠️. No scheduler is needed: the page compares the docket's `openedAt` with today
  (IST).

**Built 13 Oct 2026** (component 1, the Docket card):

- **API and data:**
  - `POST /api/visa/cases/:caseNo/docket` with `{ mode: "GROUP" | "OWN", updatedAt }`, and
    `DELETE /api/visa/cases/:caseNo/docket` with `{ updatedAt }`. Both return `{ case }`.
  - Tables `Docket` (`kind` GROUP/OWN, `status` OPEN/DISPATCHED, `openedAt`) and `DocketCounter`, plus
    `VisaCase.docketId` (migration `20261013110000_dockets`).
  - The partial unique index `Docket_one_open_group_per_vendor` allows one shared open docket per vendor.
    `prisma migrate diff` doesn't propose dropping it.
  - Audited as `visa.docket.add` (after: `docketNo`, `kind`, `newDocket`) and `visa.docket.remove`, on the Enquiry,
    with `clientId`.
  - The case sends `docket { docketNo, kind, status, openedAt, vendor, cases, totalPassports, totalOldPassports }`.
    While it isn't in one, it sends `openDocket { docketNo, caseCount }`, the vendor's shared docket it would join.
- **Screen:**
  - The **Docket card** sits at the top of the case page at Docket & dispatch, as in the demo. It has the switch, the
    Case · Passports · Invoice table (the Invoice column shows "MVI… · locked" or "Raise invoice first" since 0009
    component 4), the totals, the
    amber "Open since" line, the rule copy, and **Add** / **Take out of docket**.
  - The header chip says "In docket D-…". The next-step button says "Add to docket →" (it scrolls to the card), then
    "Dispatch docket D-… →" with **Soon**.
- **Settled while building:**
  - **Locks:** the vendor, then the docket, then the case. Two adds for one vendor take turns on the vendor's row.
  - **An emptied docket is reused** by the vendor's next case of the same kind, keeping its number, and its
    `openedAt` restarts. A refused add rolls back, so no number is used up.
  - **The case's `updatedAt` doesn't move,** like the Step 3 edits. A docket change refreshes the other cases in the
    docket that are open in the browser.
  - **A vendor switched off, or no longer covering the country, since "File ready"** blocks the add: "Global Visa
    Services is switched off. Ask the Visa HOD to switch it back on." The vendor can't be changed at Step 4 (Step 3
    is read-only). Changing it would need the send-back change request (Decision 10).
  - **Other cases in the docket** show as plain text (number, family name, country, passports), not links, because
    a processor may not be allowed to open another processor's case.

### 3. Who acts

- **Adding a case to a docket, or taking it out:** whoever can act on that case, as in Step 3 (0007 Decision 1): its
  processor, the Visa HOD, the Head. Visa EDIT is required.
- **Dispatching:** the Visa HOD, the Head, or a processor who owns **at least one case** in the docket.
  - One press dispatches every case in the docket.
  - Each case gets its own audit row naming who dispatched.
- Whoever carries the parcel to the courier counter isn't a CRM action; a processor records the dispatch.

### 4. Passports per case (the docket table and the sticker)

**Decided 13 Oct 2026 (project lead), differing from our recommendation:** old passports are counted in the total.

- **Current passports:** `VisaCase.bookletsCurrent` if it was entered in Step 2, otherwise the number of travellers.
- **Old passports:** `VisaCase.bookletsOld`, shown when it is more than 0.
- **A row** shows "4 (+3 old)", or just "4".
- **The total** (the docket card and the sticker) counts both: "7 passports + 3 old" ⚠️. The old part is left out
  when there are none. The vendor can check every booklet in the parcel.

**Built 13 Oct 2026** on the Docket card (component 1). The sticker reuses the same counts.

### 5. The sticker

- **Printed from the browser** (a print-only page or a dialog with `@media print` styles), not a PDF.
- **Size:** 100 × 150 mm ⚠️, a setting, adjusted once Masti tells us their label printer. It prints on A4 too.
- **The barcode:** Code 128 of the docket number, drawn by `jsbarcode` (an exact version at least two weeks old).
- **Contents,** as in the demo:
  - MASTI TRAVELS and the docket number
  - "To: <vendor name>, <city>" (the vendor master has no full address yet; Vimal's onboarding format, Q7)
  - each case with its passports, e.g. "V-2041 (4) · V-2044 (2 +1 old)", and the total (Decision 4)
  - the barcode
- **Plus Masti's return address** as "From". **Decided 13 Oct 2026 (project lead); not in the demo.** No company
  address is stored yet, so a new setting holds the company's details (name, address, phone), edited by the Head and
  seeded with a ⚠️ placeholder. The visa invoice (0009) reuses it and adds what it needs (GSTIN and so on).

**Masti's answers (13 Oct 2026, through the project lead):**
- **Printer:** they have no particular label printer, so the size stays 100 × 150 mm, with a Code 128 barcode.
- **Company details,** seeded as given:
  - **Name:** MASTI TOUR AND TRAVEL
  - **Address:** 301, Maitri, Opp. Canara Bank, Nr. Panchratna Tower, L.H. Road, Varachha, Surat-395006, (Guj.)
    INDIA
  - **Phone:** +91-93777-57580

**Built 13 Oct 2026** (component 2, the Sticker card):

- **API and data:**
  - `GET /api/visa/cases/:caseNo/sticker` (Visa VIEW, and the user must be able to open the case) returns the
    docket number, the vendor, each case with its passports, the totals, `from` (the company's details) and `size`.
    It reuses the Docket card's rows and counts, so the two never disagree.
  - `409 "This case isn't in a docket yet."` when the case isn't in a docket.
  - Printing isn't audited, because it changes nothing.
  - The setting `company.details`: `GET /api/company/details` for every office user, and `PUT` for the Head only,
    audited as `setting.update` (module `src/modules/company/`).
  - The setting `visa.sticker` → `{ widthMm: 100, heightMm: 150 }` ⚠️, 50–300 mm each, changed through
    `PUT /api/visa/settings`. Both settings are seeded.
- **Screen:**
  - The **Sticker card** sits under the Docket card while the case is in a docket. It shows the label scaled down and
    a **Print sticker** button.
  - Print sticker opens `/print/sticker/:caseNo` in a new tab, outside the app shell. The page holds only the label
    at its real size, with an `@page` rule of the label's size and no margins, and opens the print dialog once the
    barcode is drawn.
  - The label shows:
    - the company name and the docket number
    - "To: vendor, city"
    - each file with its passports ("VISA-2026-0002 (3 +2 old)")
    - the total
    - the barcode, with the number under it
    - "From:" with Masti's name, address and phone
  - A **Company details** card in Settings → Masters: the Head edits, everyone else reads.
- **Settled while building:**
  - **The barcode is `jsbarcode` 3.12.3, pinned exactly,** and drawn as SVG stretched to the label's millimetre box,
    with the number printed underneath.
  - **The label's heading uses the company name** from the setting ("MASTI TOUR AND TRAVEL"), not the demo's "MASTI
    TRAVELS".
  - **Who can print:** anyone who can open the case, view-only users included. A dispatched docket's label can be
    printed again.
  - **The print dialog opens on its own** only when the Sticker card opens the page (`?autoprint=1`). Opened any
    other way, the page waits for **Print**.

### 6. The courier

- **A `Courier` master** (rule 2: no free text), in Settings → Masters → Lists, edited by the Visa HOD or the Head.
  Switched off, never deleted.
- **Seeded ⚠️** with Blue Dart, DTDC and "By hand (no AWB)".
- **Each courier has `awbNeeded`.** It is off for "By hand", so no slip number is asked for.
- **The AWB (the courier's slip number) is typed in.** It is data, not a reason. Spaces are removed and letters made
  capitals; then it must be capitals and digits, 4–30 characters ⚠️.
- Built with the Dispatch card.

**Built 14 Oct 2026** (component 4a, the courier list):
- Table `Courier` (`code`, `name`, `awbNeeded`, `sortOrder`, `isActive`; migration `20261014100000_couriers`, with the
  code format CHECK).
- `GET/POST/PATCH /api/masters/couriers`: Visa staff read; the Visa HOD or the Head edits. Audited as
  `courier.create` / `courier.update`.
- Seeded ⚠️ with Blue Dart, DTDC and "By hand (no AWB)" (`awbNeeded` off).
- Settings → Masters → Lists → **Couriers**, with a "Slip (AWB) number: Needed / Not asked for" column.

### 7. The docket number

- **`D-2026-0001`**, the same pattern as case numbers (§17 #21).
- **The prefix "D"** is the setting `visa.docket` → `{ prefix: "D" }` ⚠️.
- **A `DocketCounter` per calendar year (IST)**, bumped in the docket's own transaction, like `CaseCounter`.
- **A number is used only when a docket is created.** An empty open docket keeps its number and is reused
  (Decision 10).

**Built 13 Oct 2026:** the setting `visa.docket` (seeded, changed through `PUT /api/visa/settings` by the Visa HOD or
the Head, with no screen yet, like `visa.finalFile`) and the yearly `DocketCounter`.

### 8. The email to the vendor (Q1, second half)

- **One email per docket, sent when it is dispatched.** A daily email would need a scheduler, which isn't chosen yet
  (§10.9).
- **Contents:** the docket number, the courier and AWB, and each case: the case number, the travellers' names, the
  destination country and the passports. The wording ⚠️ is drafted by us and approved by Masti.
- **How it's sent:**
  - `src/lib/email.ts`, the only place that sends email (nodemailer over SMTP), configured by `SMTP_*` settings in
    `.env` (`src/config/env.ts`), never in code.
  - **Mailpit** in `Backend/docker-compose.yml` catches mail locally and in tests, as MinIO stands in for S3.
- **Sent after the dispatch transaction commits,** never inside it. The docket records the time it was sent, or the
  error.
- **A failure never undoes the dispatch.** The Dispatch card shows the error and a **Send again** button.
- **The vendor's email becomes required to dispatch** (0007 open point C). Without it, dispatch is refused with "Add
  an email for Global Visa Services in Vendors first."
- Built with the Dispatch card.

### 9. Dispatch, and where it leaves the case

- **Refused unless:**
  - every case in the docket has its locked invoice (0009)
  - the vendor is active and has an email
  - a courier is picked, and the AWB is in when that courier needs one
- **In one transaction:**
  - lock the docket, then its cases (see *Locking*)
  - move every case to **Step 5 · At vendor** (`AT_VENDOR`)
  - set each case's `dueAt` to **the next open office day at 11:00**, using `nextOpenDay` in
    `src/modules/holidays/blockedDays.ts` (skips Sundays and office holidays). The setting is `visa.vendorConfirm` →
    `{ afterDays: 1, at: "11:00" }` ⚠️. The case lands on its owner's desk; no scheduler is needed.
  - stamp the docket `DISPATCHED`, with who and when, the courier and the AWB
  - audit `visa.docket.dispatch` on each case, and once for the docket
- **Step 4 is read-only** afterwards for those cases.
- **"Vendor got it"** is Step 5's first action (a later record), not part of Step 4.

**The status chip, step by step:**

| Where the case is | Chip |
| --- | --- |
| `DISPATCH`, not in a docket | "File ready · to dispatch" (as built) |
| `DISPATCH`, in an open docket | "In docket D-2026-0001" |
| `AT_VENDOR`, the vendor hasn't confirmed | "Dispatched · D-2026-0001" (the board's "Dispatched" column) |
| `AT_VENDOR`, confirmed | the seeded "Submitted" (Step 5) |

**Built 14 Oct 2026** (component 4b, dispatch; the vendor email follows in 4c):

- **API and data:**
  - `GET /api/visa/cases/:caseNo/dispatch/check` (anyone who can open the case) returns `{ docketNo,
    alreadyDispatched, canDispatch, blockers, vendor { name, city, email }, confirmAt }`. Each blocker is grouped by
    kind: `INVOICE` (the files without one), `VENDOR_OFF`, `VENDOR_EMAIL`.
  - `POST /api/visa/cases/:caseNo/dispatch` with `{ courierId, awbNo?, caseNos }` returns `{ case }`. It's refused with:
    - 409 `DISPATCH_BLOCKED { blockers }`
    - 409 STALE when `caseNos` isn't the docket's files any more
    - 409 when it's already dispatched
    - 400 on `courierId` (switched off) or `awbNo` (missing, malformed, wrong length, or given for a courier with none)
  - Docket columns `courierId`, `awbNo`, `dispatchedAt`, `dispatchedById` (migration `20261014110000_dispatch`), with
    CHECKs: all of them set when DISPATCHED, none (and no slip) while OPEN; the slip is capitals and digits.
  - Settings ⚠️ (no screen yet, changed through `PUT /api/visa/settings` like `visa.docket`):
    - `visa.vendorConfirm` → `{ afterDays: 1, at: "11:00" }`
    - `visa.awb` → `{ minLength: 4, maxLength: 30 }`
  - Audited as `visa.docket.dispatch`: once per case (on the Enquiry, with `clientId`, before/after stage and `dueAt`)
    and once on the Docket (the courier, slip, files and vendor).
  - The case's `docket` gains `courier`, `awbNo`, `dispatchedAt`, `dispatchedBy`, and each row its `ownerId`; the
    case's `vendor` gains `email`.
- **Screen:**
  - The header button **Dispatch docket D-… →** opens a confirm dialog with:
    - the vendor and its email
    - each file with its passports and invoice
    - what blocks it (with a link to Vendors), or the courier and the slip number (shown only when the courier has
      one)
    - when the files come back due ("Thu 15 Oct, 11:00")
  - The button is off, with the reason, for anyone else.
  - A **Dispatch** card beside the Sticker card (as in the demo):
    - before dispatch: "Invoices 2 of 3 raised", the vendor's email (or "None yet"), "Courier: picked at dispatch"
    - after: "Blue Dart · slip 50218834", who and when, and "Thu 15 Oct, 11:00 · Neha: Confirm vendor got it"
  - After dispatch the chip reads **Dispatched · D-…**. The Docket, Dispatch and Sticker cards stay, read-only, until
    Step 5 has its own.
- **Settled while building:**
  - **The routes hang off the case** (`/cases/:caseNo/dispatch`), like every other Step 4 route, not
    `/dockets/:docketNo/…`. The answer is that case, and the others in the docket that are open in the browser
    refresh.
  - **The cases are locked by hand,** in id order, after the vendor and the docket. `lockCase` would require the
    dispatcher to be able to act on every case, but Decision 3 lets a processor who owns one of them send the docket.
  - **A file with no invoice is refused before any lock,** so there is no "invoice raised meanwhile" race. A change to
    a case meanwhile (its row is locked) is seen and refused.

### 10. Changing your mind before dispatch

- **Taking a case out of an open docket** is allowed until the docket is dispatched, by whoever can act on the case.
  Audited.
- **Postponing or cancelling a case that is in an open docket** is refused: "Take it out of docket D-2026-0001 first."
  This is clearer than removing it quietly.
- **An empty open docket** is never shown, and the vendor's next case reuses it and its number. There is no "Cancelled"
  state.
- **Sending a case back to File preparation** (a paper found wrong at the last minute) is **not built**. It isn't in
  the demo; flagged as a possible change request.

**Built 13 Oct 2026** (component 1):
- Taking a case out works as described.
- Postpone and cancel check the docket inside their own transaction, after their update has locked the case's row,
  so an add can't slip in between.
- An emptied docket is reused as described in Decision 2's note.

### 11. E-visas (no vendor, no parcel)

0007 left this to 0008.

- When the visa's **Vendor needed** is off, Step 4 shows **"Submitted online"** instead of "Add to docket".
- Whoever can act on the case presses it.
- It needs the locked invoice (0009), then moves the case to Step 5 · At vendor.
- There is no docket, sticker or vendor email.
- Built last, as its own small component.

### 12. Settings and seed data (golden rule 1)

| What | Seeded with |
| --- | --- |
| `visa.docket` | `{ prefix: "D" }` ⚠️ |
| `visa.vendorConfirm` | `{ afterDays: 1, at: "11:00" }` ⚠️ |
| The sticker size | 100 × 150 mm ⚠️ |
| The company's details (name, address, phone) | Masti's own, given 13 Oct 2026 |
| `Courier` | Blue Dart · DTDC · By hand (no AWB) ⚠️ |
| The AWB format | capitals and digits, 4–30 ⚠️ |
| The vendor email wording, the "Open since" and chip wording | ours or the demo's ⚠️ |

## Schema (summary, to confirm in each component's plan)

```prisma
enum DocketStatus { OPEN DISPATCHED }

model Docket {
  id String @id @default(uuid()); docketNo String @unique   // D-2026-0001
  vendorId Int                                              // Restrict
  status DocketStatus @default(OPEN)
  courierId Int?; awbNo String?
  dispatchedAt DateTime? @db.Timestamptz(3); dispatchedById String?
  vendorEmailSentAt DateTime? @db.Timestamptz(3); vendorEmailError String?
  createdById String; createdAt DateTime @default(now()) @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @db.Timestamptz(3)           // the optimistic-lock token
  cases VisaCase[]
}
model DocketCounter { year Int @id; lastValue Int @default(0) }
model Courier { id Int @id @default(autoincrement()); code String @unique; name String; awbNeeded Boolean @default(true); sortOrder Int @default(0); isActive Boolean @default(true) }

// Added column
VisaCase { docketId String?  @@index([docketId]) }          // Restrict; set by "Add", cleared by "Take out"
```

**Hand-written checks:**

- `DISPATCHED` has `dispatchedAt`, `dispatchedById` and `courierId`; `OPEN` has none of them
- `awbNo ~ '^[A-Z0-9]{4,30}$'`
- the master code format `^[A-Z0-9_]{1,40}$` on `Courier`
- at most one `OPEN` docket per vendor (a partial unique index), if Decision 2's open point keeps it that way

The tables arrive with their components: `Docket`, `DocketCounter` and `VisaCase.docketId` with the Docket card;
`Courier` and the dispatch columns' checks with the Dispatch card. Every migration keeps `HolidayTarget_unique`.

## Locking

One order everywhere: **the docket first, then its cases, in enquiry-id order.**

- **Dispatch** locks the docket row (`SELECT … FOR UPDATE`), then each case.
- **Add and take out** lock the docket first too. When adding to a new docket, the vendor's open docket is looked up
  and locked, or created, before the case is locked with `lockCase` (`src/modules/visa/caseLock.ts`).
- Step 4 gets its own step rule in `caseLock.ts`: `DISPATCHING: { stages: ["DISPATCH"] }` (built).
- **Built:** adding a case locks the vendor's row first, then the docket, then the case, so two adds for one vendor
  take turns and never start two shared dockets.
- The races are tested as in 0006 and 0007: hold one lock, and check that the other request waits and then sees the
  change.

## API (sketch)

| Method and path | What | Component |
| --- | --- | --- |
| `POST /api/visa/cases/:caseNo/docket` | `{ mode: "GROUP" \| "OWN", updatedAt }` | Docket card |
| `DELETE /api/visa/cases/:caseNo/docket` | Take the case out | Docket card |
| `GET /api/visa/cases/:caseNo` | Gains `docket { docketNo, status, createdAt, vendor, cases: [{ caseNo, family, country, passports, oldPassports }], totalPassports, totalOldPassports }` | Docket card |
| `POST /api/visa/dockets/:docketNo/dispatch` | `{ courierId, awbNo?, updatedAt }` | Dispatch card |
| `POST /api/visa/dockets/:docketNo/email` | Send again | Dispatch card |
| `GET/POST/PATCH /api/masters/couriers` | The courier master | Dispatch card |
| `POST /api/visa/cases/:caseNo/submitted-online` | E-visas | E-visas |

Routes follow 0007: `requireAuth → requirePasswordChanged → requireUserType("HEAD","OFFICE")` and Visa EDIT; the
service checks Decision 3. Every change is audited with `clientId` on case rows (`visa.docket.add`,
`visa.docket.remove`, `visa.docket.dispatch`, `visa.docket.email`).

## Tests (rule logic), by component

- **Docket card:**
  - who may add or take out; view-only users and other staff may not
  - the wrong stage is refused; a case without `fileReadyAt` is refused; e-visas (Vendor needed off) are refused
  - a switched-off vendor, or one that no longer covers the country, is refused
  - two cases for the same vendor share one docket; "Send on its own" makes a new one
  - taking a case out; an empty docket is reused with its number
  - docket numbers per year, with the prefix setting
  - postpone and cancel are refused while the case is in a docket
  - the passport counts (current from booklets or travellers; old counted in the total)
  - the race between two adds for the same vendor (one docket, not two)
- **Sticker:** the totals and rows match the docket card; printed and checked in the browser at the label size.
- **Dispatch card:**
  - each refusal: no invoice, no vendor email, a switched-off vendor, no courier, a missing or malformed AWB
  - who may dispatch (Decision 3)
  - every case moves to At vendor with `dueAt` the next open day at 11:00, skipping Sundays and office holidays
  - the email is sent after the commit; its failure doesn't undo the dispatch; Send again works
  - the race between dispatch and taking a case out, in both directions
- **E-visas:** refused without the invoice; moves to At vendor; no docket.

## Not in this record

- **The visa invoice** (fees, the quote, the locked invoice, the additional invoice, the credit note): 0009.
- **WhatsApp to the client** ("Invoice INV-…", "File dispatched"): waits for the WhatsApp work (Q8, inputs A3).
- **Cross-sell leads** when an invoice is raised (§10.7): their own feature.
- **The Accounts follow-up task and payments:** the Accounts module.
- **A "Dockets" list page** (every open and sent docket by vendor): not in the demo; each case's docket card shows the
  whole docket. A possible change request.
- **Courier tracking:** no integration was asked for. A possible change request.
- **Sending a case back to File preparation** from Step 4 (Decision 10): a possible change request.
- **"Vendor got it"** and the rest of Step 5: a later record.

## Still needed from Masti

- **B1:** the fee sheet per country and visa type (for 0009)
- **M7 / C5:** the invoice and credit-note format, and the GSTIN and company details (for 0009 and the sticker's
  return address)
- **Q6 / M6:** when the visa invoice is raised
- **Q1:** confirm the docket grouping and the vendor email above
- **The label printer and label size** (the sticker)
- **A6:** the email account (SMTP) the CRM sends from
- **Q7:** the vendor onboarding format (a full vendor address, if they want it on the sticker later)
