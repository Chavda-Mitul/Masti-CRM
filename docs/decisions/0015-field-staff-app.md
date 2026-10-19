# 0015 · The field staff app (collection and delivery boy)

- **Status:** decided and built (17 Oct 2026, project lead), one phase at a time (Decision 1): booking a pickup
  (phase 1); booking a delivery (phase 2); his run on his phone (phase 3); couldn't complete (phase 4a); the pickup at
  the door (phase 4b); the doorstep handover (phase 5). Each part has its "Built" note.
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

**Amended 19 Oct 2026** (item 2 fixes; M46 to confirm): at the doorstep handover, picking a child as who receives the
passports is a warning, as at the office (0014 Decision 3). His phone marks a child on the list, asks "Check before
saving", and hands over once he confirms. The audit keeps it.

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

**Decided 17 Oct 2026 (project lead), for the pickup (phase 4):**
- **No code, no pickup.** If the client can't get the code at the door (the email doesn't arrive, or they can't open
  it), he records **Couldn't complete** with the reason "Client couldn't get the code". The office sorts it out: the
  client brings the papers, or the boy is booked again. This answers 0014 Decision 2's open question for the pickup;
  phase 5 settles the delivery.
- **A short return holds the delivery** (decided 17 Oct 2026, [0013](0013-visa-passport-back.md) Decision 5, amended):
  while fewer passports came back than went out and the shortfall isn't cleared, a delivery can't be booked, and the
  doorstep handover (phase 5) must refuse the same way as the office handover. Built 17 Oct 2026 for the booking:
  `assertNotHeldShort` (`Backend/src/modules/visa/shortfall.ts`) refuses it with 409. The doorstep handover calls the
  same check when phase 5 lands.
- **The code's email has fixed wording**, with Masti's name and phone from Company details: "Your code for Masti Tours
  & Travels: 482913 … Ramesh from Masti Tours & Travels is at your door to collect the documents for VISA-2026-0003.
  Give him this code to confirm … It works for 10 minutes. If you didn't expect this, don't share it, and call us on
  …". It moves to an approved SMS or WhatsApp template once one is connected (M2).

**Decided 17 Oct 2026 (project lead), for the delivery (phase 5):**
- **No code, no handover.** If the client can't get the code, he brings the passports back and taps Couldn't complete
  ("Client couldn't get the code"), as at a pickup. This settles 0014 Decision 2's open question for the delivery.
- **A count that doesn't match our stock blocks the handover,** as at the office: he brings everything back and taps
  Couldn't complete with "Passports don't match our count" ⚠️ (seeded).
