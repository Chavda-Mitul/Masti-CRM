# 0005 · System masters: holiday calendar and visa document master

- **Status:** accepted (8 Oct 2026, project lead; all seven review points confirmed below), built (8 Oct 2026), and **amended 9 Oct 2026**: machine accounts and all AI-bot support were removed (see *Amendment* below). What changed while building is listed under *Built*, at the end.
- **Date:** 8 Oct 2026
- **Scope:** two of the System Masters on Settings → *Masters & holiday calendar* (demo screen 29): the **holiday calendar** and the **visa document master** (documents and country × visa type checklists). Reminder rules, vendors, dropdown reasons and the other masters come in later records.
- **Changes:** takes over the visa master tables proposed in [0003](0003-visa-intake.md) (`Country`, `VisaType`, `VisaOffering`, `DocumentMaster`, `VisaChecklistItem`), which aren't built. The changes are listed in Decision 7. 0003's intake contract (`GET /api/visa/offerings`, the checklist copy at intake) still holds.

## Amendment (9 Oct 2026, project lead)

Machine accounts and **all AI-bot support were removed**, in the backend and the screens. The holiday calendar is **staff-entered only**. A future bot needs its own design and a new decision record.

**Removed:**
- **Machine accounts:** `ApiClient`, `ApiScope`, `/api/api-clients`, `requireApiClient` and `AuditLog.apiClientId`.
- **The bot endpoint:** `/api/inbound/holidays`.
- **Bot fields on `Holiday`:** `source` (`HolidaySource`), `externalKey`, `apiClientId`, `reviewedById` and `reviewedAt`.
- **The review flow:** the `PENDING` status, Confirm (`POST /api/holidays/:id/confirm`) and the `holidays.botEntriesNeedReview` setting (the setting is now `{ newForDays }`).
- **The screens:** the Machine accounts settings tab.

**Also changed:**
- **`HolidayStatus`** is now `ACTIVE | REMOVED`.
- **`GET /api/holidays/blocked`** lists only blocked days: `{ date, holidays: [{ id, name }] }`, with no `blocked` flag and no status.
- **`addedById` stays nullable,** for seeded rows.

**Migration `20261009090000_remove_machine_accounts_and_bot`:**
- It deletes the unreviewed (`PENDING`) bot entries.
- Bot entries that a person had confirmed stay as ordinary holidays.
- Then it drops the tables, columns and enums above.

§4 and §5, the bot and machine-account parts of the schema and the API, and review outcome #1 below are **superseded**. They are kept for the record.

## Context

What the sources say about these two masters (PROJECT_KNOWLEDGE.md §7, §10.4, §12.4, §12.20, §17, §18, and the 30 Sep transcript):

**Holiday calendar**

