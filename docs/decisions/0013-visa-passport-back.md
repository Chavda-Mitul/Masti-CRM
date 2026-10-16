# 0013 · Visa Step 7: passport back

- **Status:** decided (16 Oct 2026, project lead). Being built one component at a time (Decision 1). A "Built" note is
  added under each part as its component lands.
- **Date:** 16 Oct 2026
- **Scope:** the passports' way back from the vendor to our office, until they're in our passport stock and ready to
  hand over (Step 8):
  - "Passports on the way back": the day the vendor collected them and the day we expect them
  - changing the expected day while they're in transit
  - "Mark received": the booklets counted, the stickers checked, and who received them
- **Builds on:**
  - [0012](0012-visa-decision.md): the decision per traveller, with the sticker number and its dates (Decision 3)
  - [0011](0011-visa-at-vendor.md) Decision 6: a recalled file goes to Passport back and closes after the normal
    handover
  - [0006](0006-visa-documents.md): the booklets counted at intake ("4 current + 3 old"), optional (amendment 2)
  - [0005](0005-system-masters.md): the holiday calendar, with our office as a target

## Context

What a case looks like when it reaches this step:

| Field | Value |
| --- | --- |
| `Enquiry.stage` | `DECISION` (status "Approved" ⚠️, next step "Passports on the way back"), or `PASSPORT_BACK` for a recalled file |
| `Enquiry.dueAt` | after the decision, the next open office day at 11:00 (`visa.passportsBackCheck`); after a recall, `visa.recallReturn` |
| `VisaCaseTraveller.outcome`, `visaNo`, `validFrom`, `validTo` | each traveller's decision; the sticker number and dates for an approved one |
| `VisaCase.bookletsCurrent`, `bookletsOld` | the booklets counted at intake, or blank |
| `VisaCase.recalledAt` | set for a file taken back from the vendor (no decision, no stickers) |

The `PASSPORT_BACK` stage is seeded as "Passport back", status "Passports in our stock" ⚠️, next step "Hand over to the
client".

What the sources say:

| Source | What it says |
| --- | --- |
| Demo ⚠️ (screen 12) | Card **Passports coming back**: three tiles, "Done · 27 Oct / Vendor collected", "Done · not in our stock yet / In transit to us", "Now · 29 Oct, 12:40 pm / In our passport stock". Three fields: "Booklets counted · 4 current + 3 old — matches intake", "Visa stickers checked · All match names & dates", "Received by · Neha Joshi". Footer: "A passport counts as ours only once the packet is opened and punched at the office." Header chip "Passports in our stock", button "Hand over to the client →". The board's column is "Passport back · In transit / in stock", with a card "In transit · Reaches us ~7 Oct". WhatsApp "Passports are at our office: Delivery booked for Sat 31 Oct, 11 am – 1 pm." |
| Meeting ✅ (7:09–7:10 PM) | The passport comes back from the vendor to Surat, approved or refused. Vendors "aren't systematic" (no docket number, no email), so we only keep the day we expect it. It stays **in transit** until the packet is opened at our office and recorded ("punch kiya"), then it's in our inventory. |
| Requirements doc ✅ | "We will ask the vendor and put an approx date of when we will receive it, and keep its status as in transit. As soon as we get it, we mark it received." |
| PID | "Per-traveller decisions, passport stock, and a visa board view." |
| 0012 Decision 3 | "Step 7 checks each sticker against the passport's name and dates when the passports are back." |
| 0011 Decision 6 | A recalled file goes to Step 7, marked Recalled, and closes after the normal handover (chain of custody). |

**"Punched"** in the meeting means **recorded in the system** ("system mein punch kar diya"), not punching a hole in
the passport. There's no punching step.

## Decision

### 1. Build order: one component at a time

**Decided 16 Oct 2026 (project lead):** each component is planned in plan mode, built, tested, checked in the browser
and committed before the next starts:

