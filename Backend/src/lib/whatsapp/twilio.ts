import twilio from "twilio";
import { WhatsAppError, type WhatsAppProvider, type WhatsAppStatus } from "./types";

// WhatsApp through Twilio (https://www.twilio.com/docs/whatsapp): its sandbox while we build, Masti's own number once
// Meta approves it (docs/decisions/0020-whatsapp-sending.md). Everything Twilio-specific stays in this file.

export interface TwilioSettings {
  accountSid: string;
  authToken: string;
  /** The WhatsApp number messages come from: +14155238886 is Twilio's sandbox. */
  from: string;
}

/** Twilio gives up on a request after this long, well inside the send job's 2 minutes (src/lib/jobs.ts). */
const TIMEOUT_MS = 30_000;

/**
 * Errors that mean the request never reached Twilio, so trying again can't send twice: the name wasn't found, there was
 * no way to it (the office internet down), or it turned the connection away.
 */
const NOT_REACHED = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "ENETDOWN"]);

export function twilioProvider(settings: TwilioSettings): Required<WhatsAppProvider> {
  const client = twilio(settings.accountSid, settings.authToken, { timeout: TIMEOUT_MS });
  return {
    name: "twilio",
    async send(message) {
      // A template's document is part of the template itself, approved by Meta: our own link can't go with one.
      if (message.template && message.attachment) {
        throw new WhatsAppError("A message with a file goes with our own words: an approved template with a document comes later (M1).", false);
      }
      try {
        const sent = await client.messages.create({
          from: `whatsapp:${settings.from}`,
          to: `whatsapp:${message.to}`,
          // With a template Twilio sends Meta's approved words, so the body must stay out.
          ...(message.template
            ? { contentSid: message.template.id, contentVariables: JSON.stringify(message.template.variables) }
            : { body: message.body }),
          // Twilio fetches the file from the link (with GET and HEAD) and sends it after the words.
          ...(message.attachment ? { mediaUrl: [message.attachment.url] } : {}),
        });
        return { providerMessageId: sent.sid };
      } catch (error) {
        throw errorFor(error, "send");
      }
    },
    async checkStatus(providerMessageId) {
      let message;
      try {
        message = await client.messages(providerMessageId).fetch();
      } catch (error) {
        // In plain words too, like a refused send: wrong keys, or Twilio out of reach.
        throw errorFor(error, "read");
      }
      const status = statusOf(message.status);
      // Both are empty on a message that hasn't failed, whatever Twilio's types say.
      const code = (message.errorCode as number | null | undefined) ?? null;
      const text = (message.errorMessage as string | null | undefined) ?? null;
      return { status, error: status === "FAILED" ? failure(code, text) : null };
    },
  };
}

function statusOf(status: string): WhatsAppStatus {
  switch (status) {
    case "sent":
      return "SENT";
    case "delivered":
      return "DELIVERED";
    case "read":
      return "READ";
    case "failed":
    case "undelivered":
    case "canceled":
      return "FAILED";
    default:
      // accepted, scheduled, queued, sending
      return "QUEUED";
  }
}

// Plain words for the failures we expect. Anything else keeps Twilio's own text and the link to its error page.
const REASONS: Record<number, string> = {
  20003: "Twilio refused the Account SID or Auth Token. Copy both again from the Twilio Console.",
  63003: "That number isn't on WhatsApp, or isn't written correctly.",
  63007: "Twilio doesn't know the sending number. Check TWILIO_WHATSAPP_FROM, and that the sandbox is switched on in this Twilio account.",
  63015: "This phone hasn't joined the Twilio sandbox, or joined more than 3 days ago. Send the join message from it again.",
  63016: "It's more than 24 hours since this number last wrote to us, so WhatsApp only takes an approved template.",
  63019: "Twilio couldn't fetch the attached file: the CRM's public address (PUBLIC_APP_URL) must be reachable from the internet.",
};

function failure(code: number | null, text: string | null): string {
  if (code === null) return text ?? "Twilio didn't say why.";
  return REASONS[code] ?? `Twilio error ${code}: ${text ?? "no details"} (https://www.twilio.com/docs/api/errors/${code})`;
}

/**
 * Twilio's refusal (a RestException, with its code) is worth another try only when Twilio was down or busy. A network
 * error on a send is worth one only when the request never left: a timeout or a dropped connection may come after
 * Twilio took the message, and trying again could send it twice. A read (a status check) can always be asked again.
 */
function errorFor(error: unknown, request: "send" | "read"): WhatsAppError {
  if (error instanceof twilio.RestException) {
    const retryable = error.status >= 500 || error.status === 429;
    return new WhatsAppError(failure(error.code ?? null, error.message), retryable, { cause: error });
  }
  const text = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  if (request === "read" || (typeof code === "string" && NOT_REACHED.has(code))) {
    return new WhatsAppError(`Couldn't reach Twilio: ${text}`, true, { cause: error });
  }
  return new WhatsAppError(`Twilio didn't answer (${text}), so the message may or may not have gone. Check the chat.`, false, {
    cause: error,
  });
}
