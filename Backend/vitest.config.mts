import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { defineConfig } from "vitest/config";

// Tests use their own database from .env.test (see .env.test.example). Values here win over .env.
if (!existsSync(".env.test")) {
  throw new Error("Missing Backend/.env.test — copy .env.test.example and point DATABASE_URL at a throwaway database.");
}
const testEnv = { ...parse(readFileSync(".env.test")), NODE_ENV: "test", DOTENV_CONFIG_QUIET: "true" };
if (!/test/i.test(testEnv.DATABASE_URL ?? "")) {
  throw new Error("Refusing to run: the test DATABASE_URL must point at a database with 'test' in its name.");
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
