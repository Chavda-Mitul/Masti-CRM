# 0020 · Sending WhatsApp

- **Status:** decided and built, step 1 of 5 (20 Oct 2026, project lead). The provider for go-live is still open (M2).
  *Since 23 Oct 2026 we build on Meta's Cloud API directly; Twilio stays a choice: see Amendment 1.*
- **Date:** 20 Oct 2026
- **Scope:** how the backend hands a WhatsApp message to a provider, which provider, and how to check the set-up. Not
  what is sent or when: the outbox (0003 Decision 6) and the visa messages come next (below).

## Context

Golden rule 7: the client hears at every step, automatically, through the WhatsApp Business API with Meta-approved
templates. Every visa step since 0003 has left its message "for the WhatsApp work", and the handover code goes by email
until then (0014, 0015). The provider isn't chosen with Masti yet (M2, §16.3 #4). On 20 Oct 2026 the project lead chose
to start with **Twilio**, whose sandbox needs no Meta approval, so messages can be tried now. Twilio may not stay, so
changing provider must not touch the code that decides what to send.

## Decisions

1. **One way out:** `src/lib/whatsapp/` (`sendWhatsApp()`), as `email.ts` is for email. Callers give the number
   (+91…), the words the client reads and, when there is one, the Meta-approved template with its values. Nothing
   outside this folder names a provider.
