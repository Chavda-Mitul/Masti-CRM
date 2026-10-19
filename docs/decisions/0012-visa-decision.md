# 0012 · Visa Step 6: the decision

- **Status:** decided (15 Oct 2026, project lead). Being built one component at a time (Decision 1). Built: recording
  the decision (15 Oct 2026, component 1); changing a traveller's decision (16 Oct 2026, component 2); the refusal
  letter (16 Oct 2026, component 3). A "Built" note is added under each part as its component lands.
- **Date:** 15 Oct 2026
- **Scope:** recording whether each traveller's visa was approved or refused, from the moment the file was submitted
  (at the embassy, or online for an e-visa) until the passports start back (Step 7):
  - the decision per traveller, with the sticker (or e-visa) number and its dates for an approved one
  - correcting a wrong entry
  - the scanned refusal letter
- **Builds on:**
  - [0011](0011-visa-at-vendor.md): "Submitted at the embassy" (the file number and the collection date), and recall
    (a recalled file skips this step)
  - [0008](0008-visa-docket-dispatch.md) Decision 11: e-visas "Submitted online"
  - [0007](0007-visa-file-prep.md) Decision 8: scanned PDFs kept as case files (rule 4)

## Context

What a case looks like at the end of Step 5:

| Field | Value |
| --- | --- |
| `Enquiry.stage` | `AT_VENDOR` (seeded status "Submitted", next step "Record the decision") |
| `Enquiry.dueAt` | the open office day before the collection date at 11:00 (`visa.collectionCheck`); for an e-visa, the portal check (`visa.onlineCheck`) |
| `VisaCase.vendorFileNo`, `embassyId`, `collectionOn`, `submittedAt` | saved by "Submitted at the embassy" (0011 Decisions 3 and 4) |
| `VisaCase.submittedOnlineAt` | set instead for an e-visa |
| `VisaCaseTraveller` | each person, named, with the passport name the file went in under |

The `DECISION` stage is seeded as "Decision", status "Approved" ⚠️, next step "Passports on the way back".

What the sources say:

| Source | What it says |
| --- | --- |
| Demo ⚠️ (screen 11) | Card **Decision · collected Tue 27 Oct**, "two outcomes, per traveller". Each traveller has an **Approved / Refused** toggle. Approved shows "Sticker 0182 4471 · valid 1 Dec – 14 Jan"; Refused shows a "Refusal letter" chip and "Open in Drive". "Letters and scans stay in your Google Drive or OneDrive; the CRM keeps only the link so it stays fast." Header chip "Approved", button "Passports on the way back →". WhatsApp "Congratulations!": "All 4 visas are approved. Passports reach our office in about 2 days…" |
| Meeting ✅ | "Status only: refused or approved." The refusal letter is a Drive/OneDrive link, not an attachment. If approved, the visa sticker comes back with the passport. |
| PID | The decision per traveller. |
| PROJECT_KNOWLEDGE §17 #3 | Where the sources disagree on granularity: build per traveller, confirm with Masti (Q11 / M10). |
| Rule 4 (10 Oct 2026) | Documents live in our private S3-compatible storage, not Drive links. Clients never upload; scanning happens in the office. |

## Decision

### 1. Build order: one component at a time

**Decided 15 Oct 2026 (project lead):** each component is planned in plan mode, built, tested, checked in the browser
and committed before the next starts:

1. **Record the decision** (Decisions 2–5): the form, the move to Step 6, and the Step 6 card
2. **Change a traveller's decision** at Step 6 (Decision 6)
3. **The refusal letter** scan (Decision 4)

### 2. Per traveller

**Decided 15 Oct 2026 (project lead):** each traveller is **Approved** or **Refused**, as in the demo and the PID. A
family where one child is refused is recorded as it happened. The meeting's "status only" still holds: two outcomes,
nothing in between. M10 asks Masti to confirm.

### 3. An approved traveller

**Decided 15 Oct 2026 (project lead):** the **sticker number** and the visa's **valid-from and valid-to dates** are
required. Step 7 checks each sticker against the passport's name and dates when the passports are back.

- The number is typed as printed. It's stored in capitals with single spaces; capitals, digits, spaces, "-" and "/",
  3–40 ⚠️ (in the code and a CHECK).
- Valid-to is on or after valid-from (a CHECK).
- A refused traveller has no number or dates (a CHECK).

**Amended 19 Oct 2026 (project lead, item 2 fixes after the 17 Oct review; M46 to confirm):**
- **The same number twice on one case is refused:** each visa has its own, so it's a typo ("Rakesh Mehta and Aarav
  Mehta have the same sticker number"), when recording and when a change gives one traveller another's number.
