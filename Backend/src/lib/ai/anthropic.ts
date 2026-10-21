import Anthropic from "@anthropic-ai/sdk";
import { AiError, type AiProvider, type AiStopReason } from "./types";

// AI through Anthropic's API, with its official SDK (docs/decisions/0023-ai.md). Everything Anthropic-specific stays in
// this file.

export interface AnthropicSettings {
  apiKey: string;
  /**
   * For a user key (sk-ant-usr-…), which belongs to no workspace: Anthropic refuses its calls unless each one names
   * the workspace to bill (checked 21 Oct 2026). A key made inside a workspace needs none.
   */
  workspaceId?: string;
}

/**
 * Someone is waiting on the answer, so give up after 30 seconds and try once more. The SDK repeats a timeout, a busy
 * or overloaded answer and a dropped connection by itself.
 */
const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 1;

export function anthropicProvider(settings: AnthropicSettings): AiProvider {
  const client = new Anthropic({
    apiKey: settings.apiKey,
    timeout: TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
    ...(settings.workspaceId ? { defaultHeaders: { "anthropic-workspace-id": settings.workspaceId } } : {}),
  });
  return {
    name: "anthropic",
    async complete(request) {
      let message;
      try {
        // No temperature, top_p or top_k, and no half-written answer to continue: Haiku 5.5 refuses them. Its thinking
        // stays at the default, and the effort sets how much of it there is.
        message = await client.messages.create({
          model: request.model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: [{ role: "user", content: request.prompt }],
          output_config: { effort: request.effort },
        });
      } catch (error) {
        throw errorFor(error);
      }
      const { usage } = message;
      return {
        // An answer can start with thinking blocks: only the text blocks are the answer.
        text: message.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("")
          .trim(),
        model: message.model,
        inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
        outputTokens: usage.output_tokens,
        stopReason: stopReasonOf(message.stop_reason),
      };
    },
  };
}

function stopReasonOf(reason: Anthropic.StopReason | null): AiStopReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "DONE";
    case "refusal":
      return "REFUSED";
    default:
      // max_tokens, the context window full, or a tool call or pause we never ask for: no whole answer.
      return "CUT_OFF";
  }
}

/** The SDK's errors in plain words. Most specific first: a connection error is also an APIError. */
function errorFor(error: unknown): AiError {
  const options = { cause: error };
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiError("The AI took too long to answer. Please try again.", true, options);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiError("Couldn't reach the AI service. Check the internet connection and try again.", true, options);
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new AiError("The AI service refused the key. Check ANTHROPIC_API_KEY in Backend/.env.", false, options);
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new AiError("This key isn't allowed to use the AI model. Check its workspace in the Anthropic Console.", false, options);
  }
  // 529: Anthropic is overloaded.
  if (error instanceof Anthropic.RateLimitError || (error instanceof Anthropic.APIError && error.status === 529)) {
    return new AiError("The AI service is busy. Please try again in a minute.", true, options);
  }
  if (error instanceof Anthropic.APIError) {
    // Anthropic's own sentence when it gives one ("This API key is not scoped to a workspace…"), else the SDK's.
    const said = (error.error as { error?: { message?: unknown } } | undefined)?.error?.message;
    const retryable = error.status === undefined || error.status >= 500;
    return new AiError(`The AI service said: ${typeof said === "string" ? said : error.message}`, retryable, options);
  }
  const text = error instanceof Error ? error.message : String(error);
  return new AiError(`The AI call failed: ${text}`, false, options);
}
