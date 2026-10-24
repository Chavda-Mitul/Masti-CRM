import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config/env";
import { boss, QUEUES, stopWorkers } from "../src/lib/jobs";
import { WhatsAppError, type WhatsAppMessage, type WhatsAppStatus } from "../src/lib/whatsapp";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { FIELD_DOOR_CODE, seedMessageTemplates, VISA_CONSENT_LINK, VISA_DOCUMENT_LIST, VISA_DOCUMENTS_RECEIVED } from "../src/modules/messages/messages.seed";
import {
  checkMessageStatus,
  deliverMessage,
  dropWaitingMessages,
  fill,
  giveUpMessage,
  queueMessage,
  rewordWaitingMessage,
} from "../src/modules/messages/messages.service";
import { registerMessageWorkers } from "../src/modules/messages/messages.worker";
import { visaMessageBasics } from "../src/modules/visa/visaMessages";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { saveCase, visaStaff } from "./visaHelpers";

// The WhatsApp outbox (docs/decisions/0021-whatsapp-outbox.md): a message is written with the change it reports, then the
// "whatsapp-send" job sends it once and "whatsapp-status" follows it to delivered or read. The provider is a stand-in
// that each test sets, so nothing is ever sent; pg-boss runs without workers (tests/setup.ts), and the tests do a job's
// work by calling it.

type Stub = {
  name: string;
  send: ReturnType<typeof vi.fn<(m: WhatsAppMessage) => Promise<{ providerMessageId: string }>>>;
  checkStatus: ReturnType<typeof vi.fn<(id: string) => Promise<{ status: WhatsAppStatus; error: string | null }>>>;
};
const stub = vi.hoisted(() => ({ provider: null as Stub | null }));

vi.mock("../src/lib/whatsapp", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/whatsapp")>();
  return {
    ...real,
    whatsAppProvider: () => stub.provider,
    sendWhatsApp: async (message: WhatsAppMessage) => {
      if (!stub.provider) throw new real.WhatsAppError("WhatsApp isn't set up yet.", false);
      const { providerMessageId } = await stub.provider.send(message);
      return { provider: stub.provider.name, providerMessageId };
    },
  };
});

const BODY = [
  "Dear Rakesh Mehta,",
  "",
  "Thank you! We have received all documents for your France tourist visa (VISA-2026-0001). Our visa team is now preparing your file, and we will update you at every step.",
  "",
  "– Masti Tours & Travels",
].join("\n");

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
  await boss.deleteAllJobs();
  stub.provider = {
    name: "twilio",
    send: vi.fn(async () => ({ providerMessageId: "SM1" })),
    checkStatus: vi.fn(async () => ({ status: "SENT" as const, error: null })),
  };
});

afterEach(() => {
  env.WHATSAPP_TEST_NUMBER = undefined;
});

/** Saving a case queues message 1, the document list; these tests are about the outbox itself, so it goes. */
async function dropDocumentList() {
  await prisma.outboundMessage.deleteMany({ where: { template: { code: VISA_DOCUMENT_LIST } } });
  await boss.deleteAllJobs();
}

/** A saved visa case's "All documents received" message, queued as mature() queues it. */
async function queued(key = "test:1") {
  const staff = await visaStaff();
  const c = await saveCase(staff);
  await dropDocumentList();
  await prisma.$transaction(async (tx) =>
    queueMessage(tx, { template: VISA_DOCUMENTS_RECEIVED, enquiryId: c.id, key, ...(await visaMessageBasics(tx, c.id)) }),
  );
  return prisma.outboundMessage.findUniqueOrThrow({ where: { idempotencyKey: key } });
}

const reload = (id: string) => prisma.outboundMessage.findUniqueOrThrow({ where: { id } });
const sendJobs = (messageId: string) => boss.findJobs<{ messageId: string }>(QUEUES.whatsappSend, { data: { messageId } });
const statusJobs = (messageId: string) => boss.findJobs<{ messageId: string; check: number }>(QUEUES.whatsappStatus, { data: { messageId } });

