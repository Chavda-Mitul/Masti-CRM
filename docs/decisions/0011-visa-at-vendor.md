# 0011 · Visa Step 5: at the vendor

- **Status:** decided (15 Oct 2026, project lead). Being built one component at a time (Decision 1). Built: "Vendor got
  it" (15 Oct 2026, component 1); submitted at the embassy, with the collection date (15 Oct 2026, component 2); correcting a wrong invoice with a credit
  note and its replacement (15 Oct 2026, components 3a–3c); recall (15 Oct 2026, components 4a–4b); the additional
  invoice (15 Oct 2026, components 5a–5c). A "Built" note is added under each part as its component lands.
- **Date:** 15 Oct 2026
- **Scope:** everything from the vendor having the parcel (or an e-visa going in online) until the decision is
  recorded (Step 6):
  - "Vendor got it, papers checked"
  - submission at the embassy: the vendor's file number, the embassy, and the expected collection date
  - taking the file back (recall)
  - the credit note and the one additional invoice per file (golden rule 3)
- **Builds on:**
  - [0008](0008-visa-docket-dispatch.md): dispatch, `visa.vendorConfirm`, and e-visas "Submitted online"
  - [0009](0009-visa-invoice.md): the locked invoice; Decision 9 left the credit note and the additional invoice to
    this record
  - [0005](0005-system-masters.md): the `Embassy` master and the holiday calendar; §2 left the case's embassy to this
    record
  - [0007](0007-visa-file-prep.md): each traveller's appointment

## Context

What a case looks like when it reaches Step 5:

| Field | Value |
| --- | --- |
| `Enquiry.stage` | `AT_VENDOR` (seeded "At vendor", status label "Submitted" ⚠️, next step "Record the decision") |
| `Enquiry.dueAt` | the next open office day at 11:00 after dispatch (`visa.vendorConfirm`), or after "Submitted online" (`visa.onlineCheck`) |
| `VisaCase.docketId` | the dispatched docket (courier, slip, email); null for e-visas |
| `VisaCase.submittedOnlineAt` | set for e-visas instead of a docket |
| `VisaCaseTraveller.appointmentAt` | the embassy appointment entered in Step 3, when the visa needs one |
| `Invoice` | the case's locked tax invoice (required before dispatch or online submission) |

What the sources say:

| Source | What it says |
| --- | --- |
| Demo ⚠️ (screen 10) | Card **With the vendor**: "Dispatched in D-121 · Wed 7 Oct", "Vendor got it, papers checked · Thu 8 Oct", "Submitted at the embassy · Fri 9 Oct", "File number from vendor FR-MUM-88421". Card **Expected collection date**: "French embassy, Mumbai · October 2026 · holidays and Sundays can't be picked", a month calendar, **Save date**. Card **Take the file back (recall)**: "Credit note — embassy fee only ₹[embassy fee × 4]", "VFS, service charge, courier both ways · kept", "Only an HOD can return more, case by case. **Change refund (HOD)**". Card **Additional invoice** "1 of 1 used": "INV-0412-A · urgent submission charge ₹[amount]". Header chip "Submitted · FR-MUM-88421", button "Record the decision →". |
| Meeting ✅ | The vendor's file number is typed in (it arrives by mail, WhatsApp or phone). Entering it forces a **mandatory approximate collection date**; embassy holidays can't be picked. The follow-up desk is reminded a day before to check with the vendor ⚠️. The case isn't touched until then. |
| Meeting ✅ (7:04–7:07 PM) | **Recall:** when the embassy will take longer than the client can wait, the papers come back unsubmitted, with a reason and a **credit note for the embassy fee only** (₹10,000 bill, ₹3,000 embassy fee: ₹3,000 back). Only an HOD can return more, case by case; the override can only increase the refund. **At most one additional invoice per file** (₹500 photos, urgent fee; about 3–4% of cases). |
| Masti, M36 (13 Oct 2026) | An invoice is never cancelled or changed; every correction is a credit note, even before dispatch. |
| 0005 §2 | "Which embassy a visa case goes to is decided in the Step 5 design": likely `VisaCase.embassyId`, picked with the file number, filled in when the country has one active post. |

