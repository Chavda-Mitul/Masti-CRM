import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { parseTrustProxy } from "../src/config/trustProxy";

describe("TRUST_PROXY", () => {
  it("accepts off, a hop count, or proxy addresses and subnets", () => {
    for (const off of ["", "false", " FALSE ", "0"]) expect(parseTrustProxy(off)).toEqual({ value: false });
    expect(parseTrustProxy("1")).toEqual({ value: 1 });
    expect(parseTrustProxy("10.0.0.5, 10.1.0.0/16,::1,loopback")).toEqual({ value: ["10.0.0.5", "10.1.0.0/16", "::1", "loopback"] });
  });

  it("refuses true, which trusts a header any browser can fake", () => {
    expect(parseTrustProxy("true")).toMatchObject({ error: expect.stringMatching(/fake/) });
    expect(parseTrustProxy(" True ")).toHaveProperty("error");
  });

  it("refuses entries that aren't addresses or subnets", () => {
    for (const bad of ["yes", "10.0.0.0/", "10.0.0.0/33", "10.0.0.0/abc", "::1/129", "nginx", "1.2.3.4/8/8", "99"]) {
      expect(parseTrustProxy(bad), bad).toHaveProperty("error");
    }
  });

  it("with a hop count, ignores what the browser puts at the front of X-Forwarded-For", async () => {
    const parsed = parseTrustProxy("1");
    if (!("value" in parsed)) throw new Error(parsed.error);
    const app = express().set("trust proxy", parsed.value);
    app.get("/ip", (req, res) => res.json({ ip: req.ip }));

    // The browser sends "203.0.113.10" (an office IP, say); nginx appends the address it really saw.
    const res = await request(app).get("/ip").set("X-Forwarded-For", "203.0.113.10, 198.51.100.7");
    expect(res.body.ip).toBe("198.51.100.7");
  });
});
