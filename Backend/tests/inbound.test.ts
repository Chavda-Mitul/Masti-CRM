import { beforeEach, describe, expect, it } from "vitest";
import { addDays, istToday } from "../src/lib/dates";
import { isDateBlocked } from "../src/modules/holidays/blockedDays";
import { generateApiKey } from "../src/modules/apiClients/apiKey";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
});

type Agent = Awaited<ReturnType<typeof loginAs>>;

const day = (n: number) => addDays(istToday(), n);

async function headAgent() {
  await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
  return loginAs("vimal@masti.test");
}

/** Creates a machine account through the API and returns its one-time key. */
async function botKey(head: Agent, body: Record<string, unknown> = {}) {
  const res = await head.post("/api/api-clients").send({ name: "Holiday bot", scopes: ["HOLIDAYS_PUSH"], ...body });
  if (res.status !== 201) throw new Error(`create failed (${res.status}): ${JSON.stringify(res.body)}`);
  return { key: res.body.key as string, client: res.body.client };
}

const push = (key: string, body: object) => request(app).post("/api/inbound/holidays").set("Authorization", `Bearer ${key}`).send(body);

const nationalDay = (overrides: Record<string, unknown> = {}) => ({
  externalKey: "cn-embassy-national-day",
  name: "National Day week",
  startDate: day(5),
  endDate: day(11),
  targets: [{ kind: "COUNTRY", countryCode: "cn" }],
  reference: "https://example.test/notice",
  ...overrides,
});

describe("machine accounts", () => {
  it("are managed by the Head only", async () => {
    await createUser({ email: "hod@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await loginAs("hod@masti.test");
    expect((await hod.get("/api/api-clients")).status).toBe(403);
    expect((await hod.post("/api/api-clients").send({ name: "Bot", scopes: ["HOLIDAYS_PUSH"] })).status).toBe(403);
  });

  it("show the key once, store only its hash, and never audit it", async () => {
    const head = await headAgent();
    const { key, client } = await botKey(head, { allowedIps: ["203.0.113.0/24"] });
    expect(key).toMatch(/^mcrm_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/);
    expect(client).toMatchObject({ name: "Holiday bot", scopes: ["HOLIDAYS_PUSH"], allowedIps: ["203.0.113.0/24"], isActive: true });
    expect(client.keyPrefix).toBe(`${key.slice(0, 13)}_…`);

    const list = await head.get("/api/api-clients");
    expect(JSON.stringify(list.body)).not.toContain(key);
    const row = await prisma.apiClient.findFirstOrThrow();
    expect(row.keyHash).not.toContain(key.slice(14));
    const audits = JSON.stringify(await prisma.auditLog.findMany({ where: { entityType: "ApiClient" } }), (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
    expect(audits).not.toContain(key);
    expect(audits).not.toContain(row.keyHash);
  });

  it("refuse a bad IP entry, a repeated name, and no permissions", async () => {
    const head = await headAgent();
    await botKey(head);
    expect((await head.post("/api/api-clients").send({ name: "Holiday bot", scopes: ["HOLIDAYS_PUSH"] })).status).toBe(409);
    expect((await head.post("/api/api-clients").send({ name: "Other", scopes: ["HOLIDAYS_PUSH"], allowedIps: ["office"] })).status).toBe(400);
    expect((await head.post("/api/api-clients").send({ name: "Other", scopes: ["HOLIDAYS_PUSH"], allowedIps: ["10.0.0.0/33"] })).status).toBe(400);
    expect((await head.post("/api/api-clients").send({ name: "Other", scopes: [] })).status).toBe(400);
  });
});

describe("machine authentication", () => {
  it("needs a valid, active key", async () => {
    const head = await headAgent();
    const { key, client } = await botKey(head);

    expect((await request(app).get("/api/inbound/holidays/targets")).status).toBe(401);
    expect((await request(app).get("/api/inbound/holidays/targets").set("Authorization", `Bearer ${generateApiKey().key}`)).status).toBe(401);
    expect((await request(app).get("/api/inbound/holidays/targets").set("Authorization", "Bearer not-a-key")).status).toBe(401);
    expect((await request(app).get("/api/inbound/holidays/targets").set("Authorization", `Bearer ${key}`)).status).toBe(200);

    await head.post(`/api/api-clients/${client.id}/deactivate`).send({});
    expect((await request(app).get("/api/inbound/holidays/targets").set("Authorization", `Bearer ${key}`)).status).toBe(401);
    await head.post(`/api/api-clients/${client.id}/activate`).send({});
    expect((await request(app).get("/api/inbound/holidays/targets").set("Authorization", `Bearer ${key}`)).status).toBe(200);

    const rotated = await head.post(`/api/api-clients/${client.id}/rotate`).send({});
    expect(rotated.status).toBe(200);
    expect((await request(app).get("/api/inbound/holidays/targets").set("Authorization", `Bearer ${key}`)).status).toBe(401);
    expect((await request(app).get("/api/inbound/holidays/targets").set("Authorization", `Bearer ${rotated.body.key}`)).status).toBe(200);

    const used = await prisma.apiClient.findUniqueOrThrow({ where: { id: client.id } });
    expect(used.lastUsedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: { in: ["apiClient.deactivate", "apiClient.activate", "apiClient.rotate"] } } })).toBe(3);
  });

  it("needs the scope and an allowed address", async () => {
    const head = await headAgent();
    const user = await prisma.user.findFirstOrThrow();
    const noScope = generateApiKey();
    await prisma.apiClient.create({ data: { name: "Nothing", scopes: [], allowedIps: [], keyPrefix: noScope.prefix, keyHash: noScope.hash, createdById: user.id } });
    expect((await request(app).get("/api/inbound/holidays/targets").set("Authorization", `Bearer ${noScope.key}`)).status).toBe(403);

    // supertest calls from 127.0.0.1 (or ::1).
    const { key } = await botKey(head, { allowedIps: ["203.0.113.0/24"] });
    const res = await request(app).get("/api/inbound/holidays/targets").set("Authorization", `Bearer ${key}`);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/address/);
  });

  it("keeps keys and sessions apart", async () => {
    const head = await headAgent();
    const { key } = await botKey(head);
    // A logged-in browser can't use the machine routes…
    expect((await head.get("/api/inbound/holidays/targets")).status).toBe(401);
    // …and a key can't open a staff route.
    expect((await request(app).get("/api/holidays").set("Authorization", `Bearer ${key}`)).status).toBe(401);
  });
});

