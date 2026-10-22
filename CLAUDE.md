# Masti Travels CRM

Acceleret is building a custom CRM for **Masti Tours & Travels**, a B2C travel agency in Surat whose owner, Vimal, makes the final decisions. It covers:
- enquiries for Visa, Holidays, Hotels, Insurance (+ claims) and Tickets
- follow-ups and cross-sell
- invoices and payment follow-up
- reports
- automatic WhatsApp updates to clients
- a phone screen for the field collection/delivery boy

Go-live is **1 Jan 2027**, delivered in 3 stages: Visa → Departments → Final + go-live. It runs on Masti's own servers, and Masti owns the code.

**Full project knowledge: [PROJECT_KNOWLEDGE.md](PROJECT_KNOWLEDGE.md).** Read the relevant section before designing or building any feature. The source pack is `Masti-CRM-Handover/` (start with `00_START_HERE.md`); treat it as read-only reference.

## Repo layout

| Folder | What it is |
|---|---|
| `Backend/` | Express 5 + TypeScript (strict, compiles to CommonJS) + Prisma 7 (`prisma-client` generator → `generated/prisma`, `@prisma/adapter-pg`) + PostgreSQL. Auth is built: server-side sessions, account types (Head / Office / Field) with Staff/HOD roles per department for office staff, an append-only audit log, a Head-only users API, and tests. |
| `Frontend/` | React 19 + Vite 8 + TypeScript, React Router, TanStack Query. Vite proxies `/api` to `http://localhost:5000`. All API calls go through `src/lib/api.ts`. |
| `Helper/` | The CRM helper: a Chrome extension (Manifest V3, TypeScript, built into `Helper/dist`) that types a portal's saved login for "Log in for me" (`docs/decisions/0024-portal-logins.md`). Its own package; see `Helper/README.md`. |
| `docs/decisions/` | Decision records (start with `0001-auth-sessions.md`) |
| `Masti-CRM-Handover/` | Requirements, the contract (PID), and the approved clickable demo and its screenshots. Gitignored, local only. |

## Commands

