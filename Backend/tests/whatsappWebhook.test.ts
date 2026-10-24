import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { boss, QUEUES } from "../src/lib/jobs";
import type { WhatsAppMessage } from "../src/lib/whatsapp";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { VISA_DOCUMENT_LIST, VISA_DOCUMENTS_RECEIVED } from "../src/modules/messages/messages.seed";
import { deliverMessage, queueMessage } from "../src/modules/messages/messages.service";
import { recordLaterStatus, type LaterStatus } from "../src/modules/messages/whatsappWebhook.service";
import { visaMessageBasics } from "../src/modules/visa/visaMessages";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { app, prisma, request, resetDb } from "./helpers";
import { saveCase, visaStaff } from "./visaHelpers";

// Meta's webhook (docs/decisions/0026-whatsapp-webhook.md): Meta checks our address with the verify token, then calls
// with where our messages have got to and with the clients' own messages, each call signed with the app's secret. The
// calls here are signed as Meta signs them; sending is a stand-in, so nothing ever leaves.

/** Meta's sender: it can't be asked where a message has got to, so only the webhook says. */
type Stub = {
  name: string;
  send: ReturnType<typeof vi.fn<(m: WhatsAppMessage) => Promise<{ providerMessageId: string }>>>;
};
const meta = vi.hoisted(() => ({
  secret: "test-app-secret",
  verifyToken: "test-verify-token",
  phoneNumberId: "1433814799810645",
  /** False: WhatsApp's webhook isn't set up. */
  on: true,
  provider: null as Stub | null,
}));

vi.mock("../src/lib/whatsapp", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/whatsapp")>();
  const { metaWebhook } = await vi.importActual<typeof import("../src/lib/whatsapp/metaWebhook")>("../src/lib/whatsapp/metaWebhook");
  const webhook = metaWebhook({ appSecret: meta.secret, verifyToken: meta.verifyToken, phoneNumberId: meta.phoneNumberId });
  return {
    ...real,
    whatsAppProvider: () => meta.provider,
    sendWhatsApp: async (message: WhatsAppMessage) => {
      if (!meta.provider) throw new real.WhatsAppError("WhatsApp isn't set up yet.", false);
      const { providerMessageId } = await meta.provider.send(message);
      return { provider: meta.provider.name, providerMessageId };
    },
    whatsAppWebhook: () => (meta.on ? { provider: "meta", webhook } : null),
  };
});

const URL = "/api/public/whatsapp-webhook";
const CLIENT = "+919825041234";
/** Now, in Meta's seconds. */
const NOW = Math.floor(Date.now() / 1000);
const at = (seconds: number) => new Date(seconds * 1000);

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
  await boss.deleteAllJobs();
  meta.on = true;
  meta.provider = { name: "meta", send: vi.fn(async () => ({ providerMessageId: "wamid.A" })) };
});

/** A saved case's "All documents received", sent through Meta as wamid.A (or `id`). */
async function sentMessage(id = "wamid.A") {
  const staff = await visaStaff();
  const c = await saveCase(staff);
  // Saving a case queues message 1, the document list; these tests are about the webhook, so it goes.
  await prisma.outboundMessage.deleteMany({ where: { template: { code: VISA_DOCUMENT_LIST } } });
  await boss.deleteAllJobs();
  meta.provider!.send.mockResolvedValueOnce({ providerMessageId: id });
  await prisma.$transaction(async (tx) =>
    queueMessage(tx, { template: VISA_DOCUMENTS_RECEIVED, enquiryId: c.id, key: `test:${id}`, ...(await visaMessageBasics(tx, c.id)) }),
  );
  const m = await prisma.outboundMessage.findUniqueOrThrow({ where: { idempotencyKey: `test:${id}` } });
  await deliverMessage(m.id, { lastTry: false });
  return { message: await reload(m.id), enquiryId: c.id };
}

const reload = (id: string) => prisma.outboundMessage.findUniqueOrThrow({ where: { id } });
const laterJobs = () => boss.findJobs<LaterStatus>(QUEUES.whatsappStatusLater);

