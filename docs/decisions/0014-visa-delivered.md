# 0014 · Visa Step 8: delivered

- **Status:** decided (17 Oct 2026, project lead). Being built one component at a time (Decision 1). Built: the office
  handover (17 Oct 2026, component 1). A "Built" note is added under each part as its component lands.
- **Date:** 17 Oct 2026
- **Scope:** handing the passports back to the client once they're in our stock (Step 7), and closing the file:
  - the client collects at our office
  - booking a delivery, the delivery boy's phone screen, and the doorstep handover
- **Builds on:**
  - [0013](0013-visa-passport-back.md) Decision 5: "Mark received" (the stock count, the stickers checked)
  - [0002](0002-user-types.md): field staff (`FIELD` users, `/tasks`, `/api/field/*`, their own jobs)
  - [0005](0005-system-masters.md): the office calendar (`MASTI_OFFICE`) for delivery days
  - [0006](0006-visa-documents.md) Decision 1: who sees a case (amended here, Decision 5)
  - [0011](0011-visa-at-vendor.md) Decision 6: a recalled file closes after the normal handover

## Context

What a case looks like when it reaches this step:

| Field | Value |
| --- | --- |
| `Enquiry.stage` | `PASSPORT_BACK` (status "Passports in our stock", next step "Hand over to the client") |
| `Enquiry.dueAt` | an open case: the next open office day at 11:00 after receipt (`visa.handoverCheck`), to arrange the handover |
| `VisaCase.passportsReceivedAt`, `bookletsBackCurrent`, `bookletsBackOld` | in our stock since, and the booklets counted then |

The `DELIVERED` stage is seeded as "Delivered", status "Delivered", next step "See cross-sell leads".

What the sources say:

| Source | What it says |
| --- | --- |
| Demo ⚠️ (screen 13) | Card **Handed back to the client**, chip "Delivered · Sat 31 Oct, 12:10 pm", a toggle **Client collects from office / Our delivery boy**, tiles "OTP from client · Verified", "Photo of receiver · Saved", "Delivery boy selfie · Saved", "Place & time · Vesu · 12:10 pm", "See the delivery boy's app". A second card lists the cross-sell leads made at invoicing. Header chip "Delivered", button "See cross-sell leads →". WhatsApp "Delivered: Passports handed to Rakesh Mehta at 12:10 pm." |
| Demo ⚠️ (screen 14, the field app) | "Ramesh's run · Sat 31 Oct · Collection & delivery · 3 of 5 done"; a stop "Deliver passports · Mehta family · V-2041 · B-702, Raghuvir Residency, Vesu · 11–1", Call and Directions, "Hand over · 4 passports + 3 old", four steps (booklets counted "— matches the office count", OTP from the client, photo of the person receiving, your selfie at the door "Place and time are added by the phone"), and "Finish handover · 3 steps left" until every step is done. |
| Meeting ✅ (7:10–7:13 PM) | Two ways: the client collects, or our man delivers. "Even if he comes himself", the handover is recorded with the photo "we designed earlier" and the OTP, and the number of booklets. The boy photographs the receiver and himself; location and time are recorded; the file closes, separate from any outstanding money. A notification goes out either way. |
| PID | "a field-staff screen for pickups and passport handover with OTP, photo and location". |
| PROJECT_KNOWLEDGE §11, §12.4, §12.5 | The same proof; "The handover can't finish without every step"; "The case closes; Accounts follows up anything outstanding". The field screen is a phone web view, Stage 1. |

Nobody has designed how a delivery is booked, or how the boy is assigned: the demo only has the WhatsApp line
"Delivery booked for Sat 31 Oct, 11 am – 1 pm".

## Decision

### 1. Build order: one component at a time

**Decided 17 Oct 2026 (project lead):** the office handover first, so cases can close before the field module exists.
Each component is planned in plan mode, built, tested, checked in the browser and committed before the next starts:

1. **The office handover** (Decisions 2–6): the client collects; the case is Delivered and closes
2. **Book a delivery:** the day, the slot and the delivery boy (a field job)
3. **The delivery boy's phone screen:** his run for the day
4. **The doorstep handover:** booklets, OTP, photo of the receiver, selfie with place and time

### 2. The OTP goes by email for now

**Decided 17 Oct 2026 (project lead):** there's no SMS or WhatsApp sending yet (M2), so the handover OTP goes to the
client by email until one is connected. It's needed only at the doorstep (component 4). What happens for a client with
no email is decided when component 4 is planned.

### 3. At the office: what's recorded

**Decided 17 Oct 2026 (project lead):**
- **The booklets counted** again, current and old.
- **Who collected them:** a traveller on the case, or someone else, by name.
- **A photo of that person,** taken at the desk.
- **Who handed them over, and when:** the staff member who saves it, now (audited).

### 4. The count must match our stock

**Decided 17 Oct 2026 (project lead):** what's handed over must match the count when the passports came in (Step 7).
If it doesn't, the handover is refused: something is missing in our office, so find it first. (Unlike Step 7, where a
short packet is still received and shown red.)

### 5. Who: any Visa staff at the desk

**Decided 17 Oct 2026 (project lead):** any Visa staff with EDIT can hand the passports over, not only the case's
processor: whoever is at the desk when the client walks in. **Amends 0006 Decision 1:** while a case's passports are in
our stock (received, not yet handed over), Visa staff with EDIT can open it and find it in their list; only the
handover is theirs, everything else stays with its processor, the Visa HOD or the Head. Once delivered, the case is back
to the normal rule.

