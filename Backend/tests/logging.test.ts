import express from "express";
import { describe, expect, it } from "vitest";
import { istTimestamp } from "../src/lib/dates";
import { requestLogger } from "../src/lib/logger";
import { errorHandler } from "../src/middleware/error";
import { app, request } from "./helpers";

describe("server log", () => {
  it("gives every response a request code", async () => {
    const res = await request(app).get("/api/no-such-route");
    expect(res.status).toBe(404);
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f]{8}$/);
  });

  it("shows the request's code on an unexpected error, and nothing of the error itself", async () => {
    const mini = express();
    mini.use(requestLogger);
    mini.get("/boom", () => {
      throw new Error("connection to db-internal:5432 refused");
    });
    mini.use(errorHandler);

    const res = await request(mini).get("/boom");
    expect(res.status).toBe(500);
    const code = res.headers["x-request-id"] as string;
    expect(res.body.message).toBe(`Something went wrong. Please try again. If it keeps happening, quote code ${code}.`);
    expect(JSON.stringify(res.body)).not.toContain("db-internal");
  });

  it("gives each request its own code", async () => {
    const [a, b] = await Promise.all([request(app).get("/api/no-such-route"), request(app).get("/api/no-such-route")]);
    expect(a.headers["x-request-id"]).not.toBe(b.headers["x-request-id"]);
  });

  it("times lines in India time", () => {
    expect(istTimestamp(new Date("2026-10-15T07:23:23.858Z"))).toBe("2026-10-15T12:53:23.858+05:30");
    expect(istTimestamp(new Date("2026-12-31T20:00:00.000Z"))).toBe("2027-01-01T01:30:00.000+05:30");
  });
});
