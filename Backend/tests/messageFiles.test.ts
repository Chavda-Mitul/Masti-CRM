import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config/env";
import { boss } from "../src/lib/jobs";
import { putObject } from "../src/lib/storage";
import { WhatsAppError, type WhatsAppMessage, type WhatsAppStatus } from "../src/lib/whatsapp";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { hashFileKey } from "../src/modules/messages/messageFiles";
import { VISA_DOCUMENT_LIST, VISA_DOCUMENTS_RECEIVED } from "../src/modules/messages/messages.seed";
import { deliverMessage, queueMessage } from "../src/modules/messages/messages.service";
import { visaMessageBasics } from "../src/modules/visa/visaMessages";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { app, prisma, request, resetDb } from "./helpers";
import { saveCase, visaStaff, type Agent } from "./visaHelpers";

// A file sent with a WhatsApp message (docs/decisions/0025-evisa-after-decision.md, part 2): the outbox keeps which of
// the case's files goes, each try makes a new short-lived link with a secret key, and the provider fetches the file
// there, with GET or HEAD, no login. The provider is a stand-in, so nothing is ever sent; the files are in the test
// bucket (MinIO, emptied by globalSetup).

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

const PDF = Buffer.from("%PDF-1.7\n% a stand-in e-visa\n%%EOF\n");
const FILE_NAME = "VISA-2026-0001_Rakesh-Mehta_evisa.pdf";

/** A saved visa case, its staff, and one of its files in the test bucket (a PDF, as an e-visa is). */
async function caseWithFile(): Promise<{ agent: Agent; c: { id: string; caseNo: string }; fileId: string }> {
  const agent = await visaStaff();
  const c = await saveCase(agent);
  // Saving a case queues message 1, the document list; these tests are about the file, so it goes.
  await prisma.outboundMessage.deleteMany({ where: { template: { code: VISA_DOCUMENT_LIST } } });
  await boss.deleteAllJobs();
  const storageKey = `cases/${c.id}/evisa/${randomUUID()}/${FILE_NAME}`;
  await putObject(storageKey, PDF, "application/pdf");
  const aarti = await prisma.user.findUniqueOrThrow({ where: { email: "aarti@masti.test" } });
  const file = await prisma.caseFile.create({
    data: { enquiryId: c.id, kind: "FINAL_FILE", storageKey, fileName: FILE_NAME, sizeBytes: PDF.length, pageCount: 1, uploadedById: aarti.id },
  });
  return { agent, c, fileId: file.id };
}

/** "All documents received", carrying the file. */
async function queueWithFile(enquiryId: string, attachmentId: string, key = "test:file") {
  await prisma.$transaction(async (tx) =>
    queueMessage(tx, { template: VISA_DOCUMENTS_RECEIVED, enquiryId, key, attachmentId, ...(await visaMessageBasics(tx, enquiryId)) }),
  );
  return prisma.outboundMessage.findUniqueOrThrow({ where: { idempotencyKey: key } });
}

/** The link the provider was given on its `call`th send, split into the path the route sees and the key. */
function linkSent(call = 0) {
  const message = stub.provider!.send.mock.calls[call]![0];
  const url = new URL(message.attachment!.url);
  return { message, path: url.pathname, key: url.searchParams.get("key")! };
}

describe("queueing a file", () => {
  it("keeps which of the case's files goes with the message", async () => {
    const { c, fileId } = await caseWithFile();
    const m = await queueWithFile(c.id, fileId);
    expect(m).toMatchObject({ status: "QUEUED", attachmentId: fileId, attachmentKeyHash: null, attachmentKeyExpiresAt: null });
  });

  it("refuses another case's file, and the change it reports doesn't go through", async () => {
    const { agent, fileId } = await caseWithFile();
    const other = await saveCase(agent, { mobile: "98250 41239", clientName: "Sunil Shah" });
    await expect(queueWithFile(other.id, fileId, "other")).rejects.toThrow("The file to send with a WhatsApp message isn't this case's.");
    expect(await prisma.outboundMessage.count({ where: { idempotencyKey: "other" } })).toBe(0);
  });
});

