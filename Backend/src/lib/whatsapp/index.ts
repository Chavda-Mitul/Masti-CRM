import { env } from "../../config/env";
import { logOnlyProvider } from "./logOnly";
import { twilioProvider } from "./twilio";
import type { WhatsAppMessage, WhatsAppProvider } from "./types";

// The only way the CRM sends WhatsApp (CLAUDE.md rule 7, docs/decisions/0020-whatsapp-sending.md). Callers say what to
// send; WHATSAPP_PROVIDER in .env picks who carries it. Another provider is one more file in this folder, one more case
// below and one more name in env.ts.

export type { WhatsAppMessage, WhatsAppProvider, WhatsAppStatus } from "./types";

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
        throw new Error("Twilio isn't set up yet: add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM to Backend/.env.");
      }
      return twilioProvider({ accountSid, authToken, from });
    }
  }
}

/** Sends one message. Throws with a short reason when it can't, for the caller to record. */
export async function sendWhatsApp(message: WhatsAppMessage): Promise<{ provider: string; providerMessageId: string }> {
  const provider = whatsAppProvider();
  if (!provider) throw new Error("WhatsApp isn't set up yet.");
  const { providerMessageId } = await provider.send(message);
  return { provider: provider.name, providerMessageId };
}