describe("pushing holidays", () => {
  it("creates PENDING entries that warn but don't block, audited as the machine", async () => {
    const head = await headAgent();
    const { key, client } = await botKey(head);
    const res = await push(key, { holidays: [nationalDay()] });
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ created: 1, updated: 0, unchanged: 0, skipped: 0, invalid: 0 });
    expect(res.body.results[0]).toMatchObject({ index: 0, externalKey: "cn-embassy-national-day", result: "created", status: "PENDING" });

    const row = await prisma.holiday.findUniqueOrThrow({ where: { id: res.body.results[0].holidayId }, include: { targets: true } });
    expect(row).toMatchObject({ source: "AI_BOT", status: "PENDING", addedById: null, apiClientId: client.id });

    const embassy = await prisma.embassy.create({
      data: { code: "CN-DEL", countryId: row.targets[0]!.countryId!, name: "Chinese embassy, Delhi", city: "Delhi" },
    });
    expect(await isDateBlocked(day(6), { embassyId: embassy.id })).toBe(false);

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "holiday.create" } });
    expect(entry).toMatchObject({ actorId: null, apiClientId: client.id, entityId: row.id });

    // Staff see it with the machine's name and the reference.
    const listed = await head.get("/api/holidays");
    expect(listed.body.holidays[0]).toMatchObject({ status: "PENDING", source: "AI_BOT", apiClient: { name: "Holiday bot" }, addedBy: null });
  });

  it("updates its own entry while pending, and reports an identical push as unchanged", async () => {
    const head = await headAgent();
    const { key } = await botKey(head);
    await push(key, { holidays: [nationalDay()] });

    const same = await push(key, { holidays: [nationalDay({ targets: [{ kind: "COUNTRY", countryCode: "CN" }] })] });
    expect(same.body.results[0].result).toBe("unchanged");

    const longer = await push(key, { holidays: [nationalDay({ endDate: day(12) })] });
    expect(longer.body.results[0].result).toBe("updated");
    const row = await prisma.holiday.findFirstOrThrow({ where: { externalKey: "cn-embassy-national-day" } });
    expect(row.endDate?.toISOString().slice(0, 10)).toBe(day(12));
    expect(await prisma.holiday.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "holiday.update" } })).toBe(1);
  });

  it("can't change an entry once a person has confirmed or removed it, and can't recreate a removed one", async () => {
    const head = await headAgent();
    const { key } = await botKey(head);
    const first = await push(key, { holidays: [nationalDay(), nationalDay({ externalKey: "fr-mum-dussehra", name: "Dussehra", startDate: day(20), endDate: day(20), targets: [{ kind: "EMBASSY", embassyCode: "FR-MUM" }] })] });
    const [national, dussehra] = first.body.results;

    await head.post(`/api/holidays/${national.holidayId}/confirm`).send({});
    await head.post(`/api/holidays/${dussehra.holidayId}/remove`).send({});

    const again = await push(key, {
      holidays: [nationalDay({ endDate: day(13) }), nationalDay({ externalKey: "fr-mum-dussehra", name: "Dussehra", startDate: day(21), endDate: day(21), targets: [{ kind: "ALL_EMBASSIES" }] })],
    });
    expect(again.body.results.map((r: { result: string; reason?: string; status: string }) => [r.result, r.reason, r.status])).toEqual([
      ["skipped", "REVIEWED", "ACTIVE"],
      ["skipped", "REVIEWED", "REMOVED"],
    ]);
    const national2 = await prisma.holiday.findUniqueOrThrow({ where: { id: national.holidayId } });
    expect(national2.endDate?.toISOString().slice(0, 10)).toBe(day(11));
    expect(await prisma.holiday.count()).toBe(2);

    // The bot can read back what people did.
    const mine = await request(app).get("/api/inbound/holidays").set("Authorization", `Bearer ${key}`);
    expect(mine.body.holidays.map((h: { externalKey: string; status: string; reviewed: boolean }) => [h.externalKey, h.status, h.reviewed])).toEqual(
      expect.arrayContaining([
        ["cn-embassy-national-day", "ACTIVE", true],
        ["fr-mum-dussehra", "REMOVED", true],
      ]),
    );
  });

  it("checks each item on its own and still saves the valid ones", async () => {
    const head = await headAgent();
    const { key } = await botKey(head);
    const res = await push(key, {
      holidays: [
        nationalDay(),
        nationalDay({ externalKey: "past", startDate: day(-5), endDate: day(-3) }),
        nationalDay({ externalKey: "far", startDate: day(800), endDate: day(800) }),
        nationalDay({ externalKey: "unknown", targets: [{ kind: "COUNTRY", countryCode: "ZZ" }] }),
        nationalDay({ externalKey: "office", targets: [{ kind: "MASTI_OFFICE" }] }),
        nationalDay({ externalKey: "backwards", startDate: day(5), endDate: day(4) }),
        { name: "No key" },
        nationalDay(), // the same key twice in one push
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: { result: string }) => r.result)).toEqual([
      "created",
      "invalid",
      "invalid",
      "invalid",
      "invalid",
      "invalid",
      "invalid",
      "invalid",
    ]);
    expect(res.body.results[1].issues.endDate).toEqual(["This holiday is already over."]);
    expect(res.body.results[3].issues.targets[0]).toMatch(/ZZ/);
    expect(res.body.results[6].externalKey).toBeNull();
    expect(res.body.results[7].issues.externalKey[0]).toMatch(/twice/);
    expect(res.body.summary).toMatchObject({ created: 1, invalid: 7 });
    expect(await prisma.holiday.count()).toBe(1);
  });

  it("writes nothing on a dry run", async () => {
    const head = await headAgent();
    const { key } = await botKey(head);
    const res = await push(key, { dryRun: true, holidays: [nationalDay()] });
    expect(res.body).toMatchObject({ dryRun: true, results: [{ result: "created", holidayId: null }] });
    expect(await prisma.holiday.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "holiday.create" } })).toBe(0);
  });

  it("publishes directly when review is switched off", async () => {
    const head = await headAgent();
    await head.put("/api/holidays/settings").send({ botEntriesNeedReview: false });
    const { key } = await botKey(head);
    const res = await push(key, {
      holidays: [nationalDay({ externalKey: "dussehra", startDate: day(20), endDate: day(20), targets: [{ kind: "EMBASSY", embassyCode: "FR-MUM" }] })],
    });
    expect(res.body.results[0].status).toBe("ACTIVE");
    const embassy = await prisma.embassy.findUniqueOrThrow({ where: { code: "FR-MUM" } });
    expect(await isDateBlocked(day(20), { embassyId: embassy.id })).toBe(true);

    // Unreviewed, so the bot may still correct it.
    const fixed = await push(key, {
      holidays: [nationalDay({ externalKey: "dussehra", startDate: day(21), endDate: day(21), targets: [{ kind: "EMBASSY", embassyCode: "FR-MUM" }] })],
    });
    expect(fixed.body.results[0]).toMatchObject({ result: "updated", status: "ACTIVE" });
  });

  it("won't let one machine account change another's entry", async () => {
    const head = await headAgent();
    const { key } = await botKey(head);
    const other = await botKey(head, { name: "Second bot" });
    await push(key, { holidays: [nationalDay()] });
    const res = await push(other.key, { holidays: [nationalDay({ endDate: day(12) })] });
    expect(res.body.results[0]).toMatchObject({ result: "invalid", issues: { externalKey: ["This key belongs to another machine account."] } });
  });

  it("refuses an empty or oversized push", async () => {
    const head = await headAgent();
    const { key } = await botKey(head);
    expect((await push(key, { holidays: [] })).status).toBe(400);
    expect((await push(key, {})).status).toBe(400);
    const many = Array.from({ length: 201 }, (_, i) => nationalDay({ externalKey: `k${i}` }));
    expect((await push(key, { holidays: many })).status).toBe(413);
  });

  it("lists the codes the bot can target", async () => {
    const head = await headAgent();
    const { key } = await botKey(head);
    const res = await request(app).get("/api/inbound/holidays/targets").set("Authorization", `Bearer ${key}`);
    expect(res.body).toEqual({
      kinds: ["ALL_EMBASSIES", "COUNTRY", "EMBASSY"],
      countries: [
        { code: "CN", name: "China", embassies: [] },
        { code: "FR", name: "France", embassies: [{ code: "FR-MUM", name: "French embassy, Mumbai", city: "Mumbai" }] },
      ],
    });
  });
});
