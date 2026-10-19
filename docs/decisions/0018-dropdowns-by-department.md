# 0018 · Follow-up and reason dropdowns, by department

- **Status:** decided and built (19 Oct 2026, project lead).
- **Date:** 19 Oct 2026
- **Scope:** the three dropdowns every case uses: **What happened** and **Next step** on a follow-up, and the
  **postpone / cancel reason**. Changes [0006](0006-visa-documents.md) Decision 7 ("shared by all departments, the Head
  or any HOD edits them"). The field lists (time slots, why a visit fails) stay shared.

## Context

The three lists were shared by every department. Only Visa is built, so that was fine, but as soon as Holidays, Hotels,
Insurance and Tickets arrive each department would see the others' values: Visa staff would get "Sent hotel options",
Hotels staff "Bank statement pending". Any HOD could also change a value another department relies on.

It also matters for the follow-up note staff asked for (M43, change request 8). Until Vimal answers, the way for an
employee to say "what to do next" is a more precise **Next step** value, and those values are department-specific.

## Decisions

1. **Each value is tagged with the departments it shows in**, one or more. "No answer" can be in all five; "Visa not
   needed" only in Visa. There are no copies of a value per department, so reports see one value. A value has at least
   one department (checked by the service, as a vendor's countries are; a join table can't carry the CHECK).
2. **A case lists, and accepts, only its department's values.** Logging a call, postponing and cancelling refuse a value
   not tagged with the case's department, with the same message as a switched-off one ("Pick what happened.").
3. **Who changes a value:** the Head, or an HOD of **every** department the value is tagged with, before and after the
   change. So a Visa HOD manages Visa-only values, and a value shared by several departments is in practice the Head's.
   An HOD can't take over another department's value or give theirs to another department. Staff never edit.
4. **Departments to pick from:** active ones. A department switched off since the value was tagged may stay on it.
   The Settings screen offers the selling departments (not Accounts, which raises no enquiries).
5. **Seeded tags (⚠️ our proposal, editable):** values about collecting papers or the visa itself go to Visa only;
   the rest go to all five selling departments (Visa, Holidays, Hotels, Insurance, Tickets).

   | List | Visa only | All five |
   | --- | --- | --- |
   | What happened | Spoke — documents coming · Documents complete | No answer · Asked to call later · Wants to postpone · Wants to cancel |
   | Next step | Send collection boy | Client will visit office · Call again |
   | Reasons | Visa not needed · Documents not available | Travel dates moved · Waiting for leave approval · Went with another agent · Trip cancelled · Price higher · No reply |

   Re-seeding never changes a value's tags, like its other fields. Each department adds its own values when it is built.
6. **Audited** like every master change: the departments are in the audit's before and after, as codes. Sending the
   same set in another order changes nothing and writes nothing.

## Schema

Three join tables, like `VendorCountry`: `FollowUpOutcomeDepartment (outcomeId, departmentId)`,
`FollowUpNextStepDepartment (nextStepId, departmentId)` and `EnquiryReasonDepartment (reasonId, departmentId)`, each
keyed on the pair, indexed on `departmentId`, `ON DELETE RESTRICT`. Migration `20261019120000_dropdown_departments`.

Rows made before the migration have no departments and show nowhere: reset and reseed the dev database
(`npx prisma migrate reset`, then `npm run db:seed`).

## API

| Endpoint | Change |
| --- | --- |
| `GET /api/masters/follow-up-outcomes` · `/follow-up-next-steps` · `/enquiry-reasons` | Each row has `departments: string[]` (codes, in the departments' order) |
| `POST` the same | `departments` is required: at least one code, any case, duplicates dropped. 400 `issues.departments` for an unknown or switched-off department; 403 unless the Head or HOD of each |
| `PATCH …/:id` | `departments` is optional and replaces the set. 403 unless the Head or HOD of every department before and after |
| `POST /api/enquiries/:caseNo/follow-ups` · `/postpone` · `/cancel` | A value not tagged with the case's department is a 400 on `outcomeId`, `nextStepId` or `reasonId` |

## Tests

- `tests/enquiryMasters.test.ts`, *department tags (0018)*: the seeded tags; at least one active department (a
  switched-off one may stay); an HOD changes only their own departments' values, the Head any; the audit holds the codes,
  and an unchanged set writes nothing.
- `tests/enquiryActions.test.ts`, *values of another department*: a Hotels-only outcome, next step, postpone reason and
  cancel reason are each refused on a visa case.

## Not in this record

- **A free-text note on a follow-up** (M43, change request 8): waits for Vimal.
- **Filtering the Settings lists by department.** Each row shows its departments; a filter can come when the lists grow.
