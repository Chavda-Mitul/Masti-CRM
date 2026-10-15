# 0012 · Visa Step 6: the decision

- **Status:** decided (15 Oct 2026, project lead). Being built one component at a time (Decision 1). A "Built" note
  is added under each part as its component lands.
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

### 4. A refused traveller: the refusal letter

**Decided 15 Oct 2026 (project lead):** the letter is a **scanned PDF** kept with the case in our storage (rule 4),
not a Drive link. It's **optional**: it often comes back inside the passport, so it can be uploaded at Step 6 or
later. One letter per refused traveller; a newer upload becomes the current one and the older stays as proof.

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
- **The header chip** reads "Approved" (everyone), "Refused" (everyone) or "Approved 3 · Refused 1".

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