### 6. The photo

**Decided 17 Oct 2026 (project lead):** "Take photo" uses the computer's webcam in the page; "Upload a photo" picks a
file (e.g. taken on a phone). On a phone or tablet the page opens the camera. Camera access needs HTTPS in production.

### 7. Postponed or cancelled

**Decided 17 Oct 2026 (project lead):** the passports are handed over whatever the case's status (chain of custody). An
open or postponed case becomes **Delivered** and **closed**; a cancelled case stays cancelled, with its reason, but
records the handover and moves to Delivered.

**Built 17 Oct 2026** (component 1, the office handover, Decisions 3–7):
- **Data** (migration `20261017120000_office_handover`): `VisaHandover` (one per case: `mode` OFFICE / DELIVERY, `at`,
  `byId`, the booklets, `receiverTravellerId` or `receiverName`, `receiverPhotoId`); a case file of kind
  `RECEIVER_PHOTO` (a JPEG or PNG, with no page count). CHECKs: exactly one receiver; the name not blank, 2–100; each count
  0–50 and at least one; an office handover has its photo; a photo has no pages and a PDF has some
  (`CaseFile_size_and_pages`); a closed enquiry has no due time or resume date (`Enquiry_closed_not_due`).
- **Who sees and acts** (0006 amendment 13): `visibleEnquiryWhere` and `canSeeEnquiry` let Visa staff with EDIT see a
  case whose passports are in our stock (`passportsInStock`); the step rule `HANDING_OVER` (Passport back, any status,
  `anyEditor`) lets any of them hand over. Everything else on the case still needs its owner, the HOD or the Head.
- `POST /api/visa/cases/:caseNo/handover/photo`, the JPEG or PNG itself as the body (checked by its first bytes,
  `lib/images.ts`, shared with the company logo; size limit `visa.handoverPhoto`): stored privately under
  `cases/<id>/handover/`, a case file audited as `visa.file.upload`; the case doesn't change.
- `POST /api/visa/cases/:caseNo/handover` with `{ mode: "OFFICE", booklets, receiver: { travellerId } | { name },
  photoId, updatedAt }`. Refused with 409 before the passports are in our stock or at another step, STALE; 400 under
  `booklets` ("Count again: our stock has 2 current + 1 old. Find what's missing before handing over."), `receiver`,
  `photoId` or `mode` (DELIVERY comes with component 4).
- **In one transaction under the case lock:** the handover; the case moves to Delivered with no due time; an open or
  postponed one closes (reason and resume date cleared), a cancelled one stays cancelled; audit `visa.handover`.
- **The case** sends `handover { mode, at, by, booklets, receiver { name, travellerId }, photo }`.
- **Screen:**
  - "Hand over to the client →" in the header of an open case in our stock, for any Visa staff with EDIT, and **Hand
    over** on the Passports coming back card for any status.
  - **The form:** "Client collects from office" (the delivery boy's option comes later); blank booklet boxes beside "In
    our stock: 2 current + 1 old", red and blocked until they match; who collected them (each traveller, or Someone
    else with a name); **Take photo** (the computer's camera in the page) or **Upload a photo**, shrunk in the browser
    to at most 1600 px and saved straight away, with Retake; "Handed over by {name}, now". A message goes as soon as
    its field is fixed.
  - **Handed back to the client** (demo screen 13): the chip "Delivered · Sat 17 Oct, 12:28" and tiles for the
    booklets, who collected them, the photo (Open; "Saved" for desk staff, who can't open the case once it's
    delivered) and who handed them over. The header chip reads "Delivered".
  - The enquiries list has a **Closed** tab.

### 8. Settings and seed data (golden rule 1)

| What | Seeded with |
| --- | --- |
| `visa.handoverPhoto` (the largest photo the server accepts) | `{ maxMb: 5 }` ⚠️ |
| The card and dialog wording | the demo's, or ours ⚠️ |

**Defaults (not asked; say if any is wrong):**
- **E-visas** stay at Step 6 (M39). **A recalled file** is handed over the same way.
- **The photo** is shrunk in the browser to at most 1600 px (JPEG) and uploaded as soon as it's taken; "Hand over" then
  links it. A photo from a dialog that was cancelled stays as an unlinked, audited case file (files are never deleted).
- **A closed case** has no due time; it leaves the open lists and shows under a new **Closed** tab.

## Not in this record

- **Cross-sell leads** (the Step 8 card and "See cross-sell leads →"): the cross-sell module comes later; the button
  stays "Soon".
- **WhatsApp to the client** ("Passports are at our office", "Delivered"): waits for the WhatsApp work.
- **Collecting money at delivery** (the demo's "collect payment" stops): Accounts.
- **The Step 2 pickup job** ("Send collection boy"): the field module, after component 3.

## Still needed from Masti

- **M14 / Q12:** confirm the handover steps (we build booklets, OTP, receiver photo, selfie with place and time).
- **Q3:** the delivery boy's device (we build a phone web page).
- **M2:** the SMS / WhatsApp accounts (the OTP goes by email until then).
- **M15 / Q38:** whether Sundays and office holidays block deliveries (seeded: yes).
- **S11:** DPDP: how long receiver photos, selfies and locations are kept.