## Decision

### 1. Build order: one component at a time

**Decided 15 Oct 2026 (project lead):** follow the case, then the money. Each component is planned in plan mode, built,
tested, checked in the browser and committed before the next starts:

1. **With the vendor:** "Vendor got it, papers checked" (Decision 2)
2. **Submitted at the embassy:** the vendor's file number, the embassy and the expected collection date, saved together
   (Decisions 3 and 4)
3. **The credit note,** possible from the moment an invoice exists (Decision 5)
4. **Recall** (Decision 6)
5. **The additional invoice** (Decision 7)

### 2. "Vendor got it, papers checked"

- **Per file, not per docket.** **Decided 15 Oct 2026 (project lead):** "papers checked" is about each file, and one
  file in a parcel may have a problem while the others don't. Each file is confirmed on its own case page.
- **Who:** whoever can act on the case (its processor, the Visa HOD, the Head).
- **Due next: the appointment.** **Decided 15 Oct 2026 (project lead):** the vendor submits at the embassy appointment
  booked in Step 3. So the case comes back due at the earliest traveller's appointment still to come. With no
  appointment (the visa needs none, or it has passed), it's due the next open office day at 11:00 ⚠️: the setting
  `visa.submissionCheck` → `{ afterDays: 1, at: "11:00" }`.
- **E-visas have no vendor:** they skip this, and the With the vendor card isn't shown for them.

**Built 15 Oct 2026** (component 1):

- **API and data:**
  - `GET /api/visa/cases/:caseNo/vendor-received/check` (anyone who can open the case) returns `{ dueAt, dueReason }`,
    where `dueReason` is `APPOINTMENT` or `NEXT_DAY`.
  - `POST /api/visa/cases/:caseNo/vendor-received` with `{ updatedAt }` returns `{ case }`. It's for whoever can act on
    the case (`lockCase` with the new step rule `WITH_VENDOR`), and refused with:
    - 409 at any other step ("…while the file is with the vendor")
    - 409 for an e-visa ("This file went in online: there's no vendor to confirm.")
    - 409 when it's already recorded
    - 409 STALE; the usual postponed and closed refusals
  - **In one transaction:** `VisaCase.vendorReceivedAt` / `vendorReceivedById` are stamped (migration
    `20261015120000_vendor_received`; CHECKs: set together, and only with a docket). The case's `dueAt` becomes the
    earliest traveller appointment still to come, or else `visa.submissionCheck` → `{ afterDays: 1, at: "11:00" }` ⚠️
    through `dueOnOfficeDay`. The other files in the docket don't change.
  - **Audited** as `visa.vendorReceived` on the Enquiry, with `clientId`, before/after `dueAt`, `dueReason` and the
    docket number. The case sends `vendorReceived { at, by }`.
  - The setting is seeded and changed through `PUT /api/visa/settings`, like the other timings.
- **Screen:**
  - The header button **Vendor got it →** opens a confirm dialog: "Did Global Visa Services get VISA-2026-0001 in
    docket D-2026-0001, with its papers in order?", and when the file comes back due ("…at the embassy appointment, to
    get the file number").
  - Then the chip reads **"With vendor · papers checked"** ⚠️, and the header shows "Mark submitted → Soon" until
    component 2.
  - **Step 5's layout:** a **With the vendor** card beside the Dispatch card (demo screen 10). It shows Dispatched in
    D-… with its date, Vendor got it with its date (or "Waiting"), Submitted at the embassy and the file number ("—"
    until component 2), and what's due next ("Thu 15 Oct, 11:00 · Neha: Confirm vendor got it", then "Get the file
    number").
  - The Docket and Sticker cards now show only at Docket & dispatch. The Dispatch card keeps the courier, the slip and
    the email (with Send again); its due row moved to the With the vendor card. So the sticker can't be reprinted from
    Step 5, as in the demo.

### 3. The embassy

**Decided 15 Oct 2026 (project lead):** `VisaCase.embassyId` is picked when the vendor's file number is entered, from the
active embassies of the case's country. It's filled in when the country has only one. The collection-date calendar reads
that embassy's holidays (`blockedDays` with `{ embassyId }`, 0005 §3).

