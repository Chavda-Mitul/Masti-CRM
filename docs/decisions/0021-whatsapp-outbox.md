# 0021 · The WhatsApp outbox

- **Status:** decided and built, step 2 of 0020's five (21 Oct 2026, project lead). The "Sent to the client" card on the
  case comes next. *A message can carry one of its case's files since 22 Oct 2026: see
  [0025](0025-evisa-after-decision.md) Decision 4 (`attachmentId`, a new link at each try, the
  `/api/public/message-files` route).*
- **Date:** 21 Oct 2026
- **Scope:** how a message gets from a change in the CRM to the client. It is written down with the change, sent
  afterwards by a background job, tried again without ever going twice, and followed until it is delivered or read.
  Which messages go out, and when, is step 3; one message proves the whole path here.

## Context

Golden rule 7 says the client hears at every step, automatically. 0003 Decision 6 says how: the message is written in
the same transaction as the change, and a separate sender delivers it, so a save never waits on WhatsApp. That record
left the job runner open, and PROJECT_KNOWLEDGE §10.9 asks for a reliable, self-hostable one (§16.5 suggested
pg-boss). 0020 built the sending itself: `sendWhatsApp()`, with Twilio behind a provider that can be swapped.

On 21 Oct 2026 the project lead chose three things:
- **pg-boss** for the background jobs, over a hand-written loop.
- **Message 6, "All documents received"**, as the first real message.
- **Outside production, every message goes to one test number**, never to the client.

## Decisions

1. **pg-boss runs the background jobs** (`src/lib/jobs.ts`):
   - Its jobs live in this same Postgres, in its own `pgboss` schema. pg-boss creates and upgrades that schema
     itself when it starts, and Prisma doesn't see it.
   - The server starts pg-boss before it takes requests, because a save may queue a job. On shutdown the job workers
     stop at the same time as the web server, so a send in progress gets the whole grace period to finish. pg-boss
     itself closes last, because a request still running may queue a message.
   - It is the scheduler §10.9 asked for, so later timed work (reminders, rotations, check-in lists) uses it too.
   - Version 12.36.0 is pinned. It needs Node 22.12 or later, and our CommonJS build loads it through `require(esm)`.
   - It is MIT-licensed and self-hosted, with nothing outside Masti's own database.
