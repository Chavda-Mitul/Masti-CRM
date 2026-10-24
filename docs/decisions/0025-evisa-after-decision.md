# 0025 · E-visas after the decision

- **Status:** decided 22 Oct 2026: Vimal said yes to M39 (d), and the project lead answered the details the same day.
  Built in 5 parts, one at a time (Decision 1): all five built (22 Oct 2026). A "Built" note is under each part.
  **Amended 24 Oct 2026** (Amendment 1, [change request 21](../change-requests.md) part 3): no check against the
  passport and no "Send the e-visa →"; each e-visa goes to the client when it's uploaded. Built the same day.
- **Date:** 22 Oct 2026
- **Scope:** what follows an e-visa's decision at Step 6, until the case closes:
  - each approved traveller's e-visa PDF, and its check against the passport
  - sending it to the client on WhatsApp, with the PDF
  - closing the case, or first handing back passports we hold
  - refused e-visas
- **Builds on:**
  - [0008](0008-visa-docket-dispatch.md) Decision 11: "Submitted online"
  - [0011](0011-visa-at-vendor.md) Decision 8, [0012](0012-visa-decision.md) Decisions 4–6: the decision, the refusal
    letter, Change
  - [0013](0013-visa-passport-back.md) Decision 4: e-visas skip Step 7
  - [0014](0014-visa-delivered.md) and [0015](0015-field-staff-app.md): the handover, at the office or by the delivery boy
  - [0020](0020-whatsapp-sending.md) and [0021](0021-whatsapp-outbox.md): WhatsApp through Twilio, and the outbox
- **Not in the demo:** [change request 14](../change-requests.md). Shivanshu checks whether it's paid.

## Amendment 1 (24 Oct 2026, project lead, change request 21 part 3): each e-visa goes when it's uploaded

**The ask** ([change request 21](../change-requests.md)): each traveller's file goes to the client with its own
message, after the decision's. An approved e-visa's file is the e-visa itself.

**Decided (project lead, 23–24 Oct 2026):**
- **No check and no button.** The Matches / Doesn't match check (Decision 3) and "Send the e-visa →" (Decision 5) are
  removed. This reverses the lead's decision 1, "a mismatch blocks sending". Message 19 already asks the client to call
  us if anything on the e-visa doesn't match the passport.
- **Each upload goes at once,** from the Decision card or from "Record the decision" ([0012](0012-visa-decision.md)
  Decision 3, amended 24 Oct 2026): message 19 with that PDF. A replacement goes too, so the message is keyed per file;
  it was one per traveller.
- **The last one moves the case on,** as "Send the e-visa" did: once every approved traveller's e-visa has gone, the
  case is Delivered and closed when we hold no passports, or due for their handover (`visa.handoverCheck` ⚠️) when we
  do.
- **Change can finish it too,** when it leaves every remaining approved traveller with their e-visa (say, the one still
  waiting is changed to Refused). When that would close the case, it warns first: "Every approved traveller's e-visa
  has gone and we hold no passports: saving closes the case, and a closed case can't be changed."
- **Afterwards** Change is still refused ("The e-visa has gone to the client: the decision can't change now."), but a
  **corrected e-visa** can be uploaded at Decision or Delivered, whatever the status, even once the case is closed. It
  goes to the client and changes nothing else.

**Built 24 Oct 2026:**
- **`visaEvisaDone.ts`** replaces `visaEvisaSend.service.ts`:
  - `evisasAllIn`: every approved traveller has an e-visa
  - `finishEvisas`: who and when (`evisaSentAt`, `evisaSentById`), then `deliverCase(…, { evisa: true })` or the due
    time, audited as `visa.evisa.sent`
  - `uploadEvisa` queues message 19 in its transaction (`queueTravellerFileMessage`, keyed
    `visa.evisa_ready:<file id>`) and finishes the case after the last one; `changeDecision` finishes it too
- **The step rule** `CHECKING_EVISA` becomes `EVISA_FILES`: Decision or Delivered, any status. Until every e-visa has
  gone, the case must be open: "This case is postponed. Resume it first." or "This case is closed, so it can't change."
- **Removed:** `GET …/send-evisa/check`, `POST …/send-evisa` and `PUT …/travellers/:id/evisa-check`, with their
  schemas, and Change keeping an e-visa's check. `checkSticker` says "An e-visa has no sticker to check." **No
  migration:** `evisaSentAt` now means that every approved e-visa has gone.