describe("queueing", () => {
  it("words the message now, for the client's main number, and queues its sending in the same transaction", async () => {
    const m = await queued();
    expect(m).toMatchObject({
      status: "QUEUED",
      toMobile: "+919825041234",
      body: BODY,
      variables: { client_name: "Rakesh Mehta", visa: "France tourist visa", case_no: "VISA-2026-0001" },
      attempts: 0,
      sendingAt: null,
    });
    const jobs = await sendJobs(m.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: m.id, data: { messageId: m.id } });
  });

  it("queues one message per event: the same key again is ignored", async () => {
    const m = await queued("same");
    const c = await prisma.enquiry.findFirstOrThrow();
    await prisma.$transaction(async (tx) =>
      queueMessage(tx, { template: VISA_DOCUMENTS_RECEIVED, enquiryId: c.id, key: "same", ...(await visaMessageBasics(tx, c.id)) }),
    );
    expect(await prisma.outboundMessage.count()).toBe(1);
    expect(await sendJobs(m.id)).toHaveLength(1);
  });

  it("leaves neither message nor job when the save rolls back", async () => {
    const staff = await visaStaff();
    const c = await saveCase(staff);
    await dropDocumentList();
    await expect(
      prisma.$transaction(async (tx) => {
        await queueMessage(tx, { template: VISA_DOCUMENTS_RECEIVED, enquiryId: c.id, key: "k", ...(await visaMessageBasics(tx, c.id)) });
        throw new Error("The save failed.");
      }),
    ).rejects.toThrow("The save failed.");
    expect(await prisma.outboundMessage.count()).toBe(0);
    expect(await boss.findJobs(QUEUES.whatsappSend)).toHaveLength(0);
  });

  it("fills every placeholder, keeps only the values the wording uses, and refuses one with no value", () => {
    expect(fill("Dear {{client_name}}, {{case_no}}.", { client_name: "Rakesh", case_no: "VISA-1", visa: "unused" })).toEqual({
      body: "Dear Rakesh, VISA-1.",
      variables: { client_name: "Rakesh", case_no: "VISA-1" },
    });
    expect(() => fill("Dear {{client_name}}", {})).toThrow("The wording has {{client_name}}, which the CRM can't fill");
  });

  it("writes down a wording it can't fill as failed, and the save still goes through", async () => {
    await prisma.messageTemplate.update({
      where: { code: VISA_DOCUMENTS_RECEIVED },
      data: { body: "Dear {{client_name}}, your {{unknown}} is ready." },
    });
    const m = await queued();
    expect(m).toMatchObject({
      status: "FAILED",
      error: "The wording has {{unknown}}, which the CRM can't fill, so it wasn't sent.",
      body: "Dear {{client_name}}, your {{unknown}} is ready.",
    });
    expect(m.failedAt).not.toBeNull();
    expect(await sendJobs(m.id)).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { action: "message.failed", entityId: m.id } })).toBe(1);
  });

  it("skips a message whose wording is missing, without stopping the save", async () => {
    await prisma.messageTemplate.delete({ where: { code: VISA_DOCUMENTS_RECEIVED } });
    const staff = await visaStaff();
    const c = await saveCase(staff);
    await dropDocumentList();
    await prisma.$transaction(async (tx) =>
      queueMessage(tx, { template: VISA_DOCUMENTS_RECEIVED, enquiryId: c.id, key: "k", ...(await visaMessageBasics(tx, c.id)) }),
    );
    expect(await prisma.outboundMessage.count()).toBe(0);
  });

  it("gets a missing wording back when the server starts, and never changes one that's there", async () => {
    await prisma.messageTemplate.delete({ where: { code: VISA_DOCUMENTS_RECEIVED } });
    await seedMessageTemplates(prisma);
    const restored = await prisma.messageTemplate.findUniqueOrThrow({ where: { code: VISA_DOCUMENTS_RECEIVED } });
    expect(restored.body).toBe(BODY.replace("Rakesh Mehta", "{{client_name}}").replace("France tourist visa", "{{visa}}").replace("VISA-2026-0001", "{{case_no}}"));

    await prisma.messageTemplate.update({ where: { id: restored.id }, data: { body: "Dear {{client_name}}, all received." } });
    await seedMessageTemplates(prisma);
    expect((await prisma.messageTemplate.findUniqueOrThrow({ where: { id: restored.id } })).body).toBe("Dear {{client_name}}, all received.");
  });
});

