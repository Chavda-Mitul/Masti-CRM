import "dotenv/config";
import { z } from "zod";
import { normaliseMobile } from "../lib/contact";
import { parseTrustProxy } from "./trustProxy";
import { parseHelperIds, parseVaultKey } from "./vaultKey";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.string().min(1),
  CLIENT_URL: z.string().default("http://localhost:5173"),
  // The address clients open links on, e.g. the consent form's (docs/decisions/0022-consent-form.md): Masti's own
  // https address in production. A phone can't open localhost: on a laptop, open the link there, or use the laptop's LAN
  // address with `vite --host`. WhatsApp's provider also fetches a message's file there (docs/decisions/0025-evisa-after-
  // decision.md, part 2), so in production it must be reachable from the internet.
  PUBLIC_APP_URL: z.url("A full address, e.g. https://crm.example.com").default("http://localhost:5173"),
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
  // S3-compatible document storage (CLAUDE.md rule 4): MinIO locally, AWS S3 or Cloudflare R2 in production. The bucket
  // is private; files are opened through pre-signed links that point at S3_ENDPOINT, so staff browsers must reach it.
  S3_ENDPOINT: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  // MinIO needs path-style URLs (http://host:9000/bucket/key); AWS and R2 don't.
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  // How long a pre-signed link to a document works. ⚠️ 5 minutes.
  S3_PRESIGN_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  // Outgoing email (the dispatch email to the vendor, 0008 Decision 8), through src/lib/email.ts only. Masti's own SMTP
  // account in production (A6); Mailpit from docker compose locally (localhost:1025). With no SMTP_HOST nothing is sent
  // and the dispatch card says "Email isn't set up yet".
  SMTP_HOST: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  // "true" for implicit TLS (usually port 465); "false" upgrades with STARTTLS when the server offers it.
  SMTP_SECURE: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  SMTP_USER: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  SMTP_PASSWORD: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  // The sender, e.g. "MASTI TOUR AND TRAVEL <crm@example.com>".
  SMTP_FROM: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  // WhatsApp to clients (CLAUDE.md rule 7, docs/decisions/0020-whatsapp-sending.md), through src/lib/whatsapp only.
  // "twilio" sends through Twilio (its sandbox while we build); "log" writes each message to the server log instead, for
  // a laptop with no WhatsApp account; "off" sends nothing ("WhatsApp isn't set up yet").
  WHATSAPP_PROVIDER: z.enum(["off", "log", "twilio"]).default("off"),
  // From the Twilio Console's Account Info; needed when WHATSAPP_PROVIDER is twilio.
  TWILIO_ACCOUNT_SID: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().regex(/^AC[0-9a-f]{32}$/i, "Starts with AC: copy it from the Twilio Console's Account Info.").optional(),
  ),
  TWILIO_AUTH_TOKEN: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  // The WhatsApp number messages come from, with + and the country code: +14155238886 is Twilio's sandbox.
  TWILIO_WHATSAPP_FROM: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().regex(/^\+[1-9]\d{6,14}$/, "The number with + and the country code, e.g. +14155238886.").optional(),
  ),
  // Outside production every client message goes to this phone instead (docs/decisions/0021-whatsapp-outbox.md): yours,
  // joined to the Twilio sandbox. Needed outside production when WHATSAPP_PROVIDER is twilio; refused in production.
  WHATSAPP_TEST_NUMBER: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .transform((raw, ctx) => {
        const mobile = normaliseMobile(raw);
        if (!mobile) {
          ctx.addIssue({ code: "custom", message: "A 10-digit Indian mobile number, e.g. 98250 41234." });
          return z.NEVER;
        }
        return mobile;
      })
      .optional(),
  ),
  // AI (docs/decisions/0023-ai.md), through src/lib/ai only. "anthropic" asks Anthropic's API with ANTHROPIC_API_KEY;
  // "fake" gives a fixed answer, for a laptop with no key; "off" uses no AI ("AI isn't set up yet").
  AI_PROVIDER: z.enum(["off", "fake", "anthropic"]).default("off"),
  // The one model every AI use runs on: Claude Haiku 5.5 (the project lead, 21 Oct 2026). src/lib/ai/prices.ts must
  // know its price, or calls are recorded without a cost.
  AI_MODEL: z.preprocess((v) => (v === "" ? undefined : v), z.string().default("claude-haiku-5-5")),
  // A key made inside a workspace (Anthropic Console → Settings → Workspaces → API keys); needed when AI_PROVIDER is
  // anthropic. Never committed.
  ANTHROPIC_API_KEY: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  // Only for a user key (sk-ant-usr-…), which isn't tied to a workspace: the workspace its calls are billed to,
  // Anthropic Console → Settings → Workspaces. Not a secret.
  ANTHROPIC_WORKSPACE_ID: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().regex(/^wrkspc_[A-Za-z0-9]+$/, "Starts with wrkspc_: copy it from the Anthropic Console's Settings → Workspaces.").optional(),
  ),
  // Portal logins (docs/decisions/0024-portal-logins.md): the key that locks every saved portal ID and password, 32
  // random bytes in base64. Production refuses to start without it; elsewhere, without it, Portal logins say they
  // aren't set up. Back it up apart from the database, and never change it once logins are saved: they can't be read
  // with another key.
  PORTAL_VAULT_KEY: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .transform((raw, ctx) => {
        const parsed = parseVaultKey(raw);
        if ("error" in parsed) {
          ctx.addIssue({ code: "custom", message: parsed.error });
          return z.NEVER;
        }
        return parsed.value;
      })
      .optional(),
  ),
  // The CRM helper's Chrome extension ID(s), comma-separated: only the helper may collect a portal's login.
  PORTAL_HELPER_IDS: z
    .string()
    .default("")
    .transform((raw, ctx) => {
      const parsed = parseHelperIds(raw);
      if ("error" in parsed) {
        ctx.addIssue({ code: "custom", message: parsed.error });
        return z.NEVER;
      }
      return parsed.value;
    }),
  // The server log (src/lib/logger.ts, docs/decisions/0010-server-logs.md): one file a day in LOG_DIR (relative to the
  // folder the server starts in, Backend/), keeping the last LOG_RETENTION_DAYS days plus today's file (90: the project
  // lead, 15 Oct 2026).
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  LOG_DIR: z.string().min(1).default("logs"),
  LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
}).superRefine((e, ctx) => {
  // A laptop must never message a real client, and production must never send every client's message to one phone.
  if (e.NODE_ENV === "production" && e.WHATSAPP_TEST_NUMBER) {
    ctx.addIssue({
      code: "custom",
      path: ["WHATSAPP_TEST_NUMBER"],
      message: "Leave it empty in production: every client's message would go to this number.",
    });
  }
  if (e.NODE_ENV === "production" && !e.PORTAL_VAULT_KEY) {
    ctx.addIssue({
      code: "custom",
      path: ["PORTAL_VAULT_KEY"],
      message: "Set it in production: portal logins can't be saved or used without it (see .env.example).",
    });
  }
  if (e.NODE_ENV !== "production" && e.WHATSAPP_PROVIDER === "twilio" && !e.WHATSAPP_TEST_NUMBER) {
    ctx.addIssue({
      code: "custom",
      path: ["WHATSAPP_TEST_NUMBER"],
      message: "Outside production, set the phone that gets every message instead of the client: yours, joined to the sandbox.",
    });
  }
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

if (isProduction && env.WHATSAPP_PROVIDER === "log") {
  console.warn("WHATSAPP_PROVIDER is log: WhatsApp messages go into the server log, and clients get nothing.");
}
if (isProduction && !env.PUBLIC_APP_URL.startsWith("https://")) {
  console.warn("PUBLIC_APP_URL isn't https: the consent links sent to clients would open over an unprotected connection.");
}
if (isProduction && env.WHATSAPP_PROVIDER === "off") {
  console.warn("WHATSAPP_PROVIDER is off: clients get no WhatsApp messages, and each one is marked failed.");
}

if (isProduction && env.AI_PROVIDER === "fake") {
  console.warn("AI_PROVIDER is fake: every AI answer is a fixed text, not a real one.");
}
if (isProduction && env.AI_PROVIDER === "off") {
  console.warn("AI_PROVIDER is off: everything that uses AI says it isn't set up yet.");
}

if (isProduction && env.PORTAL_HELPER_IDS.length === 0) {
  console.warn("PORTAL_HELPER_IDS is empty: Log in for me can't work until the CRM helper's extension ID is set.");
}

/** Value for Express's "trust proxy" setting. */
export function trustProxySetting() {
  return env.TRUST_PROXY;
}
