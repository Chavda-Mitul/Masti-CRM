# 0021 · The WhatsApp outbox

- **Status:** decided and built, step 2 of 0020's five (21 Oct 2026, project lead). The "Sent to the client" card on the
  case comes next.
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

## Not in this step

- ~~The "Sent to the client" card~~: built, Amendment 1.
- **The other visa messages** and the reminders (step 3), from `docs/whatsapp-visa-messages.md`. Messages 7 and 18
  attach a PDF, so a message gets an attachment then.
- ~~The consent "I agree" link~~: built, 0022 part 2 and Amendment 2.
- **Twilio's status webhook:** optional, since the checks above work without it.
- **Editing the wording in Settings.** When it comes, it must allow only the placeholders the code fills. One the code
  doesn't know would make the save that queues the message fail.
- **SMS**, which adds a channel column.