describe("sending", () => {
  it("sends the words to the test number outside production, records how it went, and checks delivery later", async () => {
    env.WHATSAPP_TEST_NUMBER = "+919000000001";
    const m = await queued();
    await deliverMessage(m.id, { lastTry: false });

    expect(stub.provider!.send).toHaveBeenCalledExactlyOnceWith({ to: "+919000000001", body: BODY });
    const after = await reload(m.id);
    expect(after).toMatchObject({
      status: "SENT",
      provider: "twilio",
      providerMessageId: "SM1",
      sentTo: "+919000000001",
      toMobile: "+919825041234",
      attempts: 1,
      sendingAt: null,
      error: null,
    });
    expect(after.sentAt).not.toBeNull();

    const entries = await prisma.auditLog.findMany({ where: { action: "message.sent" } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorId: null,
      entityType: "OutboundMessage",
      entityId: m.id,
      clientId: m.clientId,
      after: { template: "visa.documents_received" },
    });

    const checks = await statusJobs(m.id);
    expect(checks).toHaveLength(1);
    expect(checks[0]!.data).toEqual({ messageId: m.id, check: 0 });
  });

  it("sends the approved template instead once its provider id is filled in", async () => {
    await prisma.messageTemplate.update({ where: { code: VISA_DOCUMENTS_RECEIVED }, data: { providerTemplateId: "HX123" } });
    const m = await queued();
    await deliverMessage(m.id, { lastTry: false });
    expect(stub.provider!.send).toHaveBeenCalledExactlyOnceWith({
      to: "+919825041234",
      body: BODY,
      template: { id: "HX123", variables: { client_name: "Rakesh Mehta", visa: "France tourist visa", case_no: "VISA-2026-0001" } },
    });
  });

  it("tries again later when the provider may recover, and marks it failed on the last try", async () => {
    stub.provider!.send.mockRejectedValue(new WhatsAppError("Twilio error 20500: busy", true));
    const m = await queued();

    await expect(deliverMessage(m.id, { lastTry: false })).rejects.toThrow("Twilio error 20500: busy");
    expect(await reload(m.id)).toMatchObject({ status: "QUEUED", error: "Twilio error 20500: busy", attempts: 1, sendingAt: null });
    expect(await prisma.auditLog.count({ where: { action: { startsWith: "message." } } })).toBe(0);

    await deliverMessage(m.id, { lastTry: true });
    const after = await reload(m.id);
    expect(after).toMatchObject({ status: "FAILED", error: "Twilio error 20500: busy", attempts: 2 });
    expect(after.failedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "message.failed", entityId: m.id } })).toBe(1);
    expect(await statusJobs(m.id)).toHaveLength(0);
  });

  it("doesn't try again when trying again can't help", async () => {
    stub.provider!.send.mockRejectedValue(new WhatsAppError("That number isn't on WhatsApp, or isn't written correctly.", false));
    const m = await queued();
    await deliverMessage(m.id, { lastTry: false });
    expect(await reload(m.id)).toMatchObject({ status: "FAILED", error: "That number isn't on WhatsApp, or isn't written correctly.", attempts: 1 });
  });

  it("marks it failed at once while WhatsApp is off, without trying", async () => {
    stub.provider = null;
    const m = await queued();
    await deliverMessage(m.id, { lastTry: false });
    expect(await reload(m.id)).toMatchObject({ status: "FAILED", error: "WhatsApp isn't set up yet.", attempts: 0 });
  });

  it("never repeats a try that didn't come back: the message may have gone", async () => {
    const m = await queued();
    await prisma.outboundMessage.update({ where: { id: m.id }, data: { sendingAt: new Date(Date.now() - 5 * 60_000), attempts: 1 } });
    await deliverMessage(m.id, { lastTry: false });
    expect(stub.provider!.send).not.toHaveBeenCalled();
    expect(await reload(m.id)).toMatchObject({
      status: "FAILED",
      error: "The server stopped while sending this, so it may or may not have gone. Check the chat.",
      sendingAt: null,
    });
  });

  it("does nothing for a message that has already gone", async () => {
    const m = await queued();
    await deliverMessage(m.id, { lastTry: false });
    await deliverMessage(m.id, { lastTry: false });
    expect(stub.provider!.send).toHaveBeenCalledTimes(1);
    expect(await reload(m.id)).toMatchObject({ status: "SENT", attempts: 1 });
  });

  it("skips a message that is switched off", async () => {
    const m = await queued();
    await prisma.messageTemplate.update({ where: { code: VISA_DOCUMENTS_RECEIVED }, data: { isActive: false } });
    await deliverMessage(m.id, { lastTry: false });
    expect(stub.provider!.send).not.toHaveBeenCalled();
    expect(await reload(m.id)).toMatchObject({ status: "SKIPPED", error: "This message is switched off." });
    expect(await prisma.auditLog.count({ where: { action: "message.skipped", entityId: m.id } })).toBe(1);
  });

  it("marks a message failed when pg-boss gives up on it, so none stays queued for ever", async () => {
    expect((await boss.getQueue(QUEUES.whatsappSend))?.deadLetter).toBe(QUEUES.whatsappSendFailed);

    const waiting = await queued("a");
    await prisma.outboundMessage.update({ where: { id: waiting.id }, data: { error: "Twilio error 20500: busy", attempts: 6 } });
    await giveUpMessage(waiting.id);
    expect(await reload(waiting.id)).toMatchObject({ status: "FAILED", error: "It couldn't be sent: Twilio error 20500: busy" });
    expect(await prisma.auditLog.count({ where: { action: "message.failed", entityId: waiting.id } })).toBe(1);

    const midTry = await queued("b");
    await prisma.outboundMessage.update({ where: { id: midTry.id }, data: { sendingAt: new Date(), attempts: 1 } });
    await giveUpMessage(midTry.id);
    expect(await reload(midTry.id)).toMatchObject({
      status: "FAILED",
      error: "The server stopped while sending this, so it may or may not have gone. Check the chat.",
      sendingAt: null,
    });

    const sent = await queued("c");
    await deliverMessage(sent.id, { lastTry: false });
    await giveUpMessage(sent.id);
    expect((await reload(sent.id)).status).toBe("SENT");
  });

  it("doesn't send news more than 24 hours old", async () => {
    const m = await queued();
    await prisma.outboundMessage.update({ where: { id: m.id }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
    await deliverMessage(m.id, { lastTry: false });
    expect(stub.provider!.send).not.toHaveBeenCalled();
    expect(await reload(m.id)).toMatchObject({ status: "FAILED", error: "It couldn't go within 24 hours, so it wasn't sent at all." });
  });
});

