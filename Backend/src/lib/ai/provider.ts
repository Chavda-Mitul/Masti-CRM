import { env } from "../../config/env";
import { anthropicProvider } from "./anthropic";
import { fakeProvider } from "./fake";
import { AiError, type AiProvider } from "./types";

// AI_PROVIDER in .env picks who answers (docs/decisions/0023-ai.md Decision 2). Another provider is one more file in
// this folder, one more case below and one more name in env.ts. In a file of its own so tests can swap it.

let chosen: AiProvider | null | undefined;

/** The provider AI_PROVIDER names, made on first use. Null while AI is off. */
export function aiProvider(): AiProvider | null {
  if (chosen === undefined) chosen = pick();
  return chosen;
}

function pick(): AiProvider | null {
  switch (env.AI_PROVIDER) {
    case "off":
      return null;
    case "fake":
      return fakeProvider;
    case "anthropic": {
      // Not checked at start-up, so the CRM still starts without a key, and only AI waits for one (as Twilio's keys).
      if (!env.ANTHROPIC_API_KEY) throw new AiError("AI isn't set up yet: add ANTHROPIC_API_KEY to Backend/.env.", false);
      return anthropicProvider({
        apiKey: env.ANTHROPIC_API_KEY,
        ...(env.ANTHROPIC_WORKSPACE_ID ? { workspaceId: env.ANTHROPIC_WORKSPACE_ID } : {}),
      });
    }
  }
}
