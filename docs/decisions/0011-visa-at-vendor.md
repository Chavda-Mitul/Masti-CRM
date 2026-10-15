# 0011 · Visa Step 5: at the vendor

- **Status:** decided (15 Oct 2026, project lead). Being built one component at a time (Decision 1). Built: "Vendor got
  it" (15 Oct 2026, component 1). A "Built" note is added under each part as its component lands.
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

### 5. The credit note

- **Possible from the moment an invoice exists,** before or after dispatch (M36). It's never edited.
- **Proposed ⚠️, settled in component 3's plan:**
  - its own number series (a prefix setting, like `MVI`)
  - a reason from a master list (Recall, Wrong amount…), never free text
  - amounts taken from the invoice's lines, never more than was invoiced
  - a stored PDF, locked like the invoice (the trigger and no edit route)
- **Open with Masti (M37):** after a credit note cancels a wrong invoice, is the correct invoice the file's one
  additional invoice, or a new invoice that doesn't count?

### 6. Recall: take the file back

- **The credit note covers the embassy fee only by default:** the embassy fee lines of the invoice. VFS, the service
  charge and the courier both ways are kept. A lump-sum invoice has no embassy fee line, so how it's handled is settled
  in component 4's plan.
- **Only the Visa HOD (or the Head) can return more, case by case** ("Change refund (HOD)"). The override can only
  increase the refund. The reason comes from a master list.
- **Where the case goes.** **Decided 15 Oct 2026 (project lead):** to **Step 7 · Passport back**, marked **Recalled**,
  and it closes after the normal handover. The passports are still in transit back to the office and must be counted
  in and handed back formally, so the chain of custody is kept. Until Steps 7–8 are built, a recalled case waits there.

### 7. The additional invoice

- **At most one per file** ("1 of 1 used"). Its number follows the invoice's: `MVI00001379-A` ⚠️ (settled in component
  5's plan).
- **What it's for and how much.** **Decided 15 Oct 2026 (project lead):** staff pick what it's for from a list the Visa
  HOD edits (Urgent submission, Photos… ⚠️) and type the amount. A reason is never free text, so the accounts stay
  structured. The amount is data, because urgent embassy fees vary widely. A second quote would be over-engineering for
  a ₹500 charge.
- **GST:** each charge in the list says whether GST applies ⚠️, until Masti's accountant answers (M38).
- Locked like the invoice, with its own PDF.

### 8. E-visas at Step 5

An e-visa ("Submitted online", 0008 Decision 11) has no vendor, file number to wait for, or collection date (its
passports never left the office). It waits at Step 5 until its decision comes in on the portal (Step 6), due
back to check the portal (`visa.onlineCheck`). To confirm with Masti (M39).

### 9. Settings and seed data (golden rule 1)

| What | Seeded with |
| --- | --- |
| `visa.submissionCheck` (no appointment) | `{ afterDays: 1, at: "11:00" }` ⚠️ |
| The collection reminder | the open office day before, at 11:00 ⚠️ (component 2) |
| The file number format | capitals, digits and dashes, 3–40 ⚠️ (component 2) |
| The credit-note series, the reasons list | ⚠️ (component 3) |
| The extra-charges list, with "GST applies" | Urgent submission, Photos ⚠️ (component 5) |
| The chip wording ("With vendor · papers checked", "Submitted · …") | ours or the demo's ⚠️ |

## Not in this record

- **Step 6 · Decision** (approved or refused, per traveller; Q11): its own record.
- **Steps 7–8** (passport back, delivered): their own records. A recalled case waits at Step 7 until then.
- **WhatsApp to the client** ("File submitted"): waits for the WhatsApp work.
- **Payments and refunds of money actually paid:** the Accounts module. The credit note only records what is owed back.

## Still needed from Masti

- **M37:** a corrected invoice after a credit note: the one additional invoice, or a new one?
- **M38 (accountant):** is GST charged on an additional charge (urgent fee, photos), or are some pass-through fees?
- **M39:** the e-visa flow at Step 5, and the timings: due at the appointment after "Vendor got it", reminded the day
  before the collection date.
