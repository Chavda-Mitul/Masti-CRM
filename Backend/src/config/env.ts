import "dotenv/config";
import { z } from "zod";
import { parseTrustProxy } from "./trustProxy";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.string().min(1),
  CLIENT_URL: z.string().default("http://localhost:5173"),
  // Set when running behind a reverse proxy (nginx etc.) so req.ip is the real client IP: the hop count ("1" for one
  // nginx) or a comma-separated list of the proxies' IPs/subnets. "false" when there is no proxy. "true" is refused.
  TRUST_PROXY: z
    .string()
    .default("false")
    .transform((raw, ctx) => {
      const parsed = parseTrustProxy(raw);
      if ("error" in parsed) {
        ctx.addIssue({ code: "custom", message: parsed.error });
        return z.NEVER;
      }
      return parsed.value;
    }),
  // Sessions expire after this many idle hours, and always after SESSION_MAX_DAYS.
  SESSION_IDLE_HOURS: z.coerce.number().positive().default(12),
  SESSION_MAX_DAYS: z.coerce.number().positive().default(7),
  // A session opened with a temporary password ends after this many minutes if the password isn't changed.
  TEMP_PASSWORD_SESSION_MINUTES: z.coerce.number().positive().default(15),
  // Send the session cookie over HTTPS only. "auto" = only in production.
  // Set "false" only if the CRM is served over plain HTTP (e.g. inside the office network); the browser drops a secure cookie there and login fails.
  COOKIE_SECURE: z.enum(["auto", "true", "false"]).default("auto"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === "production";

export const cookieSecure = env.COOKIE_SECURE === "auto" ? isProduction : env.COOKIE_SECURE === "true";

if (isProduction && env.TRUST_PROXY === false) {
  console.warn(
    "TRUST_PROXY is off. Behind nginx or another proxy every user then shares the proxy's IP: the office-network rule " +
      "can't tell users apart, one IP's failed logins lock out everyone, and the audit log records the proxy. " +
      'Set TRUST_PROXY to the hop count (e.g. "1") or the proxy IPs.',
  );
}

/** Value for Express's "trust proxy" setting. */
export function trustProxySetting() {
  return env.TRUST_PROXY;
}