- **Words:** the next step in the lists is "Upload the e-visa" (was "Send the e-visa"). Until then the handover says
  "Upload every approved traveller's e-visa first: the passports go back after it."
- **Screen:**
  - no Matches buttons, and no "Send the e-visa →" or its dialog
  - an upload says "E-visa sent to the client." (a replacement: "New copy sent to the client. The earlier one is
    kept."), adding "The case is delivered and closed." or "Every e-visa has gone: hand back the passports next." when
    it was the last
  - with passports held, the header then shows "Hand back the passports →" (Decision 6)
- **Tests:** `visaEvisaGoes.test.ts` replaces `visaEvisaSend.test.ts`.

## Context

| Source | What it says |
| --- | --- |
| 0013 Decision 4 (16 Oct 2026) | An e-visa's passports never left the office, so it skips Step 7 and waits at Step 6 until Masti answers M39 (d). |
| Browser test, 22 Oct 2026 | VISA-2026-0009 went File ready → Submitted online → Approved. Nothing then ends the case, so it runs late from its due time ("Let the client know") for good. |
| M39 (d), 22 Oct 2026 | Our suggestion ([#83](https://github.com/Chavda-Mitul/Masti-CRM/pull/83)): save the e-visa PDF, check it, send it on WhatsApp, then Delivered and closed. **Vimal said yes** ([#84](https://github.com/Chavda-Mitul/Masti-CRM/pull/84)). |
| Twilio's WhatsApp media guide | A WhatsApp message's media can be up to 20 MB; Twilio checks the file's content type at the link it's given; a document's file name and caption can't be set. |
| Twilio error 63019 ("Media failed to download") | Twilio checks a file's link with both GET and HEAD, and the link must be public and give the file's real type. |

**Decided by the project lead (22 Oct 2026):**

1. **A mismatch blocks sending.** Every approved traveller's e-visa must be marked Matches before it goes to the client.
   *Reversed 24 Oct 2026 (Amendment 1): there's no check, and each e-visa goes when it's uploaded.*
2. **The PDF goes on WhatsApp now,** through Twilio, as a session message (no template): like every message today, it
   reaches a client who wrote to us in the last 24 hours. An approved template with a document comes with M1.
3. **Passports we hold** (booklets counted at intake): the case closes only after the usual handover (count, who
   collected them, their photo; or the delivery boy).
4. **When everyone is refused,** the case closes on its own, or goes to the handover when we hold passports.

## Decision

### 1. Five parts, one at a time

Each part is planned in plan mode, built, tested, checked in the browser and merged before the next starts.

| Part | What |
| --- | --- |
| **1** | Each approved traveller's **e-visa PDF** on the Decision card, and its **Matches / Doesn't match** check (Decisions 2–3). |
| 2 | **WhatsApp attachments** (Decision 4): an outbox message can carry one case file. At each try the CRM makes its own short-lived link to it, and Twilio gets that as `mediaUrl`. `whatsapp:test` gets a way to send a file. |
| 3 | **"Send the e-visa →"** at Step 6, blocked until every approved traveller has a PDF marked Matches. One WhatsApp per approved traveller, each with their PDF. With no passports held, the case moves to Delivered and closes; with passports held, it's due for the handover. The step bar shows Step 7 as not needed. |
| 4 | **Handing back passports we hold** for an e-visa that was sent: the office handover and the delivery boy, against the intake count. |
| 5 | **Refused e-visas:** e-visa versions of messages 11 and 12 (no passport lines) at the decision. When everyone is refused, the case closes on its own, or goes to the handover. The Record dialog warns first: a closed case can't be changed. |

*Since 24 Oct 2026 (Amendment 1): part 1's check and part 3's button are gone. Each e-visa goes to the client when it's
uploaded, and the last one moves the case on.*

### 2. The e-visa PDF (part 1)

- **One PDF per approved traveller,** as the portal issued it, kept with the case's files in the private bucket (rule 4)
  and opened through a short-lived link, like the refusal letter. *Since 24 Oct 2026 ([0012](0012-visa-decision.md)
  Decision 3, change request 21, part 2): a JPG or PNG photo of it too, kept as a one-page PDF. It can also be added in
  "Record the decision". The limit is the shared `decisionFileMaxMb`, the same 16 MB rule.*
- **A newer upload becomes the current one;** older ones stay as proof. Kept when the traveller is changed to Refused,
  and shown again if they're approved again.
- **When:** at Decision, on an open case, by whoever can act on it (its processor, the Visa HOD, the Head). *Since
  Amendment 1: once every approved traveller's e-visa has gone, a corrected one can still be uploaded, at Decision or
  Delivered, whatever the status, and it goes too.*
- **The limit** is 16 MB ⚠️, under WhatsApp's 20 MB, or the final file's limit (`visa.finalFile.maxMb`) when that's
  lower.
- **Its name** is `VISA-2026-0001_Rakesh-Mehta_evisa.pdf` ⚠️. The storage key ends in it
  (`cases/<id>/evisa/<uuid>/<name>`), because a WhatsApp document's name can't be set: it comes from the link.

**Built 22 Oct 2026** (part 1):
- **Data** (migration `20261022180000_evisa_files`):
  - a case file of kind `EVISA`, with its traveller
  - the CHECK `CaseFile_refusal_letter_traveller` becomes `CaseFile_traveller`: REFUSAL_LETTER and EVISA have a
    traveller, and nothing else does
  - the traveller's relation `refusalLetters` becomes `files`; the case reads the newest of each kind
- `POST /api/visa/cases/:caseNo/travellers/:travellerId/evisa`, the PDF itself as the body. Refused with:
  - 409 before the decision ("The e-visa is added once the decision is recorded."), on a postponed or cancelled case,
    for a paper visa ("This visa has a sticker, not an e-visa: it's checked when the passports come back.") and for a
    traveller who wasn't approved; 404 for someone not on the case
  - 400 for an empty, non-PDF or broken file; 413 over the limit; 415 unless sent as a PDF
- Uploaded before the case lock and removed again if the checks under the lock fail; audited as `visa.file.upload`
  (kind, traveller, name, pages, `replaces`, and the check it cleared). The step rule is `CHECKING_EVISA` (Decision,
  open).
- **The case** sends each traveller's `evisa` (the current file and how many were uploaded, only while approved on an
  e-visa) and `evisaMaxMb`, which the page checks first.
- **Screen:** on the Decision card, under an approved traveller's e-visa number: "e-Visa PDF", its pages, who uploaded
  it and when, Open, and Upload e-visa / Replace.

### 3. Its check against the passport (part 1)

*Removed 24 Oct 2026 (Amendment 1): there's no check any more. `stickerCheck` is the paper sticker's again (Step 7).*

- **Matches or Doesn't match:** the PDF against the passport (name, passport number) and what was recorded at Step 6
  (the e-visa number and dates). *Since 23 Oct 2026 the number and dates are optional, added with Change
  ([0012](0012-visa-decision.md) Decision 3, amended; change request 21): they're compared when they were added.*
- **It reuses the sticker's check** (`VisaCaseTraveller.stickerCheck`): an e-visa never reaches Step 7, where a sticker
  is checked, and the database already keeps it to an approved traveller.
- **A newer PDF clears it:** it hasn't been looked at.
- **Change** keeps it while the traveller's entry stays as it was (an unchanged save), and clears it when the outcome,
  number or dates change. It's set only on the PDF's row, never in Change.
- **Doesn't match** shows in red: "get it corrected on the portal and upload the new PDF, or fix our typing with Change".
  Part 3 blocks sending until every approved traveller matches.

**Built 22 Oct 2026** (part 1):
- `PUT /api/visa/cases/:caseNo/travellers/:travellerId/evisa-check` with `{ fileId, check: MATCHES | MISMATCH | null }`.
  The `fileId` names the PDF that was looked at: 409 "A newer e-visa was uploaded: open it and check again." when it
  isn't the current one, and 409 before any PDF. Audited as `visa.evisa.check`, with the PDF.
- Like the processor's paper checks (0007 Decision 3), it doesn't move the case's `updatedAt`; pressing the chosen
  button again undoes it; saving the same check again writes nothing.
- **Screen:** Matches | Doesn't match beside the PDF for whoever can act; for others, "Matches the passport", "Doesn't
  match the passport" or "Not checked yet".

### 4. A file inside the WhatsApp message (part 2)

**Decided 22 Oct 2026 (while planning part 2):** the CRM serves the file through **its own short-lived link**, not an
S3 pre-signed one.
- Twilio downloads the file from a link and checks it with both GET and HEAD (error 63019). An S3 pre-signed link works
  for one method only, so Twilio's HEAD would be refused. That couldn't be tried on a laptop (Twilio can't reach it),
  only on Masti's live server.
- The CRM's link answers both, with the file's real type, at the public address consent links already use
  (`PUBLIC_APP_URL`, whose domain passes `/api` to the server): `…/api/public/message-files/<message>/<file name>?key=…`.
  No new setting. In production that address must be reachable from the internet, as it already must for consent links.
- **The path ends in the file's name,** which is what WhatsApp shows: Twilio can't set a document's name. The
  **key** is in the query string, which the request log never keeps.
- **A third router with no session** (CLAUDE.md asks for a decision record: this one), rate-limited per IP like the
  consent page.
- **One file per message,** as WhatsApp takes one. **Only with our own words:** an approved template with a document is
  part of the template itself, so it comes with Masti's templates (M1).

**Built 22 Oct 2026** (part 2):
- **Data** (migration `20261022200000_message_attachments`): `OutboundMessage.attachmentId` (one of the case's files),
  and the link's `attachmentKeyHash` (unique) and `attachmentKeyExpiresAt`. CHECKs: the key's hash and expiry go
  together, and only a message with a file has them.
- **Queueing** (`queueMessage`, `attachmentId`): the file must be the message's own case's, or the change stops: a
  client must never get another client's file.
- **Sending:** each try makes a new key (32 random bytes, only its SHA-256 kept), working for 30 minutes ⚠️; an earlier
  try's link stops working. The provider gets `attachment: { url, fileName }`; Twilio sends it as `mediaUrl` with our
  words. A template with a file is refused (not retried). Twilio's 63019 is explained in plain words.
- **The link** (`messageFiles.public.routes.ts`, `GET` and `HEAD /api/public/message-files/:messageId/:fileName?key=`):
  the bytes from the bucket, `Content-Type` from the file's name, `Content-Length`, `inline` with the name,
  `Cache-Control: private, no-store`. Every wrong case (unknown message, no file, wrong or old key) gets the same 404,
  "This link doesn't work any more." A GET is audited as `message.file.fetch`, with the IP; a HEAD isn't.
- **The log** (`WHATSAPP_PROVIDER=log`) hides the link's key when live and keeps it on a laptop, as for consent links.
- **Sent to the client:** a message shows "File: <name>" under its line, never the link.
- **`npm run whatsapp:test -- <mobile> media <https link>`** sends our words with the file at that link. Tried on
  22 Oct 2026 with a public sample PDF to the test number: delivered.
- **Not tried end to end on a laptop:** Twilio can't reach the CRM's own link here. Its first real run is on Masti's
  server (or through a tunnel). The tests cover the link itself: GET, HEAD, the headers and the key.

### 5. "Send the e-visa" (part 3)

*Replaced 24 Oct 2026 (Amendment 1): there's no button. Each e-visa goes with message 19 when it's uploaded, and the
upload that completes the approved travellers' e-visas does what "Then" says below. Afterwards Change is still refused,
but a corrected e-visa can be uploaded, and it goes too.*

- **When:** at Decision, on an open case, by whoever can act on it, once every approved traveller's PDF is uploaded and
  marked **Matches** (a mismatch blocks it, the lead's decision 1). Refused travellers need nothing here (part 5).
- **What goes:** message 19, **"Your e-visa"** ⚠️ (our draft, for M1), one per approved traveller, each carrying their
  current PDF (Decision 4):
  > Dear {{client_name}}, Good news! The {{visa}} is approved for {{traveller_name}} ({{case_no}}). The e-visa is
  > attached. Please print it and keep it with the passport when you travel. If anything on it doesn't match the
  > passport, call us on {{office_phone}} straight away. – Masti Tours & Travels

  *Changed 23 Oct 2026 (change request 21, part 1):* the words no longer name the e-visa's number and dates ("no.
  {{evisa_no}}, valid {{valid_from}} to {{valid_to}}"). They're optional now, added with Change
  ([0012](0012-visa-decision.md) Decision 3, amended), and the PDF shows them.
- **Then:**
  - **No passports held** (no booklets counted at intake, the usual e-visa): the case moves to **Delivered** and
    **closes**, with no due time.
  - **Passports held:** it stays at Decision, open, due for the handover (`visa.handoverCheck`, the next open office day
    at 11:00 ⚠️); part 4 builds that handover.
- **Afterwards nothing that went can change:** the PDF uploads, their checks and Change are refused.

**Built 22 Oct 2026** (part 3):
- **Data** (migration `20261022220000_evisa_sent`): `VisaCase.evisaSentAt` and `evisaSentById`. CHECKs: set together,
  and only on an e-visa.
- `GET /api/visa/cases/:caseNo/send-evisa/check` returns `{ blockers, travellers: [{ name, fileName }], held, closes,
  dueAt }`. Each blocker names one approved traveller: "Upload Rakesh Mehta's e-visa.", "Check Rakesh Mehta's e-visa
  against the passport.", "Rakesh Mehta's e-visa doesn't match the passport: get it corrected first."
- `POST /api/visa/cases/:caseNo/send-evisa` with `{ updatedAt }`, under the case lock (`CHECKING_EVISA`). Refused with
  409: `SEND_BLOCKED { blockers }`, already sent, no one approved, a paper visa, a stale page (`STALE`). It sets who
  and when, queues the messages (keyed per traveller), closes the case through `deliverCase` (which now moves an e-visa
  to Delivered from Decision) or sets the handover's due time, and audits `visa.evisa.sent`.
- **Next step** in the lists: "Send the e-visa", then "Hand back the passports" once sent with passports held.
- **Screen:**
  - **Send the e-visa →** in the header; its dialog lists each traveller with their file, and says whether the case
    closes or waits for the handover.
  - The chip reads "E-visa sent" while it waits.
  - The Decision card says "Sent to the client · <when> · <who>", and its due line says what's next.
  - Upload, the check and Change go once sent.
  - The step bar shows Step 7 as "–" ("Not needed: an e-visa's passports never left the office").

### 6. Handing back the passports we hold (part 4)

- **An e-visa's passports never go to a vendor,** so booklets counted in at intake stay **held at our office** at Steps
  5–6 too, not only before dispatch (0006 amendment 15).
- **Once the e-visa is sent** (Decision 5), they go back as any passports in our stock (0014, 0015):
  - at the desk, by any Visa staff with EDIT, who can open the case for it
  - or with the delivery boy, at the door
  - the count must match the intake, then the case is **Delivered** and closes, with message 15
  - before it's sent: "Send the e-visa first: the passports go back after it." *Since Amendment 1: "Upload every
    approved traveller's e-visa first: the passports go back after it."*
- **A cancelled e-visa** at Step 5 or 6 with passports held is "to hand back" like a case cancelled before dispatch: it
  stays on its owner's Open list, due for it, and goes back at the office only, staying cancelled at its step.
- **Paper files are unchanged:** at Steps 5–6 their passports are with the vendor and come back through Passport back
  ("Passports are handed over from Passport back.").

**Built 22 Oct 2026** (part 4):
- **`visibility.ts`:**
  - `HELD_AT_OFFICE` / `heldAtOffice` add an e-visa (`submittedOnlineAt`) at At vendor or Decision
    (`EVISA_AFTER_SUBMISSION`), so `TO_HAND_BACK` and `UNFINISHED` follow
  - `IN_STOCK` / `passportsInStock` add a sent e-visa at Decision, open or postponed, with passports held
  - `caseLock.ts` and the cancel action load `submittedOnlineAt` and `evisaSentAt`
- **The handover:**
  - `HANDING_OVER` takes At vendor and Decision too
  - `assertInStock` refuses a paper file there (unchanged words) and an unsent e-visa
  - the stock is the intake count
  - `deliverCase(…, { evisa })` moves a sent e-visa to Delivered at the office and at the door
  - both audits record the real stages (the door's said Passport back → Delivered)
- **The delivery boy:**
  - booking takes a sent e-visa with passports held
  - not a cancelled case: those go back at the office only
  - his stop shows the intake count
- **Screen:**
  - **Hand back the passports →** in the header of a sent e-visa, for whoever may hand over
  - its dialog offers the client collecting or "Our delivery boy"
  - a cancelled case's dialog stays office only

### 7. Refused e-visas (part 5)

- **The decision's message** (the lead's decision 4, and the part 5 row of Decision 1): messages 11 and 12 say the
  passports come back from the embassy, which an e-visa's never went to. An e-visa gets its own, our drafts ⚠️ for M1:
  - **Message 20, "E-visa refused"**, when everyone is refused:
    > Dear {{client_name}}, We are sorry to tell you that the {{visa}} has been refused for {{refused_names}}
    > ({{case_no}}). Please call us on {{office_phone}}: we will explain the reason and what can be done next. – Masti
    > Tours & Travels
  - **Message 21, "E-visa partly approved"**, when some are:
    > Dear {{client_name}}, The decision on your {{visa}} ({{case_no}}) has come. Good news: it is approved for
    > {{approved_names}}, and we will send the e-visa here shortly. We are sorry that it was refused for
    > {{refused_names}}. Please call us on {{office_phone}} to talk about the refusal. – Masti Tours & Travels
  - **Everyone approved:** none at the decision; message 19 brings each e-visa when it's sent (Decision 5; since
    Amendment 1, when it's uploaded).
- **Everyone refused** leaves nothing to send:
  - **No passports held:** the case moves to **Delivered** and **closes** at once, as a sent e-visa with none held
    (Decision 5).
  - **Before that, a warning** (the warn-then-confirm of `lib/warnings.ts`): "Everyone is refused and we hold no
    passports: saving closes the case, and a closed case can't be changed." Staff press Save anyway; the audit keeps
    it.
  - **Passports held:** no warning. It stays at Decision, open, due for the handover (`visa.handoverCheck` ⚠️), and the
    next step is "Hand back the passports". They go back as in Decision 6, at the desk or with the delivery boy.
- **Change** follows the same rule: a change that leaves an unsent e-visa with everyone refused closes it after the same
  warning, or makes it due to hand the passports back (its due time stays). A correction still sends no message.
- **The header chip** of a closed e-visa where everyone was refused, and nothing was handed over, reads "Refused ·
  closed" (red), not the step's "Delivered".

**Built 22 Oct 2026** (part 5):
- **Messages** (`messages.seed.ts`): `visa.evisa_refused` (20) and `visa.evisa_partly_approved` (21).
  `queueDecisionMessage(…, { evisa })` picks them, and sends nothing for an e-visa with everyone approved.
- **`visibility.ts`:** `EVISA_DONE` / `evisaDone`: sent, or every traveller refused. Part 4's checks use it instead of
  "sent":
  - `IN_STOCK` / `passportsInStock`
  - the handover's `assertInStock`
  - `deliverCase`'s `evisa` option at the office and at the door
  - the delivery booking, and the next step in the lists
  - the case loaders, `caseLock.ts` and the lists load each traveller's outcome
- **`visaDecision.service.ts`:**
  - the warning `CASE_CLOSES`, before and under the case lock
  - `recordDecision` closes through `deliverCase(…, { evisa: true })`, or sets the due time from `visa.handoverCheck`;
    its audit has the real stage and status
  - `changeDecision` closes the same way, its audit noting `caseClosed`
- **Screen:**
  - the header's "Hand back the passports →" and the Decision card's due line use `evisaDone`
  - the "Refused · closed" chip
  - after saving, the dialogs' message adds "The case is closed."

### 8. Settings and seed data (golden rule 1)

| What | Seeded with |
| --- | --- |
| The e-visa PDF limit | 16 MB ⚠️ (under WhatsApp's 20 MB), or `visa.finalFile.maxMb` when lower |
| The e-visa PDF's name | `<case no>_<traveller>_evisa.pdf` ⚠️ |
| How long a message's file link works | 30 minutes ⚠️ (`FILE_LINK_MINUTES`; Twilio fetches the file within seconds) |
| Message 19, "Your e-visa" | our draft ⚠️ (M1) |
| Messages 20 and 21, "E-visa refused" and "E-visa partly approved" | our drafts ⚠️ (M1) |
| When a sent e-visa with passports held is due, or one where everyone is refused | `visa.handoverCheck`, the next open office day at 11:00 ⚠️ |
| The words on the card | ours ⚠️ |

## Still needed

- **Shivanshu:** is change request 14 paid?
- **Masti (M1):** the wording of the new WhatsApp messages (19 from part 3, 20 and 21 from part 5), with the other
  visa messages.
- **Masti (M39 a–c):** the e-visa and Step 5 timings, still open.
