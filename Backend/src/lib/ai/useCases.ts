import type { AiEffort } from "./types";

// Every use of AI in the CRM, in one list (docs/decisions/0023-ai.md Decision 4). A feature that uses AI adds its entry
// here and names it in askAi(), so each call's cost can be shown per use. All of them run on AI_MODEL.

export interface AiUseCase {
  /** What it's for, in plain words. */
  label: string;
  /** The most an answer may use, thinking included: room enough that answers aren't cut off. */
  maxTokens: number;
  effort: AiEffort;
}

export const AI_USE_CASES = {
  "ai.test": { label: "Set-up check (npm run ai:test)", maxTokens: 1_000, effort: "low" },
  /** "Write it with AI" on a visa case's covering letter (docs/decisions/0019-covering-letters.md amendment 2). */
  "visa.coveringLetter.purpose": { label: "Covering letter: why they travel", maxTokens: 3_000, effort: "medium" },
} as const satisfies Record<string, AiUseCase>;

export type AiUseCaseCode = keyof typeof AI_USE_CASES;