describe("sending a file", () => {
  it("gives the provider the words and a link to the file, whose key only the provider gets", async () => {
    const { c, fileId } = await caseWithFile();
    const m = await queueWithFile(c.id, fileId);
    const before = Date.now();
    await deliverMessage(m.id, { lastTry: false });

    const { message, path, key } = linkSent();
    expect(message).toMatchObject({ body: m.body, attachment: { fileName: FILE_NAME } });
    expect(message.attachment!.url.startsWith(`${env.PUBLIC_APP_URL.replace(/\/+$/, "")}/api/public/message-files/`)).toBe(true);
    // The path ends in the file's name, which WhatsApp shows; the key is 32 random bytes.
    expect(path).toBe(`/api/public/message-files/${m.id}/${FILE_NAME}`);
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const after = await prisma.outboundMessage.findUniqueOrThrow({ where: { id: m.id } });
    expect(after).toMatchObject({ status: "SENT", attachmentKeyHash: hashFileKey(key) });
    const minutes = (after.attachmentKeyExpiresAt!.getTime() - before) / 60_000;
    expect(minutes).toBeGreaterThan(29.9);
    expect(minutes).toBeLessThan(30.1);
  });

  it("also gives the file itself, from storage, for a provider sent the file rather than the link (0020 amendment 2)", async () => {
    const { c, fileId } = await caseWithFile();
    const m = await queueWithFile(c.id, fileId);
    await deliverMessage(m.id, { lastTry: false });

    const { message } = linkSent();
    expect(message.attachment!.contentType).toBe("application/pdf");
    expect(await message.attachment!.read!()).toEqual(PDF);
  });

  it("makes a new link at each try: an earlier try's stops working", async () => {
    const { c, fileId } = await caseWithFile();
    const m = await queueWithFile(c.id, fileId);
    stub.provider!.send.mockRejectedValueOnce(new WhatsAppError("Twilio is busy.", true));
    await expect(deliverMessage(m.id, { lastTry: false })).rejects.toThrow("Twilio is busy.");
    await deliverMessage(m.id, { lastTry: false });

    const first = linkSent(0);
    const second = linkSent(1);
    expect(second.key).not.toBe(first.key);
    expect((await request(app).get(`${first.path}?key=${first.key}`)).status).toBe(404);
    expect((await request(app).get(`${second.path}?key=${second.key}`)).status).toBe(200);
  });

  it("sends a message with no file as before, with no link", async () => {
    const { c } = await caseWithFile();
    await prisma.$transaction(async (tx) =>
      queueMessage(tx, { template: VISA_DOCUMENTS_RECEIVED, enquiryId: c.id, key: "plain", ...(await visaMessageBasics(tx, c.id)) }),
    );
    const m = await prisma.outboundMessage.findUniqueOrThrow({ where: { idempotencyKey: "plain" } });
    await deliverMessage(m.id, { lastTry: false });
    expect(stub.provider!.send.mock.calls[0]![0]).not.toHaveProperty("attachment");
    expect((await prisma.outboundMessage.findUniqueOrThrow({ where: { id: m.id } })).attachmentKeyHash).toBeNull();
  });
});

