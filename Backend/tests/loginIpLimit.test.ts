import { beforeEach, describe, expect, it } from "vitest";
import { app, request, resetDb } from "./helpers";

// In its own file: it uses up this IP's login budget, which would break later login tests in the same file.
beforeEach(resetDb);

describe("login IP limit", () => {
  it("blocks an IP that cycles through made-up identifiers", async () => {
    for (let i = 0; i < 50; i++) {
      const res = await request(app).post("/api/auth/login").send({ identifier: `nobody${i}@masti.test`, password: "wrong-pass" });
      expect(res.status).toBe(401);
    }
    const blocked = await request(app).post("/api/auth/login").send({ identifier: "someone-else@masti.test", password: "wrong-pass" });
    expect(blocked.status).toBe(429);
  });
});
