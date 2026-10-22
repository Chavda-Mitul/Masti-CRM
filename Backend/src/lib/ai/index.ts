import type { AiCall, AiCallStatus } from "../../../generated/prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { logger } from "../logger";
import { costMicroUsd } from "./prices";
import { aiProvider } from "./provider";
import { AiError, type AiReply } from "./types";
import { AI_USE_CASES, type AiUseCase, type AiUseCaseCode } from "./useCases";

// The only way the CRM uses AI (docs/decisions/0023-ai.md). Callers say what it's for and what to ask; AI_PROVIDER and
// AI_MODEL in .env pick who answers, with which model. Every call is written down in AiCall with its tokens and cost,
// whatever the outcome. Never call it inside a database transaction: an answer can take seconds.

export { aiProvider } from "./provider";
export { AiError, type AiProvider, type AiReply, type AiRequest } from "./types";
export { AI_USE_CASES, type AiUseCaseCode } from "./useCases";

export interface AiAsk {
  useCase: AiUseCaseCode;
  /** The standing instructions for this use: how to write, what never to do. */
  system: string;
  /** What to do this time. Only the details the answer needs: never a passport number. */
  prompt: string;
  /** Who asked, when a person did. */
  userId?: string;
  /** The case it's for, when there is one. */
  enquiryId?: string;
  /**
   * Whether the answer can be used: an AiError says why not, and the call is then recorded as failed, not as an answer
   * (a letter that isn't one). Checked after the provider's own reasons (a refusal, a cut-off, nothing at all).
   */
  accept?: (text: string) => AiError | null;
}

/** Asks the AI once. Returns its answer, or throws an AiError in plain words; either way the call is recorded. */
export async function askAi(ask: AiAsk): Promise<{ text: string; callId: string }> {
  const useCase: AiUseCase = AI_USE_CASES[ask.useCase];
  const { maxTokens, effort, timeoutMs, maxRetries } = useCase;
  const started = Date.now();
  let provider: string = env.AI_PROVIDER;
  let reply: AiReply;
  try {
    const chosen = aiProvider();
    if (!chosen) throw new AiError("AI isn't set up yet.", false);
    provider = chosen.name;
    reply = await chosen.complete({
      model: env.AI_MODEL,
      system: ask.system,
      prompt: ask.prompt,
      maxTokens,
      effort,
      ...(timeoutMs !== undefined && { timeoutMs }),
      ...(maxRetries !== undefined && { maxRetries }),
    });
  } catch (error) {
    const failure =
      error instanceof AiError
        ? error
        : new AiError(`The AI call failed: ${error instanceof Error ? error.message : String(error)}`, false, { cause: error });
    await record(ask, { provider, model: env.AI_MODEL, status: "FAILED", error: failure.message, started });
    throw failure;
  }

  // Billed whatever it said, so a refusal or a cut-off answer keeps its tokens and cost too.
  const billed = {
    provider,
    model: reply.model,
    inputTokens: reply.inputTokens,
    outputTokens: reply.outputTokens,
    costMicroUsd: costMicroUsd(reply.model, reply.inputTokens, reply.outputTokens),
    started,
  };
  let failure: AiError | null = null;
  if (reply.stopReason === "REFUSED") {
    failure = new AiError("The AI wouldn't write this one. Please write it yourself.", false);
  } else if (reply.stopReason === "CUT_OFF") {
    failure = new AiError("The AI's answer was cut off. Please try again.", true);
  } else if (!reply.text) {
    failure = new AiError("The AI gave an empty answer. Please try again.", true);
  } else if (ask.accept) {
    failure = ask.accept(reply.text);
  }
  if (failure) {
    await record(ask, { ...billed, status: reply.stopReason === "REFUSED" ? "REFUSED" : "FAILED", error: failure.message });
    throw failure;
  }
  const call = await record(ask, { ...billed, status: "OK", error: null });
  return { text: reply.text, callId: call.id };
}

interface CallOutcome {
  provider: string;
  model: string;
  status: AiCallStatus;
  error: string | null;
  inputTokens?: number;
  outputTokens?: number;
  costMicroUsd?: number | null;
  /** Date.now() when the call began. */
  started: number;
}

/** Writes the call down, and one line in the server log: never the prompt or the answer, which hold client details. */
async function record(ask: AiAsk, { started, ...outcome }: CallOutcome): Promise<AiCall> {
  const call = await prisma.aiCall.create({
    data: {
      useCase: ask.useCase,
      provider: outcome.provider,
      model: outcome.model,
      status: outcome.status,
      inputTokens: outcome.inputTokens ?? null,
      outputTokens: outcome.outputTokens ?? null,
      costMicroUsd: outcome.costMicroUsd ?? null,
      durationMs: Date.now() - started,
      error: outcome.error,
      userId: ask.userId ?? null,
      enquiryId: ask.enquiryId ?? null,
    },
  });
  const { id, useCase, provider, model, status, inputTokens, outputTokens, durationMs, error } = call;
  const line = { ai: { id, useCase, provider, model, status, inputTokens, outputTokens, costMicroUsd: call.costMicroUsd, durationMs } };
  if (status === "OK") logger.info(line, `AI ${useCase}: answered`);
  else logger.warn({ ...line, error }, `AI ${useCase}: ${status === "REFUSED" ? "refused" : "failed"}`);
  return call;
}