describe("the file's link", () => {
  async function sentWithFile() {
    const { agent, c, fileId } = await caseWithFile();
    const m = await queueWithFile(c.id, fileId);
    await deliverMessage(m.id, { lastTry: false });
    return { agent, c, m, fileId, ...linkSent() };
  }

  it("GET: the file itself, as what it is, never cached, and the fetch is audited", async () => {
    const { m, fileId, path, key } = await sentWithFile();
    const res = await request(app).get(`${path}?key=${key}`).buffer(true).parse((r, done) => {
      const chunks: Buffer[] = [];
      r.on("data", (chunk: Buffer) => chunks.push(chunk));
      r.on("end", () => done(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, PDF)).toBe(0);
    expect(res.headers).toMatchObject({
      "content-type": "application/pdf",
      "content-length": String(PDF.length),
      "content-disposition": `inline; filename="${FILE_NAME}"`,
      "cache-control": "private, no-store",
    });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "message.file.fetch" } });
    expect(entry).toMatchObject({ actorId: null, entityType: "OutboundMessage", entityId: m.id, clientId: m.clientId, after: { fileId, fileName: FILE_NAME } });
  });

  it("HEAD, which Twilio asks first: the same headers and no body, and nothing audited", async () => {
    const { path, key } = await sentWithFile();
    const res = await request(app).head(`${path}?key=${key}`);
    expect(res.status).toBe(200);
    expect(res.headers).toMatchObject({ "content-type": "application/pdf", "content-length": String(PDF.length) });
    expect(res.text ?? "").toBe("");
    expect(await prisma.auditLog.count({ where: { action: "message.file.fetch" } })).toBe(0);
  });

  it("gives the same 404 for a wrong key, an old link, an unknown message and a message with no file", async () => {
    const { c, m, path, key } = await sentWithFile();
    const gone = async (url: string) => {
      const res = await request(app).get(url);
      expect(res.status).toBe(404);
      expect(res.body.message).toBe("This link doesn't work any more.");
    };
    await gone(`${path}?key=${key.slice(0, -1)}${key.endsWith("A") ? "B" : "A"}`);
    await gone(path);
    await gone(`/api/public/message-files/${randomUUID()}/${FILE_NAME}?key=${key}`);
    await gone(`/api/public/message-files/not-a-message/${FILE_NAME}?key=${key}`);

    await prisma.$transaction(async (tx) =>
      queueMessage(tx, { template: VISA_DOCUMENTS_RECEIVED, enquiryId: c.id, key: "plain", ...(await visaMessageBasics(tx, c.id)) }),
    );
    const plain = await prisma.outboundMessage.findUniqueOrThrow({ where: { idempotencyKey: "plain" } });
    await gone(`/api/public/message-files/${plain.id}/${FILE_NAME}?key=${key}`);

    await prisma.outboundMessage.update({ where: { id: m.id }, data: { attachmentKeyExpiresAt: new Date(Date.now() - 1000) } });
    await gone(`${path}?key=${key}`);
    expect(await prisma.auditLog.count({ where: { action: "message.file.fetch" } })).toBe(0);
  });

  it("shows on the Sent to the client card by the file's name, never the link", async () => {
    const { agent, c } = await sentWithFile();
    const res = await agent.get(`/api/visa/cases/${c.caseNo}/messages`);
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0]).toMatchObject({ attachment: { fileName: FILE_NAME } });
    expect(JSON.stringify(res.body)).not.toContain("key=");
  });
});

describe("the database", () => {
  it("keeps a link's key and expiry together, and only on a message with a file", async () => {
    const { c, m } = await (async () => {
      const made = await caseWithFile();
      return { c: made.c, m: await queueWithFile(made.c.id, made.fileId) };
    })();
    await expect(prisma.outboundMessage.update({ where: { id: m.id }, data: { attachmentKeyHash: hashFileKey("k") } })).rejects.toThrow(
      /OutboundMessage_attachment_key/,
    );
    await prisma.$transaction(async (tx) =>
      queueMessage(tx, { template: VISA_DOCUMENTS_RECEIVED, enquiryId: c.id, key: "plain", ...(await visaMessageBasics(tx, c.id)) }),
    );
    const plain = await prisma.outboundMessage.findUniqueOrThrow({ where: { idempotencyKey: "plain" } });
    await expect(
      prisma.outboundMessage.update({ where: { id: plain.id }, data: { attachmentKeyHash: hashFileKey("k"), attachmentKeyExpiresAt: new Date() } }),
    ).rejects.toThrow(/OutboundMessage_attachment_key_file/);
  });
});
