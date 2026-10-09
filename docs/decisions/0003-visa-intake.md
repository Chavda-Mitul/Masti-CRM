# 0003 · Visa Step 1 (Intake): data model and API

- **Status:** accepted and **refreshed 9 Oct 2026** (project lead), then built (9 Oct 2026). The *Refresh* section below says what changed from the proposal; where it disagrees with the rest of this record, the refresh wins. The rest is kept for the record.
- **Date:** 8 Oct 2026 (proposed), 9 Oct 2026 (refreshed and built)
- **Scope:** the New enquiry form for Visa (demo screen 05), the All enquiries list (demo screens 02/03) and the Step 1 data of a case. The Step 1 case page (demo screen 06) comes next.

## Refresh (9 Oct 2026)

Since this record was proposed, the client master ([0004](0004-client-master.md)) and the visa masters ([0005](0005-system-masters.md)) were built, and the project lead decided on 9 Oct to **build the form by hand, without messaging, for now**.

| As proposed below | Refreshed and built |
| --- | --- |
| Proposes `Client`, `Country`, `VisaType`, `VisaOffering`, `DocumentMaster`, `VisaChecklistItem` | Uses the built models (0004, 0005). |
| `FeeHead`, `VisaFee` seeded with intake | **Dropped.** Price breakups are designed with the quote/invoice model (as 0005 §7 says). |
| `MessageTemplate`, `OutboundMessage`, the preview endpoint, "Save and send document list" | **Deferred** to the WhatsApp provider work (M2). Saving writes the case only; the button says **"Save enquiry"** and the toast "Enquiry VISA-2026-0001 saved for …", so staff aren't told something was sent when it wasn't. For the same reason step 1's status label is seeded as **"Enquiry saved"**, not "Document list sent". All three go back to the demo wording when the outbox is built. |
| `visa.documentReminders`, `VisaCase.remindersOn` / `nextReminderAt` | **Deferred** with messaging. Only `visa.firstFollowUp` is built, because `Enquiry.dueAt` drives the list. |
| Follow-up due "tomorrow 11:00" | Today + `afterDays`, then moved to the next day the office is open (`nextOpenDay()` with the `MASTI_OFFICE` holidays, so the seeded Sunday off counts; embassy-only holidays don't). Otherwise Monday would open with Saturday's enquiries already late. |
| `VisaCaseDocument` copies the name and requirement | Also copies `detail`, `quantity` and `note` (0005 added the last two to checklist lines). |
| Owner picker, `GET /api/visa/assignees` | Not built. The owner is the person saving; reassigning comes with the enquiry actions. |
| The enquiries list "not in Step 1" | **Built:** `GET /api/enquiries` and the All enquiries screen. |
| `EnquirySource` seeded only | Also an admin list: `GET/POST/PATCH /api/masters/enquiry-sources`, Settings → Masters → Lists → Enquiry sources. The Head or the Visa HOD edits it until another department's intake exists. |
| Client lookup with `openEnquiries` | Uses the built `lookupByMobile` (main and extra numbers). Intake attaches to the client whose main number it is, else the earliest client with it as an extra number, else creates one. `openEnquiries` are that client's `OPEN` and `POSTPONED` cases in the departments the user can view; the form warns but doesn't block. **Since 9 Oct 2026 the form also asks for the client's name** (`clientName`) when the number is new or the matched client has none, and refuses to save without it; it never overwrites an existing name (0004 *Amendment*). |
| Offerings for intake | Only active offerings **that have a checklist**: intake copies the checklist, so an empty one would make a case with nothing to collect. Saving one without a checklist is refused (400). |
| Travel month required, date optional (review point 2) | Confirmed. The exact date also can't be in the past. |
| "What do they want?" | Only Visa can be picked; the other departments are shown with "Soon". **How one enquiry for several services splits across departments is still open** (§10.2). |

**Built (9 Oct 2026):**
- **Code:** `Backend/src/modules/enquiries/` (the list, staff sources, the seed of sources and visa steps), `Backend/src/modules/visa/` (intake offerings, `createVisaEnquiry`, the case DTO, `visa.firstFollowUp`), `findOrCreateClientByMobile` in `clients.service.ts`, and the sources CRUD in `visaMasters`.
- **Migration:** `20261009120000_visa_intake`. It backfills `Department.casePrefix` (VISA, HOL, HOT, INS, TKT, ACC) and adds checks: travel month is the 1st, the travel date falls in that month, and code and prefix formats.
- **Tests:** `tests/visaIntake.test.ts` and `tests/enquiries.test.ts`. They cover case numbers under concurrent saves and across the year boundary, idempotency, client matching, the checklist copy surviving master edits, follow-up timing, validation, and permissions and department scoping on the list.
- **Screens:** `Frontend/src/pages/enquiries/` (`NewEnquiryPage`, `EnquiriesPage`), the sidebar's Enquiries links and "+ New enquiry", and "New enquiry for {name}" on a client's profile.
- **A concurrent-save detail:** two saves for the same *new* mobile race to create the client. The loser's transaction fails on `Client.mobile`, and the service retries once, by which time the client exists. A failed save rolls back its case-number bump too.

**API as built** (all under `requireAuth → requirePasswordChanged → requireUserType("HEAD","OFFICE")`):

| Method + path | Guard | Purpose |
| --- | --- | --- |
| `GET /api/enquiries?department=&mine=&q=&status=&cursor=&limit=` | departments the caller can VIEW (403 for one they can't) | `{ enquiries, nextCursor, departments: [{ code, name, count, flows: [{ code, stages }] }], lateCount }` (each row's `stage.flow` picks its flow; `step`/`of` count within it). Ordered by `dueAt` (nulls last), then `createdAt`, then id. `cursor` is opaque (the last row's sort values, base64url): Prisma's own cursor can't page a nullable sort key with a LIMIT, so the keyset condition is hand-written. `q` matches the case number, the client's name, or any part of the client's main or extra mobile. `status` defaults to OPEN. |
| `GET /api/enquiries/sources` | — | Active, staff-selectable sources |
| `GET /api/visa/offerings` | Visa VIEW | `{ countries: [{ id, code, name, zone, label, visaTypes: [{ offeringId, id, code, name }] }] }` |
| `POST /api/visa/cases` | Visa EDIT | Body `{ mobile, sourceCode, offeringId, adults, children, travelMonth, travelDate }`, optional `Idempotency-Key`. Returns `201 { case, clientCreated }`, or `200` for a repeated key. |
| `GET /api/visa/cases/:caseNo` | Visa VIEW | `{ case }`: the DTO below without `messages` and `reminders` (and without `client.isNew`; the POST returns `clientCreated` instead) |
| `GET /api/visa/settings` · `PUT` | Visa VIEW · Visa HOD or Head | `{ settings: { firstFollowUp: { afterDays, at } } }`, audited as `setting.update` |
| `GET/POST/PATCH /api/masters/enquiry-sources` | Visa VIEW · Visa HOD or Head | The sources master; codes never change |

**Still open:** M4 (who owns a visa query before it matures, review point 3), the multi-service split, the WhatsApp wording (M1/Q8) and provider (M2), and the consent flag ("Anyone without a consent form on file is flagged"), which comes with Step 2's consent model.

## Context

The demo's intake asks for only a few things: the mobile number, the source, the country, the visa type, adults and children. Saving it:
- finds or creates the client by mobile
- sends the document list and the price per person on WhatsApp
- starts reminders and schedules the first follow-up

Answers from 8 Oct 2026 (PROJECT_KNOWLEDGE.md §17, §18) that shape this design:

| Ref | Decision |
|---|---|
| M9 | The written doc's "time" field is the **travel month/date**, captured at intake. |
| M1 | WhatsApp wording comes later. Use **placeholder text** for now. |
| M5 | Reminder frequency is a **setting the admin changes**, not a constant. |
| M4 | Follow-up is done by **the Visa employee assigned to the case**. |
| §17 #21 | Case numbers look like `VISA-2026-0001`. The prefix comes from the department, not from code. |
| M18 | No automatic email capture. Later, enquiries also arrive from a **WhatsApp bot** and **website forms**. |
| M17 | Old clients are imported from Excel later, by a separate job. |
| B1, B4 | A **document master**: picking country + visa type fills the checklist automatically. Seeded with dummy France Tourist data. |
| — | The AI "Fill in from a message" button is skipped for now. |

## Decision

### 1. A shared `Enquiry` row, with `VisaCase` as its visa part

Every department needs the same things on an enquiry:
- case number, client, source, stage, status, owner and due time
- a place on the all-department enquiries list (§12.2)
- a place on Today and on the follow-up desk

So each case has one `Enquiry` row, and visa-only fields live in `VisaCase` (1:1, sharing the id). The alternative is one table per department with those columns repeated, which would make the all-department list a 6-way UNION. Holidays, Hotels and the other departments each add their own 1:1 table in Stage 2.

### 2. Stages are data, statuses are an enum

- `DepartmentStage` holds the steps per department **and flow** (added 9 Oct 2026, migration `20261009140000_department_stage_flow`): Visa has one flow, `VISA`; Insurance will run `INSURANCE_POLICY` (4 steps) and `INSURANCE_CLAIM` (7), §10.2. Steps are unique per department + flow, and "step 2 of 7" counts the flow only.
- For Visa it holds the 8 visa steps and their labels ("Enquiry saved" until messaging is built, then the demo's "Document list sent"; "Start collecting documents"). The labels are demo wording ⚠️, so they are editable.
- `EnquiryStatus` (open / postponed / cancelled / lost / closed) is an enum. Code branches on it, the same reasoning as `UserType`.
- The *reasons* for postponing or cancelling will be a master table when that feature is built.

### 3. The checklist is copied onto the case, not linked

At intake, the rows of `VisaChecklistItem` for the chosen country + visa type are **copied** onto each traveller as `VisaCaseDocument` rows. Editing the master later doesn't change open cases. This is the same idea as "covering letters are effective-dated" (§10.12).
- Children get the items marked `ALL` or `CHILDREN`; adults get `ALL` or `ADULTS`. That is how child alternatives work: bank statement (adults) vs birth certificate (children). A document children don't need (salary slips) is just marked `ADULTS`.
- Travellers are created as placeholders ("Adult 1", "Child 1") because names are only taken in Step 2.

### 4. Case numbers

`{casePrefix}-{YYYY}-{NNNN}`:
- `casePrefix` is a new column on `Department`, seeded `VISA`. Holidays could use `HOL`.
- `YYYY` is the calendar year in IST when the enquiry was created.
- `NNNN` counts up per department per year, resets on 1 Jan, and grows to 5 digits past 9999.

The counter is a `CaseCounter` row incremented in the **same transaction** as the enquiry insert (`INSERT … ON CONFLICT DO UPDATE … RETURNING`). Two staff saving at once never get the same number, and a failed save doesn't burn a number.

### 5. Ready for the WhatsApp bot and website forms

- `Enquiry.origin` records *what* created the row: `STAFF`, `WHATSAPP_BOT`, `WEBSITE_FORM`, `CROSS_SELL` or `IMPORT`.
- `Enquiry.sourceId` records *how the client reached us*, from the `EnquirySource` master. Sources with `staffSelectable = false` (e.g. "Website form") are set only by integrations.
- `Enquiry.createdById` and `ownerId` are nullable. A bot enquiry has no creator and may wait unassigned.
- `Enquiry.idempotencyKey` is unique. A bot retry, or a double-clicked Save, returns the same case instead of creating a second one.
- The intake logic lives in `visaIntake.service.ts` as `createVisaEnquiry(input, origin)`. Later, `POST /api/inbound/whatsapp` and `POST /api/inbound/website` call the same function.

### 6. Messages go through an outbox

Saving the enquiry inserts an `OutboundMessage` row (status `QUEUED`) in the same transaction. A separate sender delivers it later.
- Intake never waits on WhatsApp.
- A failed send can be retried without resending to the client (`idempotencyKey`).
- The log is the "Sent to the client" panel (screen 06).

The BSP (WhatsApp provider) and the job runner are not chosen yet (§16.3 #4, §10.9). Until they are, rows stay `QUEUED`. `MessageTemplate.body` holds placeholder wording, and `providerTemplateName` is filled once Meta approves the real template.

### 7. Reminder and follow-up timing are settings

Two rows in the existing `Setting` table, validated with zod like `officeNetwork`:

| Key | Seeded value (demo ⚠️) |
|---|---|
| `visa.documentReminders` | `{ "enabled": true, "everyDays": 2, "sendAt": "11:00", "channel": "WHATSAPP" }` |
| `visa.firstFollowUp` | `{ "afterDays": 1, "at": "11:00" }` |

At intake the service sets:
- `Enquiry.dueAt`: the next follow-up, e.g. tomorrow 11:00 IST
- `VisaCase.nextReminderAt`: the first reminder, e.g. in 2 days at 11:00 IST

Actually sending reminders is the job runner's work, which isn't part of Step 1.

### 8. Owner

`ownerId` is "Whose job it is now" (M4): the Visa employee who follows up the case.
- It defaults to the staff member saving the enquiry; they may pick someone else.
- The owner must be an active office user with Visa EDIT access, or the Head.
- Reassigning comes with the enquiries list.

### 9. Fees

The document-list message quotes the price per person (embassy fee, VFS, service, courier). So `VisaFee` (country + type → fee head → amount, adults/children) is seeded with the checklist. Money is integer paise.
- Fees are **not** copied onto the case in Step 1. The rendered message stores exactly what the client was told.
- The quote → invoice snapshot is designed with Step 4 (invoice), across departments, so invoices keep coming from one quote model (rule 3).

## Proposed Prisma schema

Additions to `Backend/prisma/schema.prisma`. Existing models change only where marked.

```prisma
// ---------------------------------------------------------------------------
// Departments (changed)
// ---------------------------------------------------------------------------

model Department {
  // …existing fields…
  /// Case numbers: {casePrefix}-{YYYY}-{NNNN}. Seeded from the code (VISA); editable.
  casePrefix   String            @unique
  stages       DepartmentStage[]
  enquiries    Enquiry[]
  caseCounters CaseCounter[]
}

/// A department's steps, in order. Labels are demo wording, so they live here, not in code.
model DepartmentStage {
  id            Int        @id @default(autoincrement())
  departmentId  Int
  /// Stable key the code uses, e.g. "ENQUIRY", "DOCUMENTS".
  code          String
  name          String     /// "Enquiry"
  sortOrder     Int        /// 1…8
  statusLabel   String     /// "Document list sent"
  nextStepLabel String     /// "Start collecting documents"
  department    Department @relation(fields: [departmentId], references: [id], onDelete: Restrict)
  enquiries     Enquiry[]

  @@unique([departmentId, code])
  @@unique([departmentId, sortOrder])
}

/// The last case number used, per department per year.
model CaseCounter {
  departmentId Int
  year         Int
  lastValue    Int        @default(0)
  department   Department @relation(fields: [departmentId], references: [id], onDelete: Restrict)

  @@id([departmentId, year])
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

/// Saved against the mobile number: an enquiry needs only that.
/// Completed (name, email, accounting code, billing cycle, family) before invoicing, in the Clients module.
model Client {
  id          String    @id @default(uuid())
  /// +91XXXXXXXXXX, normalised like User.mobile. The lookup key, and the match key for the Excel import.
  mobile      String    @unique
  name        String?
  email       String?
  createdAt   DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime  @updatedAt @db.Timestamptz(3)
  /// Null when created by the WhatsApp bot, a website form or the import.
  createdById String?
  createdBy   User?     @relation("ClientCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)
  enquiries   Enquiry[]
  messages    OutboundMessage[]
}

// ---------------------------------------------------------------------------
// Enquiries (shared by every department)
// ---------------------------------------------------------------------------

enum EnquiryStatus {
  OPEN
  POSTPONED
  CANCELLED
  LOST
  CLOSED
}

/// What created the row. Not the same as the source (how the client reached us).
enum EnquiryOrigin {
  STAFF
  WHATSAPP_BOT
  WEBSITE_FORM
  CROSS_SELL
  IMPORT
}

/// "Came in through". Master data.
model EnquirySource {
  id              Int       @id @default(autoincrement())
  code            String    @unique   /// WHATSAPP, LANDLINE, MOBILE, SOCIAL_MEDIA, EMAIL, WEBSITE_FORM…
  name            String
  sortOrder       Int       @default(0)
  isActive        Boolean   @default(true)
  /// False for sources only integrations set (e.g. WEBSITE_FORM); hidden on the staff form.
  staffSelectable Boolean   @default(true)
  enquiries       Enquiry[]
}

model Enquiry {
  id             String        @id @default(uuid())
  /// e.g. VISA-2026-0001. Never changes once issued.
  caseNo         String        @unique
  departmentId   Int
  clientId       String
  sourceId       Int
  origin         EnquiryOrigin @default(STAFF)
  /// Repeat requests with the same key return this enquiry instead of creating another.
  idempotencyKey String?       @unique
  stageId        Int
  status         EnquiryStatus @default(OPEN)
  /// "Whose job it is now". Null = not assigned yet (e.g. a bot enquiry).
  ownerId        String?
  /// When someone must next act on it (drives Today, the follow-up desk and "running late").
  dueAt          DateTime?     @db.Timestamptz(3)
  createdById    String?
  createdAt      DateTime      @default(now()) @db.Timestamptz(3)
  updatedAt      DateTime      @updatedAt @db.Timestamptz(3)

  department     Department      @relation(fields: [departmentId], references: [id], onDelete: Restrict)
  client         Client          @relation(fields: [clientId], references: [id], onDelete: Restrict)
  source         EnquirySource   @relation(fields: [sourceId], references: [id], onDelete: Restrict)
  stage          DepartmentStage @relation(fields: [stageId], references: [id], onDelete: Restrict)
  owner          User?           @relation("EnquiryOwner", fields: [ownerId], references: [id], onDelete: Restrict)
  createdBy      User?           @relation("EnquiryCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)
  visa           VisaCase?
  messages       OutboundMessage[]

  @@index([departmentId, status, dueAt])
  @@index([ownerId, status, dueAt])
  @@index([clientId])
}

// ---------------------------------------------------------------------------
// Visa masters (admin-edited in Settings → Masters; seeded with dummy data for now)
// ---------------------------------------------------------------------------

model Country {
  id        Int            @id @default(autoincrement())
  /// ISO 3166-1 alpha-2, e.g. "FR".
  code      String         @unique
  name      String         /// "France"
  /// Shown in brackets: "France (Schengen)".
  zone      String?
  sortOrder Int            @default(0)
  isActive  Boolean        @default(true)
  offerings VisaOffering[]
}

model VisaType {
  id        Int            @id @default(autoincrement())
  code      String         @unique   /// TOURIST, BUSINESS, STUDENT…
  name      String
  sortOrder Int            @default(0)
  isActive  Boolean        @default(true)
  offerings VisaOffering[]
}

/// A visa we process: country × visa type. The checklist and fees hang off it.
model VisaOffering {
  id         Int                 @id @default(autoincrement())
  countryId  Int
  visaTypeId Int
  isActive   Boolean             @default(true)
  country    Country             @relation(fields: [countryId], references: [id], onDelete: Restrict)
  visaType   VisaType            @relation(fields: [visaTypeId], references: [id], onDelete: Restrict)
  checklist  VisaChecklistItem[]
  fees       VisaFee[]
  cases      VisaCase[]

  @@unique([countryId, visaTypeId])
}

/// The document master: every document a checklist can ask for.
model DocumentMaster {
  id             Int                 @id @default(autoincrement())
  code           String              @unique   /// PASSPORT, OLD_PASSPORTS, BANK_STATEMENT_6M…
  name           String              /// "Bank statement, last 6 months"
  /// Extra detail shown to the client, e.g. "35×45 mm, white background".
  detail         String?
  sortOrder      Int                 @default(0)
  isActive       Boolean             @default(true)
  checklistItems VisaChecklistItem[]
  caseDocuments  VisaCaseDocument[]
}

/// What we need. Code branches on it (Original/Xerox toggle, "Made" for things we arrange), so an enum.
enum DocumentRequirement {
  ORIGINAL
  XEROX_OK
  ARRANGED_BY_US
}

/// Which travellers a checklist item or fee applies to.
enum TravellerGroup {
  ALL
  ADULTS
  CHILDREN
}

/// One line of a country × visa type checklist.
model VisaChecklistItem {
  id          Int                 @id @default(autoincrement())
  offeringId  Int
  documentId  Int
  requirement DocumentRequirement
  appliesTo   TravellerGroup      @default(ALL)
  sortOrder   Int                 @default(0)
  offering    VisaOffering        @relation(fields: [offeringId], references: [id], onDelete: Cascade)
  document    DocumentMaster      @relation(fields: [documentId], references: [id], onDelete: Restrict)

  @@unique([offeringId, documentId, appliesTo])
}

/// Price breakup heads: Embassy fee, VFS, Service, Courier. Master data.
model FeeHead {
  id        Int       @id @default(autoincrement())
  code      String    @unique
  name      String
  sortOrder Int       @default(0)
  isActive  Boolean   @default(true)
  fees      VisaFee[]
}

/// Price per person for an offering. Integer paise, never floats.
model VisaFee {
  id          Int            @id @default(autoincrement())
  offeringId  Int
  feeHeadId   Int
  appliesTo   TravellerGroup @default(ALL)
  amountPaise Int
  offering    VisaOffering   @relation(fields: [offeringId], references: [id], onDelete: Cascade)
  feeHead     FeeHead        @relation(fields: [feeHeadId], references: [id], onDelete: Restrict)

  @@unique([offeringId, feeHeadId, appliesTo])
}

// ---------------------------------------------------------------------------
// Visa cases
// ---------------------------------------------------------------------------

/// The visa part of an Enquiry (same id). Traveller counts come from VisaCaseTraveller rows.
model VisaCase {
  enquiryId      String              @id
  offeringId     Int
  /// The month they plan to travel (stored as the 1st of the month). Captured at intake (M9).
  travelMonth    DateTime            @db.Date
  /// The exact date, if the client knows it at intake. Must fall in travelMonth.
  travelDate     DateTime?           @db.Date
  remindersOn    Boolean             @default(true)
  /// When the next pending-document reminder is due. Set from the visa.documentReminders setting.
  nextReminderAt DateTime?           @db.Timestamptz(3)
  enquiry        Enquiry             @relation(fields: [enquiryId], references: [id], onDelete: Restrict)
  offering       VisaOffering        @relation(fields: [offeringId], references: [id], onDelete: Restrict)
  travellers     VisaCaseTraveller[]
}

/// One person on the case. Created as placeholders at intake; named in Step 2.
/// Step 2 adds a link to the client's family member (for passport validity and consent).
model VisaCaseTraveller {
  id        String             @id @default(uuid())
  caseId    String
  /// 1, 2, 3… Adults first, then children. Used for "Adult 1" / "Child 1" until named.
  position  Int
  isChild   Boolean
  /// Passport name. Filled in Step 2.
  name      String?
  visaCase  VisaCase           @relation(fields: [caseId], references: [enquiryId], onDelete: Restrict)
  documents VisaCaseDocument[]

  @@unique([caseId, position])
}

enum DocumentStatus {
  PENDING
  RECEIVED
  /// For ARRANGED_BY_US items.
  MADE
  NOT_NEEDED
}

enum ReceivedAs {
  ORIGINAL
  XEROX
}

/// A traveller's copy of a checklist line. Name and requirement are copied so master edits don't change open cases.
model VisaCaseDocument {
  id           String              @id @default(uuid())
  travellerId  String
  /// Kept for reports ("which document is pending most often").
  documentId   Int
  name         String
  requirement  DocumentRequirement
  sortOrder    Int
  status       DocumentStatus      @default(PENDING)
  // Filled in Step 2, when the paper is scanned in the office:
  receivedAs   ReceivedAs?
  receivedAt   DateTime?           @db.Timestamptz(3)
  receivedById String?
  traveller    VisaCaseTraveller   @relation(fields: [travellerId], references: [id], onDelete: Restrict)
  document     DocumentMaster      @relation(fields: [documentId], references: [id], onDelete: Restrict)
  receivedBy   User?               @relation("DocumentReceivedBy", fields: [receivedById], references: [id], onDelete: Restrict)

  @@unique([travellerId, documentId])
}

// ---------------------------------------------------------------------------
// Outbound messages (transactional outbox)
// ---------------------------------------------------------------------------

enum MessageChannel {
  WHATSAPP
  SMS
  EMAIL
}

enum MessageStatus {
  QUEUED
  SENT
  DELIVERED
  READ
  FAILED
  /// Not sent on purpose (e.g. the template is switched off).
  SKIPPED
}

/// One automatic message. Body is placeholder wording until Masti approves the real text (Q8).
model MessageTemplate {
  id                   Int               @id @default(autoincrement())
  /// Stable key the code uses: "visa.document_list".
  code                 String            @unique
  channel              MessageChannel
  name                 String            /// "Visa — document list"
  /// With {{variables}}, e.g. {{country}}, {{documentList}}, {{feeList}}.
  body                 String
  /// The Meta-approved template name, once approved.
  providerTemplateName String?
  isActive             Boolean           @default(true)
  messages             OutboundMessage[]
}

model OutboundMessage {
  id                String         @id @default(uuid())
  templateId        Int
  channel           MessageChannel
  toMobile          String
  clientId          String?
  enquiryId         String?
  variables         Json
  /// The text as rendered at the time: the record of what the client was told.
  body              String
  status            MessageStatus  @default(QUEUED)
  /// e.g. "visa.document_list:<enquiryId>". Retries never double-send.
  idempotencyKey    String         @unique
  providerMessageId String?
  error             String?
  createdAt         DateTime       @default(now()) @db.Timestamptz(3)
  sentAt            DateTime?      @db.Timestamptz(3)
  template          MessageTemplate @relation(fields: [templateId], references: [id], onDelete: Restrict)
  client            Client?         @relation(fields: [clientId], references: [id], onDelete: Restrict)
  enquiry           Enquiry?        @relation(fields: [enquiryId], references: [id], onDelete: Restrict)

  @@index([status, createdAt])
  @@index([enquiryId])
}
```

`User` gains the back-relations: `ownedEnquiries`, `createdEnquiries`, `createdClients`, `receivedDocuments`.

**Seed (dummy, replaced when Masti sends B1/B4):**
- the 8 visa stages with the demo labels
- the sources: WhatsApp, Landline, Mobile, Social media, Email, plus Website form and WhatsApp bot with `staffSelectable = false`
- France (Schengen) × Tourist with the demo's 11 documents and the child alternatives
- the fee heads Embassy fee, VFS, Service and Courier with dummy amounts
- the `visa.document_list` template with placeholder text
- the two settings

## API (Step 1)

New modules: `modules/clients/`, `modules/enquiries/` (sources), `modules/visa/`. All routes follow CLAUDE.md: `requireAuth` → `requirePasswordChanged` → department check. Errors use the existing shape (`{ message }`, zod → `{ message, issues }`).

| Method + path | Guard | Purpose |
|---|---|---|
| `GET /api/clients/lookup?mobile=` | `requireUserType("HEAD","OFFICE")` | "Existing client" check while typing the mobile |
| `GET /api/enquiry-sources` | `requireUserType("HEAD","OFFICE")` | The "Came in through" chips |
| `GET /api/visa/offerings` | `VISA` VIEW | Country and visa-type dropdowns |
| `GET /api/visa/offerings/:id/preview?adults=&children=` | `VISA` VIEW | The "WhatsApp preview" panel before saving |
| `GET /api/visa/assignees` | `VISA` EDIT | Who can own a visa case |
| `POST /api/visa/cases` | `VISA` EDIT | **Save and send document list** |
| `GET /api/visa/cases/:caseNo` | `VISA` VIEW | The case header + Step 1 view |
| `GET /api/visa/settings` | `VISA` VIEW | Reminder and follow-up timing |
| `PUT /api/visa/settings` | `VISA` EDIT + `isHodOf("VISA")` (Head passes) | Change them |

### `GET /api/clients/lookup?mobile=98250%2041234`

```json
200 {
  "mobile": "+919825041234",
  "client": { "id": "…", "name": "Rakesh Mehta", "mobile": "+919825041234", "email": null },
  "openEnquiries": [{ "caseNo": "VISA-2026-0004", "department": "VISA", "summary": "France (Schengen) · Tourist", "stage": "Documents" }]
}
```
`client` is `null` for a new number. `openEnquiries` lets staff spot an existing case before making a duplicate. It warns but doesn't block, since a family can plan two trips. A bad number gives `400 "Enter a valid 10-digit Indian mobile number."`.

### `GET /api/visa/offerings`

```json
200 { "countries": [
  { "id": 1, "code": "FR", "name": "France", "zone": "Schengen",
    "visaTypes": [{ "offeringId": 1, "id": 1, "code": "TOURIST", "name": "Tourist" }] }
] }
```
Only active countries, types and offerings, sorted by `sortOrder`.

### `GET /api/visa/offerings/1/preview?adults=2&children=2`

```json
200 {
  "documents": {
    "adults":   [{ "documentId": 3, "name": "Bank statement, last 6 months", "detail": null, "requirement": "XEROX_OK" }],
    "children": [{ "documentId": 9, "name": "Birth certificate", "detail": null, "requirement": "XEROX_OK" }]
  },
  "feesPerPerson": {
    "adult": [{ "head": "Embassy fee", "amountPaise": 0 }],
    "child": [{ "head": "Embassy fee", "amountPaise": 0 }]
  },
  "message": { "template": "visa.document_list", "channel": "WHATSAPP", "body": "…rendered placeholder text…" }
}
```
The same function renders the real message at save time, so the preview and the sent text can't drift apart.

### `GET /api/visa/assignees`

```json
200 { "users": [{ "id": "…", "name": "Aarti Patel" }] }
```
Active OFFICE users with Visa EDIT access (HODs included), plus the Head.

### `POST /api/visa/cases`: Save and send document list

Optional header `Idempotency-Key: <uuid>`. The frontend sends a new one each time the form opens.

```json
{
  "mobile": "98250 41234",
  "sourceCode": "WHATSAPP",
  "offeringId": 1,
  "adults": 2,
  "children": 2,
  "travelMonth": "2026-12",
  "travelDate": null,
  "ownerId": null
}
```

| Field | Rule |
|---|---|
| `mobile` | Required. Normalised to `+91XXXXXXXXXX`. |
| `sourceCode` | Required. An active, staff-selectable source. |
| `offeringId` | Required. An active offering (active country + type). |
| `adults` | Integer, 1–30 |
| `children` | Integer, 0–30 (a sanity limit, not a business rule) |
| `travelMonth` | Required, `YYYY-MM`, not before the current month (IST) |
| `travelDate` | Optional, `YYYY-MM-DD`, must fall in `travelMonth` |
| `ownerId` | Optional. Defaults to the caller; must be a valid assignee (above) |

**In one transaction:**
1. Find the client by mobile, or create it. A new client is audited as `client.create`.
2. Take the next case number from `CaseCounter`.
3. Insert the `Enquiry` (stage ENQUIRY, status OPEN, `dueAt` from `visa.firstFollowUp`) and the `VisaCase` (`nextReminderAt` from `visa.documentReminders` if reminders are enabled).
4. Insert placeholder travellers, and copy the checklist onto each one.
5. Queue the `visa.document_list` message (rendered body + variables).
6. Audit `visa.case.create` with the case snapshot.

**Responses:**
- `201 { "case": VisaCaseDto }`
- `200 { "case": VisaCaseDto }` when the `Idempotency-Key` was already used (nothing new is created)
- `400` for validation errors, an inactive offering or source, or an invalid owner
- `403` without Visa EDIT

### `GET /api/visa/cases/:caseNo` → `200 { "case": VisaCaseDto }`

`404` if the number doesn't exist. The same DTO is returned by the POST:

```json
{
  "id": "…",
  "caseNo": "VISA-2026-0001",
  "status": "OPEN",
  "stage": { "code": "ENQUIRY", "step": 1, "of": 8, "name": "Enquiry",
             "statusLabel": "Enquiry saved", "nextStepLabel": "Start collecting documents" },
  "client": { "id": "…", "name": null, "mobile": "+919825041234", "isNew": true },
  "source": { "code": "WHATSAPP", "name": "WhatsApp" },
  "origin": "STAFF",
  "country": { "id": 1, "name": "France", "zone": "Schengen" },
  "visaType": { "id": 1, "name": "Tourist" },
  "adults": 2,
  "children": 2,
  "travelMonth": "2026-12",
  "travelDate": null,
  "owner": { "id": "…", "name": "Aarti Patel" },
  "dueAt": "2026-10-09T05:30:00.000Z",
  "reminders": { "on": true, "nextAt": "2026-10-10T05:30:00.000Z" },
  "travellers": [
    { "id": "…", "position": 1, "label": "Adult 1", "isChild": false, "name": null,
      "documents": [{ "id": "…", "name": "Passport", "requirement": "ORIGINAL", "status": "PENDING" }],
      "pendingCount": 11 }
  ],
  "messages": [{ "template": "visa.document_list", "channel": "WHATSAPP", "status": "QUEUED", "createdAt": "…" }],
  "createdBy": { "id": "…", "name": "Aarti Patel" },
  "createdAt": "2026-10-08T09:44:00.000Z"
}
```
`isNew` is true when this enquiry created the client. Times are UTC; the frontend shows IST.

### `GET/PUT /api/visa/settings`

```json
{
  "documentReminders": { "enabled": true, "everyDays": 2, "sendAt": "11:00", "channel": "WHATSAPP" },
  "firstFollowUp": { "afterDays": 1, "at": "11:00" }
}
```
`everyDays` is 1–30, `afterDays` 0–30, times are `HH:mm` in IST, and `channel` is WHATSAPP or SMS. A `PUT` writes `setting.update` to the audit log with before/after. A change applies to reminders scheduled after it; open cases keep their next date.

## Not in Step 1

- Admin screens for the masters (Settings → Masters, §12.20). Step 1 seeds them.
- The enquiries list, the visa board, reassigning and postpone/cancel.
- Step 2: naming travellers, ticking documents, linking family members, consent.
- Sending messages and reminders: needs the WhatsApp provider (M2, §16.3 #4) and the job runner (pg-boss is the suggestion in §16.5).
- The other services on "What do they want?" (Holiday, Hotel…): shown disabled until their departments are built.
- The AI fill-in, the Excel client import, and the inbound bot/website endpoints. The design leaves room for each.

## Points to review

1. **Shared `Enquiry` + `VisaCase`** rather than a standalone `VisaCase`. This is the biggest choice here; see Decision 1.
2. **Travel month required, exact date optional.** If staff often don't know the month at first contact, make it optional.
3. **M4 differs from the meeting and the demo.** In the meeting Vimal said a visa query stays in a common follow-up pool with no named handler until it matures (6:48 PM). The demo shows the follow-up desk handing over to processing. This design supports both, since the owner can change at maturity, but please confirm M4 with Vimal in writing.
4. **Fees seeded now, but not copied onto the case** until the quote/invoice design (Step 4).
5. **Case-number year:** calendar year, as asked. Invoices will need the financial year (Apr–Mar) for GST, so the two series will differ.