### 4. Submitted at the embassy, and the expected collection date

- **The file number** is typed in, then cleaned up and checked: capitals, digits and dashes, 3–40 ⚠️ (the format is
  settled in component 2's plan).
- **The expected collection date is mandatory with it:** both are saved together.
  - The calendar greys out the embassy's holidays and Sundays.
  - The server refuses a blocked date (400), using the same `blockedDays`.
- **The reminder ⚠️:** the case is due the open office day before the collection date, at 11:00, as a setting
  (proposed; settled in component 2's plan). The case isn't touched until then.
- **The chip:** "Submitted · FR-MUM-88421", as in the demo.
- **A collection date on or after the day the trip begins is a warning** (21 Oct 2026, from the visa test): the client
  would travel without the passports. "Check before saving" names both dates; staff save anyway if the trip moves,
  and the audit keeps it (`collectionWarnings`). An unchanged date isn't asked again.

**Decided 15 Oct 2026 (project lead), while planning component 2:**
- **One file number per file,** as in the demo. The per-traveller portal numbers are already in Step 3.
- **The file number and the date can be changed** while the file is at Step 5, by its processor, the Visa HOD or the
  Head. Every change is audited with the old and new values; no reason is asked.
- **"Submitted at the embassy" is stamped when it's first saved;** nothing is picked.
- **The reminder:** due the open office day before the collection date, at 11:00 ⚠️ (a setting).

**Built 15 Oct 2026** (component 2):

- **API and data:**
  - `PUT /api/visa/cases/:caseNo/submission` with `{ vendorFileNo, embassyId, collectionOn, updatedAt }` saves it, and
    changes it later; it returns `{ case }`. It's for whoever can act on the case (`WITH_VENDOR`). Refused with:
    - 409 "Confirm the vendor got it first."
    - 409 for an e-visa ("…there's no vendor file number")
    - 409 at any other step, STALE, postponed
    - 400 under `vendorFileNo`: spaces are dropped and letters made capitals, then it must be 3–40 capitals, digits,
      "-" or "/", starting with a letter or digit ⚠️
    - 400 under `embassyId`: another country's embassy, or one switched off. The one already on the case stays
      allowed, so its date can still move.
    - 400 under `collectionOn`: today or earlier; more than 366 days ahead; or a day the embassy is closed ("Dussehra:
      French embassy, Mumbai is closed that day. Pick another."). That's `blockedDays` with `{ embassyId }`: its own,
      its country's and all embassies' holidays, and the seeded weekly Sunday.
  - **Columns** on `VisaCase`: `vendorFileNo`, `embassyId`, `collectionOn`, `submittedAt`, `submittedById` (migration
    `20261015130000_submission`). CHECKs: all five set together; only after the vendor got it; the file-number pattern.
  - **In one transaction:**
    - the first save stamps who and when, and is audited as `visa.submitted`
    - a later change keeps the stamp, and is audited as `visa.submission.update` with the old and new values
    - a save that changes nothing writes nothing
  - **`dueAt`:** the open office day `daysBefore` the date, walking back over Sundays and office holidays (the new
    `previousOpenDay` in `holidays/blockedDays.ts`), at `at`. It's never already past (fixed 19 Oct 2026, code review):
    once that time has gone, or the day was before today, it's the first open office day from today whose `at` is still
    to come (it was clamped to today, even a closed day or after the time). The setting is
    `visa.collectionCheck` → `{ daysBefore: 1, at: "11:00" }` ⚠️.
  - The case sends `submission { vendorFileNo, embassy { id, name, city }, collectionOn, at, by }`.
- **Screen:**
  - After Vendor got it, the header button **Mark submitted →** opens a dialog with:
    - the file number
    - the embassy (shown as text when the country has one, a list when it has several, "No embassy for France yet" when
      none)
    - a **month calendar** (`CollectionCalendar`, Monday first): the days the embassy is closed are struck through with
      the holiday's name; today and earlier can't be picked
  - The chip then reads **"Submitted · FR-MUM88421"**, and the header shows "Record the decision → Soon" (Step 6).
  - **The With the vendor card** shows "Submitted at the embassy" with its date and the file number.
  - **A new Expected collection date card** shows the embassy, the date, and "Mon 26 Oct, 11:00 · Neha: Check with the
    vendor", with **Change**, which reopens the dialog filled in.
  - The calendar is in the dialog rather than always on the card, so the file number and the date are always saved
    together.

**Decided 16 Oct 2026 (project lead), after the end-to-end walkthrough** (a file was marked submitted six days before
its appointment, with a collection date before the appointment):
- **"Submitted at the embassy" can't be saved before the earliest traveller's appointment day** (409 "The embassy
  appointment is Thu 22 Oct 2026. Mark it submitted on that day or after."). The dialog shows the same notice and keeps
  Save off. A change later isn't held back.
- **The expected collection date is after the latest appointment day,** at the first save and on Change (400 under
  `collectionOn`, "Pick a day after the appointment (…)"). The calendar greys out the days up to it.
- **No appointment booked** (an e-visa, or "Appointment needed" off): no rule.
- **Snag:** appointments can't be edited after Step 3, so if one is moved earlier after dispatch, staff wait until the
  day the CRM has before marking the file submitted.

### 5. The credit note

- **Possible from the moment an invoice exists,** before or after dispatch (M36). It's never edited.
- **After the handover too** (fixed 21 Oct 2026, from the visa test): the handover closes the case, and the closed
  status used to refuse every invoice action although `INVOICED` lists Delivered. Now the step rule allows a closed
  case (`closedToo`): its processor, the Visa HOD or the Head can cancel a wrong invoice with a credit note, raise the
  replacement from the reopened quote, or raise the additional invoice. The case stays closed and Delivered.
- **On a cancelled case too** (amended 17 Oct 2026, [0006](0006-visa-documents.md) amendment 15): no replacement follows
  there, so it's a refund, and only the Visa HOD or the Head may issue it (step rule `CREDITING`).
- **Masti's answer (15 Oct 2026, through the project lead):** a wrong invoice is never changed; it's corrected with a
  credit note. Masti has **no system today:** the CRM is their first. So there's no credit-note format to match and no
  series to continue.

**Decided 15 Oct 2026 (project lead):**
- **The corrected invoice is a replacement** (answers M37). After a credit note cancels a wrong invoice, a fresh invoice
  is raised from the corrected quote. It doesn't use up the file's one additional invoice, which stays free for extra
  charges such as an urgent fee.
- **A credit note can be whole or part.**
  - A correction cancels the whole invoice.
  - A recall gives back part of it: the embassy fee, or more if the HOD allows (Decision 6).
  - The total credited on an invoice can never be more than was invoiced.
- **GST.** A credit note that cancels a whole invoice reverses everything on it, **including its exact GST**, so the
  accountant's tax reports come back to zero. A part credit note carries **no GST**: the embassy and VFS fees it
  returns had none. If an HOD's larger refund includes the service charge, its GST is still not touched ⚠️ (for the
  accountant to confirm, M38).
- **Its own number series,** since Masti has none: `MCN` + 8 digits ⚠️, starting at 1, as settings like the
  invoice's.
- **The PDF** follows our invoice's layout, since there's no format to copy. It's stored and locked like the invoice
  (a trigger, and no edit route).

**Decided 15 Oct 2026 (project lead), while planning component 3:**
- **Who cancels:** the case's processor, the Visa HOD or the Head, the same people who raise the invoice. (A recall
  that returns more than the embassy fee is the HOD's alone, Decision 6.)
- **The reason** comes from a list the Visa HOD edits, never free text.

**Built 15 Oct 2026** (component 3, in three steps):

- **3a, the reasons list** (`5c2cbcf`):
  - Table `CreditNoteReason`, with the code CHECK (migration `20261015140000_credit_note_reasons`).
  - Seeded ⚠️: Wrong amount, Wrong client details, Wrong traveller details, Client cancelled, Recall.
  - `GET/POST/PATCH /api/masters/credit-note-reasons`: Visa staff read; the Visa HOD or the Head edit. Audited as
    `creditNoteReason.create` / `.update`.
  - Settings → Masters → Lists → **Credit-note reasons**.
- **3b, cancelling a wrong invoice** (`df0a029`):
  - `GET /api/visa/cases/:caseNo/invoice/cancel/check` returns `{ invoiceNo, alreadyCancelled, blockers, preview }`.
    The preview is the next number and every amount given back.
  - `POST /api/visa/cases/:caseNo/invoice/cancel` with `{ invoiceNo, totalPaise, reasonId }`. It's for the case's
    owner, the Visa HOD or the Head, at any step (the step rule `INVOICED`). Refused with:
    - 409 `CREDIT_NOTE_CHANGED` when the invoice or its total isn't the one shown
    - 409 when it's already cancelled
    - 400 under `reasonId` for a switched-off reason
    - 409 `CREDIT_NOTE_BLOCKED` while Masti's details can't be printed
  - **A WHOLE credit note copies the invoice's amounts and lines,** its CGST, SGST or IGST included. Tables
    `CreditNote`, `CreditNoteLine` and `CreditNoteCounter` (migration `20261015150000_credit_notes`), with:
    - triggers: never edited
    - CHECKs: the totals add up; nothing is negative; a PART note carries no GST
    - a partial unique index: one WHOLE note per invoice
    - a BEFORE INSERT trigger: a note is on its invoice's case, and a WHOLE one matches its invoice exactly
  - **Its own series,** `visa.creditNote` → `{ prefix: "MCN", digits: 8, startAt: 1 }` ⚠️. Like the invoice's counter,
    it's taken last, after the PDF is stored, with retries.
  - **The PDF** comes from the invoice's renderer with a document type:
    - "CREDIT NOTE"
    - "Against Tax Invoice MVI… dated …" and "Reason: …"
    - "Total Credit in ₹"
    - no bank details, balance or terms
  - Stored as `CaseFile` `CREDIT_NOTE` (`MCN00000001_Mehta.pdf`). Audited as `visa.creditNote.issue`.
  - **A cancelled invoice no longer counts** (`liveInvoiceNo` in `visaCase.ts`): dispatch and Submitted online are
    blocked again, and the docket table says "Raise invoice first".
  - **Screen:**
    - In Money on this case: **Cancel with a credit note**.
    - A dialog with every amount given back, GST included, the reason, and "Issue credit note MCN…".
    - Afterwards the invoice shows "MVI… · cancelled", struck through, "Cancelled by MCN… · reason", and both PDFs.
- **3c, the replacement invoice:**
  - **A case holds one chain of invoices** (migration `20261015160000_replacement_invoice`):
    - `Invoice.enquiryId` is no longer unique
    - `Invoice.replacesId` (unique) points at the cancelled invoice it replaces
    - a partial unique index `Invoice_one_original_per_case`
    - a BEFORE INSERT trigger: a replacement replaces an invoice of its own case that a WHOLE credit note cancelled

    So only the chain's last invoice can stand.
  - **The quote reopens while correcting:** while the case's latest invoice is cancelled, the owner, the HOD or the
    Head can save the quote and raise the corrected invoice at any step, not only until dispatch
    (`assertQuoteCanChange`). Otherwise the quote stays shut as before ("…once the file has gone to the vendor").
  - **The replacement:**
    - it records `replacesId`, and its PDF prints "Replaces Tax Invoice MVI… (cancelled by Credit Note MCN…)"
    - the raise is audited with `replaces`
    - it doesn't use up the file's one additional invoice
  - **Raising it** unblocks dispatch and Submitted online again.
  - **The case** sends `invoice` (the chain's latest, with `replaces` and `cancelled`) and `earlierInvoices`.
  - **Screen:** after a cancellation, Money on this case offers the quote again and **Raise the corrected invoice**.
    The Raise dialog says what it replaces, and "Earlier invoices" lists the cancelled ones with their invoice and
    credit-note PDFs.

### 6. Recall: take the file back

- **The credit note covers the embassy fee only by default:** the embassy fee lines of the invoice. VFS, the service
  charge and the courier both ways are kept.
- **A lump-sum invoice.** **Decided 15 Oct 2026 (project lead):** a lump sum has no embassy fee line, so nothing goes
  back by default. The Visa HOD enters the refund, up to the travellers' amounts: the same "Change refund (HOD)"
  power.
- **Only the Visa HOD (or the Head) can return more, case by case** ("Change refund (HOD)"). The override can only
  increase the refund. The reason comes from a master list.
- **Where the case goes.** **Decided 15 Oct 2026 (project lead):** to **Step 7 · Passport back**, marked **Recalled**,
  and it closes after the normal handover. The passports are still in transit back to the office and must be counted
  in and handed back formally, so the chain of custody is kept. Until Steps 7–8 are built, a recalled case waits there.

**Decided 15 Oct 2026 (project lead), while planning component 4:**
- **When:** any time at At vendor, before or after the vendor submits the file at the embassy (an application can
  still be withdrawn). Not once the decision is recorded.
- **The reason:** a **recall-reasons list** the HOD edits (Embassy taking too long, Client cancelled the trip,
  Documents changed ⚠️), so reports can count why files come back. The credit note's own reason is always "Recall".
- **"Change refund (HOD)":** per traveller, up to what that traveller was charged (embassy, VFS, other). **Never
  Masti's service charge**, so the part credit note carries no GST, and M38(b) doesn't arise.
- **After the recall:** due the next office day at 11:00 ⚠️ (`visa.recallReturn`), to chase the vendor for the papers.

**Amended 17 Oct 2026 (project lead), [0006](0006-visa-documents.md) amendment 15:** a **cancelled** case is recalled
too (step rule `RECALLING`: At vendor, open or cancelled; a postponed case is still resumed first), so its passports
come back. The reason starts on "Client cancelled the trip". If its invoice was already cancelled whole with no
replacement, the recall gives nothing back and issues no credit note.

**Built 15 Oct 2026** (component 4, in two steps):

- **4a, the recall-reasons list** (`b868c7f`):
  - Table `RecallReason`, with the code CHECK (migration `20261015170000_recall_reasons`).
  - Seeded ⚠️: Embassy taking too long, Client cancelled the trip, Documents changed.
  - `GET/POST/PATCH /api/masters/recall-reasons`: Visa staff read; the Visa HOD or the Head edit.
  - Settings → Masters → Lists → **Recall reasons**.
- **4b, the recall:**
  - `GET /api/visa/cases/:caseNo/recall/check` returns:
    - each traveller's line, with what they were charged and the default refund
    - the default total, `canChangeRefund`, the next credit-note number, `dueAt`, and the blockers
  - `POST /api/visa/cases/:caseNo/recall` with `{ invoiceNo, reasonId, refunds?, updatedAt }`. It's for whoever can
    act on the case, at At vendor (`WITH_VENDOR`). Refused with:
    - 409 for an e-visa
    - 409 with no standing invoice (cancelled, no replacement yet)
    - 409 `RECALL_CHANGED` for another invoice; STALE; postponed; any other step
    - 400 under `reasonId` for a switched-off reason
    - 403 when `refunds` goes above the default and the user isn't the Visa HOD or the Head
    - 400 under `refunds` below the default, above what a traveller was charged, or for an unknown traveller
    - 409 `RECALL_BLOCKED` while Masti's details can't be printed, when something goes back
  - **In one transaction under the case lock:**
    - the case moves to **Passport back**, due the next open office day at 11:00 ⚠️
    - `VisaCase.recalledAt`, `recalledById` and `recallReasonId` are stamped (migration `20261015180000_recall`;
      CHECKs: set together, only for a docket file)
    - if anything goes back, a **PART credit note** is issued: reason "Recall", printed "Recall · Embassy taking too
      long"; one `LUMP_SUM` line per traveller with a refund; no service charge or GST
    - audited as `visa.recall` (the reason, the refunds, `changedByHod`, the credit note) and `visa.creditNote.issue`
  - **Nothing goes back** (every traveller a lump sum, no HOD change): no credit note, and the case still moves.
  - **Whole and part notes share one path** (`issueCreditNote` and `withCreditNoteNumber` in
    `visaCreditNote.service.ts`).
  - **The database refuses more than invoiced:** the credit-note trigger now also stops the notes on an invoice going
    past its total. So an invoice that a recall gave part of can't be cancelled whole, and the service says so.
  - **The case** sends `recall { at, by, reason, creditNote }`, and the invoice's `partCredits`.
  - **Screen:**
    - At At vendor, a **Take the file back (recall)** card (demo screen 10): the embassy fee that goes back, what's
      kept, "Only an HOD can return more", and **Take the file back**.
    - **The dialog:** each traveller's refund and the total; **Change refund (HOD)** for the Visa HOD or the Head,
      which makes each refund editable; the reason; and when it's due back.
    - **Afterwards:** the chip reads **"Recalled · Embassy taking too long"**, the card shows when, why and the credit
      note, and Money on this case lists "MCN… gave back ₹500.00 · Recall".
    - The step chips show Decision **skipped** (struck through), not done, and "Cancel with a credit note" is hidden
      once a recall gave part of the invoice back.

### 7. The additional invoice

- **At most one per file** ("1 of 1 used"). Its number follows the invoice's: `MVI00001379-A` ⚠️ (settled in component
  5's plan).
- **What it's for and how much.** **Decided 15 Oct 2026 (project lead):** staff pick what it's for from a list the Visa
  HOD edits (Urgent submission, Photos… ⚠️) and type the amount. A reason is never free text, so the accounts stay
  structured. The amount is data, because urgent embassy fees vary widely. A second quote would be over-engineering for
  a ₹500 charge.
- ~~GST: each charge in the list says whether GST applies~~ (superseded below).
- Locked like the invoice, with its own PDF.

**Decided 15 Oct 2026 (project lead), while planning component 5:**
- **Its number** is the main invoice's with "-A": `MVI00000001-A`, as the demo's `INV-0412-A`. It's tied to its main
  invoice, and still unique.
- **No GST** on additional charges: they're charges passed on. ⚠️ If a charge is Masti's own service (its own
  urgent-handling fee), GST law would normally apply, so M38(a) stays open for the accountant to confirm.
- **When:** at any step, once the main invoice stands, while the case is open. Photos may be needed at Step 2, an
  urgent fee at Step 5.
- **Several charges** can go on the one additional invoice (an urgent fee and photos together), since a file gets only
  one.
- **Who:** the case's processor, the Visa HOD or the Head, as for the main invoice.
- **Correcting it:** as for the main invoice, a credit note cancels a wrong one and a replacement is raised. The
  replacement takes the next letter (`MVI00000001-B`), points at the cancelled one, and still counts as "1 of 1".

**Built 15 Oct 2026** (component 5, in three steps):

- **5a, the extra-charges list** (`39527aa`):
  - Table `ExtraCharge`, with the code CHECK (migration `20261015190000_extra_charges`).
  - Seeded ⚠️: Urgent submission, Photos, Courier (extra).
  - `GET/POST/PATCH /api/masters/extra-charges`: Visa staff read; the Visa HOD or the Head edit.
  - Settings → Masters → Lists → **Extra charges**.
- **5b, raising it** (`f9950e9`):
  - **Data** (migration `20261015200000_additional_invoice`):
    - `Invoice.kind` (`MAIN` / `ADDITIONAL`); one original of each kind per case (two partial unique indexes)
    - its charges in `InvoiceCharge` (a snapshot of each name, the amount above 0 and at most ₹10 lakh), never
      edited and only on an ADDITIONAL invoice
    - a CHECK: an ADDITIONAL invoice has no service charge and no GST
    - the replacement trigger also needs the same kind as the invoice replaced
  - **"The invoice" means the main one** everywhere it did before: dispatch, Submitted online, the docket table, the
    quote lock, the cancel dialog's default and recall.
  - `GET /api/visa/cases/:caseNo/additional-invoice/check` returns the main invoice, its number, `alreadyRaised`,
    `replaces` and the blockers. `POST /api/visa/cases/:caseNo/additional-invoice` takes `{ mainInvoiceNo, charges:
    [{ chargeId, amountPaise }], totalPaise }` (1–10 charges). It's for whoever can act on the case, at any step while
    it's open. Refused with:
    - 409 with no standing main invoice ("Raise the invoice first")
    - 409 when one stands already ("1 of 1 used")
    - 400 under `charges` for a switched-off charge, none or more than 10, or an amount out of range
    - 409 `ADDITIONAL_CHANGED` when the main invoice or the total isn't the one shown
    - 409 `ADDITIONAL_BLOCKED` while Masti's details can't be printed
  - **In one transaction under the case lock:** the PDF (same layout as the main invoice, "Additional to Tax Invoice
    MVI…", one row per charge, no GST table), the file, the invoice and its charges, and the audit
    `visa.additionalInvoice.raise`. No counter: its number comes from the main invoice. The client, place of supply,
    tax type, SAC and processing speed are copied from the main invoice.
  - **The case** sends `additionalInvoice` (with its charges) and `earlierAdditionalInvoices`.
  - **Screen:** Money on this case shows **Additional invoice · 0 of 1 used** with **Raise additional invoice**; the
    dialog takes charge rows (picked from the list, the amount typed), the total and the number. Afterwards: **1 of 1
    used**, "MVI…-A · locked", each charge and Open invoice.
- **5c, correcting it:**
  - `GET …/invoice/cancel/check?invoiceNo=MVI00000001-A` and `POST …/invoice/cancel` with that number cancel the
    additional invoice with a WHOLE credit note: one `LUMP_SUM` line per charge, no GST. Without a number the check is
    about the main invoice, as before.
  - Raising again once it's cancelled gives `MVI00000001-B` with `replacesId`; its PDF also says what it replaces.
    The audit records `replaces`.
  - **Screen:** the additional box gets **Cancel with a credit note**, then shows "cancelled", the credit note and
    **Raise the corrected additional invoice**; the dialog says what it corrects. Earlier additional invoices are
    listed under it.

### 8. E-visas at Step 5

An e-visa ("Submitted online", 0008 Decision 11) has no vendor, file number to wait for, or collection date (its
passports never left the office). It waits at Step 5 until its decision comes in on the portal (Step 6), due
back to check the portal (`visa.onlineCheck`). To confirm with Masti (M39).

### 9. Settings and seed data (golden rule 1)

| What | Seeded with |
| --- | --- |
| `visa.submissionCheck` (no appointment) | `{ afterDays: 1, at: "11:00" }` ⚠️ |
| `visa.collectionCheck` (the collection reminder) | `{ daysBefore: 1, at: "11:00" }` ⚠️ |
| The file number format | capitals, digits, "-" and "/", 3–40 ⚠️ (in the code and a CHECK) |
| `visa.creditNote` (the credit-note series) | `{ prefix: "MCN", digits: 8, startAt: 1 }` ⚠️ |
| `visa.recallReturn` (after a recall) | `{ afterDays: 1, at: "11:00" }` ⚠️ |
| The recall reasons | Embassy taking too long · Client cancelled the trip · Documents changed ⚠️ |
| The credit-note reasons | Wrong amount · Wrong client details · Wrong traveller details · Client cancelled · Recall ⚠️ |
| The extra-charges list (no GST) | Urgent submission · Photos · Courier (extra) ⚠️ |
| The chip wording ("With vendor · papers checked", "Submitted · …") | ours or the demo's ⚠️ |

## Not in this record

- **Step 6 · Decision** (approved or refused, per traveller; Q11): its own record.
- **Steps 7–8** (passport back, delivered): their own records. A recalled case waits at Step 7 until then.
- **WhatsApp to the client** ("File submitted"): waits for the WhatsApp work.
- **Payments and refunds of money actually paid:** the Accounts module. The credit note only records what is owed back.

## Still needed from Masti

- **M38 (accountant):** is GST charged on an additional charge (urgent fee, photos), or are some pass-through fees?
  And when an HOD's refund on a recall includes the service charge, should its GST be reversed?
- **M39:** the e-visa flow at Step 5, and the timings: due at the appointment after "Vendor got it", reminded the day
  before the collection date.
