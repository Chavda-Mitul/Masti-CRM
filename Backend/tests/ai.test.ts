import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config/env";
import { AiError, askAi, type AiProvider, type AiReply, type AiRequest } from "../src/lib/ai";
import { anthropicProvider } from "../src/lib/ai/anthropic";
import { FAKE_ANSWER, fakeProvider } from "../src/lib/ai/fake";
import { costMicroUsd } from "../src/lib/ai/prices";
import { createUser, prisma, resetDb } from "./helpers";

// AI (docs/decisions/0023-ai.md): the provider .env picks, what Anthropic is asked, what each call costs, and the record
// every call leaves. Anthropic itself is a stand-in here, so no test ever calls the real AI or spends money.

const sdk = vi.hoisted(() => ({ create: vi.fn(), options: [] as unknown[] }));

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const real = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  // The real client, with its errors, but its messages go to the stand-in.
  class StandIn extends real.default {
    constructor(options: ConstructorParameters<typeof real.default>[0]) {
      super(options);
      sdk.options.push(options);
      (this as unknown as { messages: unknown }).messages = { create: sdk.create };
    }
  }
  return { ...real, default: StandIn };
});

// askAi's provider is a stand-in each test sets, as messages.test.ts does for WhatsApp.
const stub = vi.hoisted(() => ({ provider: null as AiProvider | null }));
vi.mock("../src/lib/ai/provider", () => ({ aiProvider: () => stub.provider }));

const request: AiRequest = {
  model: "claude-haiku-5-5",
  system: "You write one short paragraph.",
  prompt: "Two adults to France, 10–24 December.",
  maxTokens: 1_000,
  effort: "low",
};

/** Anthropic's answer: thinking first (its text left out, as Haiku 5.5 does by default), then the text. */
function message(over: Record<string, unknown> = {}) {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: "We wish to visit Paris and Nice." },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 2_500, output_tokens: 1_000, cache_creation_input_tokens: null, cache_read_input_tokens: null },
    ...over,
  };
}

/** Anthropic's error body, as the SDK keeps it. */
const body = (type: string, message: string) => ({ type: "error", error: { type, message } });

