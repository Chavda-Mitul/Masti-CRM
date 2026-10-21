import type { AiProvider } from "./types";

// AI_PROVIDER=fake: a fixed answer instead of a real AI, so a laptop can run every AI feature with no key and no bill,
// as WHATSAPP_PROVIDER=log does for WhatsApp (docs/decisions/0023-ai.md). Its model, "fake", has no price.

export const FAKE_ANSWER =
  "This text comes from the fake AI (AI_PROVIDER=fake), not a real one. Set AI_PROVIDER=anthropic in Backend/.env for a real answer.";

export const fakeProvider: AiProvider = {
  name: "fake",
  async complete(request) {
    return {
      text: FAKE_ANSWER,
      model: "fake",
      inputTokens: roughTokens(request.system) + roughTokens(request.prompt),
      outputTokens: roughTokens(FAKE_ANSWER),
      stopReason: "DONE",
    };
  },
};

/** About 4 characters a token: enough to see the numbers move. */
function roughTokens(text: string) {
  return Math.ceil(text.length / 4);
}