- **A number already on another case is a warning: the first save stops with "Check before saving" and the reason; staff save anyway, and the audit keeps what they confirmed (`lib/warnings.ts`).** It names that case and traveller. An index on
  `VisaCaseTraveller.visaNo` finds it. A change warns only when the number changed.
- **Visa dates that don't cover the trip are a warning:** valid from after the departure day, or valid to before the
  return. An embassy sometimes grants less, so it can be right. A change warns only when the dates changed.

### 4. A refused traveller: the refusal letter

**Decided 15 Oct 2026 (project lead):** the letter is a **scanned PDF** kept with the case in our storage (rule 4),
not a Drive link. It's **optional**: it often comes back inside the passport, so it can be uploaded at Step 6 or
later. One letter per refused traveller; a newer upload becomes the current one and the older stays as proof.

**Decided 16 Oct 2026 (project lead):**
- **When:** any time once the traveller is refused, whatever the case's status (open, postponed, closed or
  cancelled): a letter can come back late.
- **Refused changed to Approved** after a letter was uploaded: the change is allowed. The letter is **kept but not
  shown** (files are never deleted); the card shows a letter only while its traveller is refused, so changing them
  back to Refused shows it again.

**Built 16 Oct 2026** (component 3, the refusal letter):
- **Data** (migration `20261016120000_refusal_letters`): a case file of kind `REFUSAL_LETTER`, with
  `CaseFile.travellerId` (set for a refusal letter and only for it, a CHECK). The service keeps it to a traveller of the
  same case.
- `POST /api/visa/cases/:caseNo/travellers/:travellerId/refusal-letter`, the PDF itself as the body (like the final
  file), for whoever can act on the case, at Decision, Passport back or Delivered, **whatever its status**. Refused with:
  - 409 before the decision ("A refusal letter is added once the decision is recorded."), or for a traveller who
    wasn't refused; 404 for a traveller of another case
  - 400 for an empty, non-PDF or broken file; 413 over the size limit; 415 unless sent as a PDF
- Its pages are counted, and it's kept in the private bucket under `cases/<id>/refusal/`, uploaded before the case
  lock and removed again if the checks under the lock fail. Audited as `visa.file.upload` (kind, traveller,
  replaces). It opens like any case file: a link that works for a few minutes, audited (`visa.file.open`).
- **The case** sends each traveller's `refusalLetter` (the current one, with how many were uploaded), only while the
  traveller is refused.
- **Defaults (not asked; say if any is wrong):**
  - **Who:** the processor, the Visa HOD or the Head.
  - **Size limit:** the final file's setting, `visa.finalFile.maxMb` (50 MB); no new setting.
  - **File name** ⚠️: `VISA-2026-0001_Aarav-Mehta_refusal.pdf`.
  - A letter changes no money and sends no message.
- **Screen:** on a refused traveller's row of the Decision card, the demo's "Refusal letter" chip with its pages and
  who uploaded it, **Open**, and **Upload letter** / **Replace** ("1 earlier copy kept"). Without one: "No refusal
  letter yet".

### 5. E-visas

**Decided 15 Oct 2026 (project lead):** the same screen. An approved e-visa records the **e-visa number** and its
dates in place of a sticker. Nothing else differs for now; M39 may change the e-visa flow.

### 6. Recording, and corrections

**Decided 15 Oct 2026 (project lead):**
- **One form for the whole family.** At Step 5, once the file is submitted (at the embassy, or online),
  **Record the decision →** opens it: each traveller's outcome, with the number and dates for an approved one.
  Saving it moves the case to **Step 6 · Decision**, where the demo's card shows the results.
- **Who:** the case's processor, the Visa HOD or the Head.
- **Corrections:** "Change" on a traveller's row while the case is at Step 6, by the same people, recorded in the
  audit log. Locked once the case moves on.
  - **Amended 19 Oct 2026 (project lead, review finding 3; M45 to confirm):** also at **Step 7 (Passport back), until
    the handover**, so a sticker that doesn't match the passport (a number or date typed wrong) can be put right.
  - **Once the passports are received**, the change checks an approved traveller's sticker again, Matches or Doesn't
    match, as at Mark received. A refused traveller's check is cleared, and the audit keeps the old and new check.
  - **Still refused:** a cancelled case, a file taken back before a decision, and anything once handed over (Step 8).
  - **Same people:** the processor, the Visa HOD or the Head; desk staff who see the case in stock can't.
- **The header chip** reads "Approved" (everyone), "Refused" (everyone) or "Approved 3 · Refused 1".

