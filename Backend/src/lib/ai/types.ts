// What every AI provider is given and gives back (docs/decisions/0023-ai.md). Nothing here names a provider or a model,
// so the features that use AI stay the same when Masti changes either.

/** How hard the AI thinks before it answers: more costs more and takes longer. Each use case picks one. */
export type AiEffort = "low" | "medium" | "high";

export interface AiRequest {
  /** AI_MODEL: the one model every use runs on. */
  model: string;
  /** The use case's standing instructions: how to write, what never to do. */
  system: string;
  /** What to do this time, with the details it needs. */
  prompt: string;
  /** The most the answer may use, its thinking included. */
  maxTokens: number;
  effort: AiEffort;
}

/** Why the AI stopped, in the CRM's words: the same for every provider. */
export type AiStopReason = "DONE" | "CUT_OFF" | "REFUSED";

export interface AiReply {
  /** The answer, without the model's thinking. Empty when it gave none. */
  text: string;
  /** The model that answered, as the provider names it. */
  model: string;
  /** What the provider bills: every token read, and every token written (thinking included). */
  inputTokens: number;
  outputTokens: number;
  stopReason: AiStopReason;
}

/**
 * Why the AI gave no usable answer, in plain words for the person who asked. `retryable`: asking again later may work
 * (the service was busy, out of reach, or cut the answer off). False when it can't (a wrong key, a refusal).
 */
export class AiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface AiProvider {
  /** Saved with each call, so the record shows who answered: "anthropic", "fake". */
  readonly name: string;
  /** One request, one reply. Throws an AiError when it couldn't get an answer at all. */
  complete(request: AiRequest): Promise<AiReply>;
}
