import twilio from "twilio";
import type { WhatsAppProvider, WhatsAppStatus } from "./types";

// WhatsApp through Twilio (https://www.twilio.com/docs/whatsapp): its sandbox while we build, Masti's own number once
// Meta approves it (docs/decisions/0020-whatsapp-sending.md). Everything Twilio-specific stays in this file.

export interface TwilioSettings {
  accountSid: string;
  authToken: string;
  /** The WhatsApp number messages come from: +14155238886 is Twilio's sandbox. */
  from: string;
}

export function twilioProvider(settings: TwilioSettings): Required<WhatsAppProvider> {
  const client = twilio(settings.accountSid, settings.authToken);
  return {
    name: "twilio",
    async send(message) {
      try {
        const sent = await client.messages.create({
          from: `whatsapp:${settings.from}`,
          to: `whatsapp:${message.to}`,
          // With a template Twilio sends Meta's approved words, so the body must stay out.
          ...(message.template
            ? { contentSid: message.template.id, contentVariables: JSON.stringify(message.template.variables) }
            : { body: message.body }),
        });
        return { providerMessageId: sent.sid };
      } catch (error) {
        throw new Error(reasonFor(error), { cause: error });
      }
    },
    async checkStatus(providerMessageId) {
      const message = await client.messages(providerMessageId).fetch();
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
};

function failure(code: number | null, text: string | null): string {
  if (code === null) return text ?? "Twilio didn't say why.";
  return REASONS[code] ?? `Twilio error ${code}: ${text ?? "no details"} (https://www.twilio.com/docs/api/errors/${code})`;
}

/** Twilio's RestException carries a numeric code; anything else never reached Twilio (network, DNS). */
function reasonFor(error: unknown): string {
  if (error instanceof twilio.RestException) return failure(error.code ?? null, error.message);
  return `Couldn't reach Twilio: ${error instanceof Error ? error.message : String(error)}`;
}
