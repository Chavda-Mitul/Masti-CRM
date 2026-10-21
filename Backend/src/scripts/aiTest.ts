import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { AiError, askAi } from "../lib/ai";

// npm run ai:test
// Asks the AI for one short sentence through AI_PROVIDER and AI_MODEL, to check the set-up (docs/decisions/0023-ai.md).
// The call is recorded in AiCall like any other, so the database must be running (npm run db:up). On a server:
// node dist/src/scripts/aiTest.js

async function main(): Promise<number> {
  console.log(`Asking ${env.AI_PROVIDER} (${env.AI_MODEL})…`);
  try {
    const { text, callId } = await askAi({
      useCase: "ai.test",
      system: "You answer in one short, friendly sentence.",
      prompt: "Say hello to the team at Masti Tours & Travels in Surat.",
    });
    const call = await prisma.aiCall.findUniqueOrThrow({ where: { id: callId } });
    console.log(`\n${text}\n`);
    const cost = call.costMicroUsd === null ? "no price for this model" : `$${(call.costMicroUsd / 1_000_000).toFixed(6)}`;
    console.log(`${call.model} · ${call.inputTokens} tokens in, ${call.outputTokens} out · ${cost} · ${call.durationMs} ms`);
    return 0;
  } catch (error) {
    if (error instanceof AiError) {
      console.error(error.message);
      return 1;
    }
    // askAi writes every call down, so anything else is most likely the database.
    console.error("The call couldn't be recorded. Is the database running (npm run db:up)?");
    throw error;
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
