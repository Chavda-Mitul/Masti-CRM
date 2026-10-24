import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendWhatsApp, whatsAppProvider, WhatsAppError } from "../src/lib/whatsapp";
import { forTheLog, logOnlyProvider } from "../src/lib/whatsapp/logOnly";
import { metaProvider } from "../src/lib/whatsapp/meta";
import { twilioProvider } from "../src/lib/whatsapp/twilio";

// Sending WhatsApp (docs/decisions/0020-whatsapp-sending.md): the provider .env picks, and what Twilio and Meta are
// asked to do. Both are stand-ins here, so no test ever sends a real message.

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

describe("Meta", () => {
  const meta = { accessToken: "token", phoneNumberId: "1433814799810645", templateLanguage: "en_US" };
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Meta's answer: its JSON, with that HTTP status. */
  const answer = (status: number, json: unknown) => new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  /** Meta took the message. */
  const taken = (id: string) => answer(200, { messaging_product: "whatsapp", contacts: [{ input: "919825041234", wa_id: "919825041234" }], messages: [{ id }] });
  /** Meta turned the request down, as its Graph API does. */
  const refused = (status: number, code: number, details: string, subcode?: number) =>
    answer(status, {
      error: { message: `(#${code}) ${details}`, type: "OAuthException", code, ...(subcode ? { error_subcode: subcode } : {}), error_data: { messaging_product: "whatsapp", details }, fbtrace_id: "Ab1" },
    });
  /** What Meta was asked: the address, the headers and the message. */
  const asked = () => {
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    return { url, headers: init?.headers, message: JSON.parse(String(init?.body)) as unknown };
  };
  const request = { messaging_product: "whatsapp", recipient_type: "individual", to: "919825041234" };

  it("sends our own words to the client's number, without the +", async () => {
    fetchMock.mockResolvedValue(taken("wamid.HBgM1"));
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const sent = await metaProvider(meta).send({ to, body: "All documents received." });

    expect(sent).toEqual({ providerMessageId: "wamid.HBgM1" });
    expect(asked()).toEqual({
      url: "https://graph.facebook.com/v26.0/1433814799810645/messages",
      headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
      message: { ...request, type: "text", text: { body: "All documents received." } },
    });
    // Meta is given 30 seconds, well inside the send job's 2 minutes (src/lib/jobs.ts).
    expect(timeout).toHaveBeenCalledWith(30_000);
    timeout.mockRestore();
  });

  it("sends a file with our words as its caption: Meta fetches it from the link it's given (0025, part 2)", async () => {
    fetchMock.mockResolvedValue(taken("wamid.HBgM2"));
    const url = "https://crm.masti.in/api/public/message-files/m1/VISA-2026-0041_Rakesh-Mehta_evisa.pdf?key=k";
    await metaProvider(meta).send({ to, body: "Your e-visa is attached.", attachment: { url, fileName: "VISA-2026-0041_Rakesh-Mehta_evisa.pdf" } });

    expect(asked().message).toEqual({
      ...request,
      type: "document",
      document: { link: url, filename: "VISA-2026-0041_Rakesh-Mehta_evisa.pdf", caption: "Your e-visa is attached." },
    });
  });

  it("sends an approved template by name, in the templates' language, with its named values and not our words", async () => {
    fetchMock.mockResolvedValue(taken("wamid.HBgM3"));
    const variables = { client_name: "Rakesh Mehta", case_no: "VISA-2026-0041" };
    await metaProvider(meta).send({ to, body: "Dear Rakesh Mehta, …", template: { id: "visa_documents_received", variables } });

    expect(asked().message).toEqual({
      ...request,
      type: "template",
      template: {
        name: "visa_documents_received",
        language: { code: "en_US" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", parameter_name: "client_name", text: "Rakesh Mehta" },
              { type: "text", parameter_name: "case_no", text: "VISA-2026-0041" },
            ],
          },
        ],
      },
    });
  });

  it("sends numbered values in their order, and a template without values on its own", async () => {
    fetchMock.mockResolvedValue(taken("wamid.HBgM4"));
    const provider = metaProvider(meta);
    await provider.send({ to, body: "Your appointment is coming up on Fri 24 Oct at 10:30", template: { id: "appointment", variables: { "2": "10:30", "1": "Fri 24 Oct" } } });
    expect(asked().message).toMatchObject({
      template: { components: [{ type: "body", parameters: [{ type: "text", text: "Fri 24 Oct" }, { type: "text", text: "10:30" }] }] },
    });

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(taken("wamid.HBgM5"));
    await provider.send({ to, body: "Hello World", template: { id: "hello_world", variables: {} } });
    expect(asked().message).toEqual({ ...request, type: "template", template: { name: "hello_world", language: { code: "en_US" } } });
  });

  it("sends a one-time code as Meta's authentication template: the code in its words and in its Copy code button", async () => {
    fetchMock.mockResolvedValue(taken("wamid.HBgM7"));
    await metaProvider(meta).send({
      to,
      body: "482915 is your verification code.\n\nThis code expires in 10 minutes.",
      template: { id: "field_door_code", variables: { code: "482915", minutes: "10" }, oneTimeCode: "482915" },
      secrets: ["482915"],
    });
    expect(asked().message).toEqual({
      ...request,
      type: "template",
      template: {
        name: "field_door_code",
        language: { code: "en_US" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "482915" }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "482915" }] },
        ],
      },
    });
  });

  it("puts a file in the document header of an approved template", async () => {
    fetchMock.mockResolvedValue(taken("wamid.HBgM6"));
    const url = "https://crm.masti.in/api/public/message-files/m1/evisa.pdf?key=k";
    await metaProvider(meta).send({
      to,
      body: "Dear Rakesh Mehta, …",
      template: { id: "visa_evisa_ready", variables: { client_name: "Rakesh Mehta" } },
      attachment: { url, fileName: "evisa.pdf" },
    });

    expect(asked().message).toMatchObject({
      template: {
        components: [
          { type: "header", parameters: [{ type: "document", document: { link: url, filename: "evisa.pdf" } }] },
          { type: "body", parameters: [{ type: "text", parameter_name: "client_name", text: "Rakesh Mehta" }] },
        ],
      },
    });
  });

  it("explains a refusal in plain words, or keeps Meta's own for one we don't know; neither is worth another try", async () => {
    const provider = metaProvider(meta);
    fetchMock.mockResolvedValueOnce(refused(401, 190, "Error validating access token: Session has expired"));
    expect(await refusal(provider.send({ to, body: "Hi" }))).toMatchObject({
      message: expect.stringContaining("Meta refused the access token: it has expired or is wrong."),
      retryable: false,
    });

    fetchMock.mockResolvedValueOnce(refused(400, 100, "Object with ID '1433814799810645' does not exist", 33));
    expect(await refusal(provider.send({ to, body: "Hi" }))).toMatchObject({
      message: expect.stringContaining("Meta doesn't know this phone number ID"),
      retryable: false,
    });

    fetchMock.mockResolvedValueOnce(refused(400, 132001, "template name (visa_x) does not exist in en_US"));
    expect(await refusal(provider.send({ to, body: "Hi" }))).toMatchObject({
      message: "Meta has no approved template by this name in this language. Check the template's name and META_TEMPLATE_LANGUAGE.",
      retryable: false,
    });

    fetchMock.mockResolvedValueOnce(refused(400, 135000, "Generic user error"));
    expect(await refusal(provider.send({ to, body: "Hi" }))).toMatchObject({
      message: "Meta error 135000: Generic user error (https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes)",
      retryable: false,
    });
  });

  it("tries again later only when Meta was down or busy", async () => {
    const provider = metaProvider(meta);
    fetchMock.mockResolvedValueOnce(new Response("<html>Bad gateway</html>", { status: 502 }));
    expect(await refusal(provider.send({ to, body: "Hi" }))).toMatchObject({ message: "Meta answered 502 without saying why.", retryable: true });

    fetchMock.mockResolvedValueOnce(refused(400, 130429, "Rate limit hit"));
    expect((await refusal(provider.send({ to, body: "Hi" }))).retryable).toBe(true);
    fetchMock.mockResolvedValueOnce(refused(400, 131056, "Pair rate limit hit"));
    expect((await refusal(provider.send({ to, body: "Hi" }))).retryable).toBe(true);
  });

  it("tries again when the request never reached Meta, but not when it may have got there", async () => {
    const provider = metaProvider(meta);
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed", { cause: networkError("getaddrinfo ENOTFOUND graph.facebook.com", "ENOTFOUND") }));
    expect(await refusal(provider.send({ to, body: "Hi" }))).toMatchObject({
      message: "Couldn't reach Meta: getaddrinfo ENOTFOUND graph.facebook.com",
      retryable: true,
    });

    fetchMock.mockRejectedValueOnce(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    expect(await refusal(provider.send({ to, body: "Hi" }))).toMatchObject({
      message: "Meta didn't answer within 30 seconds, so the message may or may not have gone. Check the chat.",
      retryable: false,
    });

    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed", { cause: networkError("other side closed", "UND_ERR_SOCKET") }));
    expect(await refusal(provider.send({ to, body: "Hi" }))).toMatchObject({
      message: "Meta didn't answer (other side closed), so the message may or may not have gone. Check the chat.",
      retryable: false,
    });

    // Taken, but with no id to follow it by: it may have gone, so it isn't sent again.
    fetchMock.mockResolvedValueOnce(answer(200, {}));
    expect(await refusal(provider.send({ to, body: "Hi" }))).toMatchObject({ retryable: false });
  });
});