| Where | Commands |
|---|---|
| `Backend/` | `npm run db:up` (local Postgres + MinIO, the S3-compatible document store, + Mailpit, which catches outgoing email at http://localhost:8025, via docker compose), `npm run db:deploy` (apply migrations), `npm run db:generate` (run after every schema change), `npm run db:seed`, `npm run dev` (port 5000), `npm test` (needs `npm run db:up`: it uses its own database and MinIO bucket, and Mailpit), `npm run typecheck`, `npm run build`, `npm run whatsapp:test -- <mobile>` (one test WhatsApp through `WHATSAPP_PROVIDER`, `docs/decisions/0020-whatsapp-sending.md`), `npm run ai:test` (one test AI answer through `AI_PROVIDER` and `AI_MODEL`, `docs/decisions/0023-ai.md`) |
| `Frontend/` | `npm run dev` (port 5173), `npm run build`, `npm run typecheck`, `npm run lint` (oxlint) |
| `Helper/` | `npm run build` (then Load unpacked `Helper/dist` in Chrome), `npm test`, `npm run typecheck`, `npm run serve:test-portals` (pretend portals on port 5199) |

Make new migrations with `prisma migrate diff` and remove its proposed `DROP INDEX "HolidayTarget_unique"` (hand-written SQL that must stay). `npm run db:migrate` (`prisma migrate dev`) stops at a prompt over that index and holds the migration lock.

`Backend/.env` (see `.env.example`) and `Backend/.env.test` are gitignored; never commit them or print their values. Tests wipe the database named in `.env.test`.

## Building new routes

Protect them with `requireAuth`, then `requirePasswordChanged`, then `requireDepartment(code, 'VIEW' | 'EDIT')` (or `requireHead`) from `src/middleware/auth.ts`. A route with no department check needs `requireUserType(...)`; field staff only get `/api/auth/*` and their own jobs (`docs/decisions/0002-user-types.md`). Three routers have no session on purpose: `/api/public/consent`, the client's consent page (0022); `POST /api/portal-helper/redeem`, for the CRM helper only (0024); and `/api/public/message-files`, the file a WhatsApp message carries, fetched by the provider with a short-lived key (0025). Don't add another without a decision record.

Each feature is a folder in `Backend/src/modules/<feature>/`: `*.routes.ts` (HTTP only), `*.service.ts` (rules, queries, transactions, audit; no `req`/`res`) and `*.schemas.ts` (zod; imports only zod, `generated/prisma/enums` and other `*.schemas.ts` files, so it stays shareable with the frontend). Fields several modules validate alike (PAN, GSTIN, the GST states, a person's name) live in `src/lib/shared.schemas.ts`, not in one module's schemas.

Inside the route and its service:
- Read the user with `currentUser(req)` (or `actorOf(req)`, the user plus IP for audited changes) in the route and pass it to the service.
- Shared helpers live in `src/lib/`: `contact.ts` (mobile/email clean-up), `prismaErrors.ts` (`isUniqueViolation`, `rethrowUnique`), `settings.ts` (`saveSetting`), `dates.ts`, `audit.ts`, `httpError.ts`, `logger.ts` (the server log; use `logger`, never `console`). Reuse them rather than copying.
- Check finer rules with `can()` / `isHodOf()`.
- Write `audit({...}, tx)` for every change, in the same transaction.
- Tell the client with `queueMessage(tx, …)` (`src/modules/messages`), in the same transaction; never call `sendWhatsApp` from a service. Background work runs on pg-boss (`src/lib/jobs.ts`, `docs/decisions/0021-whatsapp-outbox.md`).
- Use AI only through `askAi()` (`src/lib/ai`), with the use listed in `src/lib/ai/useCases.ts`, and never inside a transaction (`docs/decisions/0023-ai.md`). Send it only what the answer needs, never a passport number.
- Throw `HttpError` helpers for errors.

See PROJECT_KNOWLEDGE.md §16.4.

## Non-negotiable rules

Details are in PROJECT_KNOWLEDGE.md §7.

1. **The demo is the scope, not the spec.** Values marked ⚠️ (intervals, %, windows, wording) become configurable master data seeded with the demo value. Never hard-code them.
2. **No free text** for reasons, outcomes or statuses. Use dropdowns backed by admin-editable master tables. Reports read only structured fields.
3. **Invoices** are generated from the quote breakup and **never edited**. Corrections go only through a credit note or the one additional invoice allowed per visa file. This is not accounting software.
4. **Documents live in S3-compatible storage** (AWS S3 or R2; MinIO locally), private, shared through short-lived pre-signed URLs (decided 10 Oct 2026; it was Drive/OneDrive links). Clients never upload; scanning happens in the office.
5. **Audit everything:** who and when (to the minute), plus GPS for field actions.
6. **Roles are Staff → HOD → Head**, scoped by department. HOD-only: refund override, vendor approval, portal password reset. Disabling a user ends all of their access.
7. **Client updates go out automatically on WhatsApp** (Business API with approved templates), triggered by state changes.
8. **Staff never see portal credentials** ("Log in for me" vault, rotation, office network only).
9. **Portable and Masti-owned:** self-hostable, no secrets in code, no lock-in to hosted-only services, exclusive to Masti.
10. **Match the approved look:** cream `#FBF8F3`, sea blue `#1E5AA8`, Outfit + Nunito Sans, colour-coded departments (§15).

## Working rules

- **Before encoding a business rule,** check §17 (where sources disagree), §18 (open questions) and `QUESTIONS_TO_ASK.md` (the questions still waiting on answers). If it's unresolved, make it configurable and say so.
- **Out-of-scope work:** a feature that isn't in the demo screens may be a paid change request. Flag it; don't build it quietly. Add it to [docs/change-requests.md](docs/change-requests.md).
- **Testing:** test the money and rule logic (invoice immutability, refunds, follow-up caps, holiday-blocked dates, permissions).
- **Keeping docs current:** when a decision is made, update `PROJECT_KNOWLEDGE.md` and `Masti-CRM-Handover/05_Open_Questions.md`.
- **We're still in development: no patches for old data.** There is no live data before go-live, so change things properly. A rule that becomes required is required in the database too (`NOT NULL`, a CHECK). Write no backfills, legacy fallbacks, "saved before this change" warnings or code paths for rows that the new rule forbids. Reset or reseed the dev database instead (`npx prisma migrate reset`, then `npm run db:seed`), and say so when a migration needs it.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `Chavda-Mitul/Masti-CRM`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context. `CONTEXT.md` sits at the root and is created lazily. Decision records live in `docs/decisions/`, not `docs/adr/`. See `docs/agents/domain.md`.