/** One call's body, as Meta sends it: the "messages" field for a phone number. */
function call(value: object, phoneNumberId = meta.phoneNumberId) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1800835597791897",
        changes: [
          {
            field: "messages",
            value: { messaging_product: "whatsapp", metadata: { display_phone_number: "918885552064", phone_number_id: phoneNumberId }, ...value },
          },
        ],
      },
    ],
  };
}

const status = (id: string, value: string, seconds: number, errors?: object[]) => ({
  id,
  status: value,
  timestamp: String(seconds),
  recipient_id: "919825041234",
  ...(errors ? { errors } : {}),
});

/** A client's message, as Meta brings it (`from` without the +). */
const incoming = (id: string, extra: object, from = "919825041234") => ({ from, id, timestamp: String(NOW), ...extra });

/** Posts a call signed as Meta signs it: the HMAC-SHA256 of the exact bytes, keyed with the app's secret. */
function post(body: object, { secret = meta.secret }: { secret?: string } = {}) {
  const raw = JSON.stringify(body);
  const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  return request(app).post(URL).set("Content-Type", "application/json").set("X-Hub-Signature-256", signature).send(raw);
}

describe("Meta checking our address", () => {
  it("gives back Meta's challenge when the verify token matches", async () => {
    const res = await request(app).get(URL).query({ "hub.mode": "subscribe", "hub.verify_token": meta.verifyToken, "hub.challenge": "1158201444" });
    expect(res.status).toBe(200);
    expect(res.text).toBe("1158201444");
  });

  it("turns away a wrong verify token, and says so while the webhook isn't set up", async () => {
    const wrong = await request(app).get(URL).query({ "hub.mode": "subscribe", "hub.verify_token": "guess", "hub.challenge": "1" });
    expect(wrong.status).toBe(403);
    meta.on = false;
    const off = await request(app).get(URL).query({ "hub.mode": "subscribe", "hub.verify_token": meta.verifyToken, "hub.challenge": "1" });
    expect(off.status).toBe(404);
  });
});

describe("a call that isn't Meta's", () => {
  it("is refused and changes nothing: no signature, the wrong secret, or words changed after signing", async () => {
    const { message } = await sentMessage();
    const body = call({ statuses: [status("wamid.A", "delivered", NOW)] });

    expect((await request(app).post(URL).set("Content-Type", "application/json").send(JSON.stringify(body))).status).toBe(401);
    expect((await post(body, { secret: "not-the-secret" })).status).toBe(401);
    const raw = JSON.stringify(body);
    const signature = `sha256=${createHmac("sha256", meta.secret).update(raw).digest("hex")}`;
    const changed = raw.replace("delivered", "read");
    expect((await request(app).post(URL).set("Content-Type", "application/json").set("X-Hub-Signature-256", signature).send(changed)).status).toBe(401);

    expect((await reload(message.id)).status).toBe("SENT");
  });
});

