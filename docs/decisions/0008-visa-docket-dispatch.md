# 0008 · Visa Step 4: docket, sticker and dispatch

- **Status:** decided (13 Oct 2026, project lead); not built yet. A "Built" note is added under each part as its
  component lands.
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
- **"Send on its own"** ("One file per docket") starts a new docket holding just this case. That docket is the
  vendor's open docket from then on; it doesn't hold two.
  > *To settle in the Docket card's plan:* whether "Send on its own" is allowed while the vendor already has an open
  > docket with other cases, and what happens to that docket. The simplest reading is that it is refused with "Take
  > it out of docket D-… or dispatch that one first", or that the own docket is marked so others can't join it.
- **One docket can hold cases for different countries,** as long as they go to the same vendor (the demo).
- **Once dispatched, a docket is locked.** The vendor's next case starts a new one.
- **A docket may stay open across days.** From the day after it was opened, the docket card shows an amber line
  "Open since 12 Oct, not sent yet" ⚠️. No scheduler is needed: the page compares the docket's `createdAt` with today
  (IST).

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

### 6. The courier

- **A `Courier` master** (rule 2: no free text), in Settings → Masters → Lists, edited by the Visa HOD or the Head.
  Switched off, never deleted.
- **Seeded ⚠️** with Blue Dart, DTDC and "By hand (no AWB)".
- **Each courier has `awbNeeded`.** It is off for "By hand", so no slip number is asked for.
- **The AWB (the courier's slip number) is typed in.** It is data, not a reason. Spaces are removed and letters made
  capitals; then it must be capitals and digits, 4–30 characters ⚠️.
- Built with the Dispatch card.

### 7. The docket number

- **`D-2026-0001`**, the same pattern as case numbers (§17 #21).
- **The prefix "D"** is the setting `visa.docket` → `{ prefix: "D" }` ⚠️.
- **A `DocketCounter` per calendar year (IST)**, bumped in the docket's own transaction, like `CaseCounter`.
- **A number is used only when a docket is created.** An empty open docket keeps its number and is reused
  (Decision 10).

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

### 10. Changing your mind before dispatch

- **Taking a case out of an open docket** is allowed until the docket is dispatched, by whoever can act on the case.
  Audited.
- **Postponing or cancelling a case that is in an open docket** is refused: "Take it out of docket D-2026-0001 first."
  This is clearer than removing it quietly.
- **An empty open docket** is never shown, and the vendor's next case reuses it and its number. There is no "Cancelled"
  state.
- **Sending a case back to File preparation** (a paper found wrong at the last minute) is **not built**. It isn't in
  the demo; flagged as a possible change request.

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
| The company's details (name, address, phone) | a placeholder ⚠️, until Masti gives theirs |
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
- Step 4 gets its own step rule in `caseLock.ts`, e.g. `DISPATCHING: { stages: ["DISPATCH"] }`.
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
