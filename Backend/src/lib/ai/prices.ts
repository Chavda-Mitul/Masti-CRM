// What each model costs, in micro-dollars ($0.000001) per million tokens: whole numbers, as money is whole paise
// (docs/decisions/0023-ai.md Decision 8). Anthropic bills in dollars, so no exchange rate is kept: reports convert.
// Checked against Anthropic's price list on 21 Oct 2026. A model missing here still has its tokens recorded, with no cost.
// The CRM doesn't use prompt caching, so its cheaper rates aren't here.

interface Rates {
  input: number;
  output: number;
}

interface ModelPrice {
  rates: Rates;
  /** Dearer rates for every token of a call whose prompt is longer than `aboveTokens`. */
  longPrompt?: { aboveTokens: number; rates: Rates };
}

const PRICES: Record<string, ModelPrice> = {
  "claude-haiku-5-5": {
    rates: { input: 100_000, output: 500_000 },
    longPrompt: { aboveTokens: 100_000, rates: { input: 500_000, output: 2_500_000 } },
  },
  "claude-sonnet-5-5": { rates: { input: 2_000_000, output: 10_000_000 } },
  "claude-opus-5-5": { rates: { input: 4_000_000, output: 20_000_000 } },
};

/** What one call cost in micro-dollars, rounded half up once; null for a model with no price here. */
export function costMicroUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const { input, output } =
    price.longPrompt && inputTokens > price.longPrompt.aboveTokens ? price.longPrompt.rates : price.rates;
  return Math.floor((inputTokens * input + outputTokens * output + 500_000) / 1_000_000);
}