2. **One file per provider,** picked by `WHATSAPP_PROVIDER` in `.env`:
   - `off` (the default): nothing is sent, and `sendWhatsApp` throws "WhatsApp isn't set up yet."
   - `log`: the message goes into the server log instead, for a laptop with no WhatsApp account, as Mailpit catches
     email. The server warns at start-up if production uses it.
   - `twilio`: `twilio.ts`, with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_WHATSAPP_FROM`.
   - `meta` (since 23 Oct 2026, Amendment 1): `meta.ts`, with `META_ACCESS_TOKEN` and `META_PHONE_NUMBER_ID`.

   Another provider (Meta's Cloud API directly, Gupshup, Interakt…) is one more file, one more `case` in `index.ts` and
   one more name in `env.ts`. Templates are approved again at the new provider, so a template's provider id is data,
   not code (the outbox's `MessageTemplate.providerTemplateName`, 0003).
3. **Every message keeps its words.** `body` is always filled in: it's the record of what the client was told. With a
   template, the provider sends Meta's approved words (Twilio: `contentSid` and `contentVariables`) and the body stays
   out of the request. Without one, the body goes as written, which WhatsApp delivers only within 24 hours of the
   client's last message to us.
4. **Template values are keyed as the template names them:** `"1"`, `"2"` (Twilio's sandbox sample) or `client_name`
   (the drafted visa messages).
5. **Statuses in the CRM's words,** the same for every provider: QUEUED, SENT, DELIVERED, READ, FAILED (0003's
   `MessageStatus`, without SKIPPED, which only the outbox decides). A provider that can be asked answers through
   `checkStatus` (Twilio does); the others will report through a webhook.
6. **Failures in plain words.** Twilio's common error codes become a sentence that says what to do: 20003 (wrong keys),
   63003 (not on WhatsApp), 63007 (unknown sending number), 63015 (hasn't joined the sandbox), 63016 (outside the 24
   hours). Others keep Twilio's text and the link to its error page. A network failure says "Couldn't reach Twilio".
7. **A test command:** `npm run whatsapp:test -- 98250 41234` sends one message through the chosen provider and waits
   up to 30 seconds for Twilio to report delivery. Adding the word `template` sends Twilio's sandbox sample template
   ("Your appointment is coming up on … at …"), which goes even outside the 24 hours. It's a plain word because
   PowerShell's npm drops flags after `--`. On a built server: `node dist/src/scripts/whatsappTest.js 98250 41234`.
8. **Tests never send.** `vitest.config.mts` forces `WHATSAPP_PROVIDER=off` and blanks the Twilio keys, whatever
   `.env` says; `tests/whatsapp.test.ts` checks the providers with a stand-in for Twilio.

| Setting (`Backend/.env`) | Default | Meaning |
| --- | --- | --- |
| `WHATSAPP_PROVIDER` | `off` | `off`, `log`, `twilio` or `meta` (Amendment 1) |
| `TWILIO_ACCOUNT_SID` | empty | Starts with `AC`: Twilio Console → Account Info |
| `TWILIO_AUTH_TOKEN` | empty | Next to it. Never committed |
| `TWILIO_WHATSAPP_FROM` | empty | The sending number with + and the country code; the sandbox's is `+14155238886` |

## Twilio's sandbox, while we build

1. Sign up at twilio.com (free trial).
2. In the Console, open Messaging → WhatsApp → **Try out WhatsApp** (older Console: Messaging → Try it out → Send a
   WhatsApp message) and accept the sandbox terms.
3. From each phone that should get test messages, send the `join <two words>` message shown there to the sandbox
   number, or scan the QR code. A join lasts 3 days; then send it again.
4. Put the Account SID and Auth Token in `Backend/.env`, with `WHATSAPP_PROVIDER=twilio`,
   `TWILIO_WHATSAPP_FROM=+14155238886` and (since 0021) `WHATSAPP_TEST_NUMBER` set to your phone, the one that joined.
5. Run `npm run whatsapp:test -- <your mobile>`.

The sandbox reaches only phones that joined it, so it can't message a real client by mistake. It can't use our own
templates either: until Masti's number and templates are approved, our drafted messages go as plain words, within 24
hours of the tester's last message to the sandbox.

## For go-live (not built)

- **Masti's own number** registered as a WhatsApp sender in Twilio (Meta Business Manager and business verification,
  inputs A3); `TWILIO_WHATSAPP_FROM` becomes that number.
- **The visa messages** submitted as templates (Twilio's Content Template Builder) once Masti approves the wording
  (M1). Each one's Content SID goes on its template row.
- **An API key for sending:** Twilio advises one in production instead of the Auth Token. The Auth Token is still
  needed to check the signature on Twilio's webhooks (step 5).
- **The cost** (Meta's charge per message plus Twilio's) goes on the running-cost sheet (golden rule 11).

## Next steps (agreed 20 Oct 2026, one at a time)

2. **Built 21 Oct 2026, `docs/decisions/0021-whatsapp-outbox.md`. The outbox:** `MessageTemplate` and `OutboundMessage` (0003 Decision 6), written in the same transaction as the
   change they report, and a background sender (pg-boss is the suggestion in §16.5) that retries without sending twice.
3. **The visa messages at every step,** from the drafted texts (`docs/whatsapp-visa-messages.md`, waiting for Masti's
   approval, M1). Messages 7 and 18 attach a PDF, so a message gets an attachment then. *Attachments are built (22 Oct
   2026, [0025](0025-evisa-after-decision.md) Decision 4): `WhatsAppMessage.attachment`, sent by Twilio as `mediaUrl`
   from the CRM's own short-lived link.*
4. **The consent "I agree" link** (message 4, filling the consent flag from 0006).
5. **Delivered and read ticks:** Twilio's status webhook, checked with the Auth Token. It needs a public address
   (ngrok on a laptop). *With Meta it's Meta's webhook: Amendment 1, piece 2, built in
   [0026](0026-whatsapp-webhook.md).*

## Amendment 1 (23 Oct 2026): Meta's Cloud API directly

On 23 Oct 2026 the project lead switched development from Twilio to **Meta's WhatsApp Cloud API**, with no provider in
between. Masti's choice for go-live is still M2. Twilio stays a choice (`WHATSAPP_PROVIDER=twilio`), since nothing that
decides what to send changes. The Meta app is set up, and its number is **Masti's own, +91 88855 52064, "Masti
Travels"** (the project lead, 23 Oct 2026), connected to the Cloud API. Meta's answer for it on 23 Oct 2026:
- **Not on the WhatsApp Business app** (`is_on_biz_app: false`), so a client's reply to it reaches no one until the CRM
  takes in incoming messages (Meta's webhook, piece 2; the Holidays "Client replied — your turn" needs them anyway).
- **Up to 250 clients a day** (`TIER_250`) until Masti's business is verified with Meta, which raises the limit.

The work comes in three pieces, one at a time:

1. **Sending (built):** `src/lib/whatsapp/meta.ts`, `WHATSAPP_PROVIDER=meta`.
2. **Delivered, read and failed:** Meta's webhook. It needs its own decision record (an address with no login), a public
   https address (a tunnel on a laptop), and the Meta app published: an unpublished app gets only test webhooks.
   *Built 23–24 Oct 2026: [0026](0026-whatsapp-webhook.md), which also keeps clients' own messages (change request
   19).*
3. **Masti's templates** created and approved in WhatsApp Manager, each one's name on its template row. The door code
   (message 16) is an authentication template with a copy-code button, and the consent link may go in a URL button:
   both need their own components. *Built 24 Oct 2026: Amendment 2. The consent link stays in the words.*

How piece 1 sends:
- **One request per message** to `https://graph.facebook.com/v26.0/{phone number id}/messages`, with Node's own
  `fetch` (no new package) and the access token. Meta gets 30 seconds to answer, as Twilio does. The number goes
  without its `+`.