describe("a message that waits first (amendment 8)", () => {
  const TEN_MINUTES = 10 * 60_000;

  /** One case, and a way to queue its "All documents received" under `key`, held back until `sendAfter` if given. */
  async function caseToMessage() {
    const staff = await visaStaff();
    const c = await saveCase(staff);
    await dropDocumentList();
    const queue = async (key: string, sendAfter?: Date) => {
      await prisma.$transaction(async (tx) =>
        queueMessage(tx, { template: VISA_DOCUMENTS_RECEIVED, enquiryId: c.id, key, ...(sendAfter ? { sendAfter } : {}), ...(await visaMessageBasics(tx, c.id)) }),
      );
      return prisma.outboundMessage.findUniqueOrThrow({ where: { idempotencyKey: key } });
    };
    return { c, queue };
  }

  it("is written now, and its sending job starts only when its time comes", async () => {
    const { queue } = await caseToMessage();
    const sendAfter = new Date(Date.now() + TEN_MINUTES);
    const m = await queue("wait", sendAfter);
    expect(m).toMatchObject({ status: "QUEUED", body: BODY, sendAfter });
    const [job] = await sendJobs(m.id);
    expect(Math.abs(job!.startAfter.getTime() - sendAfter.getTime())).toBeLessThan(1000);
  });

  it("is worded again with new values while it waits, and no longer once its time has come", async () => {
    const { c, queue } = await caseToMessage();
    const m = await queue("wait", new Date(Date.now() + TEN_MINUTES));
    const { variables } = await prisma.$transaction((tx) => visaMessageBasics(tx, c.id));
    await prisma.$transaction((tx) => rewordWaitingMessage(tx, "wait", { ...variables, client_name: "Priya Mehta" }));
    expect(await reload(m.id)).toMatchObject({ body: BODY.replace("Rakesh Mehta", "Priya Mehta"), variables: { client_name: "Priya Mehta" } });

    await prisma.outboundMessage.update({ where: { id: m.id }, data: { sendAfter: new Date(Date.now() - 1000) } });
    await prisma.$transaction((tx) => rewordWaitingMessage(tx, "wait", { ...variables, client_name: "Aarav Mehta" }));
    expect((await reload(m.id)).body).toBe(BODY.replace("Rakesh Mehta", "Priya Mehta"));
  });

  it("is dropped while it waits, with the reason and audited, and its job then sends nothing", async () => {
    const { c, queue } = await caseToMessage();
    const m = await queue("wait", new Date(Date.now() + TEN_MINUTES));
    await prisma.$transaction((tx) => dropWaitingMessages(tx, { enquiryId: c.id, template: VISA_CONSENT_LINK }, "Not this wording."));
    expect((await reload(m.id)).status).toBe("QUEUED");

    await prisma.$transaction((tx) => dropWaitingMessages(tx, { enquiryId: c.id }, "The case was cancelled."));
    expect(await reload(m.id)).toMatchObject({ status: "SKIPPED", error: "The case was cancelled." });
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "message.skipped", entityId: m.id } })).toMatchObject({
      after: { template: VISA_DOCUMENTS_RECEIVED, error: "The case was cancelled." },
    });
    await deliverMessage(m.id, { lastTry: false });
    expect(stub.provider!.send).not.toHaveBeenCalled();
    expect((await reload(m.id)).status).toBe("SKIPPED");
  });

  it("leaves alone a message that goes at once, one whose time has come, one being sent and one already sent", async () => {
    const { c, queue } = await caseToMessage();
    const atOnce = await queue("at once");
    const due = await queue("due", new Date(Date.now() + TEN_MINUTES));
    await prisma.outboundMessage.update({ where: { id: due.id }, data: { sendAfter: new Date(Date.now() - 1000) } });
    const sending = await queue("sending", new Date(Date.now() + TEN_MINUTES));
    await prisma.outboundMessage.update({ where: { id: sending.id }, data: { sendingAt: new Date(), attempts: 1 } });
    const sent = await queue("sent", new Date(Date.now() + TEN_MINUTES));
    await deliverMessage(sent.id, { lastTry: false });

    await prisma.$transaction((tx) => dropWaitingMessages(tx, { enquiryId: c.id }, "The case was cancelled."));
    for (const m of [atOnce, due, sending]) expect((await reload(m.id)).status).toBe("QUEUED");
    expect((await reload(sent.id)).status).toBe("SENT");
    expect(await prisma.auditLog.count({ where: { action: "message.skipped" } })).toBe(0);
  });
});

