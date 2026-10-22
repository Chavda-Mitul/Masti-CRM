import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendWhatsApp, whatsAppProvider, WhatsAppError } from "../src/lib/whatsapp";
import { forTheLog, logOnlyProvider } from "../src/lib/whatsapp/logOnly";
import { twilioProvider } from "../src/lib/whatsapp/twilio";

// Sending WhatsApp (docs/decisions/0020-whatsapp-sending.md): the provider .env picks, and what Twilio is asked to do.
// Twilio itself is a stand-in here, so no test ever sends a real message.

const twilioMock = vi.hoisted(() => {
  class RestException extends Error {
    constructor(
      message: string,
      public code?: number,
      public status = 400,
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

/** What a send threw, to check its words and whether it's worth another try. */
async function refusal(send: Promise<unknown>): Promise<WhatsAppError> {
  const error = await send.then(
    () => null,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(WhatsAppError);
  return error as WhatsAppError;
}

/** A Node network error, as Twilio's HTTP client passes it on. */
const networkError = (message: string, code: string) => Object.assign(new Error(message), { code });

beforeEach(() => {
  twilioMock.create.mockReset();
  twilioMock.fetch.mockReset();
});

describe("choosing the provider", () => {
  it("sends nothing while WhatsApp is off, and trying again won't help", async () => {
    expect(whatsAppProvider()).toBeNull();
    const error = await refusal(sendWhatsApp({ to, body: "Hello" }));
    expect(error).toMatchObject({ message: "WhatsApp isn't set up yet.", retryable: false });
  });

  it("log only: keeps the message in the server log, with an id like a sent one", async () => {
    const sent = await logOnlyProvider.send({ to, body: "Hello" });
    expect(sent.providerMessageId).toMatch(/^log-[0-9a-f-]{36}$/);
  });

  it("log only: hides a link's secret from the log when live, and keeps it on a laptop, where the log is the way in", () => {
    const link = "https://crm.masti.in/consent#abcDEF123_-xyz";
    const message = { to, body: `Please tap "I agree":\n${link}\n\nThank you.`, template: { id: "HX01", variables: { consent_link: link, case_no: "VISA-2026-0041" } } };
    expect(forTheLog(message, true)).toEqual({
      to,
      body: 'Please tap "I agree":\nhttps://crm.masti.in/consent#…\n\nThank you.',
      template: { id: "HX01", variables: { consent_link: "https://crm.masti.in/consent#…", case_no: "VISA-2026-0041" } },
    });
    expect(forTheLog(message, false)).toEqual(message);
  });

  it("log only: hides the door code from the log when live, and keeps it on a laptop; the list of secrets is never logged", () => {
    const words = { to, body: "482915 is your verification code.\n\nThis code expires in 10 minutes.", template: { id: "HX02", variables: { code: "482915", minutes: "10" } } };
    const message = { ...words, secrets: ["482915"] };
    expect(forTheLog(message, true)).toEqual({
      to,
      body: "•••••• is your verification code.\n\nThis code expires in 10 minutes.",
      template: { id: "HX02", variables: { code: "••••••", minutes: "10" } },
    });
    expect(forTheLog(message, false)).toEqual(words);
  });

  it("log only: hides a file link's key from the log when live, and keeps it on a laptop (0025, part 2)", () => {
    const url = "https://crm.masti.in/api/public/message-files/0b7e1c5e-0000-4000-8000-000000000001/VISA-2026-0041_Rakesh-Mehta_evisa.pdf?key=abcDEF123_-xyz";
    const message = { to, body: "Your e-visa is attached.", attachment: { url, fileName: "VISA-2026-0041_Rakesh-Mehta_evisa.pdf" } };
    expect(forTheLog(message, true)).toEqual({
      ...message,
      attachment: { ...message.attachment, url: url.replace("key=abcDEF123_-xyz", "key=…") },
    });
    expect(forTheLog(message, false)).toEqual(message);
  });
});

describe("Twilio", () => {
  it("sends our own words to the client's WhatsApp number", async () => {
    twilioMock.create.mockResolvedValue({ sid: "SM1" });
    const sent = await twilioProvider(settings).send({ to, body: "All documents received." });

    expect(sent).toEqual({ providerMessageId: "SM1" });
    // Twilio gives up after 30 seconds, well inside the send job's 2 minutes (src/lib/jobs.ts).
    expect(twilioMock.client).toHaveBeenCalledWith(settings.accountSid, "token", { timeout: 30_000 });
    expect(twilioMock.create).toHaveBeenCalledWith({
      from: "whatsapp:+14155238886",
      to: "whatsapp:+919825041234",
      body: "All documents received.",
    });
  });

  it("sends a file with our words: Twilio fetches it from the link it's given (0025, part 2)", async () => {
    twilioMock.create.mockResolvedValue({ sid: "SM3" });
    const url = "https://crm.masti.in/api/public/message-files/m1/VISA-2026-0041_Rakesh-Mehta_evisa.pdf?key=k";
    await twilioProvider(settings).send({ to, body: "Your e-visa is attached.", attachment: { url, fileName: "VISA-2026-0041_Rakesh-Mehta_evisa.pdf" } });

    expect(twilioMock.create).toHaveBeenCalledWith({
      from: "whatsapp:+14155238886",
      to: "whatsapp:+919825041234",
      body: "Your e-visa is attached.",
      mediaUrl: [url],
    });
  });

  it("won't send a file with an approved template, and trying again won't help", async () => {
    const error = await refusal(
      twilioProvider(settings).send({
        to,
        body: "Dear Rakesh Mehta, …",
        template: { id: "HX01", variables: { client_name: "Rakesh Mehta" } },
        attachment: { url: "https://crm.masti.in/api/public/message-files/m1/x.pdf?key=k", fileName: "x.pdf" },
      }),
    );
    expect(error).toMatchObject({ message: expect.stringContaining("goes with our own words"), retryable: false });
    expect(twilioMock.create).not.toHaveBeenCalled();
  });

  it("explains a file Twilio couldn't fetch in plain words", async () => {
    twilioMock.fetch.mockResolvedValue({ status: "failed", errorCode: 63019, errorMessage: "Media failed to download" });
    expect(await twilioProvider(settings).checkStatus("SM3")).toEqual({
      status: "FAILED",
      error: "Twilio couldn't fetch the attached file: the CRM's public address (PUBLIC_APP_URL) must be reachable from the internet.",
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

  it("explains a refusal in plain words, or keeps Twilio's own for one we don't know; neither is worth another try", async () => {
    const provider = twilioProvider(settings);
    twilioMock.create.mockRejectedValueOnce(new twilioMock.RestException("Could not find a Channel with the From address", 63007));
    expect(await refusal(provider.send({ to, body: "Hi" }))).toMatchObject({
      message: expect.stringContaining("Twilio doesn't know the sending number."),
      retryable: false,
    });

    twilioMock.create.mockRejectedValueOnce(new twilioMock.RestException("Something new", 21999));
    expect(await refusal(provider.send({ to, body: "Hi" }))).toMatchObject({
      message: "Twilio error 21999: Something new (https://www.twilio.com/docs/api/errors/21999)",
      retryable: false,
    });
  });

  it("tries again later only when Twilio was down or busy", async () => {
    const provider = twilioProvider(settings);
    twilioMock.create.mockRejectedValueOnce(new twilioMock.RestException("Service unavailable", 20500, 503));
    expect((await refusal(provider.send({ to, body: "Hi" }))).retryable).toBe(true);
    twilioMock.create.mockRejectedValueOnce(new twilioMock.RestException("Too many requests", 20429, 429));
    expect((await refusal(provider.send({ to, body: "Hi" }))).retryable).toBe(true);
  });

  it("tries again when the request never reached Twilio, but not when it may have got there", async () => {
    const provider = twilioProvider(settings);
    twilioMock.create.mockRejectedValueOnce(networkError("getaddrinfo ENOTFOUND api.twilio.com", "ENOTFOUND"));
    expect(await refusal(provider.send({ to, body: "Hi" }))).toMatchObject({
      message: "Couldn't reach Twilio: getaddrinfo ENOTFOUND api.twilio.com",
      retryable: true,
    });
    // The office internet down: no route to Twilio, so the request never left.
    twilioMock.create.mockRejectedValueOnce(networkError("connect ENETUNREACH 3.0.0.1:443", "ENETUNREACH"));
    expect(await refusal(provider.send({ to, body: "Hi" }))).toMatchObject({
      message: "Couldn't reach Twilio: connect ENETUNREACH 3.0.0.1:443",
      retryable: true,
    });

    twilioMock.create.mockRejectedValueOnce(networkError("timeout of 30000ms exceeded", "ECONNABORTED"));
    expect(await refusal(provider.send({ to, body: "Hi" }))).toMatchObject({
      message: "Twilio didn't answer (timeout of 30000ms exceeded), so the message may or may not have gone. Check the chat.",
      retryable: false,
    });
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

  it("explains a status check Twilio refused or couldn't answer, as for a send", async () => {
    const provider = twilioProvider(settings);
    twilioMock.fetch.mockRejectedValueOnce(new twilioMock.RestException("Authenticate", 20003));
    await expect(provider.checkStatus("SM1")).rejects.toThrow(
      "Twilio refused the Account SID or Auth Token. Copy both again from the Twilio Console.",
    );
    twilioMock.fetch.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND api.twilio.com"));
    await expect(provider.checkStatus("SM1")).rejects.toThrow("Couldn't reach Twilio: getaddrinfo ENOTFOUND api.twilio.com");
    // Asking again sends nothing, so even a timeout is worth another try here, unlike on a send.
    twilioMock.fetch.mockRejectedValueOnce(networkError("timeout of 30000ms exceeded", "ECONNABORTED"));
    expect(await refusal(provider.checkStatus("SM1"))).toMatchObject({
      message: "Couldn't reach Twilio: timeout of 30000ms exceeded",
      retryable: true,
    });
  });
});
