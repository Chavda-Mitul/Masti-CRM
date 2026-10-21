# 0020 · Sending WhatsApp

- **Status:** decided and built, step 1 of 5 (20 Oct 2026, project lead). The provider for go-live is still open (M2).
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
| `WHATSAPP_PROVIDER` | `off` | `off`, `log` or `twilio` |
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
   approval, M1). Messages 7 and 18 attach a PDF, so a message gets an attachment then.
4. **The consent "I agree" link** (message 4, filling the consent flag from 0006).
5. **Delivered and read ticks:** Twilio's status webhook, checked with the Auth Token. It needs a public address
   (ngrok on a laptop).
