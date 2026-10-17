# 0015 · The field staff app (collection and delivery boy)

- **Status:** decided (17 Oct 2026, project lead). Being built one phase at a time (Decision 1). Built: booking a
  pickup (17 Oct 2026, phase 1); booking a delivery (17 Oct 2026, phase 2); his run on his phone (17 Oct 2026,
  phase 3). A "Built" note is added under each part as its phase lands.
- **Date:** 17 Oct 2026
- **Scope:** the collection and delivery boy's jobs, attached to the visa flow at both ends:
  - **Step 2:** "Send collection boy": he picks the client's documents up from home
  - **Step 8:** "Our delivery boy": he hands the passports over at the client's door
  - booking him from the office, his phone website, and what he records at each stop
- **Builds on:**
  - [0002](0002-user-types.md): `FIELD` users (`/tasks`, `/api/field/*`, their own jobs) and the `FieldJob` skeleton
  - [0006](0006-visa-documents.md) Decision 4: "Client brings them / Send collection boy" (`VisaCase.arrival`)
  - [0014](0014-visa-delivered.md): the office handover and the doorstep proof (this record replaces its components
    2–4)
  - [0005](0005-system-masters.md): the office calendar (`MASTI_OFFICE`) for collection and delivery days

## Context

What the sources say:

| Source | What it says |
| --- | --- |
| PROJECT_KNOWLEDGE §12.5 | "Field staff app (collection/delivery boy)", Stage 1: a mobile-friendly web view, not a native app. "Ramesh's run · Sat 31 Oct · Collection & delivery · 3 of 5 done"; stops in order; stop types **pick up visa documents**, **deliver passport (OTP on handover)**, **collect payment**; each stop with client · case, address, time slot, **Call** and **Directions**; the passport handover can't finish until every step is done (booklets, OTP, photo of the receiver, selfie with place and time). |
| §11 (the Mehta case) | Step 2: "the collection boy collects from home (Tue 6 Oct, 4–6 pm); booklets counted (4 current + 3 old)". Step 8: the doorstep handover. |
| Demo ⚠️ (screens 14 and 25; demo Step 2) | His phone; his run of five stops ("Pick up visa documents · Sneha Kapoor, Adajan · V-2052", "Deliver passport · Shreya Iyer, Piplod · OTP on handover · 2–4 pm"); Step 2's "Collection boy · Ramesh · Tue 6 Oct, 4–6 pm", "Pick up from · B-702, Raghuvir Residency, Vesu". |
| Meeting ✅ (6:51 PM, 7:10 PM, 8:29 PM) | He has only a company phone, no computer; jobs reach him on route as soon as staff confirm; at handover he photographs the receiver and himself, with location and time. |
| PID | "a field-staff screen for pickups and passport handover with OTP, photo and location". |

Nobody had designed how a job is booked, or how the boy is assigned.

## Decision

### 1. One app, built one phase at a time

**Decided 17 Oct 2026 (project lead):** one field staff app, attached to the visa flow at both ends. Each phase is
planned in plan mode, built, tested, checked in the browser and committed before the next starts:

1. **Book a pickup:** the time-slot list, the field job, "Book the collection boy" at Step 2 (change, cancel)
2. **Book a delivery:** "Book the delivery boy" once the passports are in our stock
3. **His phone website:** his run by day; each stop with client · case, address, slot, **Call** and **Directions**
4. **Pickup done, or couldn't complete:** booklets, OTP, selfie, place and time; feeds Step 2
5. **Doorstep handover:** booklets (must match our stock), OTP, photo of the receiver, selfie, place and time →
   Delivered

Collect-payment stops wait for Accounts; WhatsApp to the boy and the client waits for the WhatsApp work.

### 2. Booking: a day and a time slot

