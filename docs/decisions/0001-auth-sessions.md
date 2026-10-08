# 0001 · Authentication: server-side sessions, roles per department

- **Status:** accepted
- **Date:** 8 Oct 2026

## Context

The client needs:
- department-wise users with Staff → HOD → Head roles and view/edit rights
- disabling a leaver to end **all** their access at once ("ek jagah pe bande ko disable kiya, khatam ho gaya")
- a full audit trail
- maybe an office-network-only login (open question Q14)

Staff are not technical, and the collection boy has only a phone.

## Decision

**Sessions**

| Topic | Choice |
|---|---|
| How sessions work | Server-side sessions stored in Postgres (`Session` table), not JWTs |
| Cookie | Random 32-byte token in an httpOnly `masti_sid` cookie. `SameSite=Lax`, and `Secure` in production. |
| What's stored | Only the token's SHA-256 hash |
| Expiry | Idle timeout 12 h and an absolute limit of 7 days (`SESSION_IDLE_HOURS`, `SESSION_MAX_DAYS`) |
| Deactivation | Deactivating a user (or resetting their password) deletes their sessions, so the next request returns 401 |

**Passwords and login**

| Topic | Choice |
|---|---|
| Hashing | argon2id (`@node-rs/argon2`) |
| New users and resets | Get a readable temporary password, shown once, which must be changed at first login (`mustChangePassword`) |
| Login | **Mobile number or email** in one field. Mobiles are normalised to `+91XXXXXXXXXX`; emails are lowercased. |
| Failed logins | One generic error message. A dummy hash check runs for unknown users, so timing doesn't reveal accounts. |
| Rate limit | 10 failed attempts per 15 min per IP + identifier |

**Roles**

| Topic | Choice |
|---|---|
| Head | `User.isHead`: everything. *Replaced by `User.type` (HEAD/OFFICE/FIELD) in [0002](0002-user-types.md).* |
| Departments | Per-department `UserDepartment(role STAFF/HOD, access VIEW/EDIT)`. An HOD always has EDIT in their department. |
| Helpers | `can()` and `isHodOf()` in `Backend/src/modules/auth/permissions.ts`; middleware `requireAuth`, `requireHead`, `requireDepartment(code, access)` |
| Departments as data | Department rows, not an enum, so Phase-2 departments don't need a migration |
| User management | Head only for now (whether HODs manage their own team is open) |

**Audit**

| Topic | Choice |
|---|---|
| Storage | Append-only `AuditLog` table. A database trigger rejects UPDATE and DELETE. |
| Helper | `audit()` in `Backend/src/lib/audit.ts`. It strips password and token hashes and is reused by every module. |

**Other protections**

| Topic | Choice |
|---|---|
| CSRF | `SameSite=Lax` plus every state-changing `/api` request must be `application/json` (`requireJson`) |
| Office network | `Setting` key `officeNetwork`. **Off by default.** When on, only listed IPs/CIDRs may use the CRM; FIELD staff are exempt (`exemptUserTypes` since 0002). Waiting on Q14. |

## Why not JWT

A stateless token stays valid until it expires, so deactivation wouldn't be immediate without a deny-list, and a deny-list is a session table anyway. Sessions are simpler, need no extra service, and run on Masti's own Postgres.

## Consequences

- One extra indexed lookup per request (the session and user with departments). The `lastSeenAt` write happens at most every 5 minutes.
- If the CRM is served on a different domain from the API, `CLIENT_URL` and the cookie settings need revisiting. Same-origin via a reverse proxy is the expected production setup.
- Production behind nginx needs `TRUST_PROXY` set so `req.ip` (audit, rate limit, office network) is the real client IP.