- **Our own words** go as a text message; **a file** as a document, from the CRM's own short-lived link (0025
  Decision 4), with our words as its caption. Meta fetches it, so the link must be reachable from the internet, as with
  Twilio.
- **A template** goes by its name (`MessageTemplate.providerTemplateId`) in one language for all of them
  (`META_TEMPLATE_LANGUAGE`, default `en_US`). Named values go by name, numbered ones in order, and a file goes in the
  template's document header.
- **No status checks:** Meta can't be asked where a message has got to; it reports only through its webhook. Until
  piece 2 a sent message stays "Sent" on the case (the outbox schedules no checks for such a provider, 0021 Decision 5),
  even one that never arrives: our own words outside the 24 hours, or a file Meta couldn't fetch. While we build, send
  any message from the test phone to Masti's number once a day, so our words keep arriving.
- **Failures in plain words**, from Meta's error codes: 0 and 190 (the token expired or wrong), 100 with subcode 33
  (wrong phone number ID), 10, 200–299 and 131005 (the token not allowed), 131030 (not on a test number's list), 131047
  (outside the 24 hours), 131026 (undeliverable), 132000 and 132001 (template values or name), 131058 (hello_world from
  a real number), 133010 (number not registered), 131042 (payment), 131031 and 368 (account restricted), 131053 (the
  file). Others keep Meta's details and the link to its list of codes.
- **Tried again** only when Meta was down or busy: HTTP 500 and above, 429, and codes 4, 80007, 130429, 131000, 131016,
  131056, 131057 and 133004. A request that never left is tried again; a timeout or a dropped connection isn't, since
  the message may have gone.
- **The test command:** `template` sends Meta's `hello_world`, which Meta allows only from its public test numbers, so
  from Masti's number the check is our own words, within 24 hours of a message from that phone. The command now ends
  without `process.exit()`, which crashes Node on Windows just after a `fetch` (a libuv assertion, exit code 127).

| Setting (`Backend/.env`) | Default | Meaning |
| --- | --- | --- |
| `META_ACCESS_TOKEN` | empty | A system user's token with `whatsapp_business_messaging`. The App Dashboard's temporary one stops working within a day. Never committed |
| `META_PHONE_NUMBER_ID` | empty | App Dashboard → WhatsApp → API Setup → Phone number ID (digits) |
| `META_TEMPLATE_LANGUAGE` | `en_US` | The language Masti's templates are approved in at Meta |

`META_WHATSAPP_BUSINESS_ACCOUNT_ID` is noted in `.env` too, for piece 3 (reading the templates' approval).

**Before piece 2:** a permanent token. In Meta Business Settings → Users → System users, add one, give it the app and
the WhatsApp account, and generate a token with `whatsapp_business_messaging` and `whatsapp_business_management`. It
goes straight into `Backend/.env`, never into a chat. *24 Oct 2026: Meta's `debug_token` shows the token in `.env` is
already a system user's, which never expires. It was pasted in a chat once, so make a new one and revoke it before
go-live.*

## Amendment 2 (24 Oct 2026): Masti's templates on Meta, and files sent as files

Without an approved template, WhatsApp delivers our words only within 24 hours of the client's last message, and most
visa messages go out days apart.

**The project lead decided on 24 Oct 2026** to submit all 21 wordings to Meta now, in the current draft's words, before
Masti approves them (M1). This replaces `PROJECT_KNOWLEDGE.md`'s "they go to Meta after the client approves". When
Masti changes words, the changed templates are edited, and Meta reviews them again.

1. **One template per wording,** made from the `MessageTemplate` rows (`modules/messages/messageTemplates.ts`, the
   Meta side in `lib/whatsapp/metaTemplates.ts`):
   - **The name** is the code with `_` for `.`, e.g. `visa_documents_received`, in `META_TEMPLATE_LANGUAGE`.
   - **Utility templates:** our words, `parameter_format: "named"`, and a made-up sample for every placeholder
     (`TEMPLATE_SAMPLES`), which Meta's reviewers read.
   - **The door code** (`ONE_TIME_CODE_TEMPLATES`) is Meta's **authentication** template: Meta's own words, "<code> is
     your verification code. This code expires in N minutes.", where N is `field.otpMinutes` ⚠️ at submission. There's
     no "do not share" line, and there's a **Copy code** button. It's sent with the code twice: in the words and in the
     button.
   - **A wording that carries a file** (`TEMPLATES_WITH_FILE`) gets a document header. These are the e-visa, and since
     24 Oct 2026 the invoice and the credit note (point 4). Its sample is a one-page PDF uploaded through Meta's
     Resumable Upload API; the app's id comes from the token's `debug_token`.
   - **Checked first, in plain words:** at most 1,024 characters; no placeholder first, last, or beside another;
     lowercase names; a sample for each.
2. **`npm run whatsapp:templates -- submit | check`** (`src/scripts/whatsappTemplates.ts`):
   - **`submit`** creates each missing template, and changes one whose words differ from ours. It doesn't change one
     still under review, and says so. Then it runs `check`.
   - **`check`** switches a wording on (`providerTemplateId` = the template's name) only when Meta has approved it in
     its current words, and off otherwise. A wording that's off goes as plain words, rather than failing on a mismatch.
     Each change is audited as `message.template.provider`, with no actor.
   - Both print a table: on/off, the name, Meta's status, and any reason, note or problem.
   - Run `check` again after Meta's review (minutes to a day), and after the database is re-seeded.
   - Twilio's templates stay in its own console.
3. **Files are sent as files.**
   - The outbox gives the provider the file's type and `read()`, its bytes from the bucket, besides the link (0025
     Decision 4).
   - Meta uploads the file first (`POST /{phone number id}/media`) and names it by the media id, in a document message
     or a template's header. So it arrives from a laptop, or from a server Meta can't reach.
   - A failed upload sends nothing, so it's tried again, unless Meta refused the file itself (131053).
   - Twilio still fetches the link.
4. **The invoice and the credit note go with their PDF** (the project lead, 24 Oct 2026, reversing 22 Oct's words
   only). Message 7 says the bank details are on the invoice. `queueInvoiceMessage` and `queueCreditNoteMessage` attach
   the invoice's or credit note's own file (`Invoice.fileId`, `CreditNote.fileId`), and the wording doesn't change.
5. **The test command:** with Meta, `template` sends our approved "All documents received" with the samples. Meta
   allows `hello_world` only from its public test numbers.

| Setting (`Backend/.env`) | Default | Meaning |
| --- | --- | --- |
| `META_WHATSAPP_BUSINESS_ACCOUNT_ID` | empty | App Dashboard → WhatsApp → API Setup → WhatsApp Business Account ID. With it, the CRM makes and checks the templates |

**Submitted 24 Oct 2026** (from a freshly seeded worktree database). The 20 utility templates are with Meta for review.
What Meta said on the way:
- **Messages 5 and 14 were rejected (`INCORRECT_CATEGORY`)** for "We will send you a code to tell our staff member at
  the door": an ordinary template may not mention a code. The project lead had the sentence dropped from both. The
  code itself still comes in message 16. A database seeded before this keeps the old words, so `check` leaves those
  two off until it's reset and re-seeded.
- **A change must repeat `parameter_format: "named"`.** Without it Meta rejected the edited words as `INVALID_FORMAT`.
  `submit` now sends a rejected template again even in our words, so a fixed one is reviewed again.
- **The door code (message 16) couldn't be made:** "This WhatsApp Business account does not have permission to create
  message template" (code 10, subcode 2388185). Meta allows authentication templates only for a business it has
  verified, and some guides add a higher daily limit than 250.
  - Until then the code goes as plain words, which reach only a client who wrote to Masti in the last 24 hours.
  - The project lead chose a stopgap. The field app's and the desk handover's code step first say "ask the client to
    reply 'Hi' to any WhatsApp message from us", which opens those 24 hours.
  - Remove that line once the code template is switched on.
- **Masti's business verification** (Meta Business Settings → Security Centre) is now needed for the code template, and
  to go past 250 clients a day. It needs Masti's business documents (inputs A3).

**Cost:** Meta charges for each utility template message (about ₹0.1–0.2 in India); one inside the 24 hours is free.
This goes on the running-cost sheet (golden rule 11). Outside production every message goes to the test number.

**Next, each with its own plan:**
- **Change request 22, the Quotation PDF:** "Your price" (message 2) carries a quotation in the invoice's layout, marked
  "Not a tax invoice". Its template then gets a document header: an edit and a new review.
- **"Your price" waits, and is dropped if the invoice comes first:** a wait set in Settings → Visa → Client messages ⚠️
  (10 minutes). Raising an invoice skips a price message still waiting.
