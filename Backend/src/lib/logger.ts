import { randomBytes } from "node:crypto";
import path from "node:path";
import type { Request, Response } from "express";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { env, isProduction } from "../config/env";
import { istTimestamp } from "./dates";

// The server log (docs/decisions/0010-server-logs.md): one JSON line per event, timed in India time. Saved as one file
// a day in LOG_DIR, keeping the newest LOG_RETENTION_DAYS files, and printed too: readable in development, JSON in
// production so a process manager can collect it as well. Tests log nothing.

function destinations() {
  const file: pino.TransportTargetOptions = {
    target: "pino-roll",
    level: env.LOG_LEVEL,
    options: {
      file: path.join(env.LOG_DIR, "server"),
      frequency: "daily",
      dateFormat: "yyyy-MM-dd",
      mkdir: true,
      // Counts the files earlier runs wrote too, so restarts don't keep old files forever.
      limit: { count: env.LOG_RETENTION_DAYS, removeOtherLogFiles: true },
    },
  };
  const terminal: pino.TransportTargetOptions = isProduction
    ? { target: "pino/file", level: env.LOG_LEVEL, options: { destination: 1 } }
    : // One line per request in the terminal, as morgan printed; the file keeps every field.
      { target: "pino-pretty", level: env.LOG_LEVEL, options: { translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname,req,res,responseTime,userId" } };
  return pino.transport({ targets: [file, terminal] });
}

export const logger =
  env.NODE_ENV === "test"
    ? pino({ level: "silent" })
    : pino({ level: env.LOG_LEVEL, timestamp: () => `,"time":"${istTimestamp()}"` }, destinations());

/** Logs each request as it finishes: method, path, status, time taken, who, and the error behind any 500. */
export const requestLogger = pinoHttp<Request, Response>({
  logger,
  // A short code for each request. A 500 shows it to the user (middleware/error.ts), so the error can be found here.
  genReqId: (_req, res) => {
    const id = randomBytes(4).toString("hex");
    res.setHeader("X-Request-Id", id);
    return id;
  },
  customProps: (req) => ({ userId: req.auth?.user.id }),
  customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : "info"),
  // One readable line, like "GET /api/visa/cases 200 12ms"; the saved line also has the fields behind it.
  customSuccessMessage: (req, res, ms) => `${req.method} ${pathOf(req)} ${res.statusCode} ${ms}ms`,
  customErrorMessage: (req, res) => `${req.method} ${pathOf(req)} ${res.statusCode} (code ${String(req.id)})`,
  serializers: {
    // No headers: they carry the session cookie. The IP is req.ip, so behind nginx it's the user's (TRUST_PROXY).
    req: (req: { id: string; method: string; raw: Request }) => ({ id: req.id, method: req.method, url: pathOf(req.raw), ip: req.raw.ip }),
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
  },
});

/** The path without its query string: client searches put mobile numbers and names there. */
function pathOf(req: Request) {
  return req.originalUrl.split("?")[0];
}