2. **A message is written with the change it reports.** `queueMessage(tx, …)` (`src/modules/messages`) words the
   message from its template, addresses it to the client's main number, and queues its job, all in the caller's
   transaction (pg-boss's Prisma adapter). A save that rolls back leaves neither the message nor the job.
   `idempotencyKey` (`visa.documents_received:<case>`) means the same event never queues a second message.
   - **A message problem never stops the change it reports** (review of #51, 21 Oct 2026). A wording the CRM can't
     fill (a placeholder it has no value for) is written down as failed, with the reason, and isn't sent. A missing
     wording is only logged; the server adds any missing wording when it starts (never changing one that's there),
     so that shouldn't happen.
3. **Two tables:**
   - **`MessageTemplate`** holds the wording with `{{placeholders}}`, the provider's id for the Meta-approved version
     (Twilio's Content SID), and an on/off switch.
     - While the provider id is empty, the words go as written. WhatsApp delivers those only within 24 hours of the
       client's last message, which is how the sandbox works.
     - Seeded word for word from `docs/whatsapp-visa-messages.md`. Re-seeding never overwrites changed words.
   - **`OutboundMessage`** is the record of what the client was told: the words as sent, the values used, who it
     was for (`toMobile`) and where it went (`sentTo`), the status, the provider and its id for the message, the
     reason for a failure, and when it was sent, delivered, read or failed.
   - Database checks keep these fields consistent with the status.
4. **Sent once, never twice.** The `whatsapp-send` job marks the message as being sent and commits. It then sends
   outside any transaction and records how it went.
   - **A try that never came back** (the server stopped mid-send) is marked failed and never repeated: it may have
     gone. "The server stopped while sending this, so it may or may not have gone. Check the chat."
   - **A failure that may pass** (Twilio down or busy, or a request that never reached it: the name not found, no
     route to it as when the office internet is down, or the connection turned away) is tried again after about 1, 2,
     4, 8 and 15 minutes, then marked failed.
   - **When pg-boss gives up** on a message whose last try failed before it could say how it went (the database out
     of reach, or the try stuck), the `whatsapp-send-failed` job (pg-boss's dead letter queue) marks it failed. It
     keeps trying for hours if the database is still down, so no message stays queued for ever.
   - **A failure that won't pass** fails at once: a wrong number, wrong keys, a phone that hasn't joined the sandbox,
     or a timeout after which the message may have gone.
   - **Other outcomes:**
     - A message more than 24 hours old isn't sent, because its news would be stale.
     - A switched-off template gives SKIPPED.
     - With WhatsApp off, the message fails at once: "WhatsApp isn't set up yet." In production the server warns at
       start when WhatsApp is off or `log`.
   - Twilio gives up on a request after 30 seconds. The job counts as stuck after 2 minutes, so pg-boss never starts
     a second try while the first is still waiting.
5. **Followed to delivered and read.** After a message goes, the `whatsapp-status` job asks the provider (Twilio's
   `checkStatus`) 1 min, 5 min, 15 min, 1 h, 4 h and 12 h after the message went, stopping once it is read or failed.
   - Failures that only show up later are recorded with their reason, e.g. "This phone hasn't joined the Twilio
     sandbox…".
   - If Twilio can't be asked at one check (an outage), the next check still comes, so a message never stays "sent"
     for want of an answer. A failed status check is safe to ask again, unlike a send.
   - This needs no public web address, so it works on a laptop and on a server reachable only from the office.
   - The times recorded are when the CRM learned of each change, so they're up to the next check late. Twilio's status
     webhook can replace this later.
   - *Meta's Cloud API (0020 Amendment 1, 23 Oct 2026) can't be asked, so no checks are queued for its messages: Meta's
     webhook reports them instead ([0026](0026-whatsapp-webhook.md)), through the same forward-only rules
     (`recordStatus()`).*
6. **Outside production, every message goes to the test number** (`WHATSAPP_TEST_NUMBER`), so a laptop never
   messages a real client.
   - The server refuses to start without one outside production when `WHATSAPP_PROVIDER=twilio`.
   - It refuses to start with one in production, where every client's message would go to it.
   - The record keeps who each message was for, even when it went to the test number.
7. **Audited:** sent, failed and skipped each go into the audit log with the client, so they appear in the client's
   history. No actor is recorded, because the CRM did it. Being queued is covered by the change's own entry
   (e.g. `visa.mature`).
8. **The first message is message 6, "All documents received"**, queued when staff press "Mark documents complete"
   (`mature()`).
   - Its values are the client's name, the visa ("France tourist visa", from `visaMessageBasics` in
     `src/modules/visa/visaMessages.ts`) and the case number.
   - The other visa messages reuse these values (step 3).
9. **Tests:** pg-boss runs in every test file, without workers (`tests/setup.ts`). The tests do a job's work by
   calling it, and look at queued jobs with `boss.findJobs`. The provider is a stand-in, so nothing is ever sent.

| Setting (`Backend/.env`) | Default | Meaning |
| --- | --- | --- |
| `WHATSAPP_TEST_NUMBER` | empty | Outside production, the phone that gets every message instead of the client: yours, joined to the sandbox. Required outside production with `WHATSAPP_PROVIDER=twilio`; must be empty in production |

## To see it work (Twilio sandbox)

1. In `Backend/.env`, set `WHATSAPP_PROVIDER=twilio`, the three `TWILIO_*` values (0020) and
   `WHATSAPP_TEST_NUMBER` to your phone, the one that joined the sandbox. Then restart the backend.
2. On a visa case with every paper in, press **Mark documents complete**.
3. "All documents received" reaches your phone within seconds. The message's row goes QUEUED → SENT → DELIVERED.

## For deployment (not built)

- Node 22.12 or later on the server, which pg-boss needs.
- The database user creates the `pgboss` schema on the first start, or it is created beforehand.
- A staging server running with `NODE_ENV=production` on a copy of real data would message real clients. Give it
  `WHATSAPP_PROVIDER=log` or `off`.

## Amendment 1 (21 Oct 2026): the "Sent to the client" card

Built after the outbox, as the case page's right rail section from the demo (screen 06), between "Whose job it is
now" and "Money on this case". The project lead chose these three on 21 Oct 2026:

- **Each message shows where it has got to.** Its dot's colour and a word: Waiting to send, Sent, Delivered or Read
  (green); Not sent or Not delivered (red, with the reason in plain words); Not sent: switched off (grey). The demo
  showed a plain green dot for every message; this shows what the CRM records. A message that went to the test
  number outside production says "to your test number".
- **No "Open chat" button.** The demo's phone panel was demo-only. Clicking a message shows its words, exactly as sent.
- **It updates by itself while a message is on its way.** It checks every 10 seconds while one is waiting (for up to
  an hour) or sent but not yet delivered (for 15 minutes), and only while the page is in view. A step that queues a
  message refreshes the card at once.

The messages come from their own request, `GET /api/visa/cases/:caseNo/messages`, for anyone who can open the case
(`findVisibleCase`). They aren't part of the case itself, so the card can refresh without reloading the case that the
page's forms are built from. They come oldest first, like a chat. The sending details stay on the server.

Not here: the client page's "WhatsApp messages sent". A client-wide list needs its own rule, because staff who can open
one of a client's cases mustn't read messages about the others. "Send again" for a failed message isn't here either:
it isn't in the demo, and messages are never sent by hand.

## Amendment 2 (21 Oct 2026): a message can name its recipient

The consent link (0022 part 2) goes to the traveller's own number when one is saved, so `queueMessage` takes an
optional `toMobile`. Without it, a message goes to the client's main number, as before.

The card shows a consent message with its secret hidden (`/consent#…`), so nobody in the office can open the client's
form and agree for them.

## Amendment 3 (22 Oct 2026): the visa messages of Steps 1–2

The project lead (22 Oct 2026) asked for the rest of `docs/whatsapp-visa-messages.md`, built step by step, one PR per
group:
- **A:** Steps 1–2, messages 1, 2, 3 and 5. This amendment.
- **B:** messages 7, 8 and 9.
- **C:** messages 10 to 15.
- **D:** messages 16, 17 and 18.

Their other answers:
- **Invoice and credit note:** the messages (7, 18) go as words only for now, and staff send the PDF by hand.
- **The door code (16):** goes on WhatsApp only.
- **The file:** its 20 Oct review fixes are applied.

| # | Template code · title | Sent when | At most once per |
| --- | --- | --- | --- |
| 1 | `visa.document_list` · Document list | a new visa case is saved (`createVisaEnquiry`) | case |
| 2 | `visa.price` · Your price | the quote is saved for the first time (`saveQuote`) | case |
| 3 | `visa.document_reminder` · Documents still pending | a planned reminder day and time is reached | case and planned day |
| 5 | `visa.collection_visit` · Collection visit booked | a pickup is booked, or its boy, day, slot or address changes | job and change |

- **What every visa message knows.** `visaMessageBasics` also fills `{{travellers}}` ("4 travellers") and
  `{{office_phone}}` (Settings → Company).
- **Long lists.** `fitList` cuts a list (messages 1 and 3) short at about 600 characters with "and 4 more (we will tell
  you)", inside WhatsApp's limit of about 1,000 for a whole message.
- **Message 1:**
  - The offering's checklist, each paper once and numbered: "4. Photos, 35×45 mm, white background × 2 (original)".
  - Not what we arrange (flights, hotels, insurance), and children's papers only when a child travels.
- **Message 2:** the quote's total, with GST on the service charge (`quoteTotals`), as "₹6,000" (`rupeesText`). A
  later change sends nothing, because the invoice carries the final amount.
- **Message 3, the reminder:**
  - **The sweep:** a pg-boss schedule, `visa-document-reminders`, every 15 minutes in India time (`startVisaReminders`;
    not in tests, where pg-boss runs no schedules).
  - **Due:** `sendDueReminders` queues one for each case whose planned time (`nextReminderAt`, the Reminders card's
    "Next") came in the last 2 hours, keyed per planned day. A server down longer than that skips to the next planned
    day.
  - **Which cases:** the same rule as the card (`remindersDue`): on in Settings and on the case, open, at Enquiry or
    Documents, with a paper the client brings still pending. Arranged items never count, so the card says "nothing
    the client brings is missing" instead of a date that would never send.
  - **`{{pending_list}}`:** "Bank statement, last 6 months (Rakesh); Birth certificate (Child 1)".
  - **SMS:** the setting allows it, but it isn't built, so with SMS chosen nothing goes.
- **Message 5:**
  - The boy's name, "Mon 19 Oct" (`dayLabel`), the slot's name and the address. For a pickup only: the delivery is
    message 14.
  - Not for a map link alone, nor for a cancel (staff call the client).
  - Keyed on the job's new `updatedAt`, so each change sends once.

Saving a visa case now queues message 1, so tests that count the queued messages count only the one they're about.

## Amendment 4 (22 Oct 2026): the visa messages of Steps 4–5

Group B of Amendment 3: messages 7, 8 and 9 of `docs/whatsapp-visa-messages.md`. Each is queued in the transaction of
the change it follows, as in Amendment 3.

| # | Template code · title | Sent when | At most once per |
| --- | --- | --- | --- |
| 7 | `visa.invoice` · Invoice | an invoice is raised: the main one or a corrected one (`raiseInvoice`), the additional one or its correction (`raiseAdditionalInvoice`) | invoice |
| 8 | `visa.submitted` · File submitted | the file is first marked submitted at the embassy, at Step 5 (`saveSubmission`) | case |
| 9 | `visa.applied_online` · Applied online | an e-visa is marked submitted online, at Step 4 (`submitOnline`) | case |

- **Message 7:**
  - `{{invoice_no}}` ("MVI00000001", "MVI00000001-A") and `{{amount}}`, the invoice's total as "6,000"
    (`rupeesText`), filled by `queueInvoiceMessage`.
  - Words only, as the project lead asked: staff send the PDF by hand.
  - Keyed on the invoice's id. When another raise took the number first, the retry rolls the first attempt's message
    back with it, so one goes.
- **Message 8:**
  - `{{embassy}}` is the embassy's name as Settings has it ("French embassy, Mumbai"). `{{expected_date}}` is the
    collection date staff enter, as "Wed 4 Nov" (`dayLabel`).
  - Only the first save sends it. A later change to the file number, the embassy or the date sends nothing.
- **Message 9:** a case is submitted online once, and a second press is refused, so it goes once.

## Amendment 5 (22 Oct 2026): the visa messages of Steps 6–8

Group C of Amendment 3: messages 10 to 15 of `docs/whatsapp-visa-messages.md`, each queued in the transaction of the
change it follows. The project lead decided two things on 22 Oct 2026:
- **A short return:** message 13 waits until every passport is back.
- **The office address:** messages 10 and 13 use the one in Settings → Company, as it is.

| # | Template code · title | Sent when | At most once per |
| --- | --- | --- | --- |
| 10 | `visa.approved` · Visa approved | the decision is recorded (`recordDecision`) and every traveller is approved | case |
| 11 | `visa.refused` · Visa refused | … every traveller is refused | case |
| 12 | `visa.partly_approved` · Partly approved | … some are approved, some refused | case |
| 13 | `visa.passports_back` · Passports at our office | every booklet that went out is back: at "Mark received" (`receivePassports`), or at "Received the rest" (`receiveRest`) once nothing is missing | case |
| 14 | `visa.delivery_visit` · Delivery booked | a delivery is booked, or its boy, day, slot or address changes (`bookFieldJob`, `changeFieldJob`) | job and change |
| 15 | `visa.handed_over` · Passports handed over | the passports are handed over at the office (`handOver`) or at the door (`handOverAtDoor`) | case |

- **What every visa message knows:** `visaMessageBasics` also fills `{{office_address}}`, the address in Settings →
  Company (the invoice's).
- **Messages 10–12:**
  - `queueDecisionMessage` picks the message by the outcomes. `{{approved_names}}` and `{{refused_names}}` are in the
    case's order, as the decision dialog names them, joined "A, B and C".
  - `{{working_days}}` is "2 working days", from a new setting, `visa.passportsArrive` ⚠️ (Settings → Visa → Client
    messages; the draft's point 4, open with Masti). It carries its own noun, so "1 working day" reads right too; the
    wording is "in about {{working_days}}".
  - ~~**Not for an e-visa yet**~~: since 22 Oct 2026 an e-visa gets message 20 (everyone refused) or 21 (some
    refused), without the passport lines, and nothing when everyone is approved: message 19 brings each e-visa
    ([0025](0025-evisa-after-decision.md) Decisions 5 and 7).
  - Correcting the decision later (`changeDecision`) sends nothing; staff call the client.
- **Message 13:**
  - A short return sends nothing until "Received the rest" makes up the count.
  - When the shortfall is cleared (a passport won't come back), nothing goes, and staff call. If it turns up after all,
    the message goes then.
  - It goes for a recalled file too, and whatever the case's status: the passports are at our office.
- **Message 14:**
  - Message 5's rules, for a delivery: `queueFieldVisit` picks message 5 or 14 by the job's kind.
  - A map link alone, a cancel, or a handover that calls the visit off sends nothing.
- **Message 15:**
  - `queueHandoverMessage` fills `{{passport_count}}` ("4 passports and 3 old passports", `passportCountText`) and
    `{{receiver_name}}` (the traveller, or the name typed).
  - `{{handover_time}}` is the handover's own time, "Sat 31 Oct, 12:10 pm" (`dayLabel` and the new `timeLabel`).
  - It goes for a cancelled case's hand-back before dispatch too.

## Amendment 6 (22 Oct 2026): the door code, the vault and the credit note

Group D of Amendment 3, the last of `docs/whatsapp-visa-messages.md`. The project lead decided:
- **Earlier (22 Oct):**
  - The door code goes on WhatsApp only, with no email fallback.
  - The credit note is words only.
- **For this group (22 Oct):**
  - One PR.
  - The boy's phone shows where the code's message has got to.

| # | Template code · title | Sent when | At most once per |
| --- | --- | --- | --- |
| 16 | `field.door_code` · Code at the door | the boy presses "Send the code" or "Send a new code" (`sendOtp`), at a pickup or a delivery | code |
| 17 | `client.documents_kept` · We keep a copy | a scan is saved for the client (`saveClientScan`: the client page, or a case's checklist) | client, ever |
| 18 | `visa.credit_note` · Credit note | a credit note is issued (`issueCreditNote`: a wrong invoice, a recall, a cancelled case's refund) | credit note |

- **Message 16, the door code** ([0015](0015-field-staff-app.md) Decision 4, amended):
  - **Queued with the code:** in the transaction that stores the code's hash, to the client's main number, keyed per
    code sent.
  - **The wording:** Meta's fixed words for a code, naming neither Masti nor the visit. `{{minutes}}` is
    `field.otpMinutes`; Meta fixes the number when it approves the template.
  - **No email any more:** the code's email (`otpEmail.ts`) and the rule that booking needs the client's email
    (`CLIENT_EMAIL_MISSING`) are gone. `otpSentTo` keeps the number, shown masked "+91••••••1299".
  - **The boy's phone:** `getMyStop` reads the message's status by its key: "sending", "sent", "delivered", "read", or
    "couldn't send" with why. `useStop` refreshes every 5 seconds while it is on its way.
- **Secrets, now one rule** (`lib/whatsapp/secrets.ts`): a placeholder listed in `SECRET_PLACEHOLDERS` (today `code`) is
  the client's alone, as the consent link's secret already was.
  - **The card:** `toMessageDto` hides its value, even while the message waits.
  - **A settled message:** `withoutSecrets` forgets it once the message is sent, fails or is skipped.
  - **The live log:** the sender gets the values as `secrets`, and `forTheLog` hides them when live; the list itself
    is never logged.
- **Message 17** ([0016](0016-client-documents.md) Decision 6): keyed per client, so later scans send nothing. Saved
  from a case, it shows on that case's "Sent to the client" card. From the client page there is no case, so no card
  shows it; it is still sent and audited.
- **Message 18:** `{{credit_note_no}}`, `{{amount}}` (the credit note's total) and `{{invoice_no}}`, keyed per credit
  note. A number retry rolls it back with the note. Change request 13.

## Not in this step

- ~~The "Sent to the client" card~~: built, Amendment 1.
- ~~**The other visa messages**~~: all built, groups A to D, Amendments 3 to 6. Messages 7 and 18 go without their PDF
  for now.
- ~~**What follows an e-visa's decision**~~ (M39 (d), answered 22 Oct 2026): built, change request 14
  ([0025](0025-evisa-after-decision.md)): message 19 with each e-visa's PDF, and messages 20 and 21 for refusals.
- ~~The consent "I agree" link~~: built, 0022 part 2 and Amendment 2.
- **Twilio's status webhook:** optional, since the checks above work without it.
- **Editing the wording in Settings.** When it comes, it must allow only the placeholders the code fills. One the code
  doesn't know would make the save that queues the message fail.
- **SMS**, which adds a channel column.
