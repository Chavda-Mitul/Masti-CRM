import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendWhatsApp, whatsAppProvider } from "../src/lib/whatsapp";
import { logOnlyProvider } from "../src/lib/whatsapp/logOnly";
import { twilioProvider } from "../src/lib/whatsapp/twilio";

// Sending WhatsApp (docs/decisions/0020-whatsapp-sending.md): the provider .env picks, and what Twilio is asked to do.
// Twilio itself is a stand-in here, so no test ever sends a real message.

const twilioMock = vi.hoisted(() => {
  class RestException extends Error {
    constructor(
      message: string,
      public code?: number,
    ) {
      super(message);
    }
  }
  const create = vi.fn();
  const fetch = vi.fn();
  const messages = Object.assign(
    vi.fn(() => ({ fetch })),
    { create },
  );
  const client = vi.fn(() => ({ messages }));
  return { RestException, create, fetch, messages, client };
});

vi.mock("twilio", () => ({ default: Object.assign(twilioMock.client, { RestException: twilioMock.RestException }) }));

const settings = { accountSid: `AC${"0".repeat(32)}`, authToken: "token", from: "+14155238886" };
const to = "+919825041234";

beforeEach(() => {
  twilioMock.create.mockReset();
  twilioMock.fetch.mockReset();
});

describe("choosing the provider", () => {
  it("sends nothing while WhatsApp is off", async () => {
    expect(whatsAppProvider()).toBeNull();
    await expect(sendWhatsApp({ to, body: "Hello" })).rejects.toThrow("WhatsApp isn't set up yet.");
  });

  it("log only: keeps the message in the server log, with an id like a sent one", async () => {
    const sent = await logOnlyProvider.send({ to, body: "Hello" });
    expect(sent.providerMessageId).toMatch(/^log-[0-9a-f-]{36}$/);
  });
});

describe("Twilio", () => {
  it("sends our own words to the client's WhatsApp number", async () => {
    twilioMock.create.mockResolvedValue({ sid: "SM1" });
    const sent = await twilioProvider(settings).send({ to, body: "All documents received." });

    expect(sent).toEqual({ providerMessageId: "SM1" });
    expect(twilioMock.client).toHaveBeenCalledWith(settings.accountSid, "token");
    expect(twilioMock.create).toHaveBeenCalledWith({
      from: "whatsapp:+14155238886",
      to: "whatsapp:+919825041234",
      body: "All documents received.",
    });
  });

  it("sends an approved template with its values, and not our words", async () => {
    twilioMock.create.mockResolvedValue({ sid: "SM2" });
    const variables = { client_name: "Rakesh Mehta", case_no: "VISA-2026-0041" };
    await twilioProvider(settings).send({ to, body: "Dear Rakesh Mehta, …", template: { id: "HX01", variables } });

    expect(twilioMock.create).toHaveBeenCalledWith({
      from: "whatsapp:+14155238886",
      to: "whatsapp:+919825041234",
      contentSid: "HX01",
      contentVariables: JSON.stringify(variables),
    });
  });

  it("explains a refusal in plain words, or keeps Twilio's own for one we don't know", async () => {
    const provider = twilioProvider(settings);
    twilioMock.create.mockRejectedValueOnce(new twilioMock.RestException("Could not find a Channel with the From address", 63007));
    await expect(provider.send({ to, body: "Hi" })).rejects.toThrow("Twilio doesn't know the sending number.");

    twilioMock.create.mockRejectedValueOnce(new twilioMock.RestException("Something new", 21999));
    await expect(provider.send({ to, body: "Hi" })).rejects.toThrow(
      "Twilio error 21999: Something new (https://www.twilio.com/docs/api/errors/21999)",
    );
  });

  it("says when Twilio can't be reached", async () => {
    twilioMock.create.mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.twilio.com"));
    await expect(twilioProvider(settings).send({ to, body: "Hi" })).rejects.toThrow(
      "Couldn't reach Twilio: getaddrinfo ENOTFOUND api.twilio.com",
    );
  });

  it("reports where a message has got to, with the reason when it failed", async () => {
    const provider = twilioProvider(settings);
    const answer = (status: string, errorCode: number | null = null, errorMessage: string | null = null) =>
      twilioMock.fetch.mockResolvedValueOnce({ status, errorCode, errorMessage });

    answer("queued");
    await expect(provider.checkStatus("SM1")).resolves.toEqual({ status: "QUEUED", error: null });
    expect(twilioMock.messages).toHaveBeenCalledWith("SM1");
    answer("sent");
    await expect(provider.checkStatus("SM1")).resolves.toEqual({ status: "SENT", error: null });
    answer("delivered");
    await expect(provider.checkStatus("SM1")).resolves.toEqual({ status: "DELIVERED", error: null });
    answer("read");
    await expect(provider.checkStatus("SM1")).resolves.toEqual({ status: "READ", error: null });

    answer("undelivered", 63015, "Channel Sandbox can only send messages to phone numbers that have joined the Sandbox");
    await expect(provider.checkStatus("SM1")).resolves.toEqual({
      status: "FAILED",
      error: "This phone hasn't joined the Twilio sandbox, or joined more than 3 days ago. Send the join message from it again.",
    });
    answer("failed");
    await expect(provider.checkStatus("SM1")).resolves.toEqual({ status: "FAILED", error: "Twilio didn't say why." });
  });
});
