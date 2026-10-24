# 0026 · Meta's webhook: delivered, read, failed, and clients' own messages

- **Status:** decided 23 Oct 2026 (project lead), part 1 of 2 built: the webhook and what it records. Part 2, showing
  clients' messages on the case, comes next (change request 19).
- **Date:** 23 Oct 2026
- **Scope:** the address Meta calls, how a call is proven to be Meta's, what it records, and how it's set up. Not the
  case card that shows clients' messages (part 2), nor answering them from the CRM.

## Context

Since 0020 Amendment 1 the CRM sends through Meta's Cloud API. Meta can't be asked where a message has got to, unlike
Twilio (0021 Decision 5): it reports only by calling a webhook. Without one, every message stays "Sent", even one that
never arrived.

The number is Masti's own (+91 88855 52064), and it's off the WhatsApp Business app. So a client's message to it
reaches no one, unless the CRM takes it in through the same webhook.

On 23 Oct 2026 the project lead chose:
- to **keep clients' messages and show them on the case** (change request 19, beyond the demo);
- **ngrok** as the tunnel while we build;
- to send Masti's privacy-policy link, because Meta delivers real webhook calls only to a published app.

This is the fourth router with no login, after the consent page (0022), the CRM helper's redeem (0024) and a message's
file (0025), so it needs this record (CLAUDE.md).

## Decisions

1. **One address,** `/api/public/whatsapp-webhook`.
   - It's mounted in `app.ts` before the JSON parser, because the signature is over the raw body
     (`src/lib/readBody.ts`, up to 5 MB, since Meta batches up to 1000 updates).
   - It's provider-neutral: the provider's `webhook` (`src/lib/whatsapp/types.ts`) does the provider-specific parts.
     Today only Meta's (`metaWebhook.ts`) is built, so nothing outside `src/lib/whatsapp/` names Meta (0020
     Decision 1).
   - With no webhook set up it answers 404.
2. **Meta's check of our address (GET).** If `hub.mode` is `subscribe` and `hub.verify_token` equals
   `META_WEBHOOK_VERIFY_TOKEN` (compared in constant time), it answers `hub.challenge` as plain text. Otherwise it
   answers 403.
3. **Every call must be Meta's (POST).**
   - `X-Hub-Signature-256` must be `sha256=` and the HMAC-SHA256 of the exact bytes received, keyed with
     `META_APP_SECRET` and compared in constant time. Otherwise it answers 401, and nothing is read.
   - Only events for our `META_PHONE_NUMBER_ID` count. The App Dashboard's test calls use another number, so they're
     logged as left out.
   - A per-IP limit, like the other public routers but well above Meta's bursts: 600 a minute.
   - The request log keeps the path only, never the query, which holds the verify token.
4. **Answer 200 once everything is recorded.** If the database can't take it, the call fails and Meta calls again
   (for up to 7 days), so everything it records must be safe to record twice.
5. **Where our messages have got to.**
   - Meta's `delivered`, `read` and `failed` move the message forward only, through one `recordStatus()` shared with
     Twilio's checks (`messages.service.ts`): sent → delivered → read, or failed with its reason in plain words
     (`metaErrors.ts`).
   - A repeated report, or a late one (delivered after read), changes nothing. The row is locked while it's recorded.
   - The times are Meta's own, not when we learned them. A read without a delivered (Meta skips it when the chat is
     open) counts as delivered then too.
   - A failure is audited as `message.failed`, as with Twilio. `sent` (we knew) and `played` (a voice note) are left
     out.
   - The message is found by its provider and the provider's id: `@@unique([provider, providerMessageId])` on
     `OutboundMessage`.
6. **A status before its message's id is saved.** Meta answers our send and calls the webhook at nearly the same
   moment. So a status for an id the CRM doesn't know yet goes to the `whatsapp-status-later` job, which tries once
   more a minute later. Still unknown then, it isn't ours (a test message, or one sent from elsewhere), and it's
   logged as left out.
7. **Clients' own messages go into `InboundMessage`.**
   - Each one keeps who wrote (`fromMobile`), its type, its words if any (a text, a caption, a button's or list's
     title, an emoji), the message it replied or reacted to, and Meta's time.
   - A photo or voice note keeps its type only. Its file isn't fetched; staff phone back.
   - It's kept once: Meta's id is unique per provider, and a second call is left out.
   - It's tied to a client and case, in this order:
     1. the client and case of our message it replies or reacts to;
     2. else those of the last message we sent to that number (`sentTo`, the test number outside production);
     3. else a client with that number, main, extra or a family member's, which gives the client without a case;
     4. else it's kept with neither.
   - It's audited as `message.received` with the client, recording its type and case only. A client's words are never
     in the log or the audit.
   - The database refuses a badly written number, a blank type or blank words, and a case without its client.
8. **Settings.** Both of these are needed to switch the webhook on. In production the server warns at start-up when
   `meta` lacks either.

| Setting (`Backend/.env`) | Default | Meaning |
| --- | --- | --- |
| `META_APP_SECRET` | empty | App Dashboard → App settings → Basic → App secret. It signs every call. Never committed or pasted in a chat |
| `META_WEBHOOK_VERIFY_TOKEN` | empty | Any long random text (we make one), also typed into Meta's Configure Webhooks |

## Setting it up

1. **A public https address.**
   - On a laptop, use ngrok's free static domain: `ngrok http 5000 --url https://<domain>`.
   - Live, use Masti's own domain (`PUBLIC_APP_URL`), where nginx passes `/api` to the server.
2. **App Dashboard → WhatsApp → Configuration** (or Use cases → Customize → Configuration):
   - Callback URL: `https://<address>/api/public/whatsapp-webhook`;
   - Verify token: the one in `.env`;
   - then **Verify and save**, and subscribe the **messages** field.
3. **Publish the app:** a privacy-policy link on Masti's website, an app icon, a category. Until then Meta sends only
   the dashboard's test calls, and real ones never arrive.
4. **The Test button** next to `messages` sends a sample call. It's signed, but its phone number isn't ours, so the
   server logs it as left out. That proves the address and the signature.

## Not in this record

- **Showing clients' messages on the case** (change request 19, part 2): its own plan.
- **Answering from the CRM,** which is free within 24 hours of the client's message; and fetching photos and files
  clients send.
- **A sign for staff** that a client wrote (like change request 15's red dot).
- **Twilio's status webhook:** Twilio can still be asked (0021 Decision 5).