/** What a call threw, to check its words and whether it's worth another try. */
async function failureOf(call: Promise<unknown>): Promise<AiError> {
  const error = await call.then(
    () => null,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(AiError);
  return error as AiError;
}

/** A provider that gives this answer. */
function answering(reply: Partial<AiReply>): AiProvider & { complete: ReturnType<typeof vi.fn> } {
  return {
    name: "anthropic",
    complete: vi.fn(async () => ({
      text: "We wish to visit Paris and Nice.",
      model: "claude-haiku-5-5",
      inputTokens: 2_500,
      outputTokens: 1_000,
      stopReason: "DONE" as const,
      ...reply,
    })),
  };
}

beforeEach(() => {
  sdk.create.mockReset();
  sdk.options.length = 0;
});

describe("Anthropic", () => {
  it("asks the one model with the effort and the instructions, and nothing Haiku 5.5 refuses", async () => {
    sdk.create.mockResolvedValue(message());
    await anthropicProvider({ apiKey: "key" }).complete(request);

    // Someone is waiting, so 30 seconds and one more try.
    expect(sdk.options).toEqual([{ apiKey: "key", timeout: 30_000, maxRetries: 1 }]);
    // Exactly these: no temperature, top_p or top_k, and no half-written answer.
    expect(sdk.create).toHaveBeenCalledWith(
      {
        model: "claude-haiku-5-5",
        max_tokens: 1_000,
        system: "You write one short paragraph.",
        messages: [{ role: "user", content: "Two adults to France, 10–24 December." }],
        output_config: { effort: "low" },
      },
      { timeout: 30_000, maxRetries: 1 },
    );
  });

  it("gives a use case with a longer answer its own time limit and tries", async () => {
    sdk.create.mockResolvedValue(message());
    await anthropicProvider({ apiKey: "key" }).complete({ ...request, timeoutMs: 60_000, maxRetries: 0 });
    expect(sdk.create).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-haiku-5-5" }), { timeout: 60_000, maxRetries: 0 });
  });

  it("names the workspace with a user key, which belongs to none", async () => {
    sdk.create.mockResolvedValue(message());
    await anthropicProvider({ apiKey: "key", workspaceId: "wrkspc_01ABC" }).complete(request);
    expect(sdk.options).toEqual([
      { apiKey: "key", timeout: 30_000, maxRetries: 1, defaultHeaders: { "anthropic-workspace-id": "wrkspc_01ABC" } },
    ]);
  });

  it("reads the answer past the thinking, with every billed token", async () => {
    sdk.create.mockResolvedValue(
      message({ usage: { input_tokens: 100, output_tokens: 40, cache_creation_input_tokens: 5, cache_read_input_tokens: 7 } }),
    );
    expect(await anthropicProvider({ apiKey: "key" }).complete(request)).toEqual({
      text: "We wish to visit Paris and Nice.",
      model: "claude-haiku-5-5",
      inputTokens: 112,
      outputTokens: 40,
      stopReason: "DONE",
    });
  });

  it("tells a refusal and a cut-off answer apart from a whole one", async () => {
    const provider = anthropicProvider({ apiKey: "key" });
    sdk.create.mockResolvedValueOnce(message({ stop_reason: "refusal", content: [] }));
    expect(await provider.complete(request)).toMatchObject({ text: "", stopReason: "REFUSED" });
    sdk.create.mockResolvedValueOnce(message({ stop_reason: "max_tokens" }));
    expect((await provider.complete(request)).stopReason).toBe("CUT_OFF");
  });

  it("explains each failure in plain words, and says which are worth another try", async () => {
    const provider = anthropicProvider({ apiKey: "key" });
    const cases: [unknown, string, boolean][] = [
      [
        new Anthropic.AuthenticationError(401, body("authentication_error", "invalid x-api-key"), "401", new Headers()),
        "The AI service refused the key. Check ANTHROPIC_API_KEY in Backend/.env.",
        false,
      ],
      [
        new Anthropic.PermissionDeniedError(403, body("permission_error", "no access"), "403", new Headers()),
        "This key isn't allowed to use the AI model. Check its workspace in the Anthropic Console.",
        false,
      ],
      [
        new Anthropic.RateLimitError(429, body("rate_limit_error", "slow down"), "429", new Headers()),
        "The AI service is busy. Please try again in a minute.",
        true,
      ],
      [
        new Anthropic.InternalServerError(529, body("overloaded_error", "Overloaded"), "529", new Headers()),
        "The AI service is busy. Please try again in a minute.",
        true,
      ],
      [new Anthropic.APIConnectionTimeoutError(), "The AI took too long to answer. Please try again.", true],
      [
        new Anthropic.APIConnectionError({ message: "Connection error." }),
        "Couldn't reach the AI service. Check the internet connection and try again.",
        true,
      ],
      // A key with no workspace, as the project lead's first one was: Anthropic's own sentence.
      [
        new Anthropic.BadRequestError(
          400,
          body("invalid_request_error", "This API key is not scoped to a workspace."),
          "400",
          new Headers(),
        ),
        "The AI service said: This API key is not scoped to a workspace.",
        false,
      ],
      [
        new Anthropic.InternalServerError(500, body("api_error", "Internal server error"), "500", new Headers()),
        "The AI service said: Internal server error",
        true,
      ],
      [new TypeError("boom"), "The AI call failed: boom", false],
    ];
    for (const [thrown, words, retryable] of cases) {
      sdk.create.mockRejectedValueOnce(thrown);
      expect(await failureOf(provider.complete(request))).toMatchObject({ message: words, retryable });
    }
  });
});

describe("what a call costs", () => {
  it("Haiku 5.5: $0.10 a million tokens in and $0.50 out, in micro-dollars", () => {
    // A covering-letter paragraph: about $0.00075.
    expect(costMicroUsd("claude-haiku-5-5", 2_500, 1_000)).toBe(750);
    expect(costMicroUsd("claude-haiku-5-5", 0, 0)).toBe(0);
  });

  it("rounds once, half up", () => {
    // 5 tokens in: 0.5 micro-dollars; 1 in: 0.1; 1 in and 1 out: 0.6.
    expect(costMicroUsd("claude-haiku-5-5", 5, 0)).toBe(1);
    expect(costMicroUsd("claude-haiku-5-5", 1, 0)).toBe(0);
    expect(costMicroUsd("claude-haiku-5-5", 1, 1)).toBe(1);
  });

  it("a prompt over 100K tokens is billed at $0.50 / $2.50, every token of the call", () => {
    expect(costMicroUsd("claude-haiku-5-5", 100_000, 1_000)).toBe(10_500);
    expect(costMicroUsd("claude-haiku-5-5", 100_001, 1_000)).toBe(52_501);
  });

  it("knows Sonnet 5.5 and Opus 5.5, and gives no cost for a model it doesn't know", () => {
    expect(costMicroUsd("claude-sonnet-5-5", 1_000, 1_000)).toBe(12_000);
    expect(costMicroUsd("claude-opus-5-5", 1_000, 1_000)).toBe(24_000);
    expect(costMicroUsd("fake", 1_000, 1_000)).toBeNull();
  });
});

describe("askAi", () => {
  beforeEach(async () => {
    await resetDb();
    stub.provider = null;
  });

  it("asks with the use case's settings and AI_MODEL, and records the answer with its cost", async () => {
    const user = await createUser();
    stub.provider = answering({});
    const { text, callId } = await askAi({ useCase: "ai.test", system: "Be brief.", prompt: "Say hello.", userId: user.id });

    expect(text).toBe("We wish to visit Paris and Nice.");
    expect(stub.provider.complete).toHaveBeenCalledWith({
      model: "claude-haiku-5-5",
      system: "Be brief.",
      prompt: "Say hello.",
      maxTokens: 1_000,
      effort: "low",
    });
    expect(await prisma.aiCall.findUniqueOrThrow({ where: { id: callId } })).toMatchObject({
      useCase: "ai.test",
      provider: "anthropic",
      model: "claude-haiku-5-5",
      status: "OK",
      inputTokens: 2_500,
      outputTokens: 1_000,
      costMicroUsd: 750,
      error: null,
      userId: user.id,
      enquiryId: null,
    });
  });

  it("a refusal: says so, and keeps the tokens it was billed", async () => {
    stub.provider = answering({ text: "", stopReason: "REFUSED", outputTokens: 10 });
    const error = await failureOf(askAi({ useCase: "ai.test", system: "s", prompt: "p" }));
    expect(error).toMatchObject({ message: "The AI wouldn't write this one. Please write it yourself.", retryable: false });
    expect(await prisma.aiCall.findFirstOrThrow()).toMatchObject({
      status: "REFUSED",
      inputTokens: 2_500,
      outputTokens: 10,
      costMicroUsd: 255,
      error: error.message,
    });
  });

  it("a cut-off or empty answer fails, worth another try, and keeps its tokens", async () => {
    stub.provider = answering({ stopReason: "CUT_OFF" });
    expect(await failureOf(askAi({ useCase: "ai.test", system: "s", prompt: "p" }))).toMatchObject({
      message: "The AI's answer was cut off. Please try again.",
      retryable: true,
    });
    stub.provider = answering({ text: "" });
    expect(await failureOf(askAi({ useCase: "ai.test", system: "s", prompt: "p" }))).toMatchObject({
      message: "The AI gave an empty answer. Please try again.",
      retryable: true,
    });
    const calls = await prisma.aiCall.findMany();
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call).toMatchObject({ status: "FAILED", inputTokens: 2_500, costMicroUsd: 750 });
  });

  it("no answer at all: the provider's words, and no tokens", async () => {
    stub.provider = { name: "anthropic", complete: vi.fn().mockRejectedValue(new AiError("The AI service is busy. Please try again in a minute.", true)) };
    expect(await failureOf(askAi({ useCase: "ai.test", system: "s", prompt: "p" }))).toMatchObject({ retryable: true });

    stub.provider = { name: "anthropic", complete: vi.fn().mockRejectedValue(new TypeError("boom")) };
    expect(await failureOf(askAi({ useCase: "ai.test", system: "s", prompt: "p" }))).toMatchObject({
      message: "The AI call failed: boom",
      retryable: false,
    });

    const calls = await prisma.aiCall.findMany({ orderBy: { createdAt: "asc" } });
    expect(calls.map((call) => call.error)).toEqual(["The AI service is busy. Please try again in a minute.", "The AI call failed: boom"]);
    for (const call of calls) {
      expect(call).toMatchObject({ provider: "anthropic", model: "claude-haiku-5-5", status: "FAILED", inputTokens: null, costMicroUsd: null });
    }
  });

  it("while AI is off: says so, and still writes the try down", async () => {
    expect(await failureOf(askAi({ useCase: "ai.test", system: "s", prompt: "p" }))).toMatchObject({
      message: "AI isn't set up yet.",
      retryable: false,
    });
    expect(await prisma.aiCall.findFirstOrThrow()).toMatchObject({ provider: "off", status: "FAILED", inputTokens: null });
  });

  it("the fake AI: a fixed answer, with rough token counts and no cost", async () => {
    stub.provider = fakeProvider;
    const { text, callId } = await askAi({ useCase: "ai.test", system: "Be brief.", prompt: "Say hello." });
    expect(text).toBe(FAKE_ANSWER);
    const call = await prisma.aiCall.findUniqueOrThrow({ where: { id: callId } });
    expect(call).toMatchObject({ provider: "fake", model: "fake", status: "OK", costMicroUsd: null });
    expect(call.inputTokens).toBeGreaterThan(0);
  });

  it("the fake AI gives a letter it's asked to write back as it was sent", async () => {
    stub.provider = fakeProvider;
    const { text } = await askAi({ useCase: "ai.test", system: "s", prompt: "The letter:\n<letter>\nDear Sir,\n{t1Name}\n</letter>" });
    expect(text).toBe("<letter>\nDear Sir,\n{t1Name}\n</letter>");
  });

  it("passes a use case's own time limit and tries", async () => {
    stub.provider = answering({ text: "<letter>Dear Sir,</letter>" });
    await askAi({ useCase: "visa.coveringLetter.write", system: "s", prompt: "p" });
    expect(stub.provider.complete).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 8_000, effort: "medium", timeoutMs: 45_000, maxRetries: 1 }));
  });

  it("an answer the caller can't use fails as the caller says, and is recorded as failed with its tokens", async () => {
    stub.provider = answering({ text: "Here is your letter!" });
    const error = await failureOf(
      askAi({ useCase: "ai.test", system: "s", prompt: "p", accept: (text) => (text.includes("<letter>") ? null : new AiError("Not a letter.", true)) }),
    );
    expect(error).toMatchObject({ message: "Not a letter.", retryable: true });
    expect(await prisma.aiCall.findFirstOrThrow()).toMatchObject({ status: "FAILED", error: "Not a letter.", inputTokens: 2_500, costMicroUsd: 750 });

    stub.provider = answering({ text: "<letter>Dear Sir,</letter>" });
    expect((await askAi({ useCase: "ai.test", system: "s", prompt: "p", accept: () => null })).text).toBe("<letter>Dear Sir,</letter>");
  });
});