describe("where our messages have got to", () => {
  it("records delivered, then read, at Meta's own times; a late or repeated report changes nothing", async () => {
    const { message } = await sentMessage();
    expect((await post(call({ statuses: [status("wamid.A", "delivered", NOW + 5)] }))).status).toBe(200);
    expect(await reload(message.id)).toMatchObject({ status: "DELIVERED", deliveredAt: at(NOW + 5) });

    await post(call({ statuses: [status("wamid.A", "read", NOW + 60)] }));
    expect(await reload(message.id)).toMatchObject({ status: "READ", readAt: at(NOW + 60), deliveredAt: at(NOW + 5) });

    await post(call({ statuses: [status("wamid.A", "delivered", NOW + 70), status("wamid.A", "read", NOW + 80)] }));
    expect(await reload(message.id)).toMatchObject({ status: "READ", readAt: at(NOW + 60), deliveredAt: at(NOW + 5) });
  });

  it("takes read without delivered as delivered then too (Meta skips delivered when the chat is open)", async () => {
    const { message } = await sentMessage();
    await post(call({ statuses: [status("wamid.A", "read", NOW + 30)] }));
    expect(await reload(message.id)).toMatchObject({ status: "READ", readAt: at(NOW + 30), deliveredAt: at(NOW + 30) });
  });

  it("records a message Meta couldn't deliver, with the reason in plain words, and audits it", async () => {
    const { message } = await sentMessage();
    const errors = [
      {
        code: 131047,
        title: "Re-engagement message",
        message: "Re-engagement message",
        error_data: { details: "Message failed to send because more than 24 hours have passed since the customer last replied to this number." },
      },
    ];
    await post(call({ statuses: [status("wamid.A", "failed", NOW + 2, errors)] }));
    expect(await reload(message.id)).toMatchObject({
      status: "FAILED",
      error: "It's more than 24 hours since this number last wrote to us, so WhatsApp only takes an approved template.",
      failedAt: at(NOW + 2),
    });
    expect(await prisma.auditLog.count({ where: { action: "message.failed", entityId: message.id } })).toBe(1);
  });

  it("leaves out sent and played, which change nothing", async () => {
    const { message } = await sentMessage();
    await post(call({ statuses: [status("wamid.A", "sent", NOW), status("wamid.A", "played", NOW + 1)] }));
    expect((await reload(message.id)).status).toBe("SENT");
    expect(await laterJobs()).toHaveLength(0);
  });

  it("tries a status for an id not saved yet again a minute later: recorded then, or left out when it isn't ours", async () => {
    expect((await post(call({ statuses: [status("wamid.EARLY", "delivered", NOW + 3)] }))).status).toBe(200);
    const [job] = await laterJobs();
    expect(job!.data).toMatchObject({ provider: "meta", event: { providerMessageId: "wamid.EARLY", status: "DELIVERED" } });
    expect((job!.startAfter.getTime() - Date.now()) / 1000).toBeGreaterThan(50);

    // Meanwhile the send job saves the message's id.
    const { message } = await sentMessage("wamid.EARLY");
    await recordLaterStatus(job!.data);
    expect(await reload(message.id)).toMatchObject({ status: "DELIVERED", deliveredAt: at(NOW + 3) });

    // A status that never finds its message is simply left out.
    await expect(recordLaterStatus({ ...job!.data, event: { ...job!.data.event, providerMessageId: "wamid.NOT-OURS" } })).resolves.toBeUndefined();
  });

  it("leaves out another phone number's calls, such as the App Dashboard's tests", async () => {
    const { message } = await sentMessage();
    expect((await post(call({ statuses: [status("wamid.A", "read", NOW)] }, "123456123"))).status).toBe(200);
    expect((await reload(message.id)).status).toBe("SENT");
    expect(await laterJobs()).toHaveLength(0);
  });
});