| Source | What it says |
| --- | --- |
| Brief, problem list | Staff promised dates during China's 1–7 Oct closure. Missed embassy holidays are a named problem. |
| Meeting ✅ | "Embassy holidays from a master are unselectable" for the **mandatory** expected collection date in Visa Step 5. The admin enters them. |
| Meeting ✅ | The visa HOD wants new embassy holidays as a **pop-up at login**; the written doc wants them on the dashboard. |
| Demo, Settings → Masters ⚠️ | "Holiday calendar — per embassy". Columns: **Date** (single "Fri 2 Oct", range "1 – 7 Oct", recurring "Every Sunday"), **Holiday**, **Embassy / applies to**, **Added** ("Vimal", "Vimal · from IVS"). A "new" chip. "Can't be picked as collection dates. New entries show on the dashboard and in the visa team's login popup." Only Vimal and HODs edit masters. |
| Demo, *applies to* values ⚠️ | "China embassy & visa centres" (a whole country), "French embassy, Mumbai" (one post), "All embassies in India · our office" (two scopes on one entry), "Collections & deliveries" (Masti's own runs). |
| Demo, Step 5 ⚠️ | "French embassy, Mumbai · October 2026 · holidays and Sundays can't be picked". The Sunday block is a sample. |
| Open | **M15 / inputs B2:** should Sundays and office holidays also block collection dates and deliveries, and who keeps the calendar updated? **Q24:** the IVS feed (provider, cost, data) is unknown. |
| Project lead (this request) | An AI bot will later scrape embassy websites and push holidays in. The schema must record the source and allow entries with no human author, and there must be a machine-to-machine endpoint. |

**Visa document master**

| Source | What it says |
| --- | --- |
| Client ✅ | A checklist per **country × visa type** from masters, tracked **per traveller**. Each item says whether we need the **original** or a **xerox**. |
| Demo ⚠️ | 23 "country × type" checklists. France Tourist has 11 lines: 7 we need from the client (Original or "Xerox is fine") and 3 "Arranged by us" (flight reservation, hotel bookings, travel insurance). |
| Demo ⚠️ | **Children get alternatives:** bank statement → birth certificate, ITR → school letter, leave letter/NOC → parents' NOC, salary slips → not needed. |
| Decided 8 Oct (B1/B4) | Picking country + visa type at intake fills the checklist from the master and **copies** it onto each traveller, so later master edits don't change open cases. Seeded with dummy France Tourist data until Masti sends the real lists (inputs B1). |
| §10.4 | The same checklist mechanism is reused later for **insurance claims**, per claim type. |
| Rules 2, 4 | Statuses are structured (no free text); documents are scanned in the office and kept as Drive links, never uploaded. |

Nothing has been built for either master yet: the current schema has no country, visa type, document or holiday tables.

## Decision

### 1. A holiday has a date rule and one or more targets

`Holiday` holds the name and *when*; `HolidayTarget` rows hold *what it applies to*. One entry can apply to several things, as the demo's "All embassies in India · our office" does.

**When** (`repeat`):

| `repeat` | Fields | Demo example |
| --- | --- | --- |
| `NONE` | `startDate`, `endDate` (equal for a single day) | "Fri 2 Oct", "1 – 7 Oct" |
| `WEEKLY` | `weekday` (ISO 1 = Mon … 7 = Sun), from `startDate`, until `endDate` or open-ended | "Every Sunday" |

All dates are `@db.Date` in IST, like the rest of the code (`src/lib/dates.ts`). There is no "every year on 2 Oct" rule: most Indian holidays move with the lunar calendar, so they are entered each year (by staff or, later, by the bot).

**Applies to** (`HolidayTarget.kind`):

| Kind | Extra field | Blocks | Demo label |
| --- | --- | --- | --- |
| `ALL_EMBASSIES` | — | every embassy's collection dates | "All embassies in India" |
| `COUNTRY` | `countryId` | every post of that country | "China embassy & visa centres" |
| `EMBASSY` | `embassyId` | one post | "French embassy, Mumbai" |
| `MASTI_OFFICE` | — | our office, collections and deliveries (field jobs) | "our office", "Collections & deliveries" |

`kind` is an enum, not a master table: the date pickers branch on it in code. The demo shows "our office" and "Collections & deliveries" separately, but nothing yet treats them differently, so they are one kind until M15 says otherwise (adding a kind is a small migration).

**Sundays are data, not code.** The seed adds one weekly entry, "Every Sunday · Weekly off", targeting `ALL_EMBASSIES` and `MASTI_OFFICE` ⚠️. Masti can remove it, or add "Every Saturday" for embassies, without a deploy (rule 1, M15).

### 2. A small `Embassy` master

"French embassy, Mumbai" needs a row to point at. `Embassy` is any post where files are submitted (embassy, consulate or visa centre): `code` (`FR-MUM`, stable, used by the bot), `countryId`, `name`, `city`.

Which embassy a visa case goes to is decided in the **Step 5 design**. The likely shape is `VisaCase.embassyId`, picked when the vendor file number is entered and defaulted when the country has only one active post. Until then, the blocked-dates API takes an `embassyId` directly.

### 3. One function decides whether a date is blocked

`holidays.service.ts` exposes `blockedDays({ from, to, target })`, where `target` is `{ embassyId }` or `{ office: true }`. It expands ranges and weekly rules and returns, per day, the holidays that hit it.

An `ACTIVE` holiday hits an embassy if any of its targets is `ALL_EMBASSIES`, `COUNTRY` (same country) or `EMBASSY` (same post). For `{ office: true }` only `MASTI_OFFICE` targets count.

| Status | In the picker | Server-side check |
| --- | --- | --- |
| `ACTIVE` | Greyed out, not pickable ✅ | Step 5 refuses the date (`400`) |
| `PENDING` (bot, not yet reviewed) | Pickable, with an amber "possible holiday" warning | Allowed |
| `REMOVED` | Not shown | Ignored |

The same function serves the date picker, the Step 5 save and, later, field-job scheduling, so the screen and the rule can't drift apart. This is one of the rules CLAUDE.md asks us to test ("holiday-blocked dates").

### 4. Ready for the AI bot (superseded 9 Oct 2026: removed)

The bot doesn't exist yet. These hooks let it slot in without a schema change:

- **`source`** is `MANUAL` or `AI_BOT`. **`addedById` is nullable**; a bot row instead has **`apiClientId`**, the machine account that pushed it. A database check enforces "manual ⇒ addedBy, bot ⇒ apiClient + externalKey".
- **`externalKey`** (unique) is the bot's own stable id for an announcement, e.g. `cn-embassy-2026-national-day`. Pushing the same key again updates that entry instead of adding a second one, so the bot can re-scrape daily without duplicates.
- **`reference`** records where it was announced ("IVS", or the embassy notice URL). It is shown as "from IVS" in the *Added* column. It is display text only; nothing reports on it.
- **AI assists; staff confirm (rule 12).** Bot entries arrive as **`PENDING`**. A Visa HOD or the Head confirms them (→ `ACTIVE`, blocking) or removes them. Whether review is needed is a setting (`holidays.botEntriesNeedReview`, seeded `true`), so Masti can let a trusted bot publish directly later.
- **Humans win.** The bot may change its own entries only until a person has reviewed them. Once a person has confirmed, edited or removed an entry, pushes for that key are reported back as `skipped` and change nothing. If an embassy changes an announced closure, the bot sends it under a new key; the reviewer confirms the new entry and removes the old one.
- **Removed means removed.** Removing sets `status = REMOVED` instead of deleting the row, so a rejected bot entry isn't recreated on the next scrape, and the history stays.

### 5. Machine accounts (`ApiClient`) (superseded 9 Oct 2026: removed)

Machine endpoints don't use sessions. An `ApiClient` row is a named machine account ("Holiday bot") with:
- a key shown **once** at creation or rotation, stored as a SHA-256 hash (like `Session.tokenHash`; the key is 32 random bytes, so a slow hash isn't needed), with a short prefix kept in clear for lookup and display
- **scopes** (`HOLIDAYS_PUSH` for now), an enum because routes check them in code
- an optional **IP allowlist** (CIDR, same matcher as `officeNetwork`), since the bot will run on Masti's own server
- `isActive`, `lastUsedAt`, `lastUsedIp`, and who created it

The Head manages them under Settings. The key goes in `Authorization: Bearer mcrm_<prefix>_<secret>`. A new middleware, `requireApiClient(scope)`, checks the key, the scope, the IP and `isActive`, then sets `req.apiClient`. Machine routes live under `/api/inbound/*`, alongside 0003's planned `/api/inbound/whatsapp` and `/website`. They never accept a session cookie, and session routes never accept a key. They are rate-limited (`express-rate-limit`, already a dependency).

**Audit:** `AuditLog` gains a nullable `apiClientId`, so a bot change is recorded as *which machine*, at what time and from which IP, just as a staff change records the user. `audit()` takes an optional `apiClientId`.

### 6. The visa document master

Three layers, as 0003 proposed:

```
Country ─┐
         ├─ VisaOffering (France × Tourist) ── VisaChecklistItem ── DocumentMaster (Passport…)
VisaType ┘
```

- **`DocumentMaster`** is every document any checklist can ask for: `code` (`BANK_STATEMENT_6M`), `name` ("Bank statement, last 6 months") and `detail` (client-facing, e.g. "35×45 mm, white background"). It has no department, so insurance claim checklists can reuse it later.
- **`VisaOffering`** is a visa Masti processes: one country × one visa type. The "23 country × type" on the demo is a count of these.
- **`VisaChecklistItem`** is one line of an offering's checklist:

  | Field | Values | Why |
  | --- | --- | --- |
  | `requirement` | `ORIGINAL` / `XEROX_OK` / `ARRANGED_BY_US` | ✅ Original/Xerox; ⚠️ "Arranged by us" (flight, hotel, insurance). Drives the Step 2 toggle and the "Made" status, so an enum. |
  | `appliesTo` | `ALL` / `ADULTS` / `CHILDREN` | Child alternatives: *Bank statement* is `ADULTS`, *Birth certificate* is `CHILDREN`. A document children don't need (salary slips) is just `ADULTS`. |
  | `quantity` | integer, default 1 | "Photos 35×45 mm (2)" |
  | `note` | optional text | A per-visa instruction for the client, e.g. "signed by both parents". Shown in the list; never reported on. |
  | `sortOrder` | integer | The order on the WhatsApp list and in Step 2 |

- **A document appears at most once per offering** (`@@unique([offeringId, documentId])`). An `ALL` line plus an `ADULTS` line for the same document would otherwise copy it twice onto an adult. A different requirement for children means a different document (e.g. "Parents' NOC").
- **Who counts as a child** is set by staff at intake (the adults/children counts), not by an age rule in the master. Countries differ on the age.
- **Edits never reach open cases.** At intake the lines are copied onto each traveller (0003 Decision 3). So a checklist can be replaced freely; nothing points at its lines.
- **Editing is whole-list.** The admin screen edits a checklist in one drawer and saves it with one `PUT` that replaces all lines in a transaction, with optimistic locking on the offering's `updatedAt`. "Copy from France Tourist" is just the screen loading another checklist before saving.
- **Masters are switched off, never deleted** (`isActive`), so reports and old cases keep their names. A document that is on an active checklist can't be switched off (`409`, listing the checklists).

### 7. Changes from 0003

| Model | Change | Why |
| --- | --- | --- |
| `Country` | gains `embassies` | Decision 2 |
| `VisaOffering` | gains `updatedAt` | Optimistic locking for the checklist `PUT` |
| `VisaChecklistItem` | unique key is now `[offeringId, documentId]` (was `+ appliesTo`); gains `quantity`, `note` | Decision 6 |
| `TravellerGroup`, `DocumentRequirement` | unchanged | — |
| `VisaFee`, `FeeHead` | unchanged; not part of this record | Price breakups are designed with the quote/invoice model |

### 8. Who can do what

"Only Vimal and HODs can change them" (demo ⚠️):

| Action | Who |
| --- | --- |
| See the holiday calendar and blocked dates | Head and office staff (`requireUserType("HEAD","OFFICE")`); every department may need it |
| Add, edit, remove holidays; confirm bot entries | The Head, or an HOD of **any** department (office closures aren't only Visa's business) |
| See the document master and checklists | Visa VIEW |
| Edit documents, countries, visa types, offerings, checklists | Visa EDIT **and** Visa HOD (the Head passes) |
| Manage machine accounts (create, rotate, revoke) | Head only |

Every change writes an audit entry in the same transaction (`holiday.create`, `holiday.confirm`, `visaChecklist.replace` with before/after, `apiClient.rotate`…).

### 9. Settings (§7 rule 1)

One new row in `Setting`, validated with zod like `officeNetwork`:

| Key | Seeded value | Meaning |
| --- | --- | --- |
| `holidays` | `{ "newForDays": 7, "botEntriesNeedReview": true }` | How long an entry shows the "new" chip ⚠️; whether bot entries wait for review |

The "show new holidays on the dashboard and in the login popup" part belongs to the Notice board (§12.18, Stage 3). Until then, Today can list entries created in the last `newForDays` days.

## Prisma schema

As proposed; the built schema is in `Backend/prisma/schema.prisma`, and the differences are listed under *Built*.

Additions to `Backend/prisma/schema.prisma`. Existing models change only where marked.

```prisma
// ---------------------------------------------------------------------------
// Audit log (changed)
// ---------------------------------------------------------------------------

model AuditLog {
  // …existing fields…
  /// Set instead of actorId when a machine account (e.g. the holiday bot) made the change.
  apiClientId String?
  apiClient   ApiClient? @relation(fields: [apiClientId], references: [id], onDelete: Restrict)

  @@index([apiClientId])
}

// `User` gains the back-relations: holidaysAdded, holidaysReviewed, apiClientsCreated.

// ---------------------------------------------------------------------------
// Machine accounts (server-to-server callers such as the holiday bot)
// ---------------------------------------------------------------------------

/// What a machine account may call. Routes check these in code, so an enum.
enum ApiScope {
  HOLIDAYS_PUSH
}

model ApiClient {
  id          String     @id @default(uuid())
  /// "Holiday bot"
  name        String     @unique
  /// The first characters of the key, kept in clear to find the row and show "mcrm_3fa9c2…".
  keyPrefix   String     @unique
  /// SHA-256 of the full key. The key itself is shown once and never stored.
  keyHash     String     @unique
  scopes      ApiScope[]
  /// CIDR or single IPs. Empty = any address.
  allowedIps  String[]
  isActive    Boolean    @default(true)
  lastUsedAt  DateTime?  @db.Timestamptz(3)
  lastUsedIp  String?
  createdAt   DateTime   @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime   @updatedAt @db.Timestamptz(3)
  createdById String
  createdBy   User       @relation("ApiClientCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)
  holidays    Holiday[]
  auditLogs   AuditLog[]
}

// ---------------------------------------------------------------------------
// Countries, visa types and embassies (masters)
// ---------------------------------------------------------------------------

model Country {
  id        Int            @id @default(autoincrement())
  /// ISO 3166-1 alpha-2, e.g. "FR". Also how the bot names a country.
  code      String         @unique
  name      String         /// "France"
  /// Shown in brackets: "France (Schengen)".
  zone      String?
  sortOrder Int            @default(0)
  isActive  Boolean        @default(true)
  offerings VisaOffering[]
  embassies Embassy[]
  holidayTargets HolidayTarget[]
}

model VisaType {
  id        Int            @id @default(autoincrement())
  code      String         @unique   /// TOURIST, BUSINESS, STUDENT…
  name      String
  sortOrder Int            @default(0)
  isActive  Boolean        @default(true)
  offerings VisaOffering[]
}

/// A post where files are submitted: an embassy, consulate or visa centre.
model Embassy {
  id             Int             @id @default(autoincrement())
  /// Stable key, e.g. "FR-MUM". The bot uses it to target one post.
  code           String          @unique
  countryId      Int
  name           String          /// "French embassy, Mumbai"
  city           String          /// "Mumbai"
  sortOrder      Int             @default(0)
  isActive       Boolean         @default(true)
  country        Country         @relation(fields: [countryId], references: [id], onDelete: Restrict)
  holidayTargets HolidayTarget[]

  @@index([countryId])
}

// ---------------------------------------------------------------------------
// Holiday calendar
// ---------------------------------------------------------------------------

/// Who created the entry. Code branches on it (review flow, bot update rules), so an enum.
enum HolidaySource {
  MANUAL
  AI_BOT
}

enum HolidayStatus {
  /// From the bot, waiting for a Visa HOD or the Head. Warns but doesn't block.
  PENDING
  /// Blocks dates.
  ACTIVE
  /// Taken off the calendar (or a rejected bot entry). Kept so the bot can't recreate it.
  REMOVED
}

enum HolidayRepeat {
  /// startDate…endDate inclusive (equal for one day).
  NONE
  /// Every `weekday`, from startDate until endDate (or for good).
  WEEKLY
}

enum HolidayTargetKind {
  ALL_EMBASSIES
  /// Every post of countryId.
  COUNTRY
  /// One post: embassyId.
  EMBASSY
  /// Masti's office, collections and deliveries.
  MASTI_OFFICE
}

/// Checks in the migration:
/// - repeat = NONE   ⇒ endDate is set, endDate >= startDate, weekday is null
/// - repeat = WEEKLY ⇒ weekday between 1 and 7; endDate null or >= startDate
/// - source = MANUAL ⇒ apiClientId and externalKey null (addedById is null only for seeded rows)
/// - source = AI_BOT ⇒ apiClientId and externalKey are set
model Holiday {
  id           String          @id @default(uuid())
  /// "Dussehra", "National Day week". A label, not a reported value.
  name         String
  repeat       HolidayRepeat   @default(NONE)
  startDate    DateTime        @db.Date
  endDate      DateTime?       @db.Date
  /// ISO weekday, 1 = Monday … 7 = Sunday. WEEKLY only.
  weekday      Int?            @db.SmallInt
  status       HolidayStatus   @default(ACTIVE)
  source       HolidaySource   @default(MANUAL)
  /// The bot's own id for this announcement. A push with the same key updates this row.
  externalKey  String?         @unique
  /// Where it was announced: "IVS", or the embassy notice URL. Display only.
  reference    String?
  /// Null for bot entries.
  addedById    String?
  /// The machine account that pushed it. Bot entries only.
  apiClientId  String?
  /// Who confirmed, edited or removed it last. Once set on a bot entry, the bot can no longer change it.
  reviewedById String?
  reviewedAt   DateTime?       @db.Timestamptz(3)
  createdAt    DateTime        @default(now()) @db.Timestamptz(3)
  /// Also the optimistic-lock token for PATCH.
  updatedAt    DateTime        @updatedAt @db.Timestamptz(3)
  addedBy      User?           @relation("HolidayAddedBy", fields: [addedById], references: [id], onDelete: Restrict)
  reviewedBy   User?           @relation("HolidayReviewedBy", fields: [reviewedById], references: [id], onDelete: Restrict)
  apiClient    ApiClient?      @relation(fields: [apiClientId], references: [id], onDelete: Restrict)
  targets      HolidayTarget[]

  @@index([status, startDate])
  @@index([status, repeat])
}

/// What a holiday applies to. At least one per holiday (checked in the service).
/// Checks in the migration:
/// - kind = COUNTRY ⇒ countryId set, embassyId null
/// - kind = EMBASSY ⇒ embassyId set, countryId null
/// - otherwise both null
/// - unique (holidayId, kind, countryId, embassyId) NULLS NOT DISTINCT (Postgres 15+; raw SQL)
model HolidayTarget {
  id        Int               @id @default(autoincrement())
  holidayId String
  kind      HolidayTargetKind
  countryId Int?
  embassyId Int?
  holiday   Holiday           @relation(fields: [holidayId], references: [id], onDelete: Cascade)
  country   Country?          @relation(fields: [countryId], references: [id], onDelete: Restrict)
  embassy   Embassy?          @relation(fields: [embassyId], references: [id], onDelete: Restrict)

  @@index([holidayId])
  @@index([kind, countryId])
  @@index([kind, embassyId])
}

// ---------------------------------------------------------------------------
// Visa document master
// ---------------------------------------------------------------------------

/// A visa Masti processes: country × visa type. The checklist (and, later, fees) hang off it.
model VisaOffering {
  id         Int                 @id @default(autoincrement())
  countryId  Int
  visaTypeId Int
  isActive   Boolean             @default(true)
  /// Bumped when the checklist is replaced: the optimistic-lock token for PUT …/checklist.
  updatedAt  DateTime            @updatedAt @db.Timestamptz(3)
  country    Country             @relation(fields: [countryId], references: [id], onDelete: Restrict)
  visaType   VisaType            @relation(fields: [visaTypeId], references: [id], onDelete: Restrict)
  checklist  VisaChecklistItem[]
  // 0003 adds: fees VisaFee[], cases VisaCase[]

  @@unique([countryId, visaTypeId])
}

/// Every document a checklist can ask for. No department: insurance claim checklists reuse it later.
model DocumentMaster {
  id             Int                 @id @default(autoincrement())
  code           String              @unique   /// PASSPORT, OLD_PASSPORTS, BANK_STATEMENT_6M…
  name           String              /// "Bank statement, last 6 months"
  /// Shown to the client with the name, e.g. "35×45 mm, white background".
  detail         String?
  sortOrder      Int                 @default(0)
  isActive       Boolean             @default(true)
  createdAt      DateTime            @default(now()) @db.Timestamptz(3)
  updatedAt      DateTime            @updatedAt @db.Timestamptz(3)
  checklistItems VisaChecklistItem[]
  // 0003 adds: caseDocuments VisaCaseDocument[]
}

/// What we need. Code branches on it (Original/Xerox toggle, "Made" for things we arrange), so an enum.
enum DocumentRequirement {
  ORIGINAL
  XEROX_OK
  ARRANGED_BY_US
}

/// Which travellers a checklist line (or a fee) applies to.
enum TravellerGroup {
  ALL
  ADULTS
  CHILDREN
}

/// One line of a country × visa type checklist. Copied onto each traveller at intake,
/// so replacing lines never changes an open case.
model VisaChecklistItem {
  id          Int                 @id @default(autoincrement())
  offeringId  Int
  documentId  Int
  requirement DocumentRequirement
  appliesTo   TravellerGroup      @default(ALL)
  /// "Photos 35×45 mm (2)". 1–20.
  quantity    Int                 @default(1) @db.SmallInt
  /// A per-visa instruction for the client ("signed by both parents"). Display only.
  note        String?
  sortOrder   Int                 @default(0)
  offering    VisaOffering        @relation(fields: [offeringId], references: [id], onDelete: Cascade)
  document    DocumentMaster      @relation(fields: [documentId], references: [id], onDelete: Restrict)

  @@unique([offeringId, documentId])
}
```

**Seed:**
- Country France (Schengen), China; visa type Tourist; offering France × Tourist with the demo's 11 lines plus the three child alternatives (birth certificate, school letter, parents' NOC; salary slips are adults-only) (dummy, replaced when Masti sends B1).
- Embassy `FR-MUM` "French embassy, Mumbai".
- Holiday "Every Sunday · Weekly off" → `ALL_EMBASSIES` + `MASTI_OFFICE` ⚠️ (M15). The demo's dated entries (China 1–7 Oct, Gandhi Jayanti, Dussehra) are test fixtures, not production seed.
- The `holidays` setting.
- No `ApiClient`: the Head creates one when the bot exists.

## API

New modules: `modules/holidays/` (staff routes, `blockedDays()`), `modules/visaMasters/` (countries, visa types, embassies, offerings, documents, checklists), `modules/apiClients/` (key management, `requireApiClient`), `modules/inbound/` (machine routes, calling the holidays service). Session routes follow CLAUDE.md: `requireAuth` → `requirePasswordChanged` → a department or user-type check, with the finer HOD rules checked in the service. Errors use the existing shape (`{ message }`, zod → `{ message, issues }`, `409 { code: "STALE" }` for optimistic locking). Dates are `YYYY-MM-DD` (IST); timestamps are UTC.

### Holiday calendar (staff)

| Method + path | Guard | Purpose |
| --- | --- | --- |
| `GET /api/holidays?from=&to=&status=&kind=&countryId=&embassyId=` | `requireUserType("HEAD","OFFICE")` | The Settings table. Defaults: from today, all statuses except `REMOVED`. |
| `GET /api/holidays/blocked?from=&to=&embassyId=` · `…&office=true` | `requireUserType("HEAD","OFFICE")` | The date pickers (Step 5, field jobs). At most 366 days. |
| `GET /api/holidays/targets` | `requireUserType("HEAD","OFFICE")` | Options for the *Applies to* picker |
| `POST /api/holidays` | same + Head or any HOD | Add a holiday (always `MANUAL`, `ACTIVE`) |
| `PATCH /api/holidays/:id` | same + Head or any HOD | Edit, with `updatedAt`. On a bot entry this also counts as a review. |
| `POST /api/holidays/:id/confirm` | same + Head or any HOD | `PENDING` → `ACTIVE` |
| `POST /api/holidays/:id/remove` | same + Head or any HOD | → `REMOVED` (also how a bot entry is rejected) |

**`POST /api/holidays`**

```json
{
  "name": "Dussehra",
  "repeat": "NONE",
  "startDate": "2026-10-20",
  "endDate": "2026-10-20",
  "targets": [{ "kind": "EMBASSY", "embassyId": 1 }],
  "reference": null
}
```

| Field | Rule |
| --- | --- |
| `name` | 1–80 characters |
| `repeat` | `NONE` (needs `endDate`; range at most 60 days) or `WEEKLY` (needs `weekday` 1–7; `endDate` optional) |
| `targets` | 1–10, no duplicates; `countryId`/`embassyId` must be active and match the kind |
| `reference` | Optional, up to 300 characters |

A holiday that duplicates an existing active one (same dates and an overlapping target) is a **warning**, as in 0004: `409 { code: "DUPLICATE", matches: [...] }`, then save again with `confirmDuplicates: true`.

**`HolidayDto`** (list items and every write response):

```json
{
  "id": "…",
  "name": "National Day week",
  "repeat": "NONE",
  "startDate": "2026-10-01",
  "endDate": "2026-10-07",
  "weekday": null,
  "label": "1 – 7 Oct",
  "targets": [{ "kind": "COUNTRY", "country": { "id": 2, "code": "CN", "name": "China" }, "label": "China embassy & visa centres" }],
  "status": "ACTIVE",
  "source": "AI_BOT",
  "reference": "IVS",
  "isNew": true,
  "addedBy": null,
  "apiClient": { "id": "…", "name": "Holiday bot" },
  "reviewedBy": { "id": "…", "name": "Vimal" },
  "reviewedAt": "2026-09-28T09:10:00.000Z",
  "createdAt": "2026-09-28T03:30:00.000Z",
  "updatedAt": "2026-09-28T09:10:00.000Z"
}
```

`label` (and each target's `label`) is built by the server, so every screen shows the same wording. The *Added* column reads "Vimal", or for a bot entry "Holiday bot · from IVS · confirmed by Vimal".

**`GET /api/holidays/blocked?from=2026-10-01&to=2026-10-31&embassyId=1`**

```json
200 {
  "from": "2026-10-01",
  "to": "2026-10-31",
  "days": [
    { "date": "2026-10-02", "blocked": true,  "holidays": [{ "id": "…", "name": "Gandhi Jayanti", "status": "ACTIVE" }] },
    { "date": "2026-10-04", "blocked": true,  "holidays": [{ "id": "…", "name": "Weekly off", "status": "ACTIVE" }] },
    { "date": "2026-10-20", "blocked": true,  "holidays": [{ "id": "…", "name": "Dussehra", "status": "ACTIVE" }] },
    { "date": "2026-10-23", "blocked": false, "holidays": [{ "id": "…", "name": "Possible closure", "status": "PENDING" }] }
  ]
}
```

Only days with a holiday are listed. `blocked: false` with a `PENDING` holiday is the amber warning.

### Visa document master (staff)

Reads: `requireDepartment("VISA","VIEW")`. Writes: `requireDepartment("VISA","EDIT")` + Visa HOD (Head passes), checked in the service. Lists include inactive rows (`?active=true` to filter). 0003's `GET /api/visa/offerings` stays the intake dropdown (active only).

| Method + path | Purpose |
| --- | --- |
| `GET /api/masters/countries` · `POST` · `PATCH /:id` | Countries (`code`, `name`, `zone`, `sortOrder`, `isActive`) |
| `GET /api/masters/visa-types` · `POST` · `PATCH /:id` | Visa types |
| `GET /api/masters/embassies?countryId=` · `POST` · `PATCH /:id` | Embassies (`code`, `countryId`, `name`, `city`). Writes: Head or any HOD, as for holidays |
| `GET /api/masters/documents` · `POST` · `PATCH /:id` | The document master. Switching off a document on an active checklist → `409 { code: "IN_USE", offerings: [...] }` |
| `GET /api/masters/visa-offerings` | Every country × type, with `checklistCount` (the "23 country × type" card) |
| `POST /api/masters/visa-offerings` | `{ countryId, visaTypeId }`. An existing pair → `409` |
| `PATCH /api/masters/visa-offerings/:id` | `{ isActive }` |
| `GET /api/masters/visa-offerings/:id/checklist` | The checklist, split for the two tabs |
| `PUT /api/masters/visa-offerings/:id/checklist` | Replace the whole checklist |

**`GET /api/masters/visa-offerings/1/checklist`**

```json
200 {
  "offering": { "id": 1, "country": { "id": 1, "name": "France", "zone": "Schengen" }, "visaType": { "id": 1, "name": "Tourist" },
                "isActive": true, "updatedAt": "2026-10-08T09:00:00.000Z" },
  "items": [
    { "id": 1, "document": { "id": 1, "code": "PASSPORT", "name": "Passport", "detail": null },
      "requirement": "ORIGINAL", "appliesTo": "ALL", "quantity": 1, "note": null, "sortOrder": 1 },
    { "id": 5, "document": { "id": 5, "code": "BANK_STATEMENT_6M", "name": "Bank statement, last 6 months", "detail": null },
      "requirement": "XEROX_OK", "appliesTo": "ADULTS", "quantity": 1, "note": null, "sortOrder": 5 },
    { "id": 12, "document": { "id": 12, "code": "BIRTH_CERTIFICATE", "name": "Birth certificate", "detail": null },
      "requirement": "XEROX_OK", "appliesTo": "CHILDREN", "quantity": 1, "note": null, "sortOrder": 5 }
  ],
  "adults":   { "count": 11 },
  "children": { "count": 10 }
}
```

**`PUT /api/masters/visa-offerings/1/checklist`**

```json
{
  "updatedAt": "2026-10-08T09:00:00.000Z",
  "items": [
    { "documentId": 1, "requirement": "ORIGINAL", "appliesTo": "ALL", "quantity": 1, "note": null },
    { "documentId": 5, "requirement": "XEROX_OK", "appliesTo": "ADULTS" }
  ]
}
```

- `items`: 1–60 lines, each `documentId` once and active. The array order becomes `sortOrder`.
- In one transaction: check `updatedAt` (else `409 { code: "STALE" }`), delete the old lines, insert the new ones, bump the offering's `updatedAt`, and audit `visaChecklist.replace` with the old and new lists.
- An unchanged list writes nothing. Returns the same shape as the GET.

### Machine accounts (Head) (superseded 9 Oct 2026: removed)

| Method + path | Purpose |
| --- | --- |
| `GET /api/api-clients` | List (never the key) |
| `POST /api/api-clients` | `{ name, scopes, allowedIps }` → `201 { client, key }`. The key is shown once. |
| `PATCH /api/api-clients/:id` | `name`, `scopes`, `allowedIps` |
| `POST /api/api-clients/:id/rotate` | New key (shown once); the old one stops working at once |
| `POST /api/api-clients/:id/deactivate` · `/activate` | Switch it off or on |

Guard: `requireAuth` → `requirePasswordChanged` → `requireHead`. Each action is audited; the key never reaches the audit log (`key` joins `SECRET_KEYS`).

### Inbound holidays (the AI bot, machine-to-machine) (superseded 9 Oct 2026: removed)

Guard: `requireApiClient("HOLIDAYS_PUSH")` and a rate limit. No cookies, no session.

| Method + path | Purpose |
| --- | --- |
| `GET /api/inbound/holidays/targets` | The active countries and embassies, by `code`, so the bot can map what it scrapes |
| `GET /api/inbound/holidays?updatedSince=` | This client's own entries and their current status, so the bot can see what was reviewed |
| `POST /api/inbound/holidays` | Push a batch (create or update by `externalKey`) |

**`POST /api/inbound/holidays`**

```
Authorization: Bearer mcrm_3fa9c2d1_…
Content-Type: application/json
```

```json
{
  "dryRun": false,
  "holidays": [
    {
      "externalKey": "cn-embassy-2026-national-day",
      "name": "National Day week",
      "startDate": "2026-10-01",
      "endDate": "2026-10-07",
      "targets": [{ "kind": "COUNTRY", "countryCode": "CN" }],
      "reference": "https://…/notice"
    }
  ]
}
```

- 1–200 items. Targets name countries and embassies by **code** (`countryCode`, `embassyCode`), not database ids. The bot pushes dated entries only (`repeat` is always `NONE`); weekly offs are staff-entered.
- Dates must end on or after today (IST) and start within the next 2 years. A range is at most 60 days.
- Each item is validated on its own; valid items are applied in one transaction, and invalid ones are reported without blocking the rest.

| Situation | Result |
| --- | --- |
| New key | `created` (`PENDING`, or `ACTIVE` if `botEntriesNeedReview` is off) |
| Key exists, still `PENDING`, values differ | `updated` |
| Key exists, same values | `unchanged` |
| Key exists, a person has reviewed, edited or removed it | `skipped` (`reason: "REVIEWED"`); nothing changes |
| Invalid (bad dates, unknown code, inactive embassy) | `invalid`, with `issues` |

```json
200 {
  "dryRun": false,
  "results": [
    { "externalKey": "cn-embassy-2026-national-day", "result": "created", "holidayId": "…", "status": "PENDING" }
  ],
  "summary": { "created": 1, "updated": 0, "unchanged": 0, "skipped": 0, "invalid": 0 }
}
```

- `dryRun: true` validates and reports without writing, for testing the bot.
- `401` for a missing, wrong or switched-off key; `403` for a missing scope or a disallowed IP; `413` over 200 items; `429` when rate-limited.
- Each created or updated holiday is audited as `holiday.create` / `holiday.update` with `apiClientId` and the caller's IP. `lastUsedAt` and `lastUsedIp` are updated.

## Tests (money and rule logic)

- `blockedDays()`: single day, inclusive ranges, weekly rules with and without an end date, `ALL_EMBASSIES` / `COUNTRY` / `EMBASSY` / `MASTI_OFFICE` matching, `PENDING` warns but doesn't block, `REMOVED` is ignored, IST boundaries.
- Bot push: create, update while pending, unchanged, skipped after review or removal, a removed key isn't recreated, invalid items don't block valid ones, `dryRun` writes nothing.
- Machine auth: wrong key, rotated key, switched-off client, missing scope, IP not allowed; a key can't open a session route, and a cookie can't open an inbound route.
- Permissions: holiday writes for the Head and HODs only; checklist writes for Visa HOD and the Head only; API clients for the Head only.
- Checklist `PUT`: replaces atomically, `STALE` on an old `updatedAt`, rejects a repeated document, audits before/after; a case created before the change keeps its old copy (once 0003 is built).

## Not in this record

- Reminder rules, vendors, dropdown reasons, hotel markups and the other masters (later records).
- Price breakups (`VisaFee`): designed with the quote/invoice model.
- Wiring Step 5 to an embassy (`VisaCase.embassyId`) and field-job scheduling to `MASTI_OFFICE`: built with those features, using `blockedDays()`.
- The Notice board and the visa team's login popup for new holidays (Stage 3, §12.18).
- The bot itself, and the IVS feed (Q24). A bot "withdraw" call (an embassy cancels an announced closure) can be added when the bot is built; until then the reviewer removes the entry.
- Insurance claim checklists (Stage 2): they reuse `DocumentMaster` with their own per-claim-type table.

## Review outcome (8 Oct 2026, project lead)

All seven points were confirmed as proposed:

1. **Bot entries wait for review** (`PENDING`: they warn but don't block until a person confirms them). `holidays.botEntriesNeedReview` stays as the switch.
2. **"Our office" and "Collections & deliveries" are one target kind**, `MASTI_OFFICE`, until M15 says otherwise.
3. **The seeded Sunday block** (embassies and our office) is a valid assumption; Masti's B2 answer can change the data.
4. **A separate `Embassy` master** linked to `Country`. How a case picks its embassy is still left to the Step 5 design.
5. **Permissions:** holidays are edited by the Head or any HOD; visa checklists by the Head or the Visa HOD.
6. **Occupation-specific documents are not modelled.** Staff mark them "Not needed" per traveller in Step 2.
7. **No yearly-repeat rule.** Every dated holiday is entered for its year.

## Built (8 Oct 2026)

**Code:** `Backend/src/modules/holidays/` (staff routes, `blockedDays.ts`, `holidaysBot.service.ts` for pushes, labels in `holiday.ts`), `visaMasters/` (masters and checklists, the dummy seed), `apiClients/` (machine accounts, `apiKey.ts`), `inbound/` (machine routes), and `src/middleware/apiClient.ts` (`requireApiClient`). **Migrations:** `20261008133011_system_masters` and `20261008134500_holiday_weekday_check`. **Tests:** `tests/holidays.test.ts`, `tests/visaMasters.test.ts`, `tests/inbound.test.ts`.

What differs from the proposal above, and why:

1. **Seeded holidays have no author.** The seed runs before any user exists, so the database rule is "manual ⇒ no machine account or bot key" (the author may be null), and "bot ⇒ machine account and key, no author".
2. **The bot may correct an entry until a person reviews it**, not only while it's `PENDING`. With review switched off, bot entries go straight to `ACTIVE`, and the bot can still fix its own mistakes. Once a person has confirmed, edited or removed an entry, the bot can't change it.
3. **The bot targets embassies only** (`ALL_EMBASSIES`, `COUNTRY`, `EMBASSY`). Our office closures are staff-entered.
4. **New routes `GET /api/holidays/settings` and `PUT /api/holidays/settings`** (the Head writes), like `/api/clients/settings`. They are audited as `setting.update`.
5. **Codes never change.** `PATCH` ignores `code`, and the database checks the code formats (country `FR`; embassy `FR-MUM`; others `A-Z0-9_`).
6. **Editing a holiday counts as a review** (it sets `reviewedBy`). Removing a holiday that is already removed changes nothing.
7. **A follow-up migration fixes the weekday check.** `NULL BETWEEN 1 AND 7` is unknown, and a CHECK accepts unknown, so a weekly holiday with no weekday got through; `20261008134500_holiday_weekday_check` adds `weekday IS NOT NULL`. A test caught it.
8. **No reads with several relations inside a transaction.** Inside an interactive transaction, Prisma 7 with the pg adapter runs the relation reads in parallel on the transaction's single connection. pg warns, and in one test run this stalled a transaction that held locks. Services include at most one relation inside a transaction and load the full DTO after commit (see the comment on `holidayInclude`).
9. **Shared helpers:**
   - `changes.ts` moved from the clients module to `src/lib/` (`onlyChanged` now compares arrays, and `definedOnly` is new).
   - `isHodOfAny()` is in `permissions.ts`; `isIpOrCidr()` is in `officeNetwork.ts`.
   - `audit()` takes `apiClientId`, and `key` / `keyHash` never reach the audit log.
   - Date helpers `addDays`, `daysInclusive` and `isoWeekday` are in `src/lib/dates.ts`.

**Screens** (`Frontend/src/pages/settings/`, built 9 Oct 2026): Settings → Masters & holiday calendar (the holiday calendar with its review list, holiday settings), the checklist list and editor, and the four small lists. (A Machine accounts tab was built too, then removed on 9 Oct 2026.)

**Not built yet:** wiring `blockedDays()` into Visa Step 5 and field jobs (built with those features).

