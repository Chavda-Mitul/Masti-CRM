# 0006 · Visa Step 2: documents, follow-ups, postpone/cancel, maturity

- **Status:** accepted (9 Oct 2026, project lead; review outcome at the end). Scope and the open choices were decided by the project lead on 9 Oct 2026 (PROJECT_KNOWLEDGE.md §18).
- **Date:** 9 Oct 2026
- **Scope:** everything a visa case needs between intake (Step 1, [0003](0003-visa-intake.md)) and processing (Step 3):
  - the case page
  - the per-traveller checklist and naming travellers
  - how documents arrive, and booklets
  - the consent flag
  - the follow-up log and the "My follow-ups" desk
  - postpone, cancel and resume
  - reassigning
  - "Mark documents complete" and the handover to a processor
  - the follow-up and reason masters
- **Changes:**
  - Who sees an enquiry: department-wide in 0003, now **owner-based** (Decision 1).
  - Closes 0003's deferred items: naming travellers, ticking documents, linking family members, the consent flag, reassigning and postpone/cancel.
  - Supersedes 0003's open M4 on our side; it still needs Vimal's written confirmation.

## Amendment (10 Oct 2026, project lead)

Decided with the go for part 6. Where this differs from the decisions below, this wins.

1. **View-only users see every case of the department, read-only** (e.g. Accounts handling fees and invoices). Staff with EDIT still see only their own; the HOD sees the department; the Head sees everything. Changing a case stays with its owner, the HOD or the Head. *Supersedes Decision 1's "staff see only their own" for view-only users, and review outcome 1.*
2. **Booklet counts are optional.** A blank count shows as 0, and maturity doesn't require it, so e-visas (no passport handed over) aren't blocked. *Supersedes Decision 8's booklet condition and review outcome 2.*
3. **M4 decided:** the person who takes the enquiry at intake owns it and does every follow-up and the document collection until maturity. *(Already how it works.)*
4. **Document storage is S3-compatible** (AWS S3 or Cloudflare R2; MinIO locally, in `Backend/docker-compose.yml`). Files are private; they are shared through short-lived pre-signed URLs. Uploading scans is built after Step 2.

Decided with the go for part 7 (10 Oct 2026, project lead):

5. **The enquiries list has an Open / Postponed / Cancelled switch** (`?status=`). Search works inside the picked status. Postponed rows show "Postponed to <date> · reason"; cancelled rows show "Cancelled · reason".
6. **Logging a call on a postponed case resumes it.** It becomes `OPEN`, and its reason and resume date are cleared, in the same save as the follow-up.
7. **The desk's Postponed tab shows every postponed case**, soonest back first. A postponed case whose date has come also shows under Overdue / Today, like any due case.
8. **"When" in Log call starts empty.** Staff pick the day and the time. A past time, a day more than a year ahead, or a day the office is closed is refused.
9. **Desk buckets (IST):** Overdue = due before now. Today = due before midnight tonight (late ones included, as in the demo). This week = due within the next 7 days (late ones included). A matured visa case leaves the desk (processing takes over). The desk shows at most 200 rows per tab.
10. **"To assign" (with the go for part 8):** cases should never sit idle without a processor. HODs and the Head get a **To assign** item in the sidebar with a count of open, unowned cases in the departments they head (the Head: all). It opens the enquiries list on its **To assign** tab (`?status=to_assign`, sent to the API as `unassigned=true`), which only they see. The API enforces it too: `unassigned=true` lists only the departments the user is HOD of (the Head: all), and refuses anyone else with 403, including view-only users, who otherwise see the whole department. "Only mine" is hidden there. Rows show "Matured · assign a processor".
11. **"Mark documents complete" asks first.** The dialog lists what is missing (unnamed travellers, pending papers by traveller) and stays disabled until nothing is. Staff are taken back to their list afterwards, as the case is no longer theirs; the HOD or Head stays on it to assign a processor.
12. **Step 2 changes and maturity take turns** (review of PR #6, 12 Oct 2026). Each one locks the case's row first in its transaction (`SELECT … FOR UPDATE`), then reads the case again and repeats its checks. Maturity checks the checklist under that lock, in the same transaction as the move to File preparation. A paper un-ticked at the same moment either lands first and stops maturity, or waits and is then refused because the case has moved on. Ticks still don't change the case's `updatedAt`, so they never make an open "Mark documents complete" stale. *Refines Decision 2: there is still no lock per document, but there is one per case.*
13. **A matured case is due the next open office day at 11:00 ⚠️** (decided 16 Oct 2026, project lead, after the end-to-end walkthrough), as the setting `visa.assignCheck` `{ afterDays: 1, at: "11:00" }`. It was due the moment it was handed over, so the HOD's list showed it "Late" at once and counted it as running late. It turns late only if nobody's assigned it by then.

Amended 17 Oct 2026 (project lead), with Step 8 ([0014](0014-visa-delivered.md) Decision 5):

13. **Visa staff with EDIT also see a case whose passports are in our stock** (received at Step 7, not yet handed
    over), in their list and on its page, so whoever is at the desk can hand them over. Only the handover is theirs;
    everything else stays with the case's owner, the HOD or the Head. Once delivered, the case is back to the rule
    above.
14. **The collection boy's pickup job** (Decision 4's "comes with the field app") is designed in
    [0015](0015-field-staff-app.md): booked from Step 2 with the boy, a day and a time slot; at the door he counts the
    booklets, takes the client's OTP and his selfie with place and time, and his count becomes the intake count.

