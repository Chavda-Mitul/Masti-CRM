# 0010 · The server log

- **Status:** decided and built (15 Oct 2026, project lead). Alerts and uptime checks are left for deployment.
- **Date:** 15 Oct 2026
- **Scope:** what the backend writes down about its own running (requests, errors, crashes), where it keeps it and for
  how long. This is not the audit log (who changed what in the business data, golden rule 5), which stays in the
  database.

## Context

Before this, the backend printed to the terminal only: `morgan` printed one line per request, and unexpected errors went
to `console.error` without saying which request caused them. Nothing was saved, so a restart or a closed window lost it.
After go-live our access to Masti's server becomes partial (PROJECT_KNOWLEDGE §6), so when staff say "it broke", the
server has to have written down what happened.

## Decisions

1. **pino writes the log** (`src/lib/logger.ts`), with `pino-http` in place of morgan. Each line is one JSON object
   timed in India time (`"time":"2026-10-15T12:53:23.858+05:30"`). Levels are numbers: 30 info, 40 warn, 50 error,
   60 fatal.
2. **One line per request when it finishes:** method, path, status, time taken, the user's id once signed in, the IP
   (`req.ip`, so `TRUST_PROXY` must be set behind nginx) and a short **request code** (8 hex characters, also sent as
   the `X-Request-Id` header). A 500 gets the error behind it, stack included, on the same line.
3. **The user sees the code.** An unexpected error answers "Something went wrong. Please try again. If it keeps
   happening, quote code a1b2c3d4." The error's details never reach the browser. To find it:
   `grep a1b2c3d4 Backend/logs/*.log`.
4. **Personal data stays out:** no request bodies, no headers (they carry the session cookie) and no query strings
   (client searches put mobile numbers and names there). An error's own message can still name a database field or a
   storage key, so the log folder is for the people who run the server only.
5. **Crashes are written down.** An uncaught exception or unhandled promise rejection is logged as fatal, and then the
   server stops as Node would. Background failures (the session sweep, removing an unsaved upload, the dispatch email)
   are logged too.
6. **Saved by the app, one file a day,** through `pino-roll`: `Backend/logs/server.2026-10-15.1.log`. It keeps the
   last `LOG_RETENTION_DAYS` days (**90**, the project lead, 15 Oct 2026) plus today's file, counting files that
   earlier runs wrote, and deletes older ones at midnight. Other files in the folder are left alone. The app saves the
   file itself because Masti's server isn't chosen yet; this works the same on any OS.
7. **Also printed:** one readable line per request in development (like morgan was), and JSON in production, so a
   process manager or Docker can collect it as well. Tests log nothing.

| Setting (`Backend/.env`) | Default | Meaning |
| --- | --- | --- |
| `LOG_LEVEL` | `info` | `debug` or `trace` shows more; `warn` or `error` shows less |
| `LOG_DIR` | `logs` | Relative to the folder the server starts in (`Backend/`), or an absolute path |
| `LOG_RETENTION_DAYS` | `90` | Days of files kept, plus today's |

## For deployment (not built)

- Run the server with `TZ=Asia/Kolkata` so the daily files change over at India midnight and are named by the Indian
  date. The times inside each line are India time either way.
- Make sure the server can write to `LOG_DIR`, and that only the people who run the server can read it.
- **Alerts** (an email when an error happens: GlitchTip, self-hosted, or Sentry, hosted) and an **uptime check** on
  `/api/health` (for example Uptime Kuma) are still to choose, together with the server.
