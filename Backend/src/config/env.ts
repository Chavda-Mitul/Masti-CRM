import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.string().min(1),
  CLIENT_URL: z.string().default("http://localhost:5173"),
  // Set when running behind a reverse proxy (nginx etc.) so req.ip is the real client IP.
  // "false", "true", a hop count like "1", or a comma-separated list of trusted proxy IPs.
  TRUST_PROXY: z.string().default("false"),
  // Sessions expire after this many idle hours, and always after SESSION_MAX_DAYS.
  SESSION_IDLE_HOURS: z.coerce.number().positive().default(12),
  SESSION_MAX_DAYS: z.coerce.number().positive().default(7),
  // A session opened with a temporary password ends after this many minutes if the password isn't changed.
  TEMP_PASSWORD_SESSION_MINUTES: z.coerce.number().positive().default(15),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === "production";

/** Value for Express's "trust proxy" setting, parsed from TRUST_PROXY. */
export function trustProxySetting(): boolean | number | string {
  const value = env.TRUST_PROXY.trim();
  if (value === "true") return true;
  if (value === "false" || value === "") return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
