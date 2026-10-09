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
| `docs/decisions/` | Decision records (start with `0001-auth-sessions.md`) |
| `Masti-CRM-Handover/` | Requirements, the contract (PID), and the approved clickable demo and its screenshots. Gitignored, local only. |

## Commands

| Where | Commands |
|---|---|
| `Backend/` | `npm run db:up` (local Postgres via docker compose), `npm run db:migrate`, `npm run db:generate` (run after every schema change), `npm run db:seed`, `npm run dev` (port 5000), `npm test`, `npm run typecheck`, `npm run build` |
| `Frontend/` | `npm run dev` (port 5173), `npm run build`, `npm run typecheck`, `npm run lint` (oxlint) |

`Backend/.env` (see `.env.example`) and `Backend/.env.test` are gitignored; never commit them or print their values. Tests wipe the database named in `.env.test`.

## Building new routes

Protect them with `requireAuth`, then `requirePasswordChanged`, then `requireDepartment(code, 'VIEW' | 'EDIT')` (or `requireHead`) from `src/middleware/auth.ts`. A route with no department check needs `requireUserType(...)`; field staff only get `/api/auth/*` and their own jobs (`docs/decisions/0002-user-types.md`).

Each feature is a folder in `Backend/src/modules/<feature>/`: `*.routes.ts` (HTTP only), `*.service.ts` (rules, queries, transactions, audit; no `req`/`res`) and `*.schemas.ts` (zod; imports only zod and `generated/prisma/enums`).

Inside the route and its service:
- Read the user with `currentUser(req)` (or `actorOf(req)`, the user plus IP for audited changes) in the route and pass it to the service.
- Shared helpers live in `src/lib/`: `contact.ts` (mobile/email clean-up), `prismaErrors.ts` (`isUniqueViolation`, `rethrowUnique`), `settings.ts` (`saveSetting`), `dates.ts`, `audit.ts`, `httpError.ts`. Reuse them rather than copying.
- Check finer rules with `can()` / `isHodOf()`.
- Write `audit({...}, tx)` for every change, in the same transaction.
- Throw `HttpError` helpers for errors.

See PROJECT_KNOWLEDGE.md §16.4.

## Non-negotiable rules

Details are in PROJECT_KNOWLEDGE.md §7.

1. **The demo is the scope, not the spec.** Values marked ⚠️ (intervals, %, windows, wording) become configurable master data seeded with the demo value. Never hard-code them.
2. **No free text** for reasons, outcomes or statuses. Use dropdowns backed by admin-editable master tables. Reports read only structured fields.
3. **Invoices** are generated from the quote breakup and **never edited**. Corrections go only through a credit note or the one additional invoice allowed per visa file. This is not accounting software.
4. **Documents are Drive/OneDrive links**, not uploads. Clients never upload; scanning happens in the office.
5. **Audit everything:** who and when (to the minute), plus GPS for field actions.
6. **Roles are Staff → HOD → Head**, scoped by department. HOD-only: refund override, vendor approval, portal password reset. Disabling a user ends all of their access.
7. **Client updates go out automatically on WhatsApp** (Business API with approved templates), triggered by state changes.
8. **Staff never see portal credentials** ("Log in for me" vault, rotation, office network only).
9. **Portable and Masti-owned:** self-hostable, no secrets in code, no lock-in to hosted-only services, exclusive to Masti.
10. **Match the approved look:** cream `#FBF8F3`, sea blue `#1E5AA8`, Outfit + Nunito Sans, colour-coded departments (§15).

## Working rules

- **Before encoding a business rule,** check §17 (where sources disagree), §18 (open questions) and `QUESTIONS_TO_ASK.md` (the questions still waiting on answers). If it's unresolved, make it configurable and say so.
- **Out-of-scope work:** a feature that isn't in the demo screens may be a paid change request. Flag it; don't build it quietly.
- **Testing:** test the money and rule logic (invoice immutability, refunds, follow-up caps, holiday-blocked dates, permissions).
- **Keeping docs current:** when a decision is made, update `PROJECT_KNOWLEDGE.md` and `Masti-CRM-Handover/05_Open_Questions.md`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `Chavda-Mitul/Masti-CRM`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context. `CONTEXT.md` sits at the root and is created lazily. Decision records live in `docs/decisions/`, not `docs/adr/`. See `docs/agents/domain.md`.
