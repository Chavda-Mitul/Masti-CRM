import type { AiProvider } from "./types";

// AI_PROVIDER=fake: a fixed answer instead of a real AI, so a laptop can run every AI feature with no key and no bill,
// as WHATSAPP_PROVIDER=log does for WhatsApp (docs/decisions/0023-ai.md). Its model, "fake", has no price.
// A letter it's asked to write (between <letter> and </letter>) comes back as it was sent, so "Write the whole letter
// with AI" runs too (docs/decisions/0019-covering-letters.md amendment 4).

export const FAKE_ANSWER =
  "This text comes from the fake AI (AI_PROVIDER=fake), not a real one. Set AI_PROVIDER=anthropic in Backend/.env for a real answer.";

export const fakeProvider: AiProvider = {
  name: "fake",
  async complete(request) {
    const text = /<letter>[\s\S]*?<\/letter>/.exec(request.prompt)?.[0] ?? FAKE_ANSWER;
    return {
      text,
      model: "fake",
      inputTokens: roughTokens(request.system) + roughTokens(request.prompt),
      outputTokens: roughTokens(text),
      stopReason: "DONE",
    };
  },
};

/** About 4 characters a token: enough to see the numbers move. */
function roughTokens(text: string) {
  return Math.ceil(text.length / 4);
}