describe("a consent link's secret (0022)", () => {
  const SECRET = "abcDEF123_-xyz";
  const LINK = `http://localhost:5173/consent#${SECRET}`;
  const HIDDEN = "http://localhost:5173/consent#…";

  /** Message 4 carrying a consent link, queued as saving a traveller's details queues it. */
  async function linkQueued(key: string) {
    const staff = await visaStaff();
    const c = await saveCase(staff);
    await prisma.$transaction(async (tx) => {
      const basics = await visaMessageBasics(tx, c.id);
      await queueMessage(tx, {
        template: VISA_CONSENT_LINK,
        clientId: basics.clientId,
        enquiryId: c.id,
        key,
        variables: { ...basics.variables, recipient_name: "Rakesh Mehta", traveller_name: "Rakesh Mehta", consent_link: LINK, office_phone: "0261 400 0000" },
      });
    });
    return prisma.outboundMessage.findUniqueOrThrow({ where: { idempotencyKey: key } });
  }

  const keepsNoSecret = async (id: string) => {
    const row = await reload(id);
    expect(JSON.stringify(row)).not.toContain(SECRET);
    return row;
  };

  it("goes whole to the client, and the sent message keeps the link without it", async () => {
    const m = await linkQueued("link:1");
    expect(m.body).toContain(LINK);
    await deliverMessage(m.id, { lastTry: false });

    expect(stub.provider!.send.mock.calls[0]![0].body).toContain(LINK);
    const after = await keepsNoSecret(m.id);
    expect(after.status).toBe("SENT");
    expect(after.body).toContain(`"I agree":\n${HIDDEN}\n`);
    expect(after.variables).toMatchObject({ consent_link: HIDDEN, traveller_name: "Rakesh Mehta" });
  });

  it("stays while the message may still go, and goes once it won't: failed, skipped, given up or unfillable", async () => {
    stub.provider!.send.mockRejectedValueOnce(new WhatsAppError("Twilio error 20500: busy", true));
    const failed = await linkQueued("link:failed");
    await expect(deliverMessage(failed.id, { lastTry: false })).rejects.toThrow("busy");
    expect((await reload(failed.id)).body).toContain(LINK);
    stub.provider!.send.mockRejectedValueOnce(new WhatsAppError("That number isn't on WhatsApp, or isn't written correctly.", false));
    await deliverMessage(failed.id, { lastTry: false });
    expect((await keepsNoSecret(failed.id)).status).toBe("FAILED");

    const givenUp = await linkQueued("link:given-up");
    await giveUpMessage(givenUp.id);
    expect((await keepsNoSecret(givenUp.id)).status).toBe("FAILED");

    const skipped = await linkQueued("link:skipped");
    await prisma.messageTemplate.update({ where: { code: VISA_CONSENT_LINK }, data: { isActive: false } });
    await deliverMessage(skipped.id, { lastTry: false });
    expect((await keepsNoSecret(skipped.id)).status).toBe("SKIPPED");

    await prisma.messageTemplate.update({ where: { code: VISA_CONSENT_LINK }, data: { body: "{{consent_link}} {{unknown}}" } });
    const unfillable = await linkQueued("link:unfillable");
    expect(unfillable.status).toBe("FAILED");
    expect((await keepsNoSecret(unfillable.id)).variables).toMatchObject({ consent_link: HIDDEN });
  });
});

