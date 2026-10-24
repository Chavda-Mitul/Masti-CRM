// Meta's error codes in plain words (https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes),
// for a send Meta refuses (meta.ts) and for a message its webhook reports undelivered (metaWebhook.ts, 0026). Anything
// else keeps Meta's own words and the link to its list of codes.

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

/** Why Meta refused or didn't deliver a message: its code (and subcode) in plain words, or its own words for one we don't know. */
export function metaFailure(code: number, subcode: number | undefined, text: string): string {
  if (code === 100 && subcode === 33) {
    return "Meta doesn't know this phone number ID, or the token can't use it. Check META_PHONE_NUMBER_ID in Backend/.env (WhatsApp → API Setup).";
  }
  if (code >= 200 && code <= 299) return NOT_ALLOWED;
  return REASONS[code] ?? `Meta error ${code}: ${text} (https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes)`;
}
