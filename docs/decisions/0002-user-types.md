# 0002 · User types: Head, Office and Field

- **Status:** accepted
- **Date:** 8 Oct 2026
- **Changes:** the Roles section of [0001](0001-auth-sessions.md) (`User.isHead` and the `FIELD` department are gone)

## Context

The collection/delivery boy (§8, §12.5) picks up documents, delivers passports and collects payments for **every** department. He has only a phone. He must not reach the desktop CRM at all, only a phone view of his own stops (`/tasks`).

0001 handled him as a member of a `FIELD` department. That was a workaround:
- **The meaning was wrong.** A department membership says "works in this department". He works for all of them, and "HOD of FIELD" or "FIELD with EDIT" meant nothing.
- **Keeping him out meant "deny if…" checks.** Every desktop surface would have to check "is in FIELD and nothing else". One forgotten check would be a leak.
- **Access hung on editable data.** Departments are admin-editable rows. Renaming or deactivating the FIELD row would silently change who can log in where.
- **It leaked into business data.** Department lists, colours, filters and reports would all have to skip a department that isn't one.

The options considered were:
- an `isFieldWorker` boolean next to `isHead`, which allows "Head and field worker" and grows another flag per new kind of account
- the dummy department we had
- one account-type column

## Decision

**One account type per user, in place of `isHead`:**

```prisma
enum UserType { HEAD  OFFICE  FIELD }   // User.type, default OFFICE
```

| Type | Who | Gets |
|---|---|---|
| `HEAD` | Vimal | Every department, desktop CRM, Settings. No department rows. |
| `OFFICE` | Everyone in the office | Desktop CRM through `UserDepartment` (STAFF/HOD, VIEW/EDIT), unchanged from 0001. Needs at least one department. |
| `FIELD` | Collection/delivery boy | `/tasks` only: the jobs assigned to him, whatever department raised them. No department rows. Needs a mobile. |

**Why an enum and not a master table** (golden rule 1 wants masters as tables): each value is wired to code (which app, which guards). A new type needs a deploy anyway, so it isn't admin-editable data. This is the same reasoning as `DepartmentRole` and `Access`.

**Field jobs carry their own scope.** `FieldJob` has a `departmentId`, the desk that raised it, for that desk's lists and reports, plus an `assigneeId` (any user). A field worker's access comes from assignment, not from a department. Only the skeleton exists so far. Job type, status (both master tables), slot, address, amount and handover proof come with the field module.

**Enforced in three layers:**

| Layer | What |
|---|---|
| Database (migration `add_user_types`, hand-written SQL) | `CHECK "User_field_needs_mobile"`: a FIELD user must have a mobile. Trigger `UserDepartment_office_only`: refuses department rows for non-OFFICE users. Trigger `User_type_without_departments`: refuses changing a user with department rows away from OFFICE. The first trigger takes `FOR SHARE` on the user row, so a concurrent type change can't slip past (READ COMMITTED). |
| API | `can()` / `isHodOf()` return false for anything but HEAD/OFFICE, so every `requireDepartment` route already refuses field staff. `requireHead` checks `type === "HEAD"`. `requireUserType(...)` guards routes with no department check (`GET /api/departments` is HEAD/OFFICE only). The users API validates the same rules as the database, with readable messages. Making someone HEAD or FIELD drops their department rows in the same transaction, before the type changes. |
| Frontend (convenience only) | `RequireDesktop` sends FIELD users to `/tasks`; `RequireField` sends everyone else to `/`. Users screen: an "Account type" picker; department access shows only for office staff. |

**Office network (Q14):** the setting's `exemptDepartments` became `exemptUserTypes`, default `["FIELD"]`.

## Consequences

- `/api/auth/*` (login, me, change password) works for every type. Field-only API routes go under `/api/field/*` with `requireUserType("FIELD")`, and return only the caller's assigned jobs.
- Seed: no `FIELD` department any more. If there is no Head but a user matches `SEED_HEAD_MOBILE`/`SEED_HEAD_EMAIL`, the seed makes that user Head (this is how existing dev databases got their Head back after `isHead` was dropped).
- Existing dev databases keep their old `FIELD` department row. Deactivate it (`UPDATE "Department" SET "isActive" = false WHERE code = 'FIELD'`) or recreate the database. Fresh databases never have it.
- One type per user. Someone who is both office staff and occasionally does runs is OFFICE. Whether they may open `/tasks` is open (see below).

## Open

- **Can office staff cover a run** (e.g. Accounts on the collection boy's day off)? The data model allows it already (`FieldJob.assignee` is any user). If yes, open the `/api/field/*` routes and `/tasks` to any user with assigned jobs, and keep blocking FIELD users from the desktop. *QUESTIONS_TO_ASK M35 · PROJECT_KNOWLEDGE §18 #31.*
- **Q3** (phone or tablet; web app or WhatsApp-only) is still open. The design holds either way: with WhatsApp-only jobs, FIELD users are assignees who never log in.
- **Session length on a phone:** the 12 h idle timeout logs the collection boy out daily. Per-type session settings may be needed once the field app is in use.