Amended 17 Oct 2026 (project lead), after the 17 Oct browser review found that a case cancelled at the vendor
stranded the client's passports (nothing could move again):

15. **Cancelling doesn't end the passports' way back.** Cancel stays possible at every step (Decision 6), but a paper
    file that went to the vendor still comes back to the client, with the usual proof:
    - **"To hand back":** a case whose file was dispatched in a docket and whose passports aren't handed over yet.
      An e-visa never is.
    - **What still works on such a cancelled case:** "Take the file back" ([0011](0011-visa-at-vendor.md) Decision 6),
      "Passports on the way back" and its "Change" ([0013](0013-visa-passport-back.md) Decision 3, component 2), as
      on an open case. Mark received and the handover already worked whatever the status (0013 Decision 5,
      [0014](0014-visa-delivered.md) Decision 7). The case stays Cancelled, with its reason, and moves to Delivered
      at the handover. Vendor got it, the submission, the decision and its correction, Log call and reassigning stay
      refused.
    - **It stays on its owner's list until the handover** (and on the HOD's): the enquiries list's Open tab shows it
      too, as "Cancelled · reason · passports still to hand back", and it counts toward running late. Cancelling gives
      it a due time instead of none: **now** at At vendor (take the file back) or when it was postponed (its due time
      was the resume day); otherwise it **keeps the due time it had** (the check after the decision, the arrival day,
      the handover check). Each later step sets its own, as on an open case: a cancelled case now also gets the
      handover check when its passports are received. The handover clears it.
    - **Money:** a recall issues its own part credit note (each traveller's embassy fee; the Visa HOD can give back
      more), and a whole credit note is refused after a part one, so a case cancelled at the vendor settles its refund
      in the recall dialog. If the invoice was already cancelled whole (no replacement), a cancelled case's recall
      gives nothing back and issues no credit note; an open case still raises a replacement first.
    - **"Cancel with a credit note" on a cancelled case** (component 2): the main invoice or the additional one, at
      any step. No corrected invoice follows, so it gives the client's money back, and **only the Visa HOD or the
      Head** may issue it (decided 17 Oct 2026, as only an HOD gives back more on a recall); the processor sees the
      button and is told to ask them. Nothing is raised on a cancelled case (no invoice, replacement, additional
      invoice or quote change): a cancellation charge Masti keeps is billed before cancelling. The cancel dialog
      warns about each invoice that still stands (at the vendor: its refund is set when the file is taken back).
    - **Hand back before dispatch** (component 3; not a demo screen, change request #7): a case cancelled at Steps
      1–4 while its passports are at our office (counted in at intake, more than zero) gets "Hand back to the
      client", with the office handover's proof: the count against the intake count, who collected, a desk photo.
      Decided 17 Oct 2026: **any Visa staff with EDIT** may do it (whoever is at the desk, as 0014 Decision 5), so
      such a case counts as in our stock and they can open it until then; it is due the next office day at 11:00
      (`visa.handoverCheck` ⚠️) and on its owner's Open list; afterwards it **stays at the step where it stopped**
      (no jump to Delivered) and stays Cancelled. At the office only: the delivery boy takes received passports
      (0015). With no intake count there's no custody record and so no hand-back; e-visas after the online submission
      wait on M39.
    - **For the field app ([0015](0015-field-staff-app.md)):** a delivery booked to hand the passports back should
      stay booked when the case is cancelled, and booking one should give a cancelled case its due time, as on an
      open one. Until that's changed there, cancelling still calls off a booked job.

    *Supersedes Decision 6's "with no due time" for these cases.* To confirm with Vimal: M41.

    **Built 17 Oct 2026, component 1** (`4f9d2ca`, branch `fix/visa-cancel-custody`):
    - **Step rules:** `cancelledToo` on `StepRule` (`caseLock.ts`), a new `RECALLING` (At vendor, WITH_VENDOR's
      wording), and `RETURNING` and `IN_TRANSIT` allow a cancelled case.
    - **"To hand back":** `TO_HAND_BACK` / `toHandBack` in `visibility.ts`.
    - **Due times:** `cancel()` keeps a due time for such a case (audit `toHandBack: true`); Mark received gives a
      cancelled case the handover check.
    - **The Open list:** it also lists them, and its rows carry `toHandBack`.
    - **Recall with nothing back:** for a cancelled case with no standing invoice, `invoiceNo: null`.
    - **The case page:** a banner of what's left; the header's custody step ("Take the file back →" and the steps
      after it); the recall reason preset; Change and the due lines on a cancelled case; a note in the cancel dialog.
    - **Tests:** 5 new (`tests/visaCancelCustody.test.ts`). All 42 test files pass (510). Browser-checked on an isolated
      copy.

    **Built 17 Oct 2026, component 2** (`5adc882`, branch `fix/visa-cancel-custody`):
    - **Step rule:** `CREDITING` (`caseLock.ts`): INVOICED's steps, on a cancelled case too, for `cancelInvoice` only.
      On a cancelled case only the Visa HOD or the Head (403 otherwise), checked again under the case lock.
    - **The check:** `GET …/invoice/cancel/check` says `hodOnly` (the case is cancelled).
    - **The Money section:** "Cancel with a credit note" shows on a cancelled case for the main and the additional
      invoice. The dialog says no corrected invoice follows, starts on "Client cancelled", and for anyone but the HOD
      or the Head explains and keeps Confirm off.
    - **The cancel dialog:** a note per standing invoice.
    - **Tests:** 3 new (`visaCreditNote`, `visaAdditionalInvoice`). Browser-checked: a case cancelled before dispatch,
      its invoice cancelled by the HOD. All 42 test files pass (513).

    **Built 17 Oct 2026, component 3** (`f37e07d`, branch `fix/visa-cancel-custody`):
    - **Definitions:** `PRE_DISPATCH` and `heldAtOffice` (`visibility.ts`, mirrored in `labels.ts`). `TO_HAND_BACK` /
      `toHandBack` and `IN_STOCK` / `passportsInStock` include a cancelled case held at the office.
    - **Cancel:** the case is due at the handover check.
    - **The handover:** `HANDING_OVER` covers Steps 1–4. `assertInStock` requires a cancelled case with an intake
      count, and the count must match the intake. The case keeps its step and its due time is cleared (audit
      `beforeDispatch: true`).
    - **The case page:** "Hand back to the client →", the banner, the dialog with no delivery option, the card's
      "Handed back".
    - **Tests:** 3 new (`visaCancelCustody`). All 42 test files pass (516). Browser-checked.

## Context

What the sources say (PROJECT_KNOWLEDGE.md §7, §10.2–§10.5, §12.4, §12.12, §18; demo screens 07 and 21):

| Source | What it says |
| --- | --- |
| Meeting ✅ | Documents are ticked over several visits. Each tick records date, hour, minute and who. Original or xerox is marked. A pending list drives reminders. Scanning happens in the office only, by anyone except the main processor. When documents are complete the case matures and goes to one processor. |
| Meeting ✅ | Follow-ups are logged with three dropdowns (What happened → Next step → When). No free text anywhere; reasons are dropdowns. |
| Meeting ✅ | Consent is once per person, for life, and stays valid if the passport changes. Anyone without one is flagged. It is obtained in parallel with processing. |
| Demo ⚠️ | Outcome, next-step and reason values, the "8 / 11" counter, "Booklets received 4 current + 3 old", the desk counters (Overdue · Today · This week · Postponed). |
| Project lead, 9 Oct | Staff see only their own cases and follow-ups. The HOD sees the department and reassigns; the Head sees all. At maturity the HOD picks a processor. The consent card is a flag only until WhatsApp. No file storage yet (S3 or Drive, decided later). |

## Decision

### 1. Who sees a case: owner, HOD, Head

- **Staff** see an enquiry only if they own it.
- **The department's HOD** sees all of the department's enquiries.
- **The Head** sees everything.
- This applies to:
  - the enquiries list
  - the case page and every case action
  - the follow-up desk
  - the client profile's open cases

One function, `visibleEnquiryWhere(user)`, builds the where-clause, so the screens can't disagree.

**The exception is the intake mobile lookup.** It still lists the client's open cases in departments the user can view, with the owner's name. Otherwise two people could open duplicate cases for the same client without knowing.

**Acting on a case** needs Visa EDIT, and being the owner, the HOD or the Head. Only the HOD or Head reassigns (Decision 6).

A case with no owner (matured, waiting for a processor) is seen only by the HOD and the Head.

### 2. The checklist: tick, original/xerox, not needed

- Each `VisaCaseDocument` (copied at intake, 0003 Decision 3) is ticked on its own.

| Requirement | Ticked as | Status |
| --- | --- | --- |
| Original / Xerox is fine | Came in as **Original** or **Xerox** (either is allowed; the toggle defaults to what's needed) | `RECEIVED` |
| Arranged by us | — | `MADE` |
| Any | — | `NOT_NEEDED` (e.g. salary slips for a business owner) or back to `PENDING` |

- `RECEIVED` and `MADE` stamp `receivedAt` (to the minute) and `receivedById`. Going back to `PENDING` or `NOT_NEEDED` clears them. The audit log keeps the history.
- **No optimistic lock per document.** Each tick is a small, independent change, and two people ticking the same paper agree anyway. Every tick is audited.
- **Who may tick:** see Decision 1. The case's owner is the follow-up person, who scans. The processor isn't assigned until maturity, so "anyone except the main processor" holds by construction.

### 3. Naming a traveller is linking a family member

- A traveller (placeholder "Adult 1") is named by linking one of the client's family members (`ClientMember`).
- If the person isn't in the family yet, staff add them on the spot with the existing member form, then link.
- The link gives the traveller a passport name, a passport status (valid / renew soon / expired) and a consent.
- The member's name is copied into `VisaCaseTraveller.name`, which keeps what the case was filed under. The page shows the member's current name.
- **Refused:**
  - a member of another client
  - an archived member
  - the same member twice on one case

Who counts as a child stays as set at intake (0005).

### 4. How documents arrive, and booklets

- **"Client brings them" or "Send collection boy"** is stored on the case (`arrival`, an enum, because the field app will branch on it).
- The collection boy's job itself (who, slot, pickup address) comes with the field app and is not built here.
- **Booklets received** are two counts, current and old, each 0–50. "The booklet count is checked again at handover."

### 5. Consent: a flag only, for now

- A `Consent` table is created: one row per family member, for life. Nothing writes to it yet.
- The "I agree" link that fills it needs WhatsApp, and the wording is still Q9.
- **The card shows, per traveller:**
  - "Name this traveller first" when the traveller isn't linked yet
  - "None on file — flagged"
  - (later) "Agreed · 28 Sep" or "On file from 2025"
- Consent never blocks maturity; it is obtained in parallel.

### 6. Follow-ups, postpone, cancel, resume, reassign

These live on the shared `Enquiry`, so Holidays, Hotels and the others reuse them.

**Follow-up log:**

- A row has What happened, Next step and When.
- Values come from two masters (Decision 7). "When" is a date and time.
- **Refused:** a time in the past, or a day the office is closed (the holiday calendar, 0005).
- Logging sets the case's `dueAt` to "When", which drives the desk and "running late".
- The case keeps its owner.

**Postpone:**

- Needs a POSTPONE reason and a resume date.
- Status becomes `POSTPONED`, and `dueAt` becomes the resume date's next open day at the follow-up time setting (`visa.firstFollowUp.at`). The case resurfaces on the desk then ("Postponed to Jan — confirm new month").
- **Resume** puts it back to `OPEN`.

**Cancel:**

- Needs a CANCEL reason. Status becomes `CANCELLED`, with no due time (unless its passports are still to hand back:
  amendment 15).
- Not reopened in this build. If needed, it's a later HOD action.

**Reassign:**

- HOD or Head only.
- The new owner must be an active office user with Visa EDIT, or the Head.

**Database checks:** `POSTPONED` needs a reason and a resume date; `CANCELLED` needs a reason.

**Locking:** case-level actions (follow-up, postpone, cancel, resume, reassign, mature) send the case's `updatedAt`. A change by someone else in between gives `409 STALE`.

### 7. Masters: follow-up outcomes, next steps, reasons

Three admin-editable tables, shared by all departments, switched off rather than deleted. Codes never change.

| Table | Seeded with the demo values ⚠️ |
| --- | --- |
| `FollowUpOutcome` (What happened) | Spoke — documents coming · No answer · Asked to call later · Wants to postpone · Wants to cancel · Documents complete |
| `FollowUpNextStep` | Send collection boy · Client will visit office · Call again |
| `EnquiryReason` (by kind) | **Postpone:** Travel dates moved · Waiting for leave approval. **Cancel:** Went with another agent · Trip cancelled · Price higher · Visa not needed · Documents not available · No reply |

- **Who edits them:** the Head or any HOD, as with the holiday calendar, because they are shared.
- **Where:** Settings → Masters → Lists.
- **Outcomes don't trigger anything** ("Wants to cancel" doesn't cancel the case). Staff press Postpone or cancel. This keeps code from branching on editable data.
- `EnquiryReasonKind` gets `LOST` when closing and losing are built.

### 8. Maturity: staff mark it, the HOD assigns a processor

**"Mark documents complete"** is pressed by the owner, the HOD or the Head. **Refused unless:**

- every traveller is linked to a family member
- every document is `RECEIVED`, `MADE` or `NOT_NEEDED`
- ~~the booklet counts are entered~~ (dropped 10 Oct 2026: booklets are optional, see *Amendment*)

The error lists what's missing.

**When it succeeds:**

- The stage moves to **File preparation**.
- The owner is cleared: the case is *Matured · to assign*, shown to the HOD and the Head.
- `dueAt` becomes now.
- `maturedAt` and `maturedById` are stamped, for the Step 3 banner: "Matured 6 Oct — All documents are in. Aarti handed the case to …".

**Assigning the processor:**

- The HOD assigns a processor with Reassign.
- **The processor can't be the person who matured the case**, because whoever scanned can't be the main processor.

**The checklist is read-only after maturity.** Step 3 ("the processor checks") is its own record.

**The stage moves forward on its own:**

- The first Step 2 change on a case still at **Enquiry** moves it to **Documents**.
- "Start collecting documents" does the same explicitly.

### 9. The case page and the desk

**Case page:** `/enquiries/:caseNo`, laid out like demo screen 07:

- **Header:** status chip, Postpone or cancel (or Resume), the next-step button, and step chips (display only).
- **Main column:** the checklist with traveller tabs and the "8 / 11" counter; how documents arrive; follow-ups; consent.
- **Right rail:** "Who it is for" and "Whose job it is now".
- "Sent to the client" and "Money on this case" wait for WhatsApp and Accounts.

**Follow-up desk:** `/follow-ups` (the sidebar's "Follow-ups"), laid out like demo screen 21:

- counters Overdue · Today · This week · Postponed (IST days)
- for the HOD and Head, a Mine / Whole department switch
- an inline "Log call" row
- "Cross-sell leads" stays "Soon" (Stage 3)

## Schema (summary)

```prisma
enum EnquiryReasonKind { POSTPONE CANCEL }
enum DocumentArrival   { CLIENT_BRINGS COLLECTION_BOY }

model FollowUpOutcome  { id Int @id @default(autoincrement()); code String @unique; name String; sortOrder Int @default(0); isActive Boolean @default(true) }
model FollowUpNextStep { /* same shape */ }
model EnquiryReason    { id Int @id @default(autoincrement()); kind EnquiryReasonKind; code String @unique; name String; sortOrder Int @default(0); isActive Boolean @default(true) }

model FollowUp {
  id String @id @default(uuid()); enquiryId String; outcomeId Int; nextStepId Int
  nextAt DateTime @db.Timestamptz(3); byId String; createdAt DateTime @default(now()) @db.Timestamptz(3)
  @@index([enquiryId, createdAt])
}

model Consent { id String @id @default(uuid()); memberId String @unique; agreedAt DateTime @db.Timestamptz(3); createdAt DateTime @default(now()) @db.Timestamptz(3) }

// Added columns
Enquiry           { reasonId Int?; resumeOn DateTime? @db.Date }
VisaCase          { arrival DocumentArrival?; bookletsCurrent Int? @db.SmallInt; bookletsOld Int? @db.SmallInt; maturedAt DateTime? @db.Timestamptz(3); maturedById String? }
VisaCaseTraveller { memberId String?  @@unique([caseId, memberId]) }
```

**Hand-written checks:**

- master code format `^[A-Z0-9_]{1,40}$`
- `Enquiry` reason and resume date by status
- booklets 0–50

The migration must keep `HolidayTarget_unique`.

## API

All routes are under `requireAuth → requirePasswordChanged → requireUserType("HEAD","OFFICE")`. The service checks Decision 1. Writes are JSON and audited with `clientId`.

| Method and path | What |
| --- | --- |
| `GET /api/visa/cases/:caseNo` | The case, extended: owner, reason, resume date, arrival, booklets, maturity, travellers with member, consent and done/need, documents with received as/at/by, the last 20 follow-ups, `updatedAt` |
| `POST /api/visa/cases/:caseNo/start` | Enquiry → Documents |
| `PATCH /api/visa/cases/:caseNo/documents/:documentId` | `{ status, receivedAs? }` (Decision 2) |
| `PUT /api/visa/cases/:caseNo/travellers/:travellerId/member` | `{ memberId }` (Decision 3) |
| `PATCH /api/visa/cases/:caseNo` | `{ arrival?, bookletsCurrent?, bookletsOld? }` |
| `POST /api/visa/cases/:caseNo/mature` | `{ updatedAt }` (Decision 8). Returns the case by id (its owner is now cleared). Not ready: `409 { message, details: { code: "NOT_READY", missing: { unnamed: ["Child 1"], pending: [{ traveller, documents: [names] }] } } }` |
| `GET /api/visa/staff` | HOD or Head: who can own a visa case |
| `POST /api/enquiries/:caseNo/follow-ups` | `{ outcomeId, nextStepId, nextAt, updatedAt }` |
| `POST /api/enquiries/:caseNo/postpone` · `/cancel` · `/resume` | `{ reasonId?, resumeOn?, updatedAt }` |
| `PUT /api/enquiries/:caseNo/owner` | `{ ownerId, updatedAt }`, HOD or Head |
| `GET /api/enquiries/follow-ups?bucket=&scope=` | The desk: rows and the four counts |
| `GET /api/enquiries?unassigned=true` | The list's To assign tab: open cases with no owner, in the departments the user is HOD of (the Head: all); 403 for anyone else (amendment 10) |
| `GET /api/enquiries/to-assign` | `{ count }` for the sidebar; an HOD (their departments) or the Head (all), 403 otherwise |
| `GET/POST/PATCH /api/masters/follow-up-outcomes` · `/follow-up-next-steps` · `/enquiry-reasons` | The masters. Anyone signed in reads; the Head or any HOD writes. |

## Tests (rule logic)

- **Visibility:** staff vs HOD vs Head across the list, the case, the desk and the client profile. The intake lookup still shows colleagues' cases.
- **Ticking:**
  - `RECEIVED` needs original/xerox
  - `MADE` only for "Arranged by us"
  - the time and who are stamped and cleared
  - only the owner, HOD or Head may tick
  - nothing changes after maturity
- **Linking:** another client's member, an archived member and the same member twice are refused.
- **Follow-ups:** past times and closed office days are refused; `dueAt` moves; switched-off values are refused; desk buckets are right around midnight IST.
- **Postpone, cancel, resume:** the reason kind must match; the resume date lands on an open day; the database checks hold; a stale `updatedAt` gives 409.
- **Maturity:** refused with pending documents, unnamed travellers or missing booklets. Afterwards there is no owner, the stage is File preparation, and the processor can't be the person who matured the case.
- **Masters:** the Head or any HOD edits; switched off, never deleted.

## Not in this record

- **Storing scanned files:** S3 bucket or Drive, decided later (`CLAUDE.md` rule 4).
- **WhatsApp:** the document list, reminders, "All documents received" and the "I agree" consent link. The template drafts are a separate task.
- **The collection boy's pickup job** (field app, Q3/Q31).
- **Trip details captured as documents come in** (entry type, duration, hotel stay): with Step 3's form filling.
- **The Today screen,** the visa board and the cross-sell tab.
- **Reopening a cancelled case,** and closing or losing a case.

## Review outcome (9 Oct 2026, project lead)

1. **VIEW-only users see no cases** in a department unless they own one (they can't, as owners need EDIT) or are its HOD. The rule is strict owner/HOD/Head, with no read-only exception.
2. **Booklet counts stay required** before maturity: they are checked again at handover, so they must be recorded now.
3. **Who follows up:** the person who saved the enquiry (its owner) does the follow-up, until the HOD reassigns it. Vimal's written confirmation of this (M4) and the consent wording (Q9) are still to come.