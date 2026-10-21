# 0004 · Client master: clients, numbers, family members, notes

- **Status:** accepted and built (8 Oct 2026); **amended 9 Oct 2026**: the name is required (see *Amendment*); **amended 19 Oct 2026**: staff don't browse the client list (see *Amendment 2*); **amended 20 Oct 2026**: a family member's number finds the family (see *Amendment 3*); **amended 21 Oct 2026**: an HOD sees only their departments' clients (see *Amendment 4*).
- **Date:** 8 Oct 2026
- **Changes:** replaces the `Client` model proposed in [0003](0003-visa-intake.md). It is a superset: `mobile @unique` and `createdById` are unchanged, so 0003's `GET /api/clients/lookup` contract still holds (extended below). 0003 adds the `enquiries` and `messages` relations when Visa Step 1 is built.
- **Order of work:** the client master is built before the System Masters (embassy holidays, rules, vendors, dropdown admin screens), which are on hold.

## Amendment (9 Oct 2026, project lead): the name is required

Staff must give a **mobile number and a name** to save a client. For a company, the name is the company name. The fields are marked * on the forms.

**How it works:**
- **Create:** `POST /api/clients` refuses a missing or blank `name` (400, `issues.name`).
- **Update:** `PATCH` can't clear it.
- **Intake:** the New enquiry form asks for the name when the number is new (0003, *Refresh*). It never overwrites an existing client's name.
- **Database (later on 9 Oct 2026):** `Client.name` is `NOT NULL` with a not-blank check (migration `20261009130000_client_name_required`). Clients saved with only the mobile before this were given the placeholder "Client +91…" (none in production). Integrations and the Excel import must supply a name too: the WhatsApp profile name, or the spreadsheet's. It also keeps the directory's paging cheap: it sorts by name, and with a nullable sort key Prisma 7's cursor reads every remaining row and pages in memory.

This differs from Vimal's "only the mobile number" (6:5x PM, quoted below), so **confirm it with him**. It is logged as open question #41.

## Amendment 2 (19 Oct 2026, project lead): staff don't browse the client list