describe("choosing the provider", () => {
  it("off, fake, or Anthropic, which waits for its key", async () => {
    const { aiProvider } = await vi.importActual<typeof import("../src/lib/ai/provider")>("../src/lib/ai/provider");
    const before = { provider: env.AI_PROVIDER, key: env.ANTHROPIC_API_KEY };
    try {
      env.AI_PROVIDER = "anthropic";
      env.ANTHROPIC_API_KEY = undefined;
      expect(() => aiProvider()).toThrow("AI isn't set up yet: add ANTHROPIC_API_KEY to Backend/.env.");
      env.AI_PROVIDER = "fake";
      expect(aiProvider()).toBe(fakeProvider);
    } finally {
      env.AI_PROVIDER = before.provider;
      env.ANTHROPIC_API_KEY = before.key;
    }
  });
});

describe("the record's checks", () => {
  beforeEach(resetDb);

  const row = { useCase: "ai.test", provider: "anthropic", model: "claude-haiku-5-5", durationMs: 5 };

  it("an answer has tokens and no error; a refusal has both; a failure says why", async () => {
    await expect(prisma.aiCall.create({ data: { ...row, status: "OK", inputTokens: 1, outputTokens: 1, error: "x" } })).rejects.toThrow();
    await expect(prisma.aiCall.create({ data: { ...row, status: "OK" } })).rejects.toThrow();
    await expect(prisma.aiCall.create({ data: { ...row, status: "REFUSED", error: "No." } })).rejects.toThrow();
    await expect(prisma.aiCall.create({ data: { ...row, status: "FAILED" } })).rejects.toThrow();
    await expect(prisma.aiCall.create({ data: { ...row, status: "FAILED", error: "Busy." } })).resolves.toBeTruthy();
  });

  it("tokens in and out together, a cost only with them, nothing negative or blank", async () => {
    await expect(prisma.aiCall.create({ data: { ...row, status: "OK", inputTokens: 1 } })).rejects.toThrow();
    await expect(prisma.aiCall.create({ data: { ...row, status: "FAILED", error: "x", costMicroUsd: 1 } })).rejects.toThrow();
    await expect(prisma.aiCall.create({ data: { ...row, status: "OK", inputTokens: -1, outputTokens: 1 } })).rejects.toThrow();
    await expect(prisma.aiCall.create({ data: { ...row, useCase: " ", status: "FAILED", error: "x" } })).rejects.toThrow();
    await expect(prisma.aiCall.create({ data: { ...row, status: "FAILED", error: " " } })).rejects.toThrow();
  });
});
