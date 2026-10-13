# Visa Step 4 · Docket & dispatch: the plan and the hand-over

> **Superseded 13 Oct 2026.** The §4 questions are answered in
> [`docs/decisions/0008-visa-docket-dispatch.md`](../decisions/0008-visa-docket-dispatch.md), which wins where they
> differ. The §6 slices are replaced by 0008 Decision 1's order, one component at a time: the Docket card → the
> Sticker card → the invoice (0009) → the Dispatch card → e-visas. Keep this file for the sources (§1–2) and the
> conventions (§7).

Written 13 Oct 2026, after Step 3 was merged (PR #7, `86800ec` on `master`). This file is the starting point for a
new session. It collects what we know, the questions to settle first, and a proposed way to build Step 4 in small
slices. One decision is already made: the build order (Q-A, §3).

---

## 0. For the new session: how to start

1. **Read, in this order:**
   - `CLAUDE.md`: the rules, conventions and commands
   - this file
   - `PROJECT_KNOWLEDGE.md` §10.6 (invoices), §10.8 (vendors), §10.9 (reminders), §10.10 (notifications), §11
     (the worked example, the 7 Oct row) and §12.4 (Step 4 and Step 5)
   - `docs/decisions/0007-visa-file-prep.md` (how Step 3 was decided and built; 0008 should follow the same shape)
   - `docs/features/visa-file-preparation.md` (the developer guide to Step 3: the case lock, the step rules, the
     tests' helpers)
   - the demo screen `Masti-CRM-Handover/references/demo/screens/09-visa-case-step4-dispatch.png` (and 10 for Step 5)
2. **Work with the user one small step at a time, in plain language** (their saved preference). Don't build anything
   yet.
3. **First, go through §4's questions with the user, one at a time.** Each one has a recommendation.
4. **Then write `docs/decisions/0008-visa-docket-dispatch.md`** from the answers, in 0007's shape (Context, Decision,
   Tests, Not in this record). Update `PROJECT_KNOWLEDGE.md` §18 and `Masti-CRM-Handover/05_Open_Questions.md`
   (gitignored, local only) with what was decided.
5. **Then plan slice 1 in plan mode,** get it approved, build it, test it, check it in the browser, and commit it.
   Repeat for each slice.
6. **Make a branch first,** e.g. `feat/visa-dispatch`, from an up-to-date `master`.

---

## 1. Where we are (13 Oct 2026)

**Built and merged:** Visa Steps 1–3.
- **Step 1, Enquiry:** intake with only four things (country, visa type, adults, children) plus the travel month.
- **Step 2, Documents:** the checklist per traveller, follow-ups, postpone/cancel with fixed reasons, and maturity
  ("Mark documents complete"), which hands the case to a processor the HOD picks.
- **Step 3, File preparation:**
  - the processor checks each paper
  - the trip details
  - each traveller's acknowledgement number and appointment
  - the saved file (one PDF in S3-compatible storage)
  - the vendor on the case
  - **"File ready — add to docket"**

**What a case looks like when it reaches Step 4:**

| Field | Value |
| --- | --- |
| `Enquiry.stage` | `DISPATCH` (seeded name "Docket & dispatch", status label "Dispatched" ⚠️, next-step label "Dispatch the docket") |
| `Enquiry.ownerId` | the processor (unchanged by "File ready") |
| `Enquiry.dueAt` | the moment it was marked file ready, so it shows as due on the processor's desk |
| `VisaCase.fileReadyAt` / `fileReadyById` | set together (a database CHECK) |
| `VisaCase.vendorId` | an active vendor covering the country, when the visa's **Vendor needed** is on; it can be empty for e-visas |
| `CaseFile` (kind `FINAL_FILE`) | the saved PDF; the newest one is current |
| Step 3 | read-only: every Step 3 write needs the `FILE_PREPARATION` stage |

**What the screen shows at Step 4 today:**
- the status chip **"File ready · to dispatch"**, instead of the seeded "Dispatched", which isn't true yet
- the next-step button **"Dispatch the docket →"** with a **Soon** tag
- the Saved file card's line "Marked file ready by Neha Joshi, 13 Oct, 8:58 am."

**Checks on `master`:** 265 backend tests pass; typecheck passes on both sides; frontend lint and build pass.

**Not built anywhere yet, and Step 4 needs some of it:**
- **invoices:** no fee, quote or invoice tables exist
- **email:** no SMTP and no email library
- **WhatsApp:** no BSP connection
- **a scheduler or job queue** (§10.9: still to be chosen)
- **the field app:** only a `FieldJob` skeleton
- **cross-sell leads**

---

## 2. What Step 4 is: what the sources say

**Demo screen 09 (the approved look ⚠️ for wording and values):**
- **Header:** status chip "Dispatched · D-121"; next-step button "Dispatch docket D-121 →".
- **Card "Docket D-121 · to the Mumbai vendor",** with a two-way switch: **One file per docket / Several files in
  one** (the demo starts on "Several files in one").
  - **A table: Case · Passports · Invoice.**
    - V-2041 · Mehta · France · 4 · "INV-0412 · locked"
    - V-2044 · Shah · France · 2 · "INV-0415 · locked"
    - V-2047 · Bhatt · Netherlands · 1 · "Raise invoice first" (amber)
  - One docket can hold cases for different countries, as long as they go to the same vendor.
  - **The rule copy:** "A file can't leave without its invoice. The invoice is built from the price quoted at the
    start — nobody types amounts — and can never be edited. Extra costs later go on one additional invoice, never
    more."
- **Card "Dispatch":**
  - Courier: "[Courier] · slip [AWB no.]"
  - Email to vendor: "Sent with the docket list"
  - "Tomorrow 11:00 · Neha": "Confirm vendor got it"
- **Card "Sticker"** (the parcel label) and a **Print sticker** button:
  - "MASTI TRAVELS" and "D-121"
  - "To: [Vendor], Mumbai"
  - "V-2041 (4) · V-2044 (2) · V-2047 (1) · 7 passports"
  - a barcode
- **The right rail** shows "Sent to the client" (WhatsApp "Invoice INV-0412 · 7 Oct") and "Money on this case"
  (INV-0412, the additional invoice INV-0412-A, "Followed up by accounts").
- **The visa board's "Dispatched" column** ("On the way to vendor") shows a card with the chip "Docket D-118" and the
  next step "Confirm vendor got it".
- **Screen 10 (Step 5, "With the vendor")** starts its timeline with "Dispatched in D-121 · Wed 7 Oct", then "Vendor
  got it, papers checked", then "Submitted at the embassy".

**The meeting and the written notes (`02_Requirements_from_Meeting.md` "Vendors and dispatch", "Invoicing (visa)"):**
- On picking the vendor, **print a parcel sticker** from the system.
- **The courier's docket number is typed in** (e.g. Blue Dart). No courier integration.
- **The next day,** the processor confirms receipt with the vendor and records it.
- **Email the vendor** the day's dockets. Per the transcript (6:59 PM), the email lists the docket number and each
  application in it, with names and destination countries.
- **Today Masti sends one docket per vendor per day,** with all of that day's files. Vimal said both ways can be
  tracked, and left the choice to us (Q1).
- **The invoice:**
  - It must exist before the file goes to the vendor.
  - It is built from the quotation breakup (embassy fee, VFS, service, courier), with no manual amounts, and is never
    edited.
  - Payment can come later, but Accounts must see the debit straight away.
  - At most one additional invoice per file. A recall (Step 5) gives a credit note for the embassy fee only.
  - When it's raised is still open: at courier time, or earlier where fees are paid upfront, e.g. VFS (Q6/M6).

**PROJECT_KNOWLEDGE:**
- **The data model sketch (§13):** `Docket`: number, vendor, courier, docket/AWB no., files, dispatched at,
  vendor-confirmed at, vendor email sent at.
- **Reminders (§10.9):** "Vendor receipt confirmation: the day after dispatch ('Tomorrow 11:00')" ⚠️, so it's a setting.
- **Notifications (§10.10):** email carries "vendor dispatch mails (the day's dockets) and invoices".
- **Cross-sell (§10.7):** raising any invoice auto-creates leads in the other departments. This is a separate feature.

---

## 3. The big catch: the invoice

**The demo, the meeting and rule 3 all say no file is dispatched without its invoice.** No invoice code exists yet,
and it isn't small. A visa invoice needs:

1. **Fees per visa:** embassy fee, VFS, service and courier, per adult and per child. This is master data Masti must
   supply (inputs B1, "price breakups"). Today nothing stores them; the intake message's "price per person" isn't
   built either.
2. **The quote:** "the price quoted at the start". The fees have to be copied onto the case when it's quoted, the way
   the checklist is copied at intake, so a later fee change doesn't change an open case. Cases created before fees
   exist would take today's fees when the invoice is raised.
3. **The invoice itself:**
   - a number series: our choice, kept as a setting (decided 9 Oct)
   - GST: which lines carry it, the rate, and the place of supply from the client's state code
   - "never edited"
   - the client must be complete first: the `clients.invoiceReadiness` setting already exists
   - a PDF in Masti's format (M7/inputs C5, still needed from Masti)
   - stored privately, like the saved file
4. **Around it:**
   - an Accounts follow-up task
   - "a call after sending is compulsory"
   - WhatsApp to the client
   - cross-sell leads
   - the one additional invoice and the credit note (Step 5)

Most of item 4 belongs to the Accounts module and the WhatsApp work, not Step 4.

**Options:**

| | Option | Good | Bad |
| --- | --- | --- | --- |
| A | **Build the invoice first,** in its own decision record (0009), then dispatch with the rule enforced | Rule 3 holds from day one; Step 4 is finished properly | The longest path; needs Masti's fees and invoice format (we can seed samples ⚠️ and use our own layout until theirs arrives) |
| B | **Build dockets, the sticker and the dispatch now, and add the invoice check when invoices exist.** The Invoice column says "Invoices come later". | Step 4's mechanics move now, without waiting on Masti | For a while the system lets a file leave without an invoice, which breaks rule 3; it must not go live like that |
| C | **Interleave:** dockets and the sticker first (they don't need the invoice), then the invoice (0009), then dispatch with the check | Moves now, never breaks rule 3, and gives Masti time to send the fees and format | Dispatch comes last |

**Decided 13 Oct 2026 (the user): C.** Dockets and the sticker first, then the visa invoice in its own decision
record (0009), then dispatch last, with the invoice check from the start. Record this in 0008 and `PROJECT_KNOWLEDGE.md`
§18 when 0008 is written. Still ask whether the project lead can get the fee sheet (B1) and the invoice format
(M7/C5) from Masti now.

---

## 4. Questions to settle before 0008 (ask one at a time)

Each question names the open question it relates to (`PROJECT_KNOWLEDGE.md` §18) and a recommendation. ⚠️ means the
value becomes configurable master data seeded with the demo's value.

### Q-A · The invoice (see §3)
**Decided 13 Oct 2026 (the user): C.** Don't ask again; start with Q-B.

### Q-B · Docket grouping (open question Q1, "Y→C": we recommend, the client confirms)
- **Today:** one docket per vendor per day, with all that day's files. The demo switches between "One file per
  docket" and "Several files in one".
- **Recommendation:** a docket per vendor stays **open** until it's dispatched.
  - **"Add to docket"** on a case puts it in that vendor's open docket, or starts one if there isn't one. This is
    "Several files in one", the demo's default and today's practice.
  - **"Send on its own"** starts a docket holding just this case ("One file per docket").
  - Once dispatched, a docket is locked, and the vendor's next case starts a new one.
  - This also supports "one per vendor per day" without a scheduler: whoever dispatches closes that day's docket.
- **Ask:** may a docket stay open over several days, or should yesterday's open docket be flagged?

### Q-C · The email to the vendor (Q1, second half)
- **Per docket, sent when it's dispatched (recommended),** or one email a day with all of the day's dockets? The
  daily version needs a scheduler, which isn't chosen yet (§10.9).
- **Contents** (transcript 6:59 PM): the docket number, the courier and AWB, and each application (case no.,
  travellers' names, destination country, passport count). Wording ⚠️: we draft it, Masti approves.
- **How it's sent:** there's no SMTP yet (inputs A6).
  - **Recommendation:** a small `src/lib/email.ts` (nodemailer over SMTP), configured by `SMTP_*` settings in `.env`,
    with **Mailpit** in `docker-compose.yml` for local use and tests, like MinIO for files.
  - Send it **after** the dispatch is saved, never inside the transaction. Record "sent at" or the failure, and offer
    **Send again**.
  - A failed email doesn't undo the dispatch.
- **The vendor's email becomes required** to dispatch to that vendor (0007 open point C said Step 4 would decide this).
  Refuse the dispatch with "Add an email for Global Visa Services in Vendors first."

### Q-D · Who builds and dispatches a docket
A docket can hold several processors' cases.
- **Adding or taking out a case:** whoever can act on that case (its processor, the Visa HOD, the Head), as in
  Step 3.
- **Dispatching:**
  - **Recommendation:** the Visa HOD, the Head, or a processor who owns at least one case in the docket.
  - Pressing it acts for every case in it. Each case's audit row names who dispatched.
- **Ask:** is the person at the courier counter a processor, or someone else (e.g. the collection boy, an office
  helper)?

### Q-E · Passports per case (the docket table and the sticker)
- **The demo:** Mehta shows 4, and Mehta has 4 travellers. The sticker adds them up ("7 passports").
- **Step 2 records booklets:** "4 current + 3 old", both optional.
- **Recommendation:**
  - show the travellers' current passports: `bookletsCurrent` if it's filled in, otherwise the number of travellers
  - show old passports separately when there are any: "4 (+3 old)"
  - the sticker's total counts current passports only, as in the demo
- **Ask:** do old passports go to the vendor too? (The France checklist asks for "Old passports · Original".)

### Q-F · The courier
- **Rule 2 (no free text) points to a courier master:** a list in Settings → Masters → Lists, edited by the Visa HOD
  or the Head.
  - Seeded ⚠️ with Blue Dart, DTDC and "By hand (no AWB)".
  - Each has a switch, **AWB needed**: off for "By hand".
- **The AWB / docket number** is typed in: it's data, not a reason. Capitals and digits, 4–30 characters ⚠️.
- **Ask:** which couriers does Masti use?

### Q-G · The sticker
- **Printed from the browser** (a print-only page), not a PDF.
- **Size:**
  - **Recommendation:** 100 × 150 mm, a common thermal-label size, which also prints fine on A4 ⚠️.
  - **Ask:** what printer and labels does Masti have?
- **The barcode:**
  - It encodes the docket number (Code 128).
  - **Recommendation:** a small, well-known library, e.g. `jsbarcode` (pin an exact version at least two weeks old),
    or our own SVG.
- **Contents,** as in the demo:
  - MASTI TRAVELS and the docket number
  - "To: <vendor>, <city>"
  - each case with its passport count, and the total
- **Ask:** should the sticker carry Masti's return address, or the vendor's full address? The vendor master has no
  address yet (Vimal's onboarding format, Q7, is still to come).

### Q-H · The docket number
- The demo shows `D-121`. Case numbers were settled as `{prefix}-{YYYY}-{NNNN}` (§17 #21), with the prefix a
  setting.
- **Recommendation:** dockets do the same: `D-2026-0001`.
  - The prefix "D" is a setting ⚠️.
  - The counter runs per calendar year (IST) and is bumped in the docket's own transaction, like `CaseCounter`.
- **Ask:** does Masti have a docket series today that we should continue?

### Q-I · "Confirm vendor got it" the next day
- **Recommendation:**
  - On dispatch, each case's `dueAt` becomes the **next open office day at 11:00**. Use `nextOpenDay` in
    `src/modules/holidays/blockedDays.ts`, which already skips Sundays and office holidays.
  - It lands on the case owner's desk. No scheduler is needed: the follow-up desk reads `dueAt`.
  - Setting `visa.vendorConfirm` = `{ afterDays: 1, at: "11:00" }` ⚠️, like `visa.firstFollowUp`.
- **The "Vendor got it" action itself is Step 5's first step** (0010?). See Q-J.

### Q-J · Where dispatch leaves the case
- **Recommendation:** **Dispatch** moves every case in the docket to **Step 5 · At vendor**.
  - The status chip says **"Dispatched · D-2026-0001"** until the vendor confirms (the board's "Dispatched" column).
  - The next step is "Confirm vendor got it", due the next open day at 11:00.
  - Step 4 is then read-only for those cases.
  - Step 5 (later) adds "Vendor got it", the vendor's file number, the expected collection date, recall and the
    additional invoice.
- **The alternative** keeps the case at Step 4 until the vendor confirms receipt. It's simpler for Step 5, but the
  case would sit at "Docket & dispatch" after the parcel has left.
- **Before dispatch, while a case is in an open docket,** the chip says **"In docket D-2026-0001"**. Until then it
  says "File ready · to dispatch".

### Q-K · E-visas (no vendor, no parcel)
0007 left this to 0008. When the visa's **Vendor needed** is off, there's nothing to courier.
- **Recommendation:**
  - At Step 4 such a case shows **"Submitted online"** instead of "Add to docket".
  - Pressing it needs the invoice (once invoices exist) and moves the case straight to Step 5.
  - There's no docket, sticker or vendor email.
- **Ask:** is that how e-visas work at Masti, and who submits them?

### Q-L · Changing your mind before dispatch
- **Taking a case out of an open docket:** allowed until the docket is dispatched, by whoever can act on the case.
  Audited.
- **Postponing or cancelling a case that's in an open docket:**
  - **Recommendation:** refused, with "Take it out of docket D-2026-0001 first."
  - This is clearer than quietly removing it.
- **An empty open docket:**
  - **Recommendation:** it disappears, i.e. it's never shown and the next case reuses it.
  - The alternative is a "Cancelled" state.
  - Docket numbers are only used up when a docket is created, so keep it simple.
- **Sending a case back to File preparation** (e.g. a paper found wrong at the last minute):
  - This isn't in the demo. Flag it as a possible change request rather than build it.
  - **Ask** whether it's needed.

### Q-M · Out of Step 4 (confirm, then list under "Not in this record")
- WhatsApp to the client ("Invoice INV-0412", "File dispatched"): this waits for the WhatsApp work (Q8, inputs A3).
- Cross-sell leads on invoicing (§10.7): their own feature.
- The Accounts follow-up task and payments: the Accounts module.
- A "Dockets" list page (all open and sent dockets by vendor): **not in the demo.** The docket card on each case page
  shows the whole docket. Flag the list page as a possible change request, unless the user decides otherwise.
- Courier tracking: no integration was requested.

---

## 5. A first sketch of the data (to confirm in 0008)

| Table / field | What it holds |
| --- | --- |
| `Docket` | `id`; `docketNo` (unique, `D-2026-0001`); `vendorId` (Restrict); `status` (`OPEN` / `DISPATCHED`, an enum because code branches on it); `courierId?`; `awbNo?`; `dispatchedAt?` and `dispatchedById?` (set together: CHECK); `vendorEmailSentAt?`; `vendorEmailError?`; `createdById`; `createdAt`; `updatedAt` (the optimistic-lock token) |
| `VisaCase.docketId?` | Restrict, indexed. Set by "Add to docket", cleared by "Take out" while the docket is open |
| `Courier` | `code` (never changes), `name`, `awbNeeded`, `sortOrder`, `isActive`. Switched off, never deleted |
| `DocketCounter` | `year`, `lastValue` (like `CaseCounter`) |
| Settings | `visa.docket` `{ prefix: "D" }` ⚠️ and `visa.vendorConfirm` `{ afterDays: 1, at: "11:00" }` ⚠️ |
| CHECKs (hand-written in the migration) | `DISPATCHED` needs `dispatchedAt`, `dispatchedById` and `courierId`; `OPEN` has none of them; the AWB's format |

**Locking:**
- A dispatch locks the docket row (`SELECT … FOR UPDATE`) first.
- Then it locks each case, in one fixed order (by enquiry id), so two actions can't deadlock.
- Adding or taking out a case locks the case (`lockCase` in `caseLock.ts`), then the docket.
- **Pick one order and use it everywhere:** docket first, then cases. Write it in 0008, and test the races as 0006
  and 0007 did: hold one lock and check that the other request waits and then sees the change.

**The invoice tables** (fees, quote, invoice, lines) belong to 0009 and aren't sketched here.

---

## 6. The proposed slices (Q-A = C, decided 13 Oct 2026)

Each slice: plan in plan mode → approval → build → tests → browser check → docs → commit. Step 4 needs a new step
rule in `caseLock.ts`, e.g. `DISPATCHING: { stages: ["DISPATCH"] }`.

1. **Courier master and docket settings** (small)
   - the `Courier` table and seed ⚠️, plus the screens in Settings → Masters → Lists (copy `DocumentProblemsTable`)
   - the `visa.docket` and `visa.vendorConfirm` settings
2. **Dockets: add a case, take it out, and the docket card**
   - `Docket`, `DocketCounter` and `VisaCase.docketId`, plus the migration
   - **`POST /api/visa/cases/:caseNo/docket { mode: "GROUP" | "OWN", updatedAt }`** adds the case:
     - only at `DISPATCH`, with `fileReadyAt` set, the vendor active and still covering the country, and Vendor needed
       on
     - it joins the vendor's open docket, or a new one
   - **`DELETE /api/visa/cases/:caseNo/docket`** takes it out.
   - **The case DTO** gains `docket { docketNo, status, vendor, cases: [{ caseNo, family, country, passports, oldPassports }], totalPassports }`.
   - **The screen:** a `DocketCard` at Step 4, in the demo's layout, with the switch as "Add to the open docket" or
     "Send on its own".
     - The Invoice column says "Invoices come later" (muted) until 0009.
   - **Header:** the chip "In docket D-…", and the next-step button "Add to docket" or "Dispatch docket D-…".
   - **Audit:** `visa.docket.add` and `visa.docket.remove`, on the Enquiry, with `clientId`.
   - **Tests:**
     - who may act; the wrong stage; e-visas refused
     - a switched-off vendor, or one no longer covering the country, is refused
     - two cases for the same vendor share one docket; "Send on its own" makes a new one
     - taking a case out
     - postpone/cancel refused while in a docket
     - the race between adding a case and a dispatch
3. **The sticker**
   - a print-only route, e.g. `/enquiries/:caseNo/sticker`, or a dialog with `@media print` styles
   - the barcode, and the passport totals
   - checked in the browser at the chosen label size
4. **The visa invoice (0009),** planned and decided on its own, probably in 2–3 slices:
   - fees
   - the quote copied onto the case
   - raising the locked invoice, with its PDF
5. **Dispatch**
   - **`POST /api/dockets/:docketNo/dispatch { courierId, awbNo?, updatedAt }`** (or under `/api/visa/`). It refuses
     unless every case has its locked invoice, the vendor has an email, and the AWB is in when the courier needs one.
   - **In one transaction:** lock the docket and then the cases; move each case to `AT_VENDOR` with `dueAt` the next
     open day at 11:00; lock the docket. Audit `visa.docket.dispatch` on each case, plus one on the docket.
   - **Then:** send the vendor email (`src/lib/email.ts`, Mailpit locally) and record the result. **Send again** on
     failure.
   - **The screen:**
     - the Dispatch card (courier dropdown, AWB, email status, "Tomorrow 11:00 · Neha · Confirm vendor got it")
     - the header chip "Dispatched · D-…"
     - Step 4 read-only afterwards
   - **Tests:**
     - each refusal
     - the email isn't sent inside the transaction, and its failure doesn't undo the dispatch
     - `dueAt` skips Sundays and office holidays
     - the race between dispatch and taking a case out
6. **E-visas: "Submitted online"** (if Q-K is accepted). Small; it needs the invoice too.

Dispatch (slice 5) is never built without the invoice check: no file leaves without its invoice (rule 3).

---

## 7. Conventions that matter here (short; the full list is in `CLAUDE.md`)

**Routes and modules:**
- Routes: `requireAuth → requirePasswordChanged → requireDepartment("VISA", "EDIT" | "VIEW")` (see `visaEdit` and
  `visaView` in `visa.routes.ts`).
- Module files are `*.routes.ts`, `*.service.ts` and `*.schemas.ts`.
  - Services never touch `req`/`res`.
  - Schemas import only zod and the generated enums.
- Every change writes `audit({...}, tx)` in the same transaction, with `clientId` on case rows.

**Case writes:**
- Use `loadCase(caseNo, actor, RULE)` before the transaction.
- Inside the transaction, use `lockCase` and check `assertFresh(updatedAt)` again (see `markFileReady` in
  `visaFilePrep.service.ts`).
- Errors: `HttpError` helpers. A list of what's missing goes in `409` with `{ code, missing }` (see `NOT_READY`).

**Migrations:**
- Make them with `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`.
- Remove the `DROP INDEX "HolidayTarget_unique"` it proposes.
- Then run `npm run db:deploy` and `npm run db:generate`. `npm run db:migrate` hangs: don't use it.

**Tests:**
- `npm run db:up` first. `npm test` wipes the database named in `.env.test`.
- Reuse `tests/visaHelpers.ts`: `maturedCase()`, and `readyCase()`, which gives a case at Step 4 with everything in.

**Code style:**
- The backend uses double quotes and semicolons.
- The frontend uses single quotes, no semicolons, and lines up to about 150 characters.
- The frontend imports from `'react-router'`.
- Don't run Prettier.

**Secrets:** never print or commit `Backend/.env` or `.env.test`.

**Browser checks:**
- The previous session used a throwaway copy:
  - the API on :5001 against the test database and bucket
  - the app on 127.0.0.1:5174
  - a seed script for Neha, Aarti, Riya (HOD) and Meena (view-only), three vendors and three cases
- **The tools are in that session's scratchpad:**
  `C:\Users\Mansi\AppData\Local\Temp\claude\D--accelarate-Masti-CRM\0abbb84b-6876-473f-89ac-628462e66516\scratchpad\ui-check\`
  - `launch.mjs` runs a command with `.env.test` on port 5001
  - `vite.ui-check.config.mjs` is the second frontend
  - `seed-ui.ts` resets and seeds the test database; only run it after `npm test` has finished
  - `sample-file.pdf` is a test PDF
- Copy them into the new session's scratchpad if they're still there; otherwise rebuild them the same way.
- **Never touch the user's own dev servers on :5000 and :5173.**

**Git:**
- Commit only when the user asks, or an approved plan says to.
- End commit messages with the `Co-Authored-By` line from the session's instructions.

**Docs:**
- When something is decided, update `PROJECT_KNOWLEDGE.md` and `Masti-CRM-Handover/05_Open_Questions.md`.
- Add a "Built" note under each decision as it's built.
- Out-of-scope ideas are flagged, not built quietly.

---

## 8. What to ask Masti (for the project lead), so later slices don't wait

- **B1:** the fee sheet per country and visa type (embassy fee, VFS, service, courier; adult and child).
- **M7 / C5:** the invoice and credit-note format, and the GSTIN and company details on them.
- **Q6 / M6:** when the visa invoice is raised.
- **Q1:** confirm the docket grouping and the vendor email we recommend.
- **Couriers used:** the label printer and label size.
- **Vendors' emails:** the address on the sticker (part of Vimal's vendor onboarding format, Q7).
- **A6:** the email account (SMTP) the CRM sends from.