Masti doesn't want every employee to be able to go through the whole client list. The concern isn't in the meeting
transcript or the requirements note; it came to the project lead afterwards, so **confirm it with Vimal** (open
question #45, M43). It is close to Vimal's worry about staff who leave keeping access (transcript, 6:54 PM).

**The rule:** an employee sees everything about the client of their own enquiry, and nothing of the full list.

| Who | The Clients tab (list, search, adding a client there) | One client's page, and changing it |
| --- | --- | --- |
| The Head, the HOD of any department, Accounts (VIEW or EDIT: they bill every client) | Yes | Any client |
| Other office staff | No (`403`; the menu hides the tab) | Only a client with at least one case they can see (`visibility.ts`: their own cases; view-only staff, their department's), finished cases too |
| Field staff | No | No (unchanged) |

- **Intake is unchanged:** `GET /api/clients/lookup` (the New enquiry check by mobile) and `GET /api/clients/options`
  stay open to office staff, and intake still creates the client (`findOrCreateClientByMobile`). Staff can't add a
  client from the Clients tab (`POST /api/clients` follows the list).
- **Everything the case links to keeps working** for its owner: the client's name on the case, "Open the client" from
  Raise invoice and from booking the collection boy, and Step 2's family list and "Add person".
- **With [0006](0006-visa-documents.md) amendment 17** (a client's page lists colleagues' cases, not to open): staff see
  that list only on a client they can open, i.e. when they have a case of their own for the family. Whoever matured a
  case that now waits for the HOD no longer opens the client.
- **A refusal doesn't depend on whether the client exists**, so ids reveal nothing: "This client isn't on any of your
  cases. Ask your HOD."
- **Not changed:** the Enquiries list still shows each visible case's client name and mobile, and the "Already on file"
  warning still names the other client (with a link that a staff member can't open). Masking details was discussed and
  left out for now.
- **Code:** `canBrowseClients`, `assertCanBrowseClients` and `assertCanSeeClient` in `src/modules/clients/access.ts`;
  the frontend mirror is `canBrowseClients` in `Frontend/src/auth/permissions.ts`.

## Amendment 3 (20 Oct 2026, project lead): a family member's number finds the family

**The gap:** the New enquiry lookup matched only a client's main and extra numbers. When Rakesh's son Aarav called
from his own number (saved on his family-member row), the form said "New client", and saving made a second client
for the same family. Nothing in this record chose that; members' numbers were simply never checked. The demo's rule is
that an existing client is recognised by the mobile ✅, so this is a fix, not a change request.

**The decision (project lead, in their words):** keep it simple. Pool the family's phone numbers on the main client's
profile as extra numbers; don't build a family tree or relationship model, which would only mean more typing for staff.
Finding the right file at once is what matters.

**How it works:**
- **Lookup:** when no client has the number as a main or extra one, `GET /api/clients/lookup` also returns
  `familyMatches`: each client with an active (not archived) family member whose own number it is, with those members
  (name, relation), whether the client already has the maximum 5 extra numbers, and the client's open enquiries. A
  client's own number always wins; family numbers are then not asked for.
- **The form** warns (it never blocks): "This number belongs to AARAV MEHTA (Son), family of Rakesh Mehta · +91 98250
  41234", with **Use Rakesh Mehta** and **No, it's a new client**.
  - *Use* files the enquiry on Rakesh's client and, in the same transaction, saves the number there as an extra number
    labelled with the member's name (audited as `client.phone.add` with `fromMemberId`). Next time the number is found
    directly ("Existing client · Rakesh Mehta (extra number)"). The form keeps the number staff typed.
  - *No* hides the warning and asks for the new client's name, as for any new number. Editing the number asks again.
  - A client with 5 extra numbers can't take another: the form offers **Use Rakesh Mehta's main number** instead,
    which puts his main number in the field.
  - Saving while the question is unanswered is stopped on the form ("Pick below whose file it goes on").
- **Intake:** `POST /api/visa/cases` takes an optional `familyClientId`. It is used only when the number isn't a
  client's main or extra one. It is refused (400 under `mobile`) when that client has no active member with the number,
  or no room for another extra number.
- **Clients search:** a family member's own number (any part of it) finds the client too.
- **Database:** `ClientMember.mobile` gets a plain index (the lookup) and a trigram index (the search), migration
  `20261020120000_member_mobile_lookup` (indexes only: `npm run db:deploy`).
- **Not done:** saving a member's number on the client page doesn't add it as an extra number by itself; the pooling
  happens the first time the number is used at intake.

## Amendment 4 (21 Oct 2026, project lead): an HOD sees their departments' clients

**The gap:** the role walkthrough of 21 Oct 2026 found that the Holidays HOD could open a visa family's page, see and
add their passport scans, and change their main number. The page then said "No cases yet", though the family had an open
visa case that the HOD isn't allowed to see. So she could take them for a new client.

**The decision (project lead, option c):** a department's HOD doesn't see another department's clients.

| Who | The Clients tab (list, search) | One client's page, and their scans |
| --- | --- | --- |
| The Head; Accounts (VIEW or EDIT: they bill every client) | Every client | Any client (scans: the Head, and an Accounts HOD, as before) |
| An HOD | The clients with a case (open or finished) in a department they head, and the clients with no case yet | Those, or a client of a case they can see |
| Other office staff | No (unchanged) | A client of a case they can see (unchanged) |

- **Clients with no case** (added on the Clients tab) stay visible to every HOD, since no department owns them yet.
  The first case decides. *(Default, not asked: say if it's wrong.)*
- **Scans** ([0016](0016-client-documents.md) Decision 4, amended): an HOD sees a client's scans only on a client they
  can open, so the Holidays HOD sees a family's passports once that family has a holiday case.
- **Intake is unchanged:** the New enquiry lookup by mobile still finds any client, so a holiday enquiry for a visa
  family goes on the same client. From then on, the Holidays HOD sees them.
- **Code:** `clientsTabWhere` and `assertCanSeeClient` in `src/modules/clients/access.ts`. The frontend needed no
  change: the server filters the list and refuses the rest.

## Context

Every department works for the same clients, so the client record comes first. What the sources say (PROJECT_KNOWLEDGE.md §10.1, §12.14, and the 30 Sep transcript):

| Source | What it says |
| --- | --- |
| Vimal, 6:5x PM | "We'll save the query against the mobile number, only the mobile number." |
| Demo + PID | Fixed format: **minimal at enquiry, complete before invoicing** ✅. Accounting client code ✅, billing cycle weekly / half-monthly / monthly, **default monthly** ✅. |
| Demo, Clients screen | Family & travellers: name · relation · passport valid till ("renew soon") · consent. The search bar searches "client, mobile, case **or passport number**". Notes: free text with author and date. |
| Vimal, 7:08, 7:18, 8:39 PM | Documents are **links** to Masti's Drive/OneDrive, never attachments, "so the system doesn't get heavy". Clients never upload; staff scan in the office. |
| Vimal, 7:37 PM | PAN verification (EasyLife/TBO style) was "an example"; "whether you put it in our system or not is a separate matter." Open (Q23). |
| — | Nobody asked for a reusable client document vault, a client GSTIN, extra mobile numbers or Aadhaar. |

## Decision

### 1. Seven tables, no document vault

| Model | Purpose |
| --- | --- |
| `Client` | The client (a person or a company). `mobile` is unique: the lookup key, the WhatsApp number and the Excel-import match key. Everything else is optional until invoicing. |
| `ClientPhone` | Extra numbers. Lookup matches them too; WhatsApp always goes to `Client.mobile`. Not unique across clients. |
| `ClientMember` | Family & travellers (or a corporate's employees): passport name, relation, DOB, own mobile, **current** passport number and expiry. Archived, never deleted. |
| `ClientNote` | Free-text notes with author and time. Append-only, never read by reports or rules (§7 rule 2). |
| `BillingCycle`, `PaymentHabit`, `Relation` | Lookup tables (masters), seeded. Admin screens come with System Masters. |

The schema is in `Backend/prisma/schema.prisma` (section "Client master"); the migration is `20261008092632_client_master`.

**The document vault is excluded** (reusable passport/PAN scans per client). It isn't in the demo, so it may be a change request (§7 rule 16), and Q37 asks Shivanshu. If it is built later, it stores **Drive/OneDrive links**, not S3 uploads: uploads go against what Vimal said three times and against rule 4.

**Replaced 17 Oct 2026** by [0016](0016-client-documents.md): the vault is being built, in the private bucket (rule 4
changed to S3-compatible storage on 10 Oct 2026). Aadhaar cards are kept as scans; a typed Aadhaar number is still
not stored.

**Not stored:**

- **Aadhaar numbers.** Aadhaar rules restrict storing full numbers, and S11 (DPDP) is open. A masked copy can be a Drive link if a checklist ever needs it.
- **Consent.** That is its own model, one per person for life, keyed to `ClientMember` (not to the passport, since consent survives a passport change). It is built with Visa Step 2.
- **Passport history.** Old numbers stay in the audit log (`client.member.update` before/after).

### 2. Client fields

`kind` (INDIVIDUAL / CORPORATE, an enum because code branches on it), `name`, `contactPerson` (companies only), `email`, `addressLine`, `area`, `city`, `stateCode` (GST state code: it decides the place of supply on invoices), `pincode`, `pan`, `gstin`, `accountingCode` (unique), `billingCycleId` (defaults to the default cycle), `paymentHabitId`, `clientSince` (the IST date of creation, which is also the database default; the import may set an earlier one).

Cross-field rules (service and database):

- **Only companies have a contact person.** Switching a company to INDIVIDUAL clears it.
- **A GSTIN carries its holder's PAN** in characters 3–12. An empty PAN is filled from the GSTIN; a different PAN is refused. An empty state is filled from the GSTIN's first two digits; a different state is refused (amended 9 Oct 2026: the state decides the GST type on invoices, which are never edited). The database checks both (`Client_gstin_matches_pan`, `Client_gstin_matches_state`).
- PAN `AAAAA9999A`; GSTIN pattern + check character; passport 6–12 letters/digits (not just the Indian format, for NRI/OCI travellers). All stored uppercase without spaces.
- **Names (added 9 Oct 2026, service only).** A person's name (an INDIVIDUAL client, a contact person, a member, a client made at intake) is letters in any script, with vowel signs, plus spaces and `. ' -`. A company's name needs at least one letter ("3M India", "Shah & Sons"). It is checked when the name or the kind changes, so switching a company to INDIVIDUAL can be refused. There is no database check: the Excel import must decide what to do with old names that break the rule.
- **Mobile numbers** with anything besides digits, spaces, `+` and `-` are refused (`normaliseMobile` in `src/lib/contact.ts`), never cleaned: `98250abc41234` is a typo, not a number.

PAN is a typed field only. **PAN verification (Q23) is not built.**

### 3. Settings, not constants (§7 rule 1)

Rows in the `Setting` table, validated with zod, seeded by `db:seed`. The Head changes them with `PUT /api/clients/settings`, which is audited as `setting.update`.

| Key | Seeded value | Status |
| --- | --- | --- |
| `clients.invoiceReadiness` | `{ "INDIVIDUAL": ["name","addressLine","city","stateCode"], "CORPORATE": ["name","contactPerson","addressLine","city","stateCode","gstin"] }` | ⚠️ our proposal (Q33) |
| `clients.expiryWarnings` | `{ "passportRenewSoonMonths": 12 }` | ⚠️ matches the demo (Q35) |

The allowed readiness fields are a fixed list: name, contactPerson, email, addressLine, area, city, stateCode, pincode, pan, gstin, accountingCode. `contactPerson` can't be required for individuals.

**For the invoice module:** `assertInvoiceReady(clientId, tx)` in `src/modules/clients/readiness.ts` throws `422 { code: "CLIENT_INCOMPLETE", missing }`. Call it inside the transaction that raises an invoice, so "complete before invoicing" is enforced, not just shown.

### 4. Who can do what

Clients are shared by every department, so the routes use `requireAuth → requirePasswordChanged → requireUserType("HEAD", "OFFICE")` and the service decides the rest:

| Action | Who |
| --- | --- |
| Look up by mobile (New enquiry) | The Head and every office user. Field staff get 403. |
| List, search, create from the Clients tab | The Head, any HOD, Accounts (*Amendment 2*). An HOD lists only their departments' clients and clients with no case (*Amendment 4*) |
| View one client | The clients their list shows, or a client of a case they can see (*Amendments 2 and 4*) |
| Change clients, numbers, members, notes | A user who may view the client and has EDIT (or HOD) in **any** department |
| Set, change or clear `accountingCode`, `billingCycleId`, `paymentHabitId` | `can(user, "ACCOUNTS", "EDIT")`: Accounts or the Head (Q34). Sending an unchanged value is fine. |
| Change the settings | Head only |

### 5. Duplicates are warnings, not errors

A passport number, PAN, GSTIN or extra mobile already on file elsewhere is usually a double entry, but not always: one person can be in two families, and an accountant's number can sit on two companies. So:

1. The first save answers `409` with `details: { code: "DUPLICATE", duplicates: [{ field, value, matches: [{ clientId, clientName, clientMobile, memberId?, memberName? }] }] }`.
2. Staff check the matches and send the **same request** again with `"confirmDuplicates": true`.
3. The audit entry records `confirmedDuplicates`.

| Field | Compared with |
| --- | --- |
| `passportNumber` (members) | Other people not taken off a family list |
| `pan`, `gstin` (clients) | Other clients |
| `mobile` (new client, new main number, extra number) | Other clients' main and extra numbers |

Hard errors, by contrast: a second client with the same **main** number (`409 { code: "CLIENT_EXISTS", clientId }`), a used accounting code (409), a number already on this client (409).

Merging two client records is not built (not in the demo).

### 6. Optimistic locking

`PATCH /api/clients/:id` and `PATCH /api/clients/:id/members/:memberId` require the `updatedAt` the browser read. A mismatch gives `409 { code: "STALE" }` ("Someone else changed this client after you opened it. Reload and try again."). The update itself runs as `updateMany where { id, updatedAt }`, so a save that races past the check still fails instead of overwriting. Only changed fields are written and audited (before/after of those fields only); a request with no real change writes nothing.

### 7. Database rules

Hand-written in the migration, because the Excel import (Q29) and later writers bypass the service: mobile format on all three mobile columns, contact person only for CORPORATE, PAN and GSTIN format, GSTIN/PAN consistency, passport format, and at most one default billing cycle (partial unique index).

## API

All under `/api/clients`. Errors use the existing shape: `{ message }`, `{ message, details }` for HttpError, `{ message, issues }` for zod.

| Method + path | Who | Purpose |
| --- | --- | --- |
| `GET /lookup?mobile=` | View | "Existing client" check. `{ mobile, client: { id, name, kind, mobile, matchedOn: "PRIMARY" \| "SECONDARY" } \| null, alsoMatches }`. 400 for a bad number. |
| `GET /?q=&kind=&incomplete=&cursor=&limit=` | View | Search by name, contact person, member name, mobile (any part, main or extra), passport number, PAN, GSTIN or accounting code. `incomplete=true/false` filters by the readiness setting. Ordered by name; `{ clients, nextCursor }`. The "any part of" matches use pg_trgm GIN indexes. |
| `GET /options` | View | Billing cycles (with `isDefault`), payment habits, relations, GST states (by name, "Other Territory" last), kinds |
| `GET /settings` · `PUT /settings` | View · Head | `{ settings: { invoiceReadiness, expiryWarnings } }`; `PUT` takes either key |
| `POST /` | Edit (Accounts fields: Accounts) | Create; `mobile` and `name` are required (amended 9 Oct 2026). 201 `{ client }` (the profile) |
| `GET /:id` | View | Profile: client fields, `billingCycle`, `paymentHabit`, `readiness`, `phones`, active `members` (with `age`, `passportStatus` VALID / RENEW_SOON / EXPIRED), latest 20 `notes` |
| `PATCH /:id` | Edit (Accounts fields: Accounts) | Partial update with `updatedAt`. `""` or `null` clears a field. |
| `PUT /:id/mobile` | Edit | `{ mobile, keepOldAsSecondary = true }`: makes another number the main one. If it was an extra number of this client, it moves up. |
| `GET /:id/readiness` | View | `{ readiness: { ready, missing: [{ field, label }] } }` |
| `POST /:id/phones` · `DELETE /:id/phones/:phoneId` | Edit | Add (`{ mobile, label? }`, at most 5) or remove an extra number (204) |
| `POST /:id/members` · `PATCH /:id/members/:memberId` | Edit | Add, or update with `updatedAt` |
| `POST /:id/members/:memberId/archive` | Edit | Take off the family list (safe to repeat). An archived member can't be edited. |
| `GET /:id/notes` · `POST /:id/notes` | View · Edit | All notes, newest first · add one |

Every write records an audit entry in the same transaction: `client.create`, `client.update`, `client.mobile.change`, `client.phone.add`, `client.phone.remove`, `client.member.create`, `client.member.update`, `client.member.archive`, `client.note.add`, `setting.update`. Client entries carry `AuditLog.clientId` (indexed with `createdAt`), so a client's history is one query.

## Code

`Backend/src/modules/clients/`: `clients.routes.ts`, `clients.service.ts` (clients, numbers, notes, lookup, search, settings), `members.service.ts`, `clients.schemas.ts` (zod, GST states, GSTIN checksum), `access.ts` (permission rules), `duplicates.ts`, `readiness.ts`, `changes.ts` (no-op detection, optimistic locking), `client.ts` (DTOs, input clean-up), `clients.settings.ts`, `clients.seed.ts` (lookup rows, used by `db:seed` and the tests). Date-only helpers (IST "today") are in `src/lib/dates.ts`. Tests: `Backend/tests/clients.test.ts`.

## Not built (and why)

- **Document vault:** excluded for now (Q37).
- **Summary tiles** (business with us, open now, still to pay, messages sent) and "Everything we've done for this family": they come from the enquiry, invoice and message modules.
- **Consent:** with Visa Step 2.
- **Admin screens for the lookup tables:** with System Masters.
- **Merging duplicate clients, restoring an archived member, the Excel import (Q29), PAN verification (Q23):** not in the demo, or decided later.
- **Frontend:** built. `Frontend/src/pages/clients/` (directory `/clients`, profile `/clients/:id`).

## Points to review

1. **Readiness defaults** (Q33) are our proposal. Is an accounting code needed for every client before an invoice?
2. **Accounts-only billing fields** (Q34): is it right that Visa staff can't set a billing cycle when creating a corporate client?
3. **Extra-number limit of 5:** a sanity limit in code, not a business rule. Say if Masti needs more.
4. **Payment habits** (Q36): only "Part advance, rest on delivery" comes from the demo.
