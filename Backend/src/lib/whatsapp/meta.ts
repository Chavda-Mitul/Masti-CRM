import { NOT_REACHED, WhatsAppError, type WhatsAppMessage, type WhatsAppProvider } from "./types";

// WhatsApp through Meta's Cloud API directly (https://developers.facebook.com/documentation/business-messaging/whatsapp),
// with no provider in between (docs/decisions/0020-whatsapp-sending.md, amendment 1). Everything Meta-specific stays in
// this file. Meta can't be asked where a message has got to: it reports delivery only through a webhook, so there's no
// checkStatus here.

export interface MetaSettings {
  /** A system user's token with whatsapp_business_messaging. API Setup's temporary one stops working within a day. */
  accessToken: string;
  /** The number messages come from, as Meta knows it: WhatsApp → API Setup → Phone number ID. */
  phoneNumberId: string;
  /** The language Masti's templates are approved in, e.g. en_US (that of Meta's own hello_world). */
  templateLanguage: string;
}

/** The Graph API version this file is written for (v26.0, July 2026). Meta keeps each version for about two years. */
const GRAPH_API = "https://graph.facebook.com/v26.0";

/** Meta is given this long to answer, well inside the send job's 2 minutes (src/lib/jobs.ts), as Twilio is. */
const TIMEOUT_MS = 30_000;

/** Meta's codes for being down or busy (rate limits, its own errors), when trying again later may work. */
const BUSY: ReadonlySet<number> = new Set([4, 80007, 130429, 131000, 131016, 131056, 131057, 133004]);

/** What Meta answers when it takes a message: its id, "wamid.…". */
interface Taken {
  messages?: { id?: string }[];
}

/** What Meta answers when it turns a request down. */
interface Refused {
  error?: { code?: number; error_subcode?: number; message?: string; error_data?: { details?: string } };
}