1. **Passports on the way back** (Decisions 2–4): the form, the move to Step 7, and the Passports coming back card
2. **Change the expected day** while the passports are in transit
3. **Mark received** (Decision 5): the booklets, the stickers and the receiver

### 2. Two states: in transit, then in our stock

**Decided 16 Oct 2026 (project lead):** as the meeting says, the passports are **In transit** from the moment the
vendor has collected them until the packet is opened at our office and marked received; only then are they **in our
passport stock**. The demo's three tiles show this: Vendor collected → In transit to us → In our passport stock.

- **One packet per case,** as the demo shows. If the passports come back in parts, staff mark them received once all
  are back, or receive a short count, which shows red (Decision 5).
- **Refused travellers' passports come back too** ("dono case mein"), in the same packet.

### 3. Passports on the way back

**Decided 16 Oct 2026 (project lead):**
- **Two dates, both required:** the day the **vendor collected** them (today or earlier, not before the file was
  dispatched) and the day they're **expected at our office** (today or later, on or after the collected day, a day
  our office is open: Sundays and office holidays are struck through on the calendar and refused by the server).
- **The case moves to Step 7 · Passport back, In transit,** due on the expected day at 11:00 ⚠️
  (`visa.arrivalCheck`), on the processor's desk, to check the passports have arrived.
- **Who:** the case's processor, the Visa HOD or the Head, while the case is open.
- **From Step 6:** "Passports on the way back →" in the header.
- **A recalled file** is already at Step 7, so the same button shows there until it's in transit. Everything else is
  the same, with no stickers to check later.

### 4. E-visas skip this step for now

**Decided 16 Oct 2026 (project lead):** an e-visa's passports never left the office (0011 Decision 8), so
there's nothing to bring back. An e-visa case **waits at Step 6** after its decision until Masti answers M39 (what
follows an e-visa's decision). Step 7 is for paper visas and recalled files only; the database refuses "in transit" on
an e-visa.

### 5. Mark received

**Decided 16 Oct 2026 (project lead):**
- **Booklets counted again,** current and old, against intake. A count that **doesn't match is allowed**: the
  passports are here, so they go into our stock. The card shows it in red ("4 current + 2 old — 1 old short of
  intake"), and the audit log keeps it. No reason list.
- **Stickers checked** for each **approved** traveller: **Matches** or **Doesn't match** the passport's name and the
  dates recorded at Step 6. A mismatch is recorded and shown in red; the passports still go into stock. Fixing it with
  the embassy stays outside the CRM. A refused traveller and a recalled file have no sticker to check.
- **Received by** is whoever records it, **at the moment they record it** (to the minute, audited). Nobody records it
  for someone else.
- The case then shows "Passports in our stock", next step "Hand over to the client" (Step 8).

### 6. Settings and seed data (golden rule 1)

| What | Seeded with |
| --- | --- |
| `visa.arrivalCheck` (in transit: when the case comes back due, counted from the expected day) | `{ afterDays: 0, at: "11:00" }` ⚠️ |
| The chip and card wording ("In transit · expected Thu 29 Oct", the tiles, the footer) | the demo's, or ours ⚠️ |

**Defaults (not asked; say if any is wrong):**
- **The furthest expected day** is a year ahead, the same sanity limit as the collection date.
- **Nothing here moves money or sends a message.**

## Not in this record

- **WhatsApp to the client** ("Passports are at our office"): waits for the WhatsApp work. The demo's "Delivery booked
  for Sat 31 Oct" needs a delivery booking, which is Step 8.
- **Booking the delivery or the client's visit, and the handover itself:** the Step 8 record.
- **A list of every passport in our stock, across cases** (the demo's unused "Passports arriving back · mark received"
  attention list): not in the demo screens, so a change request if Masti wants it.
- **Courier tracking for the way back:** like the dispatch AWB (change request #4), the vendor's courier isn't
  tracked.

## Still needed from Masti

- **M39:** what follows an e-visa's decision (it skips Step 7 for now).
- **M10:** the decision per traveller, which the sticker check follows.
