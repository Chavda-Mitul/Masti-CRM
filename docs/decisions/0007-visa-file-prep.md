# 0007 · Visa Step 3: file preparation, and the vendor master

- **Status:** accepted (12 Oct 2026, project lead). The decisions below were taken by the project lead on 11–12 Oct
  2026; the six open points were reviewed the same day (*Review outcome*, at the end): B–F accepted, A changed (trip
  details are required before "File ready").
- **Date:** 12 Oct 2026
- **Scope:** everything a visa case needs between maturity (0006 Decision 8) and the docket (Step 4):
  - the matured banner
  - the processor's own check of every paper
  - trip details
  - each traveller's acknowledgement number and appointment
  - the visa's "Appointment needed" and "Vendor needed" switches
  - the vendor master, and picking a vendor for the case
  - the saved file kept as proof (the first upload to S3-compatible storage)
  - "File ready — add to docket"
- **Builds on:** [0005](0005-system-masters.md) (visa offerings and checklists),
  [0006](0006-visa-documents.md) (maturity, the processor handover, and the case lock of amendment 12).

## Context

What the sources say (PROJECT_KNOWLEDGE.md §10.8, §12.4 Step 3, §12.20, §16.2, §17 #14; demo screens 08 and 29):

| Source | What it says |
| --- | --- |
| Meeting ✅ | When documents are complete, the case matures and goes to one processor, **who receives and checks the documents**. The final file is saved as one PDF and linked under the case number (Masti keeps a single scanned PDF like this today). The vendor comes from the approved list. |
| Demo ⚠️ (screen 08) | Banner "Matured 6 Oct — All documents are in. Aarti handed the case to Neha Joshi in processing." A portal card with **Log in for me**; buttons Read passport scan · Fill from consent & trip details · Print application form; a table of travellers with **Acknowledgement no. (typed in)** and **Appointment** ("9 Oct, 10:30"); a covering-letter card; "Saved file — kept as proof" (`V-2041_Mehta_file.pdf`, 52 pages, vendor "[Vendor] · Mumbai"); next step **File ready — add to docket**. |
| Demo ⚠️ (screen 29) | Vendors: name · city · countries, Approved / Waiting HOD, "Open a vendor", "Staff can only pick approved vendors." |
| PROJECT_KNOWLEDGE §17 #14, §16.2 | Passport-scan autofill is unconfirmed (Q13). "Log in for me" is the biggest technical unknown: spike it first. |
| Project lead, 10 Oct | Documents go to S3-compatible storage (AWS S3 or R2; MinIO locally), private, shared through short-lived pre-signed URLs. Uploading scans comes after Step 2. |
| Project lead, 11–12 Oct | The decisions in this record (below). |

**Decided by the project lead (11–12 Oct 2026):**

1. **Vendor master with basic fields.** Only the HOD or the Head adds a vendor, and it is approved as it is added: there
   is no "Waiting HOD" state.
2. **Pending, not built here:**
   - the covering letter (the formats will be supplied: M13/Q10). *Now [0019](0019-covering-letters.md) (19 Oct 2026):
     built with sample formats until Masti's arrive.*
   - "Log in for me" (§16.2)
   - Read passport scan, Fill from consent & trip details, and Print application form (S6/Q13)
3. **"File ready" needs:**
   - an acknowledgement number for every traveller
   - an appointment for every traveller
   - the final PDF
   - a vendor
4. **Two switches on each visa,** both on by default:
   - **Appointment needed**
   - **Vendor needed**
   E-visas turn them off, so they never wait for an appointment or a vendor they don't have.
5. **The processor re-ticks every paper.** A bad paper is flagged **Needs replacing** with a reason from a list, and the
   processor sorts it out; the case stays with them. *This goes beyond the demo screens. The project lead is telling
   Vimal and Shivanshu.*

## Decision

### 1. Who acts in Step 3

- **Changing a case at File preparation** needs Visa EDIT, and being:
  - its owner (the processor)
  - the Visa HOD
  - the Head
- **Before a processor is assigned** (Matured · to assign), only the HOD or the Head can act.
- **The person who matured the case can't be its processor** (0006 Decision 8, already enforced by Reassign).
- **Every Step 3 change locks the case row first** and repeats its checks, as Step 2 does (0006 amendment 12).
  `lockForStep2` becomes one helper that takes the steps allowed, so Step 2 and Step 3 share it.

**Built 12 Oct 2026:** `Backend/src/modules/visa/caseLock.ts`, with `loadCase` / `lockCase` and a `StepRule`:
`COLLECTING` (Step 2, same messages as before) and `PREPARING` (Step 3: "This can only be changed during file
preparation."). Step 3's writes live in `visaFilePrep.service.ts`.

### 2. The matured banner

| Situation | What it says |
| --- | --- |
| A processor is assigned | "Matured 6 Oct — All documents are in. Aarti handed the case to Neha Joshi in processing." |
| No processor yet | "Matured 6 Oct — All documents are in. Waiting for the HOD to pick a processor." |

It reads `maturedAt`, `maturedBy` and the owner, which the case already has. The wording is the demo's ⚠️.

**Built 12 Oct 2026** (`Frontend/src/pages/enquiries/case/MaturedBanner.tsx`). It shows while the case is at File
preparation only; later steps will have their own.

### 3. The processor checks every paper

The meeting's "the processor receives and checks the documents", built as a second tick on the same checklist.

| Paper (from Step 2) | What the processor can mark |
| --- | --- |
| Received or Made | **Checked**, or **Needs replacing** with a reason |
| Not needed | Nothing to check |

- **Checked** and **Needs replacing** stamp who and when (`checkedAt`, `checkedById`, to the minute).
- **Needs replacing** needs a reason from a new master, `DocumentProblemReason`, edited by the Visa HOD or the Head
  (Settings → Masters → Lists). Seeded with placeholders ⚠️:
  - Wrong photo size
  - Not signed
  - Expired
  - Copy not clear
  - Wrong dates
- **When the replacement comes in,** the processor marks it **Checked**, which clears the reason. Every change is
  audited, so the history stays.
- **Step 2's receipt is kept as it was:** Original/Xerox, and who received it and when. The check is its own record.
- **A database check:** a reason is set exactly when the paper needs replacing.

**Built 12 Oct 2026:**

- **API:**
  - `PATCH /api/visa/cases/:caseNo/documents/:documentId/check`, audited as `visa.document.check`
  - the master at `GET/POST/PATCH /api/masters/document-problem-reasons`
  - migration `20261012100000_document_checks`
- **Screens:**
  - Once a case has matured, the checklist's Status column becomes **Check**. The receipt's time moves to a hover.
  - The processor gets two buttons on each paper: **✓ Checked** and **Needs replacing…**, which opens a reason picker.
  - The count reads "8 / 10 checked", and a traveller's tab shows how many papers need replacing.
  - The master is Settings → Masters → Lists → **Document problems**.
- **Settled while building:**
  - Pressing **Checked** again sets the paper back to "to check" (`check: null`), to undo a mis-click.
  - Re-sending the same check changes nothing, and its first time stays.
  - Checks don't change the case's `updatedAt`, as with ticks, so they never make someone else's page stale.
  - Hand-written checks also require a check to carry who and when, and to be on a paper that came in or was made.
  - **Clicking quickly down the list:** the answers to several changes in flight can come back out of order, and an
    older one used to overwrite a newer one on screen. The server was always right. Now the last change to finish
    reloads the case instead. This fixes Step 2's ticks too, since they share the code.

### 4. Trip details

The details the forms and the covering letter will need, "captured as the documents come in" (§12.4):

| Field | How |
| --- | --- |
| Travelling out | Date. Pre-filled from the intake's travel date, if there was one. |
| Coming back | Date, not before travelling out |
| Duration | Worked out from the two dates, not stored |
| Entry type | Single · Double · Multiple (an enum: the visa rules fix these, and the forms will branch on them) |
| Hotel stay | Short text: the hotel's name and city. It is data for the forms, not a reason or a status, so rule 2 (no free text) doesn't apply. |

- **Editable in Documents and File preparation,** by whoever can act on the case at that step.
- **Required for "File ready":** travelling out, coming back and the entry type (review outcome A, 12 Oct 2026). If
  the processor doesn't enter them now, they are forgotten, and the covering letter will need them. Hotel stay stays
  optional.
- The intake's `travelMonth` and `travelDate` stay as they were filed.

**Built 12 Oct 2026** (slice 3, with Decisions 5 and 6):

- **API and data:**
  - `PATCH /api/visa/cases/:caseNo/trip`, audited as `visa.trip.update` (only the changed fields)
  - migration `20261012120000_trip_and_application`
  - the **Trip details** card on the case page
- **Settled while building:**
  - **Pre-filled means stored.** A new case with an exact travel date starts with `departOn` set to it, and the
    migration did the same for existing cases. So "File ready" reads what is stored, and nobody has to re-save it.
  - **A newly set travelling out can't be in the past,** as at intake. Coming back is checked against travelling out
    as stored, so sending one date alone is checked too.
  - **Editable at Enquiry as well.** Like any Step 2 change, the first trip save at the Enquiry stage moves the case
    to Documents. After File preparation the answer is "Trip details can't change once the file is ready."
  - **It doesn't change the case's `updatedAt`,** like ticks and checks, so it never makes someone else's open page
    stale.
  - **Duration** counts both days (15 → 26 Dec is 12 days), as the visa counts them.

### 5. Each traveller: acknowledgement number and appointment

| Field | Rule |
| --- | --- |
| Acknowledgement no. | Typed in from the portal. Capitals and digits, 4–40 characters, e.g. `FRA1MU20261006481`. |
| Appointment | Date and time (IST). It can't be in the past when entered. There is no holiday check, because the portal gave that slot. Asked for only when the visa's **Appointment needed** is on. |

**Amended 19 Oct 2026 (project lead, item 2 fixes; M46 to confirm):** an appointment **on or after the trip's departure
day** is a warning: the first save stops with "Check before saving" and the reason; staff save anyway, and the audit keeps what they confirmed (`lib/warnings.ts`). It can still be right if the trip moves.

**Built 12 Oct 2026:**

- **API:** `PATCH /api/visa/cases/:caseNo/travellers/:travellerId/application`, audited as
  `visa.traveller.application`. File preparation only.
- **Screen:** the **Apply on the government portal** card (demo screen 08). Each traveller has a row with their own
  **Save**.
- **Settled while building:**
  - **The appointment is sent as a day and a time in India,** `{ appointment: { on, at } }`, as follow-ups are. The
    server turns it into the moment. `null` clears it.
  - **The acknowledgement number is cleaned up:** spaces go and letters become capitals ("fra1 mu2026 0648" is saved
    as `FRA1MU20260648`). Anything else that isn't a capital or a digit is refused.
  - **Saved even when Appointment needed is off.** The switch only decides what "File ready" asks for and whether the
    page shows the column.
  - **Not shown yet:** the portal box ("Log in for me") and the Read passport scan, Fill and Print buttons. They are
    pending (Decision 2), so the page shows no dead buttons.

### 6. The visa's switches: Appointment needed, Vendor needed

- **Two columns on `VisaOffering`** (the "France · Tourist" row), both `true` by default:
  - `appointmentNeeded`
  - `vendorNeeded`
- **They sit on the offering, not on `VisaType`,** because whether a visa is an e-visa depends on the country: a tourist
  visa is an e-visa for some countries and a sticker visa for France.
- **Who edits them:** the Visa HOD or the Head, on the offering in Settings → Masters → Checklists (0005 Decision 8).
- **Read live at "File ready",** not copied at intake. Checklists are copied so that editing them never changes an
  open case; a switch is different, because correcting it should help the cases already open.
- **Switching "Vendor needed" on is refused while a case would be stranded** (decided 19 Oct 2026, project lead, after
  the code review): an open or postponed case of that visa at Docket & dispatch with no vendor could then be neither put
  in a docket nor submitted online, and only File preparation picks a vendor. The 409 names the cases ("VISA-2026-0004
  is at Docket & dispatch with no vendor. Submit it online first…"). Switching it off is unaffected: a case already in a
  docket keeps it (0008).

**Built 12 Oct 2026:**

- **API:** `PATCH /api/masters/visa-offerings/:id` takes `isActive`, `appointmentNeeded` and `vendorNeeded`, any of
  them. The audit stays `visaOffering.update`.
- **On the case:** the case sends both switches, read live.
- **Screen:** a **Before the file is ready** card in the checklist editor, with two checkboxes that save on click.
  The checklist list shows "No appointment · No vendor" when one is off.
- **Like "Switch off this visa",** the checkboxes wait while the checklist has unsaved changes. Changing one also
  makes an open checklist editor elsewhere stale, because both share the offering's `updatedAt`.

### 7. The vendor master

Visa submission agents for now ("Mumbai · Schengen", "Delhi · China"). Hotel vendors come with Hotels (Stage 2).

| Field | Rule |
| --- | --- |
| Kind | `VISA_AGENT` (`HOTEL` added in Stage 2) |
| Name | Required |
| City | Required |
| Countries covered | At least one, picked from the country master |
| Contact person | Optional |
| Mobile | Optional; cleaned with `src/lib/contact.ts` |
| Email | Required (decided 14 Oct 2026, project lead): Step 4's dispatch email goes to it *(open point C)* |
| Active | Switched off, never deleted |

- **One vendor per kind, name and city,** ignoring case.
- **Only the Visa HOD or the Head** adds, edits or switches off a vendor. A new vendor is approved as it is added
  (decided 12 Oct; replaces the demo's "Waiting HOD"). Golden rule 6, "vendor approval is HOD-only", holds because
  adding is approving.
- **Where:** a **Vendors** tab in Settings → Masters.
- **On the case:**
  - `VisaCase.vendorId`, picked in File preparation.
  - The picker lists only active vendors that cover the case's country.
  - A vendor that is switched off, or doesn't cover the country, is refused.
  - If none covers the country, the page says so ("No vendor covers France yet — ask the Visa HOD to add one").
- **A vendor switched off after being picked** stays on the case for the record, but "File ready" asks for an active
  one.
- **A vendor that stops covering the case's country after being picked** (the HOD takes the country off it) is treated
  the same way: it stays on the case, and "File ready" asks for a vendor that covers the country. *(Added 13 Oct 2026,
  from code review: the picker already refuses a vendor that doesn't cover the country, so "File ready" must not accept
  one.)*

**Built 12 Oct 2026** (the master only; picking a vendor on a case comes with the Step 3 case work):

- **Backend:** `Backend/src/modules/vendors/` and migration `20261012090000_vendors`.
- **Screen:** Settings → Masters → Lists → **Vendors**, plus a Vendors card on the Masters page.
- **Settled while building:**
  - The duplicate check compares `lower(name)` and `lower(city)`, exactly as the unique index does, so the friendly
    message and the database never disagree.
  - A country switched off later stays on the vendors that already cover it; it just can't be added to another vendor.
  - `prisma migrate diff` doesn't propose dropping the expression index, so only `HolidayTarget_unique` needs removing
    from its output, as before.

**Built 13 Oct 2026** (slice 4, the vendor on the case):

- **API and data:**
  - `PUT /api/visa/cases/:caseNo/vendor` with `{ vendorId }`; `null` clears the pick
  - `VisaCase.vendorId` (migration `20261013090000_case_vendor`), `ON DELETE RESTRICT`
  - audited as `visa.vendor.set`, before and after as the id and "Name · City"
  - the case sends `vendor { id, name, city, isActive, contactName, mobile, coversCountry }`; `coversCountry` is false
    when the case's country was taken off the vendor after it was picked
- **Screen:** the last row of the "Saved file — kept as proof" card, where the demo shows it. While the case is at File
  preparation, the processor, the HOD or the Head picks from a list. It saves as soon as one is picked.
- **Settled while building:**
  - **Refused with a reason under `vendorId`:** an unknown vendor, a switched-off one, or one that doesn't cover the
    case's country. Sending the vendor already on the case changes nothing, so it isn't refused even if switched off
    since.
  - **Allowed when the visa's "Vendor needed" is off,** as the appointment is. The page says "This visa needs no
    vendor." and shows no list while nothing is picked.
  - **The case's `updatedAt` doesn't move,** like the other Step 3 edits.
  - **A vendor that no longer covers the country** shows a "No longer covers France" chip and "Pick a vendor that
    covers France before the file is ready." (added 13 Oct).
  - **A vendor switched off after being picked** shows a "Switched off" chip and "Pick an active vendor before the
    file is ready."
  - **The contact person and mobile** from the master show under the name, for the next day's "did you get it?" call.
    The demo shows only the name and the city.
  - **When no vendor covers the country,** staff see "No vendor covers France yet — ask the Visa HOD to add one". The
    HOD and the Head see a link to the Vendors list instead.
  - **The picker reads the master's vendor list** and filters it on the page. Saving a vendor in Settings refreshes
    open cases.

### 8. The saved file, kept as proof

The first upload in the CRM (golden rule 4: S3-compatible, private, shared through short-lived pre-signed links).

- **One PDF per case,** as in the demo: every page as it went to the vendor.
- **Uploaded through our API.** The server:
  - streams the PDF to the bucket
  - checks it really is a PDF (its first bytes are `%PDF-`)
  - checks its size against the setting `visa.finalFile` → `{ maxMb: 50 }` ⚠️
  - counts its pages ("52 pages")
  Going through the API, rather than straight from the browser to the bucket, means no bucket CORS to set up, and it
  works the same on MinIO, S3 and R2. *(Open point E.)*
- **Opening it** uses a pre-signed link that lasts `S3_PRESIGN_SECONDS` (300 ⚠️, in `.env`).
- **Its name** is shown as `<case no>_<client's last name>_file.pdf`, e.g. `VISA-2026-0001_Mehta_file.pdf` ⚠️. The
  storage key is `cases/<enquiryId>/final/<uuid>.pdf`, so no name ever collides.
- **A newer upload becomes the current file.** Older ones are kept and never deleted, because they are proof. The case
  page shows the current one; the audit log lists every upload.
- **It can be replaced during File preparation only.** *(Open point F.)*
- **New code:**
  - `src/lib/storage.ts`, the only place that talks to the bucket (`@aws-sdk/client-s3`,
    `@aws-sdk/s3-request-presigner`)
  - `pdf-lib`, for the page count
  - the `S3_*` settings, added to `src/config/env.ts`

**Built 12 Oct 2026** (slice 2, moved ahead of trip details so the storage risk showed early):

- **API and data:**
  - `POST /api/visa/cases/:caseNo/files/final` and `GET /api/visa/cases/:caseNo/files/:fileId/link`
  - table `CaseFile` (migration `20261012110000_case_files`), audited as `visa.file.upload` and `visa.file.open`
  - the "Saved file — kept as proof" card on the case page
- **Settled while building:**
  - **The PDF is the request body itself** (`Content-Type: application/pdf`), not a form. That keeps the CSRF guard: no
    other site's form can send that type, so `requireJson` now accepts JSON or a PDF.
  - **Held in memory, not streamed.** Counting the pages needs the whole file, so the server reads it into memory (at
    most the limit), checks it, then sends it to the bucket. A bigger upload is refused with 413.
  - **The bucket first, then the row.** The upload to the bucket happens before the case lock, so a slow upload never
    holds the case. If the case moved on meanwhile, the row isn't saved and the object is removed again.
  - **The link is per file** (`/files/:fileId/link`), not `/files/final/link`, so older copies and later files can use
    it. Opening a file is audited too, because it holds passports.
  - **The size limit** (`visa.finalFile.maxMb`, 50 ⚠️) is changed through `PUT /api/visa/settings`, like the
    follow-up timing. Neither has a screen yet. The page checks the type and the size before sending.
  - **Tests** use their own bucket (`masti-crm-test` by default, from `.env.test`), created and emptied at the start of
    every run.

### 9. "File ready — add to docket"

Pressed by the processor, the HOD or the Head. **Refused** (`409 NOT_READY`, listing what is missing, like maturity)
**unless:**

- every Received or Made paper is **Checked**, and none **Needs replacing**
- every traveller has an **acknowledgement number**
- every traveller has an **appointment** (if the visa's Appointment needed is on)
- the **final PDF** is uploaded
- an **active vendor that covers the case's country** is picked (if the visa's Vendor needed is on)

**Amended 19 Oct 2026 (project lead, item 2 fixes; M46 to confirm):** File ready is the last look before the file goes
out. A passport that runs out less than ⚠️ `visa.passportValidity` months (seeded 6) after the trip comes back is
a warning: the first save stops with "Check before saving" and the reason; staff save anyway, and the audit keeps what they confirmed (`lib/warnings.ts`). Many embassies refuse it, but it can be right. The same check runs when a traveller is linked and when the
return changes (0006 amendment 18).
- the **trip details** are in: travelling out, coming back and the entry type

**When it succeeds,** in one transaction, under the case lock:

- the stage moves to **Docket & dispatch**
- the processor stays the owner (Step 4 is still processing)
- the case is due now
- `fileReadyAt` and `fileReadyById` are stamped and audited
- Step 3 becomes read-only: the checks, the travellers' numbers and appointments, the vendor and the file

Step 4's next-step button shows "Soon" until it is built.

**Built 13 Oct 2026** (slice 5; Step 3 is complete):

- **API and data:**
  - `POST /api/visa/cases/:caseNo/file-ready` with `{ updatedAt }`
  - `VisaCase.fileReadyAt` and `fileReadyById` (migration `20261013100000_file_ready`, with a CHECK that both are set
    together)
  - audited as `visa.file.ready`. The after values include the vendor's id and the saved file's id, so the record
    shows what went to the docket.
  - `409 NOT_READY` has `details.missing`: `{ papers: [{ traveller, toCheck, needsReplacing }], ackNo, appointment,
    finalFile, vendor: "NONE" | "SWITCHED_OFF" | "NOT_COVERING" | null, trip }`. A vendor that is both switched off
    and no longer covering is reported as `SWITCHED_OFF`.
- **Screen:**
  - the header's next-step button opens a **File ready — add to docket** dialog, built like maturity's
  - the dialog lists what's missing from the loaded case; the server's list replaces it if they disagree
  - once ready, the Saved file card says who marked it and when
- **Settled while building:**
  - **A case with no processor is refused** ("Give this case to a processor first"). Step 4 is the processor's work,
    and the header shows no button until a processor is assigned.
  - **At Docket & dispatch the status chip says "File ready · to dispatch"** instead of the seeded "Dispatched" ⚠️,
    which isn't true until Step 4 sends the docket. It works like "Matured · to assign"; Step 4 will replace it.
  - **The case's `updatedAt` is checked,** as for maturity: a page that missed a reassign or a postpone gets
    `409 STALE`. The Step 3 edits don't move it, so they never make this button stale.
  - **Nothing new makes Step 3 read-only:** every Step 3 write already needs File preparation (trip details stop
    there too).
  - **A `NOT_READY` answer reloads the case,** so the cards behind the dialog show the same thing as its list (found
    in the browser check: a paper flagged meanwhile still showed as Checked).
  - **The dialog scrolls inside itself** when the list is longer than the screen (a large family's papers on a phone).

### 10. Settings and seed data (golden rule 1)

| What | Seeded with |
| --- | --- |
| `visa.finalFile.maxMb` | 50 ⚠️ |
| `DocumentProblemReason` | Wrong photo size · Not signed · Expired · Copy not clear · Wrong dates ⚠️ |
| `VisaOffering.appointmentNeeded` / `vendorNeeded` | on ⚠️ |
| The banner wording and the file name pattern | the demo's ⚠️ (frontend text) |

## Schema (summary)

```prisma
enum DocumentCheck { CHECKED NEEDS_REPLACING }
enum EntryType     { SINGLE DOUBLE MULTIPLE }
enum VendorKind    { VISA_AGENT }
enum CaseFileKind  { FINAL_FILE }

model DocumentProblemReason { id Int @id @default(autoincrement()); code String @unique; name String; sortOrder Int @default(0); isActive Boolean @default(true) }

model Vendor {
  id Int @id @default(autoincrement()); kind VendorKind; name String; city String
  contactName String?; mobile String?; email String?; isActive Boolean @default(true)
  createdAt DateTime @default(now()) @db.Timestamptz(3); updatedAt DateTime @updatedAt @db.Timestamptz(3)
  countries VendorCountry[]
}
model VendorCountry { vendorId Int; countryId Int  @@id([vendorId, countryId]) }

model CaseFile {
  id String @id @default(uuid()); enquiryId String; kind CaseFileKind; storageKey String @unique
  fileName String; sizeBytes Int; pageCount Int; uploadedById String; uploadedAt DateTime @default(now()) @db.Timestamptz(3)
  @@index([enquiryId, kind, uploadedAt])
}

// Added columns
VisaOffering      { appointmentNeeded Boolean @default(true); vendorNeeded Boolean @default(true) }
VisaCase          { departOn DateTime? @db.Date; returnOn DateTime? @db.Date; entryType EntryType?; hotelStay String?
                    vendorId Int?; fileReadyAt DateTime? @db.Timestamptz(3); fileReadyById String? }
VisaCaseTraveller { ackNo String?; appointmentAt DateTime? @db.Timestamptz(3) }
VisaCaseDocument  { check DocumentCheck?; checkReasonId Int?; checkedAt DateTime? @db.Timestamptz(3); checkedById String? }
```

**Hand-written checks:**

- `checkReasonId` is set exactly when `check = 'NEEDS_REPLACING'`; `checkedAt`/`checkedById` go with `check`
- `returnOn >= departOn`
- `ackNo ~ '^[A-Z0-9]{4,40}$'`
- `hotelStay` at most 200 characters
- `fileReadyAt` and `fileReadyById` set together
- the master code format `^[A-Z0-9_]{1,40}$` on `DocumentProblemReason`
- a unique index on `Vendor (kind, lower(name), lower(city))`

The migration must keep `HolidayTarget_unique` (CLAUDE.md).

## API

Case routes sit under `requireAuth → requirePasswordChanged → requireUserType("HEAD","OFFICE")` and Visa EDIT; the
service checks Decision 1. Master routes follow 0005: Visa VIEW reads, and the Visa HOD or the Head writes. Every
change is audited with `clientId`.

| Method and path | What |
| --- | --- |
| `GET /api/visa/cases/:caseNo` | Extended: trip details, each traveller's `ackNo` and `appointmentAt`, each paper's check, the vendor, the current file (name, size, pages, who and when), `fileReadyAt`/`By`, and the visa's two switches |
| `PATCH /api/visa/cases/:caseNo/trip` | `{ departOn?, returnOn?, entryType?, hotelStay? }` (Documents or File preparation) |
| `PATCH /api/visa/cases/:caseNo/travellers/:travellerId/application` | `{ ackNo?, appointmentAt? }` |
| `PATCH /api/visa/cases/:caseNo/documents/:documentId/check` | `{ check: "CHECKED" \| "NEEDS_REPLACING" \| null, reasonId? }` |
| `PUT /api/visa/cases/:caseNo/vendor` | `{ vendorId }` |
| `POST /api/visa/cases/:caseNo/files/final` | `multipart/form-data`, one PDF; 413 if too big, 400 if not a PDF |
| `GET /api/visa/cases/:caseNo/files/final/link` | `{ url, expiresAt }`: a pre-signed link to the current file |
| `POST /api/visa/cases/:caseNo/file-ready` | `{ updatedAt }`; `409 NOT_READY` with `details.missing` |
| `GET/POST/PATCH /api/masters/vendors` | The vendor master (`?active=true`, `?countryId=` for the case's picker) |
| `GET/POST/PATCH /api/masters/document-problem-reasons` | The reasons master |
| `PATCH /api/masters/visa-offerings/:id` | Gains `appointmentNeeded`, `vendorNeeded` |

## Tests (rule logic)

- **Who:**
  - the processor, the HOD and the Head may act on Step 3
  - other staff and view-only users may not
  - before a processor is assigned, only the HOD and the Head
- **Checking papers:**
  - Checked and Needs replacing stamp who and when
  - Needs replacing needs an active reason
  - Checked clears the reason
  - Not needed papers can't be checked
  - nothing changes after "File ready"
- **"File ready":** refused for each missing piece on its own, with the list naming it:
  - an unchecked paper
  - a paper that needs replacing
  - a missing acknowledgement number
  - a missing appointment
  - no PDF
  - no vendor
  - a missing trip detail (travelling out, coming back or the entry type)
  With **Appointment needed** or **Vendor needed** off, that piece is no longer asked for. Success moves the case to
  Docket & dispatch with the processor still owning it.
- **Vendors:**
  - only the Visa HOD and the Head write
  - duplicates (kind, name, city) are refused
  - a switched-off vendor, or one that doesn't cover the country, is refused on a case
  - a vendor switched off after being picked blocks "File ready"
  - a vendor that no longer covers the case's country blocks "File ready" too
- **The file:**
  - a non-PDF is refused
  - a file over the limit is refused
  - a second upload becomes current and the first is kept
  - the link is pre-signed and expires
  - no uploads after "File ready"
  Tests use the local MinIO with the bucket named in `.env.test`.
- **Races:** "File ready" and a change to a check take turns under the case lock, in both directions (like 0006's
  tests).
- **Trip details:** coming back before travelling out is refused.

## Not in this record

- **The covering letter:** fixed formats per process and family type, on the client's letterhead. Waiting for the
  formats (M13/Q10). *Since 19 Oct 2026: [0019](0019-covering-letters.md), built with sample formats.*
- **"Log in for me"** and the portal vault (§16.2, §12.19): a spike first.
- **Read passport scan, Fill from consent & trip details, Print application form:** scope unconfirmed (S6/Q13).
- **Step 4** (docket, sticker, invoice before dispatch, vendor email). It also decides what an e-visa (no vendor, no
  passports sent) does after "File ready": for 0008.
- **Hotel vendors,** which come with Hotels.
- **Uploading other scans** (the client document vault, Q37: not built). Where passport scans would go, if
  confirmed, is settled at the end of this record.

## Review outcome (12 Oct 2026, project lead)

The six points we proposed, and what was decided:

| | Proposal | Why we proposed it | Outcome |
| --- | --- | --- | --- |
| A | Trip details not required for "File ready" | Nothing reads them yet | **Changed: required.** Travelling out, coming back and the entry type must be in before "File ready", or processors will forget them and the covering letter will break later. Hotel stay stays optional. |
| B | Hotel stay is short text (name and city) | The forms need the real hotel, which no dropdown can list | Accepted |
| C | A vendor's email is optional for now | Step 4's dispatch email will make it required then | Accepted; **closed 14 Oct 2026:** required in the vendor master and the database |
| D | An appointment can't be in the past when entered | Catches typos; a past appointment means the date is wrong | Accepted |
| E | The PDF goes through our API, not straight to the bucket | No CORS setup, the same on MinIO/S3/R2, and the server checks the file | Accepted |
| F | The file can be replaced only during File preparation | After "File ready" it is what went to the vendor | Accepted |

## Settled after slice 2: the saved file stays one PDF; passport scans come later, per person (12 Oct 2026, project lead)

**The question.** With AI passport reading in mind (autofill, Q13), should the papers be uploaded one by one, one upload
per checklist line, with the server merging them into one PDF for the vendor, instead of one scanned PDF?

**Decided:**

- **Keep Decision 8 as built:** one scanned PDF per case. Don't build per-paper uploads.
- **If passport reading is confirmed,** add one separate, small upload: the passport's photo page, per person.

**Why:**

1. **Speed, and so adoption.** A processor drops the whole docket into the office scanner's auto-feeder and has one PDF
   in about a minute. Scanning, saving and uploading about 15 papers one by one, for every traveller, would make this
   the slowest step of the case. A strict system that is also slow gets worked around: the whole stack uploaded under
   the first checklist line, for example. That leaves neither speed nor structure.
2. **It is what was approved.** The meeting and demo screen 08 show one PDF, as Masti keeps today. Per-paper upload
   would be a scope change Vimal has to agree to, and possibly a paid change request.
3. **The structure already exists without images.** Every paper is ticked in Step 2, then checked or flagged with a
   reason in Step 3 (Decision 3). Reports read those fields, not scans of bank statements.
4. **Timing, the deciding point.** The final PDF is uploaded at the end of File preparation and already contains the
   printed application form. Autofill is needed *before* the form is filled. So the final PDF arrives too late to be
   the AI's input. They are two different jobs:

   | | The saved file (built) | A passport scan (later, if confirmed) |
   | --- | --- | --- |
   | What it is for | Proof of what went to the vendor | Input for autofill |
   | When | The end of File preparation | When the passport arrives (Step 2) |
   | What | The whole docket | The photo page only |
   | Belongs to | The case | The person: a passport lasts up to 10 years and is reused on the next trip |

5. **Not "AI finds the passport inside the PDF".** Searching a 30–50-page scan for the passport pages works too late
   (point 4), costs more per call, and is less reliable on scanner-quality pages.

**17 Oct 2026:** the vault is confirmed and goes further than below: every paper, not just the passport's photo page,
kept on the client per family member. See [0016](0016-client-documents.md). The saved file is unchanged.

**If passport reading (Q13) or the document vault (Q37) is confirmed:**

- **One extra scan per traveller:** the passport's photo page, captured when the passport arrives in Step 2. That is one
  page on the scanner, or a phone photo, about 10 seconds.
- **Kept on the person** (the client's family member), not the case, so the next trip reuses it while the passport is
  valid.
- **It reuses slice 2's storage:** `src/lib/storage.ts`, private short-lived links, the audit of every opening, and the
  file checks. The saved file needs no rework. The exact table (a member-level file) is designed then.

**Before anyone builds it:**

- **Vimal's yes:** Q13 and Q37 are unconfirmed scope, and possibly a change request.
- **A data-protection decision** (India's Digital Personal Data Protection Act, 2023): how long passport images are
  kept, who may open them, and how they are removed on request. Aadhaar numbers stay unstored.

**What changed now:** nothing in the code.