**Decided 17 Oct 2026 (project lead):** staff pick the boy, a **day** (an open office day: Sundays and office holidays
can't be picked) and a **time slot** from a list the Head or an HOD edits, seeded with the demo's ⚠️: 11 am – 1 pm,
2–4 pm, 4–6 pm.

### 3. Getting there: Google Maps

**Decided 17 Oct 2026 (project lead):** each stop opens **Google Maps** for directions. The job keeps the address
(copied from the client's, correctable) and, optionally, the **Google Maps link** of the client's location when they
shared one (addresses in Surat are often vague); Directions uses the link when there is one, else the address. A plain
Google Maps link: no maps account, key or cost.

### 4. Proof: an OTP from the client, at both ends

**Decided 17 Oct 2026 (project lead):** the client confirms with a **one-time code**, so we can prove who **gave** us
the documents (pickup) and who **got** the passports (delivery). Until SMS or WhatsApp is connected (M2), the code goes
to the **client's email** (0014 Decision 2), so **booking either job needs the client's email** on file: staff add it
first, or the client comes to the office.

At each stop the boy also records, before he can finish:
- **pickup:** the booklets counted (current and old; his count becomes the case's intake count), the OTP, and his
  selfie at the door with the **place (GPS) and time** added by the phone. The papers are still ticked and scanned at
  the office.
- **delivery:** the booklets counted (they must match our stock, as at the office), the OTP, a photo of the person
  receiving, and his selfie with the place and time.

### 5. A visit that fails

**Decided 17 Oct 2026 (project lead):** the boy taps **Couldn't complete** and picks a reason from a list the Head or an
HOD edits, seeded ⚠️ with Client not home, Wrong address, Client asked to come later, Not ready. The place and time are
recorded, and the case comes back to the office, due now, to book again.

**Built 17 Oct 2026** (phase 1, book a pickup):
- **Data** (migration `20261017140000_field_pickup`): the list `FieldSlot` (code, name, from, to, order, on/off; CHECKs:
  the code's format, a name, 24-hour times ending after they start); `FieldJob` filled out (`kind`, `status`,
  `enquiryId`, `assigneeId` now required, `day`, `slotId`, `address`, `mapLink`, `mobile`, who booked it, who
  cancelled it and when; CHECKs: address and mobile not blank, a map link is an https address, cancelled ↔ who and
  when). One booked job of a kind per case is kept by the case lock, not an index (a partial index would show up in
  every `prisma migrate diff`).
- **The slots list:** `GET/POST/PATCH /api/masters/field-slots` (the Head or any HOD changes it; audited
  `fieldSlot.create` / `fieldSlot.update`), seeded 11 am – 1 pm, 2–4 pm, 4–6 pm ⚠️; a **Time slots** tab in Settings →
  Lists.
- `GET /api/visa/field-staff`: the active field staff. `POST /api/visa/cases/:caseNo/field-jobs` with `{ kind:
  "PICKUP", assigneeId, day, slotId, address, mapLink?, updatedAt }`, by whoever can act on the case at Steps 1–2.
  Refused with: 409 when the client has no email (`CLIENT_EMAIL_MISSING`: "Add the client's email first: the one-time
  code they give the boy goes there.") or a pickup is booked already; 400 under `assigneeId` (not active field staff),
  `day` (past, more than a year ahead, an office closed day by name), `slotId` (switched off, or "4–6 pm is over for
  today"), `address` or `mapLink` ("Paste a Google Maps link"). In one transaction under the case lock: the job (with
  the client's mobile), "Send collection boy", the case due at the slot's end, audit `field.job.book`.
- `PUT …/field-jobs/:jobId` (Change, audited `field.job.update` with the old and new; the due time follows the day and
  slot; an unchanged save writes nothing) and `POST …/field-jobs/:jobId/cancel` (audited `field.job.cancel`).
- **Postponing or cancelling the case calls the boy off** (each job audited, with why; the case's audit lists them);
  "Client brings them" is refused while a pickup is booked ("Cancel the collection boy's pickup first.").
- **The case** sends `fieldJobs` (newest first) and the client's `email` and `address` in one line.
- **Screen:** on "How the documents reach us", for "Send collection boy": **Book the collection boy** opens the form
  (who goes, the day on the office calendar, the slot, with today's past slots switched off, the address filled in, an
  optional Google Maps link, the client's mobile he'll call; without the client's email it says so and won't book).
  Once booked: "Collection boy · Ramesh · Mon 19 Oct, 4–6 pm", "Pick up from · … · Map", **Change** and **Cancel**
  ("Call off Ramesh's pickup?", asked in the page).

**Built 17 Oct 2026** (phase 2, book a delivery):
- The same `POST /api/visa/cases/:caseNo/field-jobs` with `kind: "DELIVERY"`, by any Visa staff with EDIT, whatever the
  case's status (the office handover's rule, `HANDING_OVER`), once the passports are in our stock. Refused with 409 at
  another step, before they're received ("Mark the passports received first."), without the client's email, or when a
  delivery is booked already. An open case is due at the slot's end; a postponed or cancelled one keeps its due time.
  Change and Cancel as for a pickup.
- **The office handover calls a booked delivery off**, in the same save (audited, "handed over at the office"; the
  handover's audit lists it).
- **Screen:** the office handover's **Our delivery boy** toggle opens "Book the delivery boy" (or the booked one's
  Change), with "He hands over 2 current + 1 old"; on the Passports coming back card, "Delivery boy · Ramesh · Mon 19
  Oct, 11 am – 1 pm", "Deliver to · …", Change and Cancel, or **Book the delivery boy**. The pickup and delivery lines
  share `FieldJobLines`; the dialog takes the kind.

**Built 17 Oct 2026** (phase 3, his run on his phone):
- `GET /api/field/jobs?day=YYYY-MM-DD`, for field staff only (office staff and the Head get 403): his own jobs that
  day, today in India when no day is asked for. They come in slot order, then by when they were booked, with the
  called-off ones last. Each stop carries:
  - the desk that raised it (for the chip's colour), the slot, the case number and the client's name
  - the address, the map link and the mobile to call
  - what it needs: for a delivery, the booklets in our stock; for a pickup, the papers still pending on the case's
    checklist, by traveller, leaving out what we arrange ourselves

  With them come `done` (done or couldn't complete) of `total` (not called off), and `today` by the server's clock.
- **Screen** (`/tasks`, demo screen 14; it replaces the placeholder):
  - **The dark band:** "Ramesh's run · Sat 17 Oct", "Collection & delivery", "1 of 3 done" and a bar with one piece per
    stop (done green, the one he's on orange).
  - **‹ Yesterday · Today · Tomorrow ›** step through the days (`?day=`). Today drops it, so a phone left open reopens
    on the new day.
  - **Each stop:** "Stop 2 · 2–4 pm · Now", the kind (Pick up documents / Deliver passports, in the desk's colour),
    client · case and the address. While it's booked: **Call Hiren** (`tel:`) and **Directions** (the pasted Google
    Maps link, else Google Maps directions to the address: no key, no cost). Then "Hand over · 2 passports + 1 old",
    or "Still to collect" traveller by traveller (the names split by " · ", since checklist names hold commas;
    "Nothing pending on the checklist" when empty).
  - **A done or couldn't-complete stop** shows a chip. **A called-off one** is greyed: "Called off by the office.
    Don't go."
  - The run refreshes every minute while open and whenever he comes back to it. When the server can't be reached, it
    keeps the last loaded run, with a note.
  - A phone-first column, 480 px wide and centred on a desktop.

### 6. Settings and lists (golden rule 1)

| What | Seeded with |
| --- | --- |
| Time slots (a list: name, from, to) | 11 am – 1 pm, 2–4 pm, 4–6 pm ⚠️ |
| Reasons a visit fails (a list, phase 4) | Client not home, Wrong address, Client asked to come later, Not ready ⚠️ |

**Defaults (not asked; say if any is wrong):**
- **Kinds and statuses are fixed in code** (kind PICKUP / DELIVERY; status BOOKED / DONE / FAILED / CANCELLED), like an
  enquiry's status: the screens and the rules branch on them. Slots and fail reasons are lists. *(0002 sketched both as
  master tables.)*
- **The boy is an active FIELD user** (the Head adds him on the Users page with his mobile). Whether office staff can
  cover a run is still M35.
- **One open job of each kind per case**, changed (boy, day, slot, address, map link) or cancelled while booked.
- **The job copies the client's mobile** and address at booking.
- **While a job is booked**, an open case is due at the slot's end that day, to check it happened.
- **The office handover cancels an open delivery job** of the case, in the same save (phase 2).

### 7. His run on his phone (phase 3)

**Decided 17 Oct 2026 (project lead):**
- **Days:** his phone opens on **today**. ‹ › step to other days: tomorrow to plan ahead, past days to look back
  (read-only).
- **A pickup stop lists the papers still pending** on the case's checklist ("Still to collect"), traveller by
  traveller. Names only; nothing scanned is shown.
- **His sign-in** works as office staff's for now: 12 h idle, 7 days at most. Revisit once Masti answers Q3 (the
  device).

**Defaults (not asked; say if any is wrong):**
- **He sees only his own jobs**, and only what each stop needs: the client's name, the case number, the address, the
  map link, the mobile to call, and the booklets to hand over or the papers to collect. Never the case page, money or
  documents.
- **Order:** by slot start, then by when the job was booked.
- **"3 of 5 done"** counts finished stops (done or couldn't complete) among the day's jobs that weren't called off.
- **Called-off stops** stay at the bottom, greyed, as "Called off by the office", so he knows not to go.
- **Call** is a `tel:` link to the job's mobile; **Directions** as in Decision 3.

## Not in this record

- **Collect-payment stops** (the demo's "Collect payment · ₹[amount] · cheque"): Accounts.
- **WhatsApp:** the job reaching the boy's WhatsApp, and the client's messages; the OTP moves from email to SMS or
  WhatsApp once connected (M2).
- **Routing or ordering stops** beyond day and slot.

## Still needed from Masti

- **Q3 / R2:** the boy's device (we build a phone website; the camera and GPS need HTTPS in production). Until
  then his sign-in works as office staff's (Decision 7).
- **M14 / Q12:** confirm the handover steps.
- **M2:** the SMS / WhatsApp accounts.
- **M15 / Q38:** whether Sundays and office holidays block collections and deliveries (seeded: yes).
- **M35:** whether office staff can do a run.
- **S11:** DPDP: how long selfies, receiver photos and locations are kept.