export function metaProvider(settings: MetaSettings): WhatsAppProvider {
  return {
    name: "meta",
    async send(message) {
      let response: Response;
      try {
        response = await fetch(`${GRAPH_API}/${settings.phoneNumberId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${settings.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(requestFor(message, settings.templateLanguage)),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        throw networkError(error);
      }
      const answer: unknown = await response.json().catch(() => null);
      if (!response.ok) throw refusal(response.status, answer as Refused | null);
      const id = (answer as Taken | null)?.messages?.[0]?.id;
      if (!id) {
        throw new WhatsAppError("Meta's answer had no id for the message, so it may or may not have gone. Check the chat.", false);
      }
      return { providerMessageId: id };
    },
  };
}

/** One message as Meta takes it: the approved template when there is one, else our own words; with the file if any. */
function requestFor(message: WhatsAppMessage, language: string): Record<string, unknown> {
  const { template, attachment } = message;
  // Meta takes the number with its country code and without the +.
  const request = { messaging_product: "whatsapp", recipient_type: "individual", to: message.to.replace(/^\+/, "") };
  if (template) {
    const components = [
      // The file goes in the template's document header, approved by Meta with the template.
      ...(attachment
        ? [{ type: "header", parameters: [{ type: "document", document: { link: attachment.url, filename: attachment.fileName } }] }]
        : []),
      ...(Object.keys(template.variables).length > 0 ? [{ type: "body", parameters: bodyValues(template.variables) }] : []),
    ];
    return {
      ...request,
      type: "template",
      template: { name: template.id, language: { code: language }, ...(components.length > 0 ? { components } : {}) },
    };
  }
  // Meta fetches the file from the link, and our words go with it as its caption.
  if (attachment) {
    return { ...request, type: "document", document: { link: attachment.url, filename: attachment.fileName, caption: message.body } };
  }
  return { ...request, type: "text", text: { body: message.body } };
}

/** A template's values: named ones ({{client_name}}) with their names, numbered ones ({{1}}, {{2}}) in their order. */
function bodyValues(variables: Record<string, string>): Record<string, string>[] {
  const values = Object.entries(variables);
  if (values.every(([name]) => /^\d+$/.test(name))) {
    return values.sort(([a], [b]) => Number(a) - Number(b)).map(([, text]) => ({ type: "text", text }));
  }
  return values.map(([name, text]) => ({ type: "text", parameter_name: name, text }));
}

// Plain words for the failures we expect. Anything else keeps Meta's own words and the link to its list of codes.
const TOKEN = "Meta refused the access token: it has expired or is wrong. Make a new one and put it in META_ACCESS_TOKEN in Backend/.env.";
const NOT_ALLOWED =
  "The access token isn't allowed to send from this WhatsApp number. Give its system user this WhatsApp account with the whatsapp_business_messaging permission, then make a new token.";
const RESTRICTED = "Meta has restricted this WhatsApp account. See WhatsApp Manager → Account quality.";
const REASONS: Record<number, string> = {
  0: TOKEN,
  190: TOKEN,
  10: NOT_ALLOWED,
  131005: NOT_ALLOWED,
  131030: "This phone isn't on the test number's list. Add it in Meta's App Dashboard → WhatsApp → API Setup → To.",
  131047: "It's more than 24 hours since this number last wrote to us, so WhatsApp only takes an approved template.",
  131026: "WhatsApp couldn't deliver it: the number may not be on WhatsApp, or its WhatsApp may be out of date.",
  132000: "The template's values don't match the ones Meta approved: one is missing or extra.",
  132001: "Meta has no approved template by this name in this language. Check the template's name and META_TEMPLATE_LANGUAGE.",
  131058: "Meta's hello_world goes only from its public test numbers. From a real number, send our own words or one of our approved templates.",
  133010: "This WhatsApp number isn't registered with the Cloud API. Finish its registration in WhatsApp Manager.",
  131042: "Meta has a payment problem on this WhatsApp account. Add or fix the payment method in WhatsApp Manager.",
  131031: RESTRICTED,
  368: RESTRICTED,
  131053:
    "Meta couldn't fetch or use the attached file: the CRM's public address (PUBLIC_APP_URL) must be reachable from the internet, and the file must be a type WhatsApp takes.",
};

function failure(code: number, subcode: number | undefined, text: string): string {
  if (code === 100 && subcode === 33) {
    return "Meta doesn't know this phone number ID, or the token can't use it. Check META_PHONE_NUMBER_ID in Backend/.env (WhatsApp → API Setup).";
  }
  if (code >= 200 && code <= 299) return NOT_ALLOWED;
  return REASONS[code] ?? `Meta error ${code}: ${text} (https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes)`;
}

/** Meta turned the request down, so nothing went: worth another try only when Meta was down or busy. */
function refusal(status: number, answer: Refused | null): WhatsAppError {
  const retryable = status >= 500 || status === 429;
  const error = answer?.error;
  if (error?.code === undefined) return new WhatsAppError(`Meta answered ${status} without saying why.`, retryable);
  const text = error.error_data?.details ?? error.message ?? "no details";
  return new WhatsAppError(failure(error.code, error.error_subcode, text), retryable || BUSY.has(error.code));
}

/**
 * The request failed before Meta answered. Worth another try only when it never left (the network error's cause says
 * so): a timeout or a dropped connection may come after Meta took the message, and trying again could send it twice.
 */
function networkError(error: unknown): WhatsAppError {
  const cause = (error as { cause?: unknown } | null)?.cause;
  const code = (cause as { code?: unknown } | null)?.code;
  const text = cause instanceof Error ? cause.message : error instanceof Error ? error.message : String(error);
  if (typeof code === "string" && NOT_REACHED.has(code)) return new WhatsAppError(`Couldn't reach Meta: ${text}`, true, { cause: error });
  const why = error instanceof Error && error.name === "TimeoutError" ? `within ${TIMEOUT_MS / 1000} seconds` : `(${text})`;
  return new WhatsAppError(`Meta didn't answer ${why}, so the message may or may not have gone. Check the chat.`, false, { cause: error });
}
