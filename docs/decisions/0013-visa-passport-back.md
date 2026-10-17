# 0013 · Visa Step 7: passport back

- **Status:** decided (16 Oct 2026, project lead). Being built one component at a time (Decision 1). Built: passports
  on the way back (16 Oct 2026, component 1); changing the dates (16 Oct 2026, component 2); mark received (17 Oct
  2026, component 3). Step 7 is complete. A "Built" note is added under each part as its component lands.
- **Date:** 16 Oct 2026
- **Scope:** the passports' way back from the vendor to our office, until they're in our passport stock and ready to
  hand over (Step 8):
  - "Passports on the way back": the day the vendor collected them and the day we expect them
  - changing either day while they're in transit
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
2. **Change the dates** while the passports are in transit
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

**Built 16 Oct 2026** (component 1, passports on the way back):
- **Data** (migration `20261016130000_passports_back`): `VisaCase.passportsCollectedOn`, `passportsExpectedOn`,
  `passportsInTransitAt`, `passportsInTransitById`, with CHECKs: all four together; expected on or after collected,
  collected no later than the day it was recorded (IST); only once decided or recalled; never for an e-visa.
- `POST /api/visa/cases/:caseNo/passports-back` with `{ collectedOn, expectedOn, updatedAt }`, for whoever can act on
  the case, while it's open, at Decision or (recalled) at Passport back (step rule `RETURNING`). Refused with:
  - 409 for an e-visa ("An e-visa's passports never left the office."), once already in transit, at another step
    ("Passports go back after the decision, or after a recall."), STALE, postponed
  - 400 under `collectedOn`: after today, or before the file was dispatched
  - 400 under `expectedOn`: before today, more than a year ahead, or a day our office is closed ("Weekly off: our
    office is closed that day. Pick another.")
- **In one transaction under the case lock:** the two days, who and when; the case moves to Passport back, due on the
  expected day at 11:00 ⚠️ (`visa.arrivalCheck`, the next open office day `afterDays` after it); audit
  `visa.passports.inTransit`.
- **The case** sends `passportsBack { collectedOn, expectedOn, at, by }`.
- **Screen:**
  - **Header:** "Passports on the way back →" at Step 6 (a paper visa), or at Step 7 for a recalled file until it's
    in transit. An e-visa at Step 6 has no button. While in transit the chip reads "In transit · expected Tue 20 Oct"
    (a recalled file keeps its "Recalled" chip), and "Hand over to the client →" stays "Soon".
  - **The form:** "Vendor collected them on" (today by default) and "Expected at our office", a month calendar with
    Sundays and office holidays struck through. The calendar is shared with the expected collection date
    (`OpenDayCalendar`, an embassy's days or the office's).
  - **The Passports coming back card**, above the Decision card: the demo's three tiles, when it's due back ("Check the
    passports have arrived") and the demo's footer.

**Fixed 17 Oct 2026** (found in the visa review): the enquiries list showed the step's own next step, "Hand over to
the client", while the passports were still in transit.
- **The cause:** each list row only carried the step's fixed label.
- **The fix:** each row now sends its own `nextStep` (`visaNextStep`), as the header button does. It reads:
  - "Passports on the way back" for a recalled file not yet sent back
  - "Mark received" in transit
  - the step's own label once the passports are received
  - "No passports to bring back (e-visa)" ⚠️ for an e-visa at Decision (Decision 4)

**Changing the dates.** **Decided 16 Oct 2026 (project lead):** vendors aren't systematic, so the expected day moves,
and a collected day can be mistyped.
- **"Change" edits both days** in the same form, filled in, with the same checks.
- **No reason is asked:** the audit log keeps the old and new days, who and when. A delay-reasons list would be a
  change request.

**Defaults (not asked; say if any is wrong):**
- **Who and when:** the processor, the Visa HOD or the Head, while the case is open at Passport back and the passports
  are in transit (component 3 adds "not yet received").
- **What stays:** who recorded them on the way back, and when. The due time moves with the expected day.
- **Collected day:** no later than the day they were recorded on the way back.
- **Saving:** a save that changes nothing writes nothing, and a stale page is refused.

**Built 16 Oct 2026** (component 2, changing the dates):
- `PUT /api/visa/cases/:caseNo/passports-back` with the same body, for whoever can act on the case. The step rule
  `IN_TRANSIT` (Passport back only) refuses it at another step: "The dates can only be changed while the passports are
  on their way back." Also refused:
  - 409 before they're on the way back ("Mark the passports on the way back first."), STALE, postponed
  - 400 as when first saved, plus a collected day after the day they were recorded on the way back ("Pick a day on or
    before the day they were recorded on the way back.")
- **In one transaction under the case lock:** the two days and the due time (`visa.arrivalCheck` from the new expected
  day); audit `visa.passports.update` with the old and new values. The step and who recorded them on the way back stay.
- **Screen:** **Change** on the Passports coming back card opens "Change the dates", filled in; the toast reads "Dates
  saved. Expected Fri, 23 October 2026."; the chip, tiles and due line follow.

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

**Decided 17 Oct 2026 (project lead):**
- **Whatever the case's status:** the passports can be marked received on a postponed or cancelled case too (chain of
  custody: the packet is here). The case keeps its status; only an open case gets a new due time.
- **No correction for now:** a saved receipt is fixed, and audited. If Masti asks for corrections, it's its own
  component.
- **Counting:** the booklet boxes start blank, with intake's count beside them; a difference turns red as staff type.

**Defaults (not asked; say if any is wrong):**
- **Intake** is what went to the vendor, as the docket counted it: the current booklets counted at Step 2 (else one per
  traveller) and the old ones (else none).
- **At least one booklet** is counted; each count is 0–50, as at intake.
- **After receipt**, an open case is due the next open office day at 11:00 ⚠️ (`visa.handoverCheck`) to arrange the
  handover. It stays at Step 7; Step 8 is its own record.
- **The dates can't change** once received; a refusal letter can still be uploaded.

**Built 17 Oct 2026** (component 3, mark received):
- **Data** (migration `20261017100000_passports_received`): `VisaCase.passportsReceivedAt`, `passportsReceivedById`,
  `bookletsBackCurrent`, `bookletsBackOld`; `VisaCaseTraveller.stickerCheck` (`StickerCheck`: MATCHES / MISMATCH).
  CHECKs: all four together; received only after (and not before) "on the way back"; each count 0–50, at least one
  booklet; a sticker check only for an approved traveller.
- `POST /api/visa/cases/:caseNo/passports-received` with `{ booklets: { current, old }, stickers: [{ travellerId,
  check }], updatedAt }`, for whoever can act on the case, at Passport back, **whatever its status** (step rule
  `RECEIVING`). Refused with:
  - 409 before they're on the way back ("Mark the passports on the way back first."), once received ("The passports
    are already in our stock."), at another step ("Passports are received at Passport back."), STALE
  - 400 under `booklets` ("Count at least one booklet.", "50 at most.") or `stickers`, naming the traveller: "Check
    Rakesh Mehta's sticker.", "Aarav Mehta was refused: there's no sticker to check.", someone listed twice or not on
    the case; a recalled file lists none
- **In one transaction under the case lock:** who received them and when, the counts, each approved traveller's sticker
  check, the due time (an open case only), and the audit `visa.passports.received` (the counts, intake, whether they
  match, each sticker check by name). "Change" on the dates is refused from then on.
- **The case** sends `passportsReceived { at, by, booklets }` and each traveller's `stickerCheck`.
- **Screen:**
  - **"Mark received →"** in the header of an open case in transit, and **Mark received** on the Passports coming back
    card for any status (beside Change, which is for open cases only).
  - **The form:** blank Current and Old boxes with "Intake: 2 current + 1 old" beside them and a live "— 1 old short of
    intake" in red (or "matches intake" in green); Matches / Doesn't match for each approved traveller's sticker (with
    its number and dates), "Refused · no sticker" for the others, or "Taken back unsubmitted · no stickers to check";
    "Received by Neha Joshi, now"; the demo's footer.
  - **Once received:** the chip reads "Passports in our stock" (green); the third tile is current ("Now · Sat 17 Oct,
    11:09"); the demo's three boxes show the booklets (red when they don't match intake), the stickers ("All match
    names & dates", "Doesn't match: …" in red, "No stickers (taken back)" or "(all refused)") and who received them; an
    open case is due to "Arrange the handover"; the header's "Hand over to the client →" stays "Soon" until Step 8.

### 6. Settings and seed data (golden rule 1)

| What | Seeded with |
| --- | --- |
| `visa.arrivalCheck` (in transit: when the case comes back due, counted from the expected day) | `{ afterDays: 0, at: "11:00" }` ⚠️ |
| `visa.handoverCheck` (received: when an open case comes back due to arrange the handover) | `{ afterDays: 1, at: "11:00" }` ⚠️ |
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
