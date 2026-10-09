# 0004 · Client master: clients, numbers, family members, notes

- **Status:** accepted and built (8 Oct 2026)
- **Date:** 8 Oct 2026
- **Changes:** replaces the `Client` model proposed in [0003](0003-visa-intake.md). It is a superset: `mobile @unique` and `createdById` are unchanged, so 0003's `GET /api/clients/lookup` contract still holds (extended below). 0003 adds the `enquiries` and `messages` relations when Visa Step 1 is built.
- **Order of work:** the client master is built before the System Masters (embassy holidays, rules, vendors, dropdown admin screens), which are on hold.

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

**Not stored:**

- **Aadhaar numbers.** Aadhaar rules restrict storing full numbers, and S11 (DPDP) is open. A masked copy can be a Drive link if a checklist ever needs it.
- **Consent.** That is its own model, one per person for life, keyed to `ClientMember` (not to the passport, since consent survives a passport change). It is built with Visa Step 2.
- **Passport history.** Old numbers stay in the audit log (`client.member.update` before/after).

### 2. Client fields

`kind` (INDIVIDUAL / CORPORATE, an enum because code branches on it), `name`, `contactPerson` (companies only), `email`, `addressLine`, `area`, `city`, `stateCode` (GST state code: it decides the place of supply on invoices), `pincode`, `pan`, `gstin`, `accountingCode` (unique), `billingCycleId` (defaults to the default cycle), `paymentHabitId`, `clientSince` (the IST date of creation, which is also the database default; the import may set an earlier one).

Cross-field rules (service and database):

- **Only companies have a contact person.** Switching a company to INDIVIDUAL clears it.
- **A GSTIN carries its holder's PAN** in characters 3–12. An empty PAN is filled from the GSTIN; a different PAN is refused. An empty state is filled from the GSTIN's first two digits.
- PAN `AAAAA9999A`; GSTIN pattern + check character; passport 6–12 letters/digits (not just the Indian format, for NRI/OCI travellers). All stored uppercase without spaces.

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
| View, search, look up | The Head and every office user. Field staff get 403. |
| Create and change clients, numbers, members, notes | The Head, or an office user with EDIT (or HOD) in **any** department |
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
| `POST /` | Edit (Accounts fields: Accounts) | Create; only `mobile` is required. 201 `{ client }` (the profile) |
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