describe("the door code (message 16, amendment 6)", () => {
  const CODE = "482915";
  const WORDS = (code: string) => `${code} is your verification code.\n\nThis code expires in 10 minutes.`;

  /** Message 16 as the boy's "Send the code" queues it, on Rakesh's case. */
  async function codeQueued(key: string) {
    const staff = await visaStaff();
    const c = await saveCase(staff);
    await prisma.$transaction(async (tx) =>
      queueMessage(tx, { template: FIELD_DOOR_CODE, clientId: c.client.id, enquiryId: c.id, key, variables: { code: CODE, minutes: "10" } }),
    );
    return { staff, c, m: await prisma.outboundMessage.findUniqueOrThrow({ where: { idempotencyKey: key } }) };
  }

  it("is hidden from staff even while it waits, goes whole to the client, and is forgotten once sent", async () => {
    const { staff, c, m } = await codeQueued("code:1");
    expect(m.body).toBe(WORDS(CODE));
    const card = (await staff.get(`/api/visa/cases/${c.caseNo}/messages`)).body.messages as { title: string; body: string }[];
    expect(card.find((x) => x.title === "One-time code")!.body).toBe(WORDS("••••••"));
    expect(JSON.stringify(card)).not.toContain(CODE);

    await deliverMessage(m.id, { lastTry: false });
    // The client gets it; the sender is told it's a secret, so a live log hides it.
    expect(stub.provider!.send).toHaveBeenCalledExactlyOnceWith({ to: "+919825041234", body: WORDS(CODE), secrets: [CODE] });
    const after = await reload(m.id);
    expect(after.status).toBe("SENT");
    expect(after.body).toBe(WORDS("••••••"));
    expect(after.variables).toEqual({ code: "••••••", minutes: "10" });
  });

  it("goes as the provider's code template once one is approved, with the code for the provider's own words (0020 amendment 2)", async () => {
    await prisma.messageTemplate.update({ where: { code: FIELD_DOOR_CODE }, data: { providerTemplateId: "field_door_code" } });
    const { m } = await codeQueued("code:template");
    await deliverMessage(m.id, { lastTry: false });
    expect(stub.provider!.send).toHaveBeenCalledExactlyOnceWith({
      to: "+919825041234",
      body: WORDS(CODE),
      template: { id: "field_door_code", variables: { code: CODE, minutes: "10" }, oneTimeCode: CODE },
      secrets: [CODE],
    });
  });

  it("is forgotten when it won't go too", async () => {
    stub.provider!.send.mockRejectedValueOnce(new WhatsAppError("That number isn't on WhatsApp, or isn't written correctly.", false));
    const { m } = await codeQueued("code:failed");
    await deliverMessage(m.id, { lastTry: false });
    const after = await reload(m.id);
    expect(after.status).toBe("FAILED");
    expect(JSON.stringify({ body: after.body, variables: after.variables })).not.toContain(CODE);
  });
});

describe("delivery checks", () => {
  async function sent() {
    const m = await queued();
    await deliverMessage(m.id, { lastTry: false });
    return m;
  }

  it("follows a sent message to delivered, then to read, and then stops asking", async () => {
    const m = await sent();
    stub.provider!.checkStatus.mockResolvedValueOnce({ status: "DELIVERED", error: null });
    await checkMessageStatus(m.id, 0);
    const delivered = await reload(m.id);
    expect(delivered.status).toBe("DELIVERED");
    expect(delivered.deliveredAt).not.toBeNull();
    expect(stub.provider!.checkStatus).toHaveBeenCalledWith("SM1");
    expect((await statusJobs(m.id)).map((j) => j.data.check).sort()).toEqual([0, 1]);

    stub.provider!.checkStatus.mockResolvedValueOnce({ status: "READ", error: null });
    await checkMessageStatus(m.id, 1);
    const read = await reload(m.id);
    expect(read.status).toBe("READ");
    expect(read.readAt).not.toBeNull();
    expect(read.deliveredAt).toEqual(delivered.deliveredAt);
    expect((await statusJobs(m.id)).map((j) => j.data.check).sort()).toEqual([0, 1]);
  });

  it("asks again later while it isn't delivered yet, each check so long after the send, until the checks run out", async () => {
    const m = await sent();
    const { sentAt } = await reload(m.id);
    const dueAfterSend = async (check: number) => {
      const job = (await statusJobs(m.id)).find((j) => j.data.check === check);
      return Math.round((job!.startAfter.getTime() - sentAt!.getTime()) / 1000);
    };
    // 1, 5, 15 minutes … after it went, not each a further 5 or 15 minutes after the check before.
    expect(await dueAfterSend(0)).toBe(60);
    await checkMessageStatus(m.id, 0);
    expect((await reload(m.id)).status).toBe("SENT");
    expect(await dueAfterSend(1)).toBe(300);
    await checkMessageStatus(m.id, 1);
    expect(await dueAfterSend(2)).toBe(900);

    await checkMessageStatus(m.id, 5);
    expect((await statusJobs(m.id)).map((j) => j.data.check).sort()).toEqual([0, 1, 2]);
  });

  it("keeps checking when the provider can't be asked for a while", async () => {
    const m = await sent();
    stub.provider!.checkStatus.mockRejectedValueOnce(new WhatsAppError("Couldn't reach Twilio: getaddrinfo ENOTFOUND", true));
    await checkMessageStatus(m.id, 0);
    expect((await reload(m.id)).status).toBe("SENT");
    expect((await statusJobs(m.id)).map((j) => j.data.check).sort()).toEqual([0, 1]);

    stub.provider!.checkStatus.mockResolvedValueOnce({ status: "DELIVERED", error: null });
    await checkMessageStatus(m.id, 1);
    expect((await reload(m.id)).status).toBe("DELIVERED");
  });

  it("records a message the provider couldn't deliver, with the reason", async () => {
    const m = await sent();
    const reason = "This phone hasn't joined the Twilio sandbox, or joined more than 3 days ago. Send the join message from it again.";
    stub.provider!.checkStatus.mockResolvedValueOnce({ status: "FAILED", error: reason });
    await checkMessageStatus(m.id, 0);
    const after = await reload(m.id);
    expect(after).toMatchObject({ status: "FAILED", error: reason, providerMessageId: "SM1" });
    expect(after.failedAt).not.toBeNull();
    expect(after.sentAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "message.failed", entityId: m.id } })).toBe(1);
    expect((await statusJobs(m.id)).map((j) => j.data.check)).toEqual([0]);
  });

  it("can't ask about a message another provider carried", async () => {
    const m = await sent();
    stub.provider = { ...stub.provider!, name: "log" };
    await checkMessageStatus(m.id, 0);
    expect(stub.provider.checkStatus).not.toHaveBeenCalled();
  });
});

