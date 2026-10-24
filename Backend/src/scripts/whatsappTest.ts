import { normaliseMobile } from "../lib/contact";
import { dayLabel, istTimestamp, istToday } from "../lib/dates";
import { sendWhatsApp, whatsAppProvider, type WhatsAppMessage, type WhatsAppStatus } from "../lib/whatsapp";
import { metaTemplateName } from "../lib/whatsapp/metaTemplates";
import { TEMPLATE_SAMPLES } from "../modules/messages/messageTemplates";
import { VISA_DOCUMENTS_RECEIVED } from "../modules/messages/messages.seed";

// npm run whatsapp:test -- 98250 41234 [template | media <https link to a file>]
// Sends one test WhatsApp through WHATSAPP_PROVIDER to check the set-up (docs/decisions/0020-whatsapp-sending.md). It
// sends our own words, which WhatsApp delivers only within 24 hours of that phone's last message to us; "template" sends
// an approved template instead, which goes at any time: Twilio's sandbox sample, or with Meta our own "All documents
// received" with its sample values, once `npm run whatsapp:templates` has it approved (0020 Amendment 2); "media" adds
// the file at that link, which the provider fetches (docs/decisions/0025-evisa-after-decision.md, part 2). Plain words,
// not --template: PowerShell's npm drops flags after --. On a server: node dist/src/scripts/whatsappTest.js

/** Twilio's sample template in every sandbox: "Your appointment is coming up on {{1}} at {{2}}". */
const SANDBOX_TEMPLATE = "HXb5b62575e6e4ff6129ad7c8efe1f983e";

const WAIT_SECONDS = 30;

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const word = (arg: string) => arg.replace(/^--/, "");
  const useTemplate = args.some((arg) => word(arg) === "template");
  const mediaAt = args.findIndex((arg) => word(arg) === "media");
  const mediaUrl = mediaAt >= 0 ? args[mediaAt + 1] : undefined;
  if (mediaAt >= 0 && !mediaUrl?.startsWith("https://")) {
    console.error("Give the file's https link after media: npm run whatsapp:test -- 98250 41234 media https://…/file.pdf");
    return 1;
  }
  if (useTemplate && mediaUrl) {
    console.error("Send a file with our own words, not with the template.");
    return 1;
  }
  const to = normaliseMobile(args.filter((arg, i) => word(arg) !== "template" && (mediaAt < 0 || (i !== mediaAt && i !== mediaAt + 1))).join(" "));
  if (!to) {
    console.error("Give the mobile number to send to: npm run whatsapp:test -- 98250 41234");
    return 1;
  }
  const provider = whatsAppProvider();
  if (!provider) {
    console.error("WhatsApp is off. Set WHATSAPP_PROVIDER and its values (TWILIO_* or META_*) in Backend/.env (see .env.example).");
    return 1;
  }

  const day = dayLabel(istToday());
  const time = istTimestamp().slice(11, 16);
  const { client_name, visa, case_no } = TEMPLATE_SAMPLES;
  const sample: WhatsAppMessage =
    provider.name === "meta"
      ? {
          to,
          body: `All documents received (a sample: ${client_name}, ${visa}, ${case_no})`,
          template: { id: metaTemplateName(VISA_DOCUMENTS_RECEIVED), variables: { client_name: client_name!, visa: visa!, case_no: case_no! } },
        }
      : {
          to,
          body: `Your appointment is coming up on ${day} at ${time}`,
          template: { id: SANDBOX_TEMPLATE, variables: { "1": day, "2": time } },
        };
  const message: WhatsAppMessage = useTemplate
    ? sample
    : mediaUrl
      ? {
          to,
          body: `Test file from Masti CRM, sent ${day} at ${time}. If a document comes with this, files work.`,
          attachment: { url: mediaUrl, fileName: decodeURIComponent(new URL(mediaUrl).pathname.split("/").at(-1) || "file") },
        }
      : { to, body: `Test message from Masti CRM, sent ${day} at ${time}. If you can read this, WhatsApp works.` };

  const { providerMessageId } = await sendWhatsApp(message);
  if (!provider.checkStatus) {
    if (provider.name === "log") {
      console.log(`Handed to "log" (${providerMessageId}), which can't report delivery. See the server log.`);
      return 0;
    }
    console.log(`Handed to ${provider.name} (${providerMessageId}), which can't be asked about delivery. Check WhatsApp on that phone.`);
    if (!useTemplate) {
      console.log(`Nothing there? Our own words go only within 24 hours of that phone's last message to us: send one from it first.`);
    }
    return 0;
  }
  console.log(`Handed to ${provider.name} (${providerMessageId}). Waiting for delivery…`);
  let status: WhatsAppStatus = "QUEUED";
  for (let waited = 0; waited < WAIT_SECONDS; waited += 2) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const check = await provider.checkStatus(providerMessageId);
    status = check.status;
    if (status === "FAILED") {
      console.error(`Not delivered. ${check.error ?? ""}`);
      if (!useTemplate) console.error(`In the sandbox, adding "template" sends Twilio's approved sample, which goes even after 24 hours.`);
      return 1;
    }
    if (status === "DELIVERED" || status === "READ") {
      console.log("Delivered. Check WhatsApp on that phone.");
      return 0;
    }
  }
  console.log(`Still ${status.toLowerCase()} after ${WAIT_SECONDS} seconds. Check the phone, or Twilio Console → Monitor → Logs → Messaging.`);
  return 0;
}

// The script ends on its own rather than by process.exit(): exiting just after a fetch (Meta's provider) trips a libuv
// assertion on Windows ("UV_HANDLE_CLOSING") and gives a wrong exit code.
main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
