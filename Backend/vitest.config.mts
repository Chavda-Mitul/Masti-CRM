import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { defineConfig } from "vitest/config";

// Tests use their own database and their own document bucket from .env.test (see .env.test.example). Values here win
// over .env, which still gives the MinIO address and keys.
if (!existsSync(".env.test")) {
  throw new Error("Missing Backend/.env.test — copy .env.test.example and point DATABASE_URL at a throwaway database.");
}
const fromFile = parse(readFileSync(".env.test"));
// Email goes to Mailpit from docker compose (npm run db:up), never to a real server: tests clear it and read it back.
const testEnv = {
  ...fromFile,
  S3_BUCKET: fromFile.S3_BUCKET ?? "masti-crm-test",
  SMTP_HOST: fromFile.SMTP_HOST ?? "localhost",
  SMTP_PORT: fromFile.SMTP_PORT ?? "1025",
  SMTP_SECURE: "false",
  SMTP_USER: "",
  SMTP_PASSWORD: "",
  SMTP_FROM: fromFile.SMTP_FROM ?? "Masti CRM test <crm@masti.test>",
  MAILPIT_URL: fromFile.MAILPIT_URL ?? "http://localhost:8025",
  // WhatsApp never leaves a test run, whatever .env says: tests check the providers on their own.
  WHATSAPP_PROVIDER: "off",
  TWILIO_ACCOUNT_SID: "",
  TWILIO_AUTH_TOKEN: "",
  TWILIO_WHATSAPP_FROM: "",
  WHATSAPP_TEST_NUMBER: "",
  // Nor does AI: tests check the providers with a stand-in for Anthropic (docs/decisions/0023-ai.md).
  AI_PROVIDER: "off",
  AI_MODEL: "claude-haiku-5-5",
  ANTHROPIC_API_KEY: "",
  ANTHROPIC_WORKSPACE_ID: "",
  NODE_ENV: "test",
  DOTENV_CONFIG_QUIET: "true",
};
if (!/test/i.test(testEnv.DATABASE_URL ?? "")) {
  throw new Error("Refusing to run: the test DATABASE_URL must point at a database with 'test' in its name.");
}
if (!/test/i.test(testEnv.S3_BUCKET)) {
  throw new Error("Refusing to run: the test S3_BUCKET must have 'test' in its name. Tests empty it.");
}
if (!["localhost", "127.0.0.1", "::1"].includes(testEnv.SMTP_HOST)) {
  throw new Error("Refusing to run: tests send email, so SMTP_HOST must be the local Mailpit (localhost).");
}
Object.assign(process.env, testEnv);

export default defineConfig({
  test: {
    env: testEnv,
    globalSetup: ["tests/globalSetup.ts"],
    // Starts pg-boss (without workers) for each file: saves queue jobs (docs/decisions/0021-whatsapp-outbox.md).
    setupFiles: ["tests/setup.ts"],
    // One shared database, wiped between tests, so test files must not run in parallel.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
