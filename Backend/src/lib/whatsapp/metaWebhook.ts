import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { normaliseMobile } from "../contact";
import { logger } from "../logger";
import { metaFailure } from "./metaErrors";
import type { WhatsAppEvent, WhatsAppWebhook } from "./types";

// Meta's webhook (docs/decisions/0026-whatsapp-webhook.md;
// https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview): the handshake when
// Meta's Configure Webhooks checks our address, the signature on every call, and its "messages" field (where our
// messages have got to, and the clients' own) in the CRM's words. A client's words are never logged.

export interface MetaWebhookSettings {
  /** The app's secret: Meta signs every call with it. */
  appSecret: string;
  /** The word Meta's Configure Webhooks was given. */
  verifyToken: string;
  /** Only this number's events count: Meta's dashboard tests, and any other number's, are left out. */
  phoneNumberId: string;
}

const statusSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  timestamp: z.string(),
  errors: z
    .array(
      z.object({
        code: z.number(),
        title: z.string().optional(),
        message: z.string().optional(),
        error_data: z.object({ details: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});

const captioned = z.object({ caption: z.string().optional() }).optional();
const messageSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  timestamp: z.string(),
  type: z.string().min(1),
  /** The message it replies to, when the client swiped to reply. */
  context: z.object({ id: z.string().optional() }).optional(),
  text: z.object({ body: z.string() }).optional(),
  image: captioned,
  document: captioned,
  video: captioned,
  audio: captioned,
  sticker: captioned,
  button: z.object({ text: z.string().optional() }).optional(),
  interactive: z
    .object({
      button_reply: z.object({ title: z.string() }).optional(),
      list_reply: z.object({ title: z.string() }).optional(),
    })
    .optional(),
  reaction: z.object({ message_id: z.string().optional(), emoji: z.string().optional() }).optional(),
});

const payloadSchema = z.object({
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.object({
            metadata: z.object({ phone_number_id: z.string() }).optional(),
            statuses: z.array(z.unknown()).optional(),
            messages: z.array(z.unknown()).optional(),
          }),
        }),
      ),
    }),
  ),
});

/** A number in the shape the CRM keeps: +91XXXXXXXXXX, or + and the digits outside India. */
const MOBILE = /^\+[1-9]\d{6,14}$/;

export function metaWebhook(settings: MetaWebhookSettings): WhatsAppWebhook {
  return {
    handshake(query) {
      const token = query["hub.verify_token"];
      const challenge = query["hub.challenge"];
      if (query["hub.mode"] !== "subscribe" || typeof token !== "string" || typeof challenge !== "string") return null;
      return sameText(token, settings.verifyToken) ? challenge : null;
    },

    events(rawBody, headers) {
      const signature = headers["x-hub-signature-256"];
      if (typeof signature !== "string" || !signedWith(settings.appSecret, rawBody, signature)) return null;
      let json: unknown;
      try {
        json = JSON.parse(rawBody.toString("utf8"));
      } catch {
        logger.warn("Meta's webhook sent a body that isn't JSON; nothing recorded.");
        return [];
      }
      const parsed = payloadSchema.safeParse(json);
      if (!parsed.success) {
        logger.warn({ issues: parsed.error.issues.length }, "Meta's webhook sent something unexpected; nothing recorded.");
        return [];
      }

      const events: WhatsAppEvent[] = [];
      let otherNumber = 0;
      for (const entry of parsed.data.entry) {
        for (const { field, value } of entry.changes) {
          if (field !== "messages") continue;
          if (value.metadata?.phone_number_id !== settings.phoneNumberId) {
            otherNumber += 1;
            continue;
          }
          for (const raw of value.statuses ?? []) pushIfAny(events, statusEvent(raw));
          for (const raw of value.messages ?? []) pushIfAny(events, incomingEvent(raw));
        }
      }
      if (otherNumber > 0) logger.info({ otherNumber }, "Meta's webhook reported on another phone number (a dashboard test?); left out.");
      return events;
    },
  };
}

function pushIfAny(events: WhatsAppEvent[], event: WhatsAppEvent | null) {
  if (event) events.push(event);
}

/** Where one of our messages has got to. Only delivered, read and failed change anything: we knew it was sent. */
function statusEvent(raw: unknown): WhatsAppEvent | null {
  const parsed = statusSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { id: providerMessageId, timestamp, errors } = parsed.data;
  const at = timeOf(timestamp);
  switch (parsed.data.status) {
    case "delivered":
      return { kind: "status", providerMessageId, status: "DELIVERED", error: null, at };
    case "read":
      return { kind: "status", providerMessageId, status: "READ", error: null, at };
    case "failed": {
      const first = errors?.[0];
      const error = first
        ? metaFailure(first.code, undefined, first.error_data?.details ?? first.message ?? first.title ?? "no details")
        : "WhatsApp didn't deliver it, and Meta didn't say why.";
      return { kind: "status", providerMessageId, status: "FAILED", error, at };
    }
    default:
      // "sent" (we knew), "played" (a voice note), and anything Meta adds later.
      return null;
  }
}

/** A client's own message: its words when it has any (a text, a caption, a button, a reaction), else its type only. */
function incomingEvent(raw: unknown): WhatsAppEvent | null {
  const parsed = messageSchema.safeParse(raw);
  if (!parsed.success) return null;
  const m = parsed.data;
  const from = normaliseMobile(m.from) ?? `+${m.from.replace(/\D/g, "")}`;
  if (!MOBILE.test(from)) {
    logger.warn({ type: m.type }, "Meta's webhook brought a message from a number the CRM can't read; left out.");
    return null;
  }
  const media = m.image ?? m.document ?? m.video ?? m.audio ?? m.sticker;
  const words =
    m.text?.body ?? media?.caption ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? m.reaction?.emoji;
  return {
    kind: "incoming",
    providerMessageId: m.id,
    from,
    type: m.type,
    text: words?.trim() ? words : null,
    replyTo: m.context?.id ?? m.reaction?.message_id ?? null,
    at: timeOf(m.timestamp),
  };
}

/** Meta's timestamps are seconds since 1970, as text. */
function timeOf(timestamp: string): Date {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
}

/** The two the same, compared in constant time. */
function sameText(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

/** Meta's "X-Hub-Signature-256: sha256=<hex>": the HMAC-SHA256 of the exact bytes received, keyed with the app's secret. */
function signedWith(secret: string, body: Buffer, signature: string): boolean {
  const [scheme, hex] = signature.split("=", 2);
  if (scheme !== "sha256" || !hex || !/^[0-9a-f]{64}$/i.test(hex)) return false;
  return timingSafeEqual(Buffer.from(hex, "hex"), createHmac("sha256", secret).update(body).digest());
}
