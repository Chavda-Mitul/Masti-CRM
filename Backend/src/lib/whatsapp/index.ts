import { env } from "../../config/env";
import { logOnlyProvider } from "./logOnly";
import { metaProvider } from "./meta";
import { twilioProvider } from "./twilio";
import { WhatsAppError, type WhatsAppMessage, type WhatsAppProvider, type WhatsAppWebhook } from "./types";

// The only way the CRM sends WhatsApp (CLAUDE.md rule 7, docs/decisions/0020-whatsapp-sending.md). Callers say what to
// send; WHATSAPP_PROVIDER in .env picks who carries it. Another provider is one more file in this folder, one more case
// below and one more name in env.ts.

export {
  WhatsAppError,
  type ProviderTemplate,
  type TemplateDraft,
  type WhatsAppEvent,
  type WhatsAppMessage,
  type WhatsAppProvider,
  type WhatsAppStatus,
  type WhatsAppTemplates,
  type WhatsAppWebhook,
} from "./types";

let chosen: WhatsAppProvider | null | undefined;

/** The provider WHATSAPP_PROVIDER names, made on first use. Null while WhatsApp is off. */
export function whatsAppProvider(): WhatsAppProvider | null {
  if (chosen === undefined) chosen = pick();
  return chosen;
}

function pick(): WhatsAppProvider | null {
  switch (env.WHATSAPP_PROVIDER) {
    case "off":
      return null;
    case "log":
      return logOnlyProvider;
    case "twilio": {
      const { TWILIO_ACCOUNT_SID: accountSid, TWILIO_AUTH_TOKEN: authToken, TWILIO_WHATSAPP_FROM: from } = env;
      if (!accountSid || !authToken || !from) {
        throw new WhatsAppError(
          "Twilio isn't set up yet: add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM to Backend/.env.",
          false,
        );
      }
      return twilioProvider({ accountSid, authToken, from });
    }
    case "meta": {
      const { META_ACCESS_TOKEN: accessToken, META_PHONE_NUMBER_ID: phoneNumberId, META_TEMPLATE_LANGUAGE: templateLanguage } = env;
      if (!accessToken || !phoneNumberId) {
        throw new WhatsAppError("Meta isn't set up yet: add META_ACCESS_TOKEN and META_PHONE_NUMBER_ID to Backend/.env.", false);
      }
      const { META_APP_SECRET: appSecret, META_WEBHOOK_VERIFY_TOKEN: verifyToken, META_WHATSAPP_BUSINESS_ACCOUNT_ID: businessAccountId } = env;
      return metaProvider({
        accessToken,
        phoneNumberId,
        templateLanguage,
        ...(appSecret ? { appSecret } : {}),
        ...(verifyToken ? { verifyToken } : {}),
        ...(businessAccountId ? { businessAccountId } : {}),
      });
    }
  }
}

/**
 * The webhook of the provider WHATSAPP_PROVIDER names (docs/decisions/0026-whatsapp-webhook.md), with the provider's
 * name. Null when WhatsApp is off, isn't set up, or its provider has no webhook set up.
 */
export function whatsAppWebhook(): { provider: string; webhook: WhatsAppWebhook } | null {
  let provider: WhatsAppProvider | null;
  try {
    provider = whatsAppProvider();
  } catch {
    return null;
  }
  return provider?.webhook ? { provider: provider.name, webhook: provider.webhook } : null;
}

/** Sends one message. Throws a WhatsAppError with a short reason when it can't, for the caller to record. */
export async function sendWhatsApp(message: WhatsAppMessage): Promise<{ provider: string; providerMessageId: string }> {
  const provider = whatsAppProvider();
  if (!provider) throw new WhatsAppError("WhatsApp isn't set up yet.", false);
  const { providerMessageId } = await provider.send(message);
  return { provider: provider.name, providerMessageId };
}
