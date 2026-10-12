import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { defineConfig } from "vitest/config";

// Tests use their own database and their own document bucket from .env.test (see .env.test.example). Values here win
// over .env, which still gives the MinIO address and keys.
if (!existsSync(".env.test")) {
  throw new Error("Missing Backend/.env.test — copy .env.test.example and point DATABASE_URL at a throwaway database.");
}
const fromFile = parse(readFileSync(".env.test"));
const testEnv = { ...fromFile, S3_BUCKET: fromFile.S3_BUCKET ?? "masti-crm-test", NODE_ENV: "test", DOTENV_CONFIG_QUIET: "true" };
if (!/test/i.test(testEnv.DATABASE_URL ?? "")) {
  throw new Error("Refusing to run: the test DATABASE_URL must point at a database with 'test' in its name.");
}
if (!/test/i.test(testEnv.S3_BUCKET)) {
  throw new Error("Refusing to run: the test S3_BUCKET must have 'test' in its name. Tests empty it.");
}
Object.assign(process.env, testEnv);

export default defineConfig({
  test: {
    env: testEnv,
    globalSetup: ["tests/globalSetup.ts"],
    // One shared database, wiped between tests, so test files must not run in parallel.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
