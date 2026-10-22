import type { AiEffort } from "./types";

// Every use of AI in the CRM, in one list (docs/decisions/0023-ai.md Decision 4). A feature that uses AI adds its entry
// here and names it in askAi(), so each call's cost can be shown per use. All of them run on AI_MODEL.

export interface AiUseCase {
  /** What it's for, in plain words. */
  label: string;
  /** The most an answer may use, thinking included: room enough that answers aren't cut off. */
  maxTokens: number;
  effort: AiEffort;
  /** For an answer longer than a paragraph: how long one try may take, and how many more tries (the provider's own when left out). */
  timeoutMs?: number;
  maxRetries?: number;
}

export const AI_USE_CASES = {
  "ai.test": { label: "Set-up check (npm run ai:test)", maxTokens: 1_000, effort: "low" },
  /**
   * "Write the whole letter with AI" on a visa case's covering letter (docs/decisions/0019-covering-letters.md amendment
   * 4). Tried on Haiku 5.5 on 22 Oct 2026: 4–6 seconds and 700–1,400 tokens out, a 60-traveller letter included (its
   * table goes as one placeholder). The longest letter sent (15,000 characters) needs more, so 45 seconds a try.
   */
  "visa.coveringLetter.write": { label: "Covering letter: written by AI", maxTokens: 8_000, effort: "medium", timeoutMs: 45_000, maxRetries: 1 },
} as const satisfies Record<string, AiUseCase>;

export type AiUseCaseCode = keyof typeof AI_USE_CASES;
