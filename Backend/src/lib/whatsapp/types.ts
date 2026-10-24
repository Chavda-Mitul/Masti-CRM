// What every WhatsApp provider is given and gives back (docs/decisions/0020-whatsapp-sending.md). Nothing here names a
// provider, so the code that decides what to send stays the same when Masti changes provider.

export interface WhatsAppMessage {
  /** The client's number as the CRM saves it: +91XXXXXXXXXX. */
  to: string;
  /**
   * The words the client reads, always filled in: it's the record of what they were told. Sent as written only when
   * there's no template, which WhatsApp allows within 24 hours of the client's last message to us.
   */
  body: string;
  /**
   * The Meta-approved template as the provider knows it (Twilio: the Content SID, "HX…"; Meta: the template's name),
   * with a value for each of its {{placeholders}}, keyed as the template names them ("1", "2" or "client_name").
   */
  template?: { id: string; variables: Record<string, string> };
  /**
   * One file sent with the words (docs/decisions/0025-evisa-after-decision.md, part 2): a link the provider fetches it
   * from, which works for a short while only (its key is a secret), and the file's name. Twilio takes one only with our
   * own words; Meta also puts it in the document header of an approved template that has one.
   */
  attachment?: { url: string; fileName: string };
  /** Values only the client may see (the door code, secrets.ts): a live log hides them. Never sent on. */
  secrets?: readonly string[];
}

/**
 * Why a provider couldn't take a message, in plain words. `retryable`: trying again later may work (the provider was
 * down or busy). False when it can't (a wrong number or wrong keys), or when the message may already have gone.
 */
export class WhatsAppError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * Network errors that mean the request never reached the provider, so trying again can't send twice: the name wasn't
 * found, there was no way to it (the office internet down), or it turned the connection away.
 */
export const NOT_REACHED: ReadonlySet<string> = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "ENETDOWN"]);

/** Where a message has got to, in the CRM's words: the same for every provider. */
export type WhatsAppStatus = "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED";

export interface WhatsAppProvider {
  /** Saved with each message, so the log shows who carried it: "twilio", "meta", "log". */
  readonly name: string;
  /** Hands the message over, returning the provider's id for it. Delivery happens later. Throws a WhatsAppError. */
  send(message: WhatsAppMessage): Promise<{ providerMessageId: string }>;
  /** Asks where a message has got to, for providers that answer (others only report back through a webhook). */
  checkStatus?(providerMessageId: string): Promise<{ status: WhatsAppStatus; error: string | null }>;
  /** What the provider reports through its webhook, for providers that have one and are set up for it (0026). */
  webhook?: WhatsAppWebhook;
}

/**
 * A provider's webhook (docs/decisions/0026-whatsapp-webhook.md): the address it calls with what happened to our
 * messages and with the clients' own. Everything provider-specific (the set-up check, the signature, the shape) stays
 * behind this.
 */
export interface WhatsAppWebhook {
  /** The provider checking our address while it's set up: the answer it expects, or null to turn it away. */
  handshake(query: Record<string, unknown>): string | null;
  /** What one call reports, in the CRM's words; null when the call didn't come from the provider (a bad signature). */
  events(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): WhatsAppEvent[] | null;
}

/** One thing a provider's webhook reports, in the CRM's words: the same for every provider. */
export type WhatsAppEvent =
  | {
      kind: "status";
      /** The provider's id for one of our messages. */
      providerMessageId: string;
      status: "DELIVERED" | "READ" | "FAILED";
      /** Why it wasn't delivered, in plain words; null unless it failed. */
      error: string | null;
      /** When it happened, by the provider's clock. */
      at: Date;
    }
  | {
      kind: "incoming";
      /** The provider's id for the client's message: a call the provider makes again brings the same one. */
      providerMessageId: string;
      /** Who wrote: +91XXXXXXXXXX, or + and the digits for a number outside India. */
      from: string;
      /** "text", "image", "document", "audio", "button", "reaction"…, as the provider names it. */
      type: string;
      /** What they wrote: the text, a file's caption, the button they tapped, the emoji. Null for a photo without words. */
      text: string | null;
      /** The provider's id for our message they replied or reacted to, when they did. */
      replyTo: string | null;
      /** When they sent it, by the provider's clock. */
      at: Date;
    };
