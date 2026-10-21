import { randomBytes } from "node:crypto";
import { beforeEach, expect, it } from "vitest";
import { redeemLimitStore } from "../src/modules/portalLogins/portalHelper.routes";
import { app, request, resetDb } from "./helpers";

// Collecting a portal's login is limited to 20 failures per 15 minutes from one address (docs/decisions/0024-portal-logins.md).

beforeEach(async () => {
  await resetDb();
  redeemLimitStore.resetAll();
});

it("stops guessing tickets after 20 failures", async () => {
  const guess = () =>
    request(app)
      .post("/api/portal-helper/redeem")
      .set("Origin", "chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh")
      .send({ ticket: randomBytes(32).toString("base64url") });
  for (let i = 0; i < 20; i++) expect((await guess()).status).toBe(410);
  const blocked = await guess();
  expect(blocked.status).toBe(429);
  expect(blocked.body.message).toMatch(/Too many tries/);
});