- **The receiver is as at the office:** a traveller on the case, or someone else by name. He photographs that person
  (the phone's back camera); the client confirms with the code.

### 5. A visit that fails

**Decided 17 Oct 2026 (project lead):** the boy taps **Couldn't complete** and picks a reason from a list the Head or an
HOD edits, seeded ⚠️ with Client not home, Wrong address, Client asked to come later, Not ready, Client couldn't get the
code, and Passports don't match our count (the last two added the same day: no code, no pickup or handover; a count
that doesn't match, no handover; Decision 4). The place and time are recorded, and the case comes back to the office,
due now, to book again.

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

**Built 17 Oct 2026** (phase 4a, couldn't complete):
- **Data** (migration `20261017160000_field_visit_failed`):
  - the list `FieldFailReason` (code, name, order, on/off). CHECKs: the code's format, a name.
  - on `FieldJob`: when it finished and the place his phone gave (`finishedAt`, `latitude`, `longitude`, `accuracyM`
    in whole metres), and a failed visit's `failReasonId`. CHECKs: a finished job (done or couldn't complete) ↔ its
    time and place, and only then; the place in range; FAILED ↔ a reason.
- **The list:** `GET/POST/PATCH /api/masters/field-fail-reasons` (the Head or any HOD changes it; audited
  `fieldFailReason.create` / `.update`), seeded ⚠️ Client not home, Wrong address, Client asked to come later, Not
  ready, Client couldn't get the code; a **Visit fail reasons** tab in Settings → Lists.
- **His side** (`fieldJobs/fieldStops.service.ts`, field staff only):
  - `GET /api/field/jobs/:jobId`: one of his stops, with today. Anyone else's is not found.
  - `GET /api/field/fail-reasons`: the ones switched on.
  - `POST /api/field/jobs/:jobId/failed` `{ reasonId, place: { lat, lng, accuracy } }`, for either kind of stop.
    - **Refused:** 404 for another boy's stop; 409 for one called off ("The office called this stop off."), already
      recorded, or on another day ("This stop is on Mon 19 Oct. Record it on the day." / "This stop was on … Ask the
      office to book it again."); 400 for a reason switched off, or no place ("Your phone's location is needed. Allow
      it, then try again.").
    - **One transaction,** under the case's lock, then the job's: FAILED with when, where and why; an open case due
      now (a postponed or cancelled one keeps its own); the case's updatedAt moves; audit `field.job.fail`, with the
      place.
- **Maturity waits for a booked pickup:** "The collection boy is still booked for this case. Cancel his pickup first."
- **Screens:**
  - **His run:** today's booked stops get **Record this stop ›**. A finished stop shows "Couldn't complete · Client not
    home · 3:24 pm" (or "Done · …") instead of what it needs.
  - **The stop's screen** (`/tasks/:jobId`): the stop as on his run. **Couldn't complete** lists the reasons as big
    rows; **Record** reads the phone's location first (blocked: "Location is blocked for the CRM. In Chrome, tap the
    icon left of the address, allow Location, then try again."), saves, and goes back to the run ("Recorded. The
    office will book it again."). Another day's stop is read-only, with one line saying why.
  - **The case page:** "Last visit · Ramesh couldn't complete · Client not home" and "When · Sat 17 Oct, 15:24 ·
    Place" (Google Maps), above "Book the collection boy" (or the booked one).

**Built 17 Oct 2026** (phase 4b, the pickup at the door):
- **Data** (migration `20261017180000_field_pickup_done`):
  - `CaseFileKind` gains `FIELD_SELFIE`; the `CaseFile_size_and_pages` CHECK now leaves both photo kinds without a
    page count.
  - on `FieldJob`: the booklets he counted (`bookletsCurrent`, `bookletsOld`), his `selfieId` (unique, a case file),
    and the client's code: `otpHash` (sha256 of the job and the code, never the code), `otpSentAt`, `otpSentTo`,
    `otpExpiresAt`, `otpTries`, `otpConfirmedAt`. CHECKs: DONE ↔ the booklets and the selfie, and DONE → the code
    confirmed; booklets 0–50; the code's columns together, confirmed only once sent.
- **The setting `field`** ⚠️ (`fieldJobs/fieldJobs.settings.ts`): `{ otpMinutes: 10, otpTries: 5, otpResendSeconds:
  60, selfieMaxMb: 5 }`; `GET/PUT /api/masters/field-settings` (the Head or any HOD changes it; audited
  `setting.update`). API only, like the visa settings.
- **His side** (field staff only; his booked pickup on today's run; a delivery gets 409 until phase 5):
  - `POST /api/field/jobs/:jobId/otp`: a new 6-digit code to the client's email as it is then, stored as a hash
    before the email goes (outside any transaction).
    - **Refused:** 409 within the wait ("Wait 40 seconds, then send a new code."), once confirmed, or with no email
      (`CLIENT_EMAIL_MISSING`).
    - **If the email fails,** the code is cleared again and he's told why (502 "Couldn't send the code: …").
      Audited `field.otp.send` either way.
    - **The email** (fixed wording): "Your code for MASTI TOUR AND TRAVEL: 740972 … Ramesh from MASTI TOUR AND TRAVEL
      is at your door to collect the documents for VISA-2026-0001. Give him this code to confirm: 740972 … It works
      for 10 minutes. If you didn't expect this, don't share it, and call us on +91-93777-57580." Masti's name and
      phone come from Company details as written there.
  - `POST …/otp/check` `{ code }`: six digits (a typo isn't a try). A wrong one counts ("That's not the code. 4 tries
    left.", audited `field.otp.wrong`, committed before the refusal); after the last try, or once expired, a new code
    is needed; the right one confirms (`field.otp.confirm`).
  - `POST …/selfie` (the JPEG or PNG as the body; 415, 400 when the bytes aren't what's stated, 413 over the limit):
    a FIELD_SELFIE case file (`{caseNo}_selfie.jpg`), saved as he takes it, audited `visa.file.upload`.
  - `POST …/done` `{ booklets, selfieId, place }`: once the code is confirmed ("The client hasn't confirmed with the
    code yet."), with his own unused selfie of this case ("Take your selfie at the door."), on an open case at Steps
    1–2. In one transaction under the case's lock: DONE with when, where, the booklets and the selfie; his count
    becomes the case's intake count (audited `visa.case.update`); a case still at Step 1 moves to Documents
    (`enquiry.stage`); the case's updatedAt moves; audited `field.job.done`, with the place.
  - `GET /api/field/jobs/:jobId` adds where the code stands: `otp: { sentTo: "h•••@example.com", sentAt, expiresAt,
    resendAt, confirmedAt }`.
- **Screens:**
  - **A booked pickup's screen** shows the demo's numbered steps, each a green tick once done:
    1. **Booklets counted:** current and old.
    2. **Code from the client:** Send the code, then "Sent to h•••@example.com at 3:55 pm", the 6 digits and Check,
       and Send a new code; then "Confirmed by the client at 3:55 pm".
    3. **Your selfie at the door:** the front camera in the page (Capture waits for the camera's first frames), with
       the phone's place and time added; Retake.

    **Finish pickup · N steps left** waits for all three, then "Pickup recorded." and back to the run. Couldn't
    complete stays below.
  - **The case page:** "Last visit · Ramesh picked up", "When · … · Place", "Booklets · 2 current + 1 old", "Proof ·
    Code confirmed · Selfie" (it opens through a short-lived link, audited). The arrival card's booklet boxes show his
    count.
  - **The camera in the page** now asks the browser to play the stream, and Capture waits for its first frames:
    before them, a picture came out black (seen in headless Chrome; iOS Safari needs the same). The office's receiver
    photo (0014) gets the same fix.

**Built 17 Oct 2026** (phase 5, the doorstep handover):
- **Data** (migration `20261017200000_field_doorstep_handover`):
  - `VisaHandover.fieldJobId` (unique, the delivery boy's job). CHECK: a handover at the door (mode DELIVERY) ↔ its
    job.
  - `receiverPhotoId` becomes `NOT NULL`: both kinds of handover photograph the person receiving. The office's own
    CHECK goes.
  - The reasons list gains "Passports don't match our count" ⚠️ (`COUNT_MISMATCH`).
- **Shared with the office** (`visa/visaHandover.service.ts`): `gather`, `assertInStock`, `checkHandover` (the booklets
  equal our stock; the receiver is a traveller or a name) and a new `deliverCase` (Delivered, closing, booked jobs
  called off), which the office's handover now calls too. The validators `handOverBookletsSchema` and `receiverSchema`
  are shared from `visa.schemas.ts`.
- **His side** (field staff only; his booked delivery on today's run):
  - The code and his selfie now work at a delivery too. The code's email reads "…is at your door to hand over the
    passports for VISA-2026-0001. Give him this code to confirm: …".
  - `POST /api/field/jobs/:jobId/receiver-photo` (a delivery only): the person receiving, a RECEIVER_PHOTO case file
    (`{caseNo}_receiver.jpg`), saved as he takes it.
  - `POST /api/field/jobs/:jobId/handover` `{ booklets, receiver: { travellerId | name }, photoId, selfieId, place }`:
    - **Refused:** without the code ("The client hasn't confirmed with the code yet."); a count that doesn't match
      ("Count again: our stock has 2 current + 0 old. Find what's missing before handing over."); no receiver, or
      both; a photo or selfie that isn't his, of the right kind, unused; a pickup (409); another boy's stop (404).
    - **One transaction under the case's lock:**
      - the job DONE, with the booklets, his selfie and the place
      - `deliverCase` ("handed over at the door")
      - the `VisaHandover` (mode DELIVERY, by him, the receiver and their photo, the job)
      - audits `visa.handover` (with the job and the place) and `field.job.done`
    - The office's handover first calls a booked delivery off, and his is then refused ("The office called this stop
      off."). After either, a second is refused.
  - A delivery's stop lists its travellers (`travellers: [{ id, name }]`, names only), to pick who receives.
- **Screens:**
  - **A booked delivery's screen** shows the demo's four steps:
    1. **Booklets counted:** "Our stock: 2 passports + 1 old". A different count says "Count again… If one is
       missing, don't hand over: use Couldn't complete."
    2. **Code from the client.**
    3. **Photo of the person receiving:** the travellers as big rows, or Someone else with a name; then the back
       camera.
    4. **Your selfie at the door.**

    **Finish handover · N steps left**, then "Passports handed over." and back to the run.
  - **The steps are shared** with the pickup (`DoorSteps.tsx`: `Step`, `BookletsStep`, `CodeStep`; `PhotoStep.tsx`
    for both photos).
  - **The case page's "Handed back to the client"** shows "Our delivery boy", "Received by", and a second row: Code
    from the client · Confirmed, His selfie · Open, Place · Map, At the door · Sat 17 Oct, 16:46.

### 6. Settings and lists (golden rule 1)

| What | Seeded with |
| --- | --- |
| Time slots (a list: name, from, to) | 11 am – 1 pm, 2–4 pm, 4–6 pm ⚠️ |
| Reasons a visit fails (a list, phase 4) | Client not home, Wrong address, Client asked to come later, Not ready, Client couldn't get the code, Passports don't match our count ⚠️ |
| The code and the selfie (setting `field`, phase 4) | the code works 10 minutes, 5 wrong tries, a new one after 60 seconds; a selfie at most 5 MB ⚠️ |

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

### 8. Recording a stop (phase 4)

**Defaults (not asked; say if any is wrong):**
- **What he can record:** only his own stops, booked, on today's run, at any time that day. Past days stay read-only;
  nothing is undone from the phone (the office books again).
- **The place is required** for Done and Couldn't complete alike (golden rule 5). With location blocked or off, his
  phone says how to allow it, and nothing is saved until it works.
- **Couldn't complete** works for both kinds (same list, same rule). The case's due time moves to now only while it's
  open; a postponed or cancelled case keeps its own.
- **After a failed visit,** the arrival stays "Send collection boy": the office books again, or switches to "Client
  brings them".
- **The case's updatedAt moves** when he finishes or fails a stop, so an office page left open over it is refused
  (STALE) rather than writing over it.
- **Maturity waits for a booked pickup:** "The collection boy is still booked for this case. Cancel his pickup
  first.", as "Client brings them" does.
- **The code:** 6 digits, works 10 minutes ⚠️, 5 wrong tries ⚠️, a new one after 60 seconds ⚠️. It's kept only as a
  hash, and sent when he taps Send the code, to the client's email as it is then; his phone shows where it went,
  masked.
- **The selfie** is taken in the page with the front camera (live, not picked from the gallery), shrunk to 1600 px,
  at most 5 MB ⚠️; the place is read at the same moment.
- **After a pickup is done,** the case keeps its due time (the slot's end) and "Send collection boy"; the papers are
  still ticked and scanned at the office.
- **Who sees the proof:** anyone who can open the case sees the selfie (a short-lived link, audited) and the place (a
  Google Maps link). How long they're kept is still S11.
- **The ⚠️ values** are one setting, `field`, which the Head or any HOD changes (API only, like the visa settings).

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
