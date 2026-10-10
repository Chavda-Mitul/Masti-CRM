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

- Needs a CANCEL reason. Status becomes `CANCELLED`, with no due time.
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