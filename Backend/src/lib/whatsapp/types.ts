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
}