describe("the clients' own messages", () => {
  it("keeps a reply with the case and client of the message it answers, and audits it without the words", async () => {
    const { message, enquiryId } = await sentMessage();
    await post(call({ messages: [incoming("wamid.IN1", { type: "text", text: { body: "Thank you! When will the passports come back?" }, context: { from: "918885552064", id: "wamid.A" } })] }));

    const saved = await prisma.inboundMessage.findFirstOrThrow();
    expect(saved).toMatchObject({
      provider: "meta",
      providerMessageId: "wamid.IN1",
      fromMobile: CLIENT,
      clientId: message.clientId,
      enquiryId,
      type: "text",
      text: "Thank you! When will the passports come back?",
      replyToProviderMessageId: "wamid.A",
      receivedAt: at(NOW),
    });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "message.received" } });
    expect(entry).toMatchObject({ entityType: "InboundMessage", entityId: saved.id, clientId: message.clientId, actorId: null });
    expect(entry.after).toEqual({ type: "text", enquiryId });
  });

  it("ties a message that answers nothing in particular to the last message we sent to that number", async () => {
    const { message, enquiryId } = await sentMessage();
    await post(call({ messages: [incoming("wamid.IN2", { type: "text", text: { body: "Ok" } })] }));
    expect(await prisma.inboundMessage.findFirstOrThrow()).toMatchObject({ clientId: message.clientId, enquiryId });
  });

  it("finds the client by their number when we never wrote to it: main or extra, without a case", async () => {
    const staff = await visaStaff();
    await saveCase(staff);
    await prisma.outboundMessage.deleteMany();
    const client = await prisma.client.findUniqueOrThrow({ where: { mobile: CLIENT } });
    const aarti = await prisma.user.findUniqueOrThrow({ where: { email: "aarti@masti.test" } });
    await prisma.clientPhone.create({ data: { clientId: client.id, mobile: "+919876500001", label: "Office", createdById: aarti.id } });

    await post(call({ messages: [incoming("wamid.IN3", { type: "text", text: { body: "Hi" } }), incoming("wamid.IN4", { type: "text", text: { body: "Hello" } }, "919876500001")] }));
    const byMain = await prisma.inboundMessage.findUniqueOrThrow({ where: { provider_providerMessageId: { provider: "meta", providerMessageId: "wamid.IN3" } } });
    const byExtra = await prisma.inboundMessage.findUniqueOrThrow({ where: { provider_providerMessageId: { provider: "meta", providerMessageId: "wamid.IN4" } } });
    expect(byMain).toMatchObject({ clientId: client.id, enquiryId: null });
    expect(byExtra).toMatchObject({ clientId: client.id, enquiryId: null, fromMobile: "+919876500001" });
  });

  it("keeps a message from a number no client has, unmatched, as written by a number outside India too", async () => {
    await post(call({ messages: [incoming("wamid.IN5", { type: "text", text: { body: "Is this Masti Travels?" } }, "447700900123")] }));
    expect(await prisma.inboundMessage.findFirstOrThrow()).toMatchObject({ fromMobile: "+447700900123", clientId: null, enquiryId: null });
  });

  it("keeps what each kind of message says: a caption, a button, a list choice, an emoji, or nothing", async () => {
    await sentMessage();
    await post(
      call({
        messages: [
          incoming("wamid.P1", { type: "image", image: { id: "m1", mime_type: "image/jpeg" } }),
          incoming("wamid.P2", { type: "document", document: { id: "m2", caption: "My passport scan", filename: "passport.pdf" } }),
          incoming("wamid.P3", { type: "button", button: { text: "Yes", payload: "yes" } }),
          incoming("wamid.P4", { type: "interactive", interactive: { type: "list_reply", list_reply: { id: "a", title: "Tomorrow" } } }),
          incoming("wamid.P5", { type: "reaction", reaction: { message_id: "wamid.A", emoji: "👍" } }),
          incoming("wamid.P6", { type: "location", location: { latitude: 21.17, longitude: 72.83 } }),
        ],
      }),
    );
    const kept = await prisma.inboundMessage.findMany({ orderBy: { providerMessageId: "asc" }, select: { type: true, text: true, replyToProviderMessageId: true } });
    expect(kept).toEqual([
      { type: "image", text: null, replyToProviderMessageId: null },
      { type: "document", text: "My passport scan", replyToProviderMessageId: null },
      { type: "button", text: "Yes", replyToProviderMessageId: null },
      { type: "interactive", text: "Tomorrow", replyToProviderMessageId: null },
      { type: "reaction", text: "👍", replyToProviderMessageId: "wamid.A" },
      { type: "location", text: null, replyToProviderMessageId: null },
    ]);
  });

  it("keeps a message once when Meta calls again with it", async () => {
    await sentMessage();
    const body = call({ messages: [incoming("wamid.IN6", { type: "text", text: { body: "Hello again" } })] });
    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(200);
    expect(await prisma.inboundMessage.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "message.received" } })).toBe(1);
  });
});

describe("the database", () => {
  it("refuses a client's message from a badly written number, with a blank type or words, or with a case but no client", async () => {
    const { enquiryId } = await sentMessage();
    const base = { provider: "meta", fromMobile: CLIENT, type: "text", receivedAt: new Date() };
    let n = 0;
    const create = (data: Partial<typeof base> & Record<string, unknown>) =>
      prisma.inboundMessage.create({ data: { ...base, providerMessageId: `wamid.DB${(n += 1)}`, ...data } });
    await expect(create({ fromMobile: "98250 41234" })).rejects.toThrow();
    await expect(create({ type: " " })).rejects.toThrow();
    await expect(create({ text: "  " })).rejects.toThrow();
    await expect(create({ enquiryId })).rejects.toThrow();
    await expect(create({ providerMessageId: " " })).rejects.toThrow();
    expect(await prisma.inboundMessage.count()).toBe(0);
  });
});