describe("the workers, through pg-boss", () => {
  /** Waits up to 15 seconds for the message to be as asked: pg-boss looks for work every 2 seconds. */
  async function until(id: string, done: (m: Awaited<ReturnType<typeof reload>>) => boolean) {
    for (let waited = 0; waited < 15_000; waited += 250) {
      if (done(await reload(id))) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("The worker didn't get to the message in time.");
  }

  beforeEach(async () => {
    await registerMessageWorkers();
  });

  afterEach(async () => {
    await stopWorkers();
  });

  it("send a message once its save commits, and queue the first delivery check", async () => {
    const m = await queued();
    await until(m.id, (now) => now.status === "SENT");
    expect(stub.provider!.send).toHaveBeenCalledTimes(1);
    expect((await statusJobs(m.id)).map((j) => j.data.check)).toEqual([0]);
  });

  it("leave a message that may still go for pg-boss's next try, which isn't the last", async () => {
    stub.provider!.send.mockRejectedValue(new WhatsAppError("Twilio error 20500: busy", true));
    const m = await queued();
    await until(m.id, (now) => now.attempts === 1 && now.sendingAt === null);
    expect(await reload(m.id)).toMatchObject({ status: "QUEUED", attempts: 1, error: "Twilio error 20500: busy" });
    // pg-boss keeps the job for its next try, a minute or more away; it marks it a moment after the handler throws.
    let state: string | undefined;
    for (let waited = 0; waited < 5_000 && state !== "retry"; waited += 250) {
      state = (await sendJobs(m.id))[0]?.state;
      if (state !== "retry") await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(state).toBe("retry");
  });
});

describe("the case's messages (the Sent to the client card)", () => {
  /** A saved case with its "All documents received" message queued, as Mark documents complete leaves it. */
  async function caseWithMessage() {
    const staff = await visaStaff();
    const c = await saveCase(staff);
    await dropDocumentList();
    await prisma.$transaction(async (tx) =>
      queueMessage(tx, { template: VISA_DOCUMENTS_RECEIVED, enquiryId: c.id, key: `k:${c.id}`, ...(await visaMessageBasics(tx, c.id)) }),
    );
    const message = await prisma.outboundMessage.findUniqueOrThrow({ where: { idempotencyKey: `k:${c.id}` } });
    return { staff, c, message };
  }
  const list = (agent: Awaited<ReturnType<typeof visaStaff>>, caseNo: string) => agent.get(`/api/visa/cases/${caseNo}/messages`);

  it("lists them oldest first: words, status, the reason a failed one didn't go, and nothing of the sending details", async () => {
    const { staff, c, message } = await caseWithMessage();
    const sentAt = new Date(Date.now() - 60_000);
    const deliveredAt = new Date();
    await prisma.outboundMessage.update({
      where: { id: message.id },
      data: { status: "DELIVERED", provider: "twilio", providerMessageId: "SM1", sentTo: "+919000000001", sentAt, deliveredAt, attempts: 1 },
    });
    const template = await prisma.messageTemplate.findUniqueOrThrow({ where: { code: VISA_DOCUMENTS_RECEIVED } });
    const failedAt = new Date();
    await prisma.outboundMessage.create({
      data: {
        templateId: template.id,
        clientId: c.client.id,
        enquiryId: c.id,
        toMobile: message.toMobile,
        variables: {},
        body: "Dear Rakesh Mehta, …",
        idempotencyKey: "later",
        status: "FAILED",
        error: "Twilio refused the Account SID or Auth Token. Copy both again from the Twilio Console.",
        failedAt,
        createdAt: new Date(Date.now() + 1000),
      },
    });

    const res = await list(staff, c.caseNo.toLowerCase());
    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([
      {
        id: message.id,
        title: "All documents received",
        body: BODY,
        attachment: null,
        status: "DELIVERED",
        error: null,
        createdAt: message.createdAt.toISOString(),
        sendAfter: null,
        sentAt: sentAt.toISOString(),
        deliveredAt: deliveredAt.toISOString(),
        readAt: null,
        failedAt: null,
        toTestNumber: true,
      },
      expect.objectContaining({
        title: "All documents received",
        status: "FAILED",
        error: "Twilio refused the Account SID or Auth Token. Copy both again from the Twilio Console.",
        sentAt: null,
        failedAt: failedAt.toISOString(),
        toTestNumber: false,
      }),
    ]);
    expect(Object.keys(res.body.messages[0])).not.toContain("providerMessageId");
  });

  it("is empty for a case with no messages", async () => {
    const staff = await visaStaff();
    const c = await saveCase(staff);
    await dropDocumentList();
    expect((await list(staff, c.caseNo)).body).toEqual({ messages: [], replies: [] });
  });

  it("lists what the client wrote back, newest first, saying who wrote when it wasn't their own number (0026 amendment 1)", async () => {
    const { staff, c } = await caseWithMessage();
    env.WHATSAPP_TEST_NUMBER = "+919000000001";
    const reply = (n: number, data: { fromMobile?: string; type?: string; text?: string; enquiryId?: string }) =>
      prisma.inboundMessage.create({
        data: {
          provider: "meta",
          providerMessageId: `wamid.R${n}`,
          fromMobile: "+919825041234",
          clientId: c.client.id,
          enquiryId: c.id,
          type: "text",
          receivedAt: new Date(Date.now() - (10 - n) * 60_000),
          ...data,
        },
      });
    const own = await reply(1, { text: "Thank you! When will the passports come back?" });
    const tester = await reply(2, { fromMobile: "+919000000001", type: "image" });
    const family = await reply(3, { fromMobile: "+919876500001", type: "document", text: "My passport scan" });
    // Another case of the same client: its replies stay on that case.
    const other = await saveCase(staff);
    await reply(4, { enquiryId: other.id, text: "About the other trip" });

    const res = await list(staff, c.caseNo);
    expect(res.status).toBe(200);
    expect(res.body.replies).toEqual([
      { id: family.id, type: "document", text: "My passport scan", receivedAt: family.receivedAt.toISOString(), from: "+919876500001" },
      { id: tester.id, type: "image", text: null, receivedAt: tester.receivedAt.toISOString(), from: "test" },
      { id: own.id, type: "text", text: "Thank you! When will the passports come back?", receivedAt: own.receivedAt.toISOString(), from: null },
    ]);
    expect(Object.keys(res.body.replies[0])).not.toContain("providerMessageId");
    expect(res.body.messages).toHaveLength(1);
  });

  it("shows only to whoever can open the case", async () => {
    const { c } = await caseWithMessage();
    await createUser({ name: "Neha", email: "neha@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    const other = await list(await loginAs("neha@masti.test"), c.caseNo);
    expect(other.status).toBe(403);
    expect(other.body.messages).toBeUndefined();

    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    expect((await list(await loginAs("riya@masti.test"), c.caseNo)).body.messages).toHaveLength(1);
    expect((await list(await loginAs("riya@masti.test"), "VISA-2099-9999")).status).toBe(404);
  });
});

describe("the database", () => {
  it("refuses a sent message without how it went, a failed one without why, a stray send mark and a bad number", async () => {
    const m = await queued();
    const update = (data: Parameters<typeof prisma.outboundMessage.update>[0]["data"]) =>
      prisma.outboundMessage.update({ where: { id: m.id }, data });
    await expect(update({ status: "SENT" })).rejects.toThrow();
    await expect(update({ status: "FAILED" })).rejects.toThrow();
    await expect(
      update({ status: "DELIVERED", sentAt: new Date(), provider: "twilio", providerMessageId: "SM1", sentTo: "+919825041234" }),
    ).rejects.toThrow();
    await expect(update({ status: "SKIPPED", sendingAt: new Date() })).rejects.toThrow();
    await expect(update({ toMobile: "98250 41234" })).rejects.toThrow();
    await expect(update({ attempts: -1 })).rejects.toThrow();
    await expect(update({ body: "  " })).rejects.toThrow();
    expect(await reload(m.id)).toMatchObject({ status: "QUEUED" });
  });
});