**Built 15 Oct 2026** (component 1, recording the decision):
- **Data** (migration `20261015210000_visa_decision`):
  - `VisaCaseTraveller.outcome` (`VisaOutcome`: APPROVED / REFUSED), `visaNo`, `validFrom`, `validTo`, with CHECKs
    (approved needs all three and valid-to on or after valid-from; otherwise none; the number's format)
  - `VisaCase.decidedAt` / `decidedById`: set together, only after the embassy submission or "Submitted online",
    never on a recalled file (CHECKs)
- `POST /api/visa/cases/:caseNo/decision` with `{ outcomes: [{ travellerId, outcome, visaNo?, validFrom?, validTo? }],
  updatedAt }`, for whoever can act on the case, at At vendor once the file was submitted. Refused with:
  - 409 before the submission ("Mark it submitted at the embassy first"), at another step, STALE, postponed
  - 400 under `outcomes`, naming the traveller: missing, unknown or repeated; an approved one without its number or
    dates, or ending before it starts; a refused one with them; a badly formed number
- **In one transaction under the case lock:** each traveller's outcome; who and when; the case moves to Decision, due
  the next open office day at 11:00 ⚠️ (`visa.passportsBackCheck`); audit `visa.decision.record`.
- **The case** sends `decision { at, by }` and each traveller's `decision`.
- **Screen:**
  - At Step 5, once submitted (at the embassy or online), the header's **Record the decision →** opens the form: each
    traveller's Approved / Refused (green / red, as the demo), and for Approved the sticker no. (an e-visa: e-Visa no.)
    and the two dates.
  - At Step 6, the **Decision** card: each traveller's outcome and "Sticker FRA 0182 4471 · valid 1 Dec 2026 – 14 Jan
    2027", and when it's due back. The chip reads "Approved", "Refused" or "Approved 1 · Refused 1"; "Passports on the
    way back →" stays "Soon" until Step 7.

**Built 16 Oct 2026** (component 2, changing a traveller's decision):
- `PUT /api/visa/cases/:caseNo/travellers/:travellerId/decision` with `{ outcome, visaNo?, validFrom?, validTo?,
  updatedAt }` (`updatedAt` since 19 Oct, below), for
  whoever can act on the case, only while it's at Decision (open, not postponed): "The decision can only be changed
  while the case is at Decision." It's checked as when recorded, with the messages under `decision`; a traveller of
  another case is a 404.
- **In one transaction under the case lock:** the traveller's entry (Approved ↔ Refused, or just the number or dates;
  a refused one loses its number and dates) and the audit `visa.decision.change` with the old and new values.
- **Defaults (not asked; say if any is wrong):**
  - **One traveller at a time:** each row has its own Change, already filled in.
  - ~~**The last save wins**, as with the other one-traveller edits (the portal details, the checklist): a change doesn't
    make anyone else's open page stale.~~ **Changed 19 Oct 2026** (code review, item 2 fixes): two dialogs opened on
    the same row could undo each other, since each saves the whole row. "Change" now sends the case's `updatedAt` from
    when the dialog opened: a save after someone else's change is refused (409 STALE, "Someone else changed this case
    after you opened it. Reload and try again."). A saved change moves the case's `updatedAt`, so other open pages reload
    before they act. A save that changes nothing writes nothing.
  - **The case stays as it was:** its step, its due time and "recorded {day} · {name}" on the card. Changes show only in
    the audit log; the demo has no "changed by" line. A change moves no money and sends no message.
  - A traveller changed to Approved keeps their refusal letters, which the case then doesn't show (Decision 4).
- **Screen:** "Change" at the end of each row of the Decision card, while the case is at Step 6 and open, for whoever
  can act on it. It opens "Change the decision" with that traveller's row (the same toggle and fields as recording).

### 7. Settings and seed data (golden rule 1)

| What | Seeded with |
| --- | --- |
| `visa.passportsBackCheck` (after the decision: check the passports are on their way back) | `{ afterDays: 1, at: "11:00" }` ⚠️ |
| The sticker / e-visa number format | capitals, digits, spaces, "-" and "/", 3–40 ⚠️ (in the code and a CHECK) |
| The chip wording ("Approved 3 · Refused 1") | ours ⚠️ |

**Defaults (not asked; say if any is wrong):**
- **A refusal changes no money:** embassy and VFS fees aren't refunded, so there's no credit note.
- **No refusal-reason list:** the demo doesn't have one. If Masti wants refusal reports, it's a change request.

## Not in this record

- **"Passports on the way back →"** (Step 6 → Step 7, with an expected arrival date): the Step 7 record.
- **WhatsApp to the client** ("Congratulations!" / the "sorry" message): waits for the WhatsApp work.
- **Re-applying after a refusal:** a new enquiry, as today.

## Still needed from Masti

- **M10:** confirm the decision is recorded per traveller.
- **M39:** the e-visa flow (Step 5 timings, and what follows an e-visa's decision).
