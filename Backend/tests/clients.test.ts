import { beforeEach, describe, expect, it } from "vitest";
import { addMonths, istToday } from "../src/lib/dates";
import { gstinChecksumOk } from "../src/modules/clients/clients.schemas";
import { assertInvoiceReady } from "../src/modules/clients/readiness";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";

beforeEach(resetDb);

type Agent = Awaited<ReturnType<typeof loginAs>>;

async function headAgent() {
  await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
  return loginAs("vimal@masti.test");
}

/** Visa staff with EDIT: may change clients, but not the Accounts fields. */
async function visaAgent() {
  await createUser({ name: "Aarti", email: "aarti@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
  return loginAs("aarti@masti.test");
}

async function accountsAgent() {
  await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "ACCOUNTS", access: "EDIT" }] });
  return loginAs("meena@masti.test");
}

/** A valid GSTIN for this PAN in Gujarat (state 24), with the right check character. */
function gstinFor(pan: string, state = "24") {
  const first14 = `${state}${pan}1Z`;
  const check = [..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"].find((c) => gstinChecksumOk(first14 + c));
  return first14 + check;
}

async function createClient(agent: Agent, body: Record<string, unknown>) {
  const res = await agent.post("/api/clients").send(body);
  if (res.status !== 201) throw new Error(`create failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.client;
}

async function relationId(code: string) {
  return (await prisma.relation.findUniqueOrThrow({ where: { code } })).id;
}

describe("clients API access", () => {
  it("needs a login, and refuses field staff", async () => {
    expect((await request(app).get("/api/clients")).status).toBe(401);
    await createUser({ name: "Ravi", mobile: "+919876500001", type: "FIELD" });
    const field = await loginAs("9876500001");
    expect((await field.get("/api/clients")).status).toBe(403);
    expect((await field.get("/api/clients/lookup?mobile=9825041234")).status).toBe(403);
  });

  it("lets view-only staff look but not change", async () => {
    const head = await headAgent();
    const client = await createClient(head, { mobile: "9825041234", name: "Rakesh Mehta" });
    await createUser({ email: "viewer@masti.test", departments: [{ code: "HOTELS", access: "VIEW" }] });
    const viewer = await loginAs("viewer@masti.test");

    expect((await viewer.get(`/api/clients/${client.id}`)).status).toBe(200);
    expect((await viewer.post("/api/clients").send({ mobile: "9825041235" })).status).toBe(403);
    expect((await viewer.post(`/api/clients/${client.id}/notes`).send({ body: "Hi" })).status).toBe(403);
  });
});

describe("creating clients", () => {
  it("needs only the mobile, and fills in the defaults", async () => {
    const visa = await visaAgent();
    const res = await visa.post("/api/clients").send({ mobile: "098250 41234" });
    expect(res.status).toBe(201);
    const { client } = res.body;
    expect(client.mobile).toBe("+919825041234");
    expect(client.kind).toBe("INDIVIDUAL");
    expect(client.billingCycle.code).toBe("MONTHLY");
    expect(client.clientSince).toBe(istToday());
    expect(client.readiness.ready).toBe(false);
    expect(client.readiness.missing.map((m: { field: string }) => m.field)).toEqual(["name", "addressLine", "city", "stateCode"]);

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "client.create" } });
    expect(entry.entityId).toBe(client.id);
  });

  it("refuses a second client with the same main number, pointing at the first", async () => {
    const visa = await visaAgent();
    const first = await createClient(visa, { mobile: "9825041234" });
    const res = await visa.post("/api/clients").send({ mobile: "+91 98250 41234" });
    expect(res.status).toBe(409);
    expect(res.body.details).toEqual({ code: "CLIENT_EXISTS", clientId: first.id });
  });

  it("validates mobile, PAN, GSTIN and state", async () => {
    const visa = await visaAgent();
    expect((await visa.post("/api/clients").send({ mobile: "12345" })).status).toBe(400);
    expect((await visa.post("/api/clients").send({ mobile: "9825041234", pan: "ABCDE12345" })).status).toBe(400);
    const good = gstinFor("ABCDE1234F");
    const badCheck = good.slice(0, 14) + (good.endsWith("0") ? "1" : "0");
    const res = await visa.post("/api/clients").send({ mobile: "9825041234", gstin: badCheck });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.issues)).toMatch(/typo/);
    expect((await visa.post("/api/clients").send({ mobile: "9825041234", stateCode: "99" })).status).toBe(400);
  });

  it("fills PAN and state from the GSTIN, and refuses a PAN that doesn't match it", async () => {
    const visa = await visaAgent();
    const gstin = gstinFor("AAACS1234K");
    const client = await createClient(visa, { mobile: "9825041234", kind: "CORPORATE", name: "Sunrise Textiles", gstin: gstin.toLowerCase() });
    expect(client.gstin).toBe(gstin);
    expect(client.pan).toBe("AAACS1234K");
    expect(client.stateCode).toBe("24");

    const res = await visa.post("/api/clients").send({ mobile: "9825041235", gstin: gstinFor("AAACG9999Q"), pan: "AAACS1234K" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/doesn't match/);
  });

  it("only lets companies have a contact person", async () => {
    const visa = await visaAgent();
    expect((await visa.post("/api/clients").send({ mobile: "9825041234", contactPerson: "Mr Shah" })).status).toBe(400);

    const company = await createClient(visa, { mobile: "9825041234", kind: "CORPORATE", name: "Gajera Diamonds", contactPerson: "Mr Shah" });
    const res = await visa.patch(`/api/clients/${company.id}`).send({ kind: "INDIVIDUAL", updatedAt: company.updatedAt });
    expect(res.status).toBe(200);
    expect(res.body.client.contactPerson).toBeNull();
  });
});

describe("database rules (they also guard the Excel import)", () => {
  it("refuses bad rows written directly", async () => {
    const billingCycleId = (await prisma.billingCycle.findUniqueOrThrow({ where: { code: "MONTHLY" } })).id;
    const base = { billingCycleId, mobile: "+919825041234" };
    await expect(prisma.client.create({ data: { ...base, mobile: "9825041234" } })).rejects.toThrow();
    await expect(prisma.client.create({ data: { ...base, contactPerson: "Mr Shah" } })).rejects.toThrow();
    await expect(prisma.client.create({ data: { ...base, pan: "abcde1234f" } })).rejects.toThrow();
    await expect(prisma.client.create({ data: { ...base, pan: "AAACS1234K", gstin: gstinFor("AAACG9999Q") } })).rejects.toThrow();
    await expect(prisma.billingCycle.create({ data: { code: "QUARTERLY", name: "Quarterly", isDefault: true } })).rejects.toThrow();
    await expect(prisma.client.create({ data: { ...base, pan: "AAACS1234K", gstin: gstinFor("AAACS1234K") } })).resolves.toBeTruthy();
  });
});

describe("duplicate warnings (confirmDuplicates)", () => {
  it("warns about a PAN already on file, and saves once confirmed", async () => {
    const visa = await visaAgent();
    const first = await createClient(visa, { mobile: "9825041234", name: "Rakesh Mehta", pan: "ABCPM1234K" });

    const warned = await visa.post("/api/clients").send({ mobile: "9825041235", pan: "abcpm1234k" });
    expect(warned.status).toBe(409);
    expect(warned.body.details.code).toBe("DUPLICATE");
    expect(warned.body.details.duplicates[0]).toMatchObject({ field: "pan", value: "ABCPM1234K" });
    expect(warned.body.details.duplicates[0].matches[0]).toMatchObject({ clientId: first.id, clientName: "Rakesh Mehta" });
    expect(await prisma.client.count()).toBe(1);

    const confirmed = await visa.post("/api/clients").send({ mobile: "9825041235", pan: "abcpm1234k", confirmDuplicates: true });
    expect(confirmed.status).toBe(201);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "client.create", entityId: confirmed.body.client.id } });
    expect(JSON.stringify(entry.after)).toMatch(/confirmedDuplicates/);
  });

  it("warns when a new client's main number is another client's extra number", async () => {
    const visa = await visaAgent();
    const first = await createClient(visa, { mobile: "9825041234" });
    expect((await visa.post(`/api/clients/${first.id}/phones`).send({ mobile: "9898989898" })).status).toBe(201);

    const res = await visa.post("/api/clients").send({ mobile: "9898989898" });
    expect(res.status).toBe(409);
    expect(res.body.details.duplicates[0].field).toBe("mobile");
    expect((await visa.post("/api/clients").send({ mobile: "9898989898", confirmDuplicates: true })).status).toBe(201);
  });
});

describe("updating clients", () => {
  it("uses updatedAt for optimistic locking", async () => {
    const visa = await visaAgent();
    const client = await createClient(visa, { mobile: "9825041234" });

    const first = await visa.patch(`/api/clients/${client.id}`).send({ name: "Rakesh Mehta", updatedAt: client.updatedAt });
    expect(first.status).toBe(200);
    expect(first.body.client.name).toBe("Rakesh Mehta");

    // A second tab still holding the old updatedAt is refused instead of overwriting.
    const stale = await visa.patch(`/api/clients/${client.id}`).send({ name: "R. Mehta", updatedAt: client.updatedAt });
    expect(stale.status).toBe(409);
    expect(stale.body.details.code).toBe("STALE");

    expect((await visa.patch(`/api/clients/${client.id}`).send({ name: "R. Mehta" })).status).toBe(400);
    const fresh = await visa.patch(`/api/clients/${client.id}`).send({ name: "R. Mehta", updatedAt: first.body.client.updatedAt });
    expect(fresh.status).toBe(200);

    const entries = await prisma.auditLog.findMany({ where: { action: "client.update" }, orderBy: { id: "asc" } });
    expect(entries).toHaveLength(2);
    expect(entries[1]!.before).toEqual({ name: "Rakesh Mehta" });
    expect(entries[1]!.after).toEqual({ name: "R. Mehta" });
  });

  it("clears a field with an empty string", async () => {
    const visa = await visaAgent();
    const client = await createClient(visa, { mobile: "9825041234", city: "Surat" });
    const res = await visa.patch(`/api/clients/${client.id}`).send({ city: "", updatedAt: client.updatedAt });
    expect(res.status).toBe(200);
    expect(res.body.client.city).toBeNull();
  });

  it("keeps the accounting code, billing cycle and payment habit for Accounts", async () => {
    const visa = await visaAgent();
    const accounts = await accountsAgent();
    const weekly = await prisma.billingCycle.findUniqueOrThrow({ where: { code: "WEEKLY" } });
    const monthly = await prisma.billingCycle.findUniqueOrThrow({ where: { code: "MONTHLY" } });

    expect((await visa.post("/api/clients").send({ mobile: "9825041234", accountingCode: "C-101" })).status).toBe(403);
    const client = await createClient(visa, { mobile: "9825041234" });

    const refused = await visa.patch(`/api/clients/${client.id}`).send({ billingCycleId: weekly.id, updatedAt: client.updatedAt });
    expect(refused.status).toBe(403);
    // Sending the unchanged value along with other fields is fine.
    const allowed = await visa.patch(`/api/clients/${client.id}`).send({ name: "Rakesh", billingCycleId: monthly.id, updatedAt: client.updatedAt });
    expect(allowed.status).toBe(200);

    const byAccounts = await accounts.patch(`/api/clients/${client.id}`).send({
      accountingCode: "C-101",
      billingCycleId: weekly.id,
      updatedAt: allowed.body.client.updatedAt,
    });
    expect(byAccounts.status).toBe(200);
    expect(byAccounts.body.client.accountingCode).toBe("C-101");
    expect(byAccounts.body.client.billingCycle.code).toBe("WEEKLY");

    // Clearing it is an Accounts change too.
    const clear = await visa.patch(`/api/clients/${client.id}`).send({ accountingCode: null, updatedAt: byAccounts.body.client.updatedAt });
    expect(clear.status).toBe(403);

    const other = await createClient(visa, { mobile: "9825041235" });
    const taken = await accounts.patch(`/api/clients/${other.id}`).send({ accountingCode: "c-101", updatedAt: other.updatedAt });
    expect(taken.status).toBe(409);
  });
});

describe("invoice readiness", () => {
  it("follows the setting, which only the Head can change", async () => {
    const head = await headAgent();
    const visa = await visaAgent();
    const client = await createClient(visa, { mobile: "9825041234", name: "Rakesh Mehta" });
    await expect(assertInvoiceReady(client.id)).rejects.toMatchObject({ status: 422, details: { code: "CLIENT_INCOMPLETE" } });

    const incomplete = await visa.get("/api/clients?incomplete=true");
    expect(incomplete.body.clients.map((c: { id: string }) => c.id)).toEqual([client.id]);

    const settings = { invoiceReadiness: { INDIVIDUAL: ["name"], CORPORATE: ["name", "gstin"] } };
    expect((await visa.put("/api/clients/settings").send(settings)).status).toBe(403);
    expect((await head.put("/api/clients/settings").send({ invoiceReadiness: { INDIVIDUAL: ["contactPerson"], CORPORATE: [] } })).status).toBe(400);
    const saved = await head.put("/api/clients/settings").send(settings);
    expect(saved.status).toBe(200);
    expect(saved.body.settings.invoiceReadiness).toEqual(settings.invoiceReadiness);

    expect((await visa.get(`/api/clients/${client.id}/readiness`)).body.readiness).toEqual({ ready: true, missing: [] });
    await expect(assertInvoiceReady(client.id)).resolves.toBeUndefined();
    expect((await visa.get("/api/clients?incomplete=true")).body.clients).toEqual([]);
    expect((await visa.get("/api/clients?incomplete=false")).body.clients).toHaveLength(1);

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "setting.update" } });
    expect(entry.entityId).toBe("clients.invoiceReadiness");
  });
});

describe("family members", () => {
  it("adds a member with a normalised passport and a renew-soon flag", async () => {
    const visa = await visaAgent();
    const client = await createClient(visa, { mobile: "9825041234" });
    const expiry = addMonths(istToday(), 8);
    const res = await visa.post(`/api/clients/${client.id}/members`).send({
      name: "AARAV MEHTA",
      relationId: await relationId("SON"),
      dateOfBirth: addMonths(istToday(), -12 * 12),
      passportNumber: "z 123 4567",
      passportExpiry: expiry,
    });
    expect(res.status).toBe(201);
    expect(res.body.member).toMatchObject({ passportNumber: "Z1234567", passportExpiry: expiry, passportStatus: "RENEW_SOON", age: 12 });
    expect(res.body.member.relation.code).toBe("SON");

    const profile = await visa.get(`/api/clients/${client.id}`);
    expect(profile.body.client.members).toHaveLength(1);
  });

  it("refuses a birth date in the future and an inactive relation", async () => {
    const visa = await visaAgent();
    const client = await createClient(visa, { mobile: "9825041234" });
    const self = await relationId("SELF");
    expect((await visa.post(`/api/clients/${client.id}/members`).send({ name: "X", relationId: self, dateOfBirth: addMonths(istToday(), 1) })).status).toBe(400);
    await prisma.relation.update({ where: { id: self }, data: { isActive: false } });
    expect((await visa.post(`/api/clients/${client.id}/members`).send({ name: "X", relationId: self })).status).toBe(400);
  });

  it("warns about a passport number on file for another person", async () => {
    const visa = await visaAgent();
    const mehta = await createClient(visa, { mobile: "9825041234", name: "Mehta family" });
    const corporate = await createClient(visa, { mobile: "9825041235", kind: "CORPORATE", name: "Sunrise Textiles" });
    const first = await visa.post(`/api/clients/${mehta.id}/members`).send({ name: "ANITA MEHTA", relationId: await relationId("SPOUSE"), passportNumber: "Z1234567" });
    expect(first.status).toBe(201);

    const body = { name: "ANITA MEHTA", relationId: await relationId("EMPLOYEE"), passportNumber: "z1234567" };
    const warned = await visa.post(`/api/clients/${corporate.id}/members`).send(body);
    expect(warned.status).toBe(409);
    expect(warned.body.details.duplicates[0]).toMatchObject({ field: "passportNumber", value: "Z1234567" });
    expect(warned.body.details.duplicates[0].matches[0]).toMatchObject({
      clientId: mehta.id,
      clientName: "Mehta family",
      memberId: first.body.member.id,
      memberName: "ANITA MEHTA",
    });

    expect((await visa.post(`/api/clients/${corporate.id}/members`).send({ ...body, confirmDuplicates: true })).status).toBe(201);
  });

  it("updates with optimistic locking, and archives instead of deleting", async () => {
    const visa = await visaAgent();
    const client = await createClient(visa, { mobile: "9825041234" });
    const created = (await visa.post(`/api/clients/${client.id}/members`).send({ name: "DIYA MEHTA", relationId: await relationId("DAUGHTER") })).body.member;
    const url = `/api/clients/${client.id}/members/${created.id}`;

    const updated = await visa.patch(url).send({ passportNumber: "Y7654321", updatedAt: created.updatedAt });
    expect(updated.status).toBe(200);
    expect(updated.body.member.passportNumber).toBe("Y7654321");
    expect((await visa.patch(url).send({ name: "DIYA", updatedAt: created.updatedAt })).status).toBe(409);

    const archived = await visa.post(`${url}/archive`).send({});
    expect(archived.status).toBe(200);
    expect(archived.body.member.archivedAt).not.toBeNull();
    expect((await visa.get(`/api/clients/${client.id}`)).body.client.members).toEqual([]);
    expect((await visa.patch(url).send({ name: "DIYA", updatedAt: archived.body.member.updatedAt })).status).toBe(400);
    expect(await prisma.clientMember.count()).toBe(1);
  });
});

describe("mobile numbers", () => {
  it("looks clients up by main and extra numbers", async () => {
    const visa = await visaAgent();
    const rakesh = await createClient(visa, { mobile: "9825041234", name: "Rakesh" });
    await visa.post(`/api/clients/${rakesh.id}/phones`).send({ mobile: "9898989898", label: "Office" });

    expect((await visa.get("/api/clients/lookup?mobile=98250%2041234")).body.client).toMatchObject({ id: rakesh.id, matchedOn: "PRIMARY" });
    expect((await visa.get("/api/clients/lookup?mobile=9898989898")).body.client).toMatchObject({ id: rakesh.id, matchedOn: "SECONDARY" });
    expect((await visa.get("/api/clients/lookup?mobile=9000000000")).body.client).toBeNull();
    expect((await visa.get("/api/clients/lookup?mobile=123")).status).toBe(400);
  });

  it("adds and removes extra numbers", async () => {
    const visa = await visaAgent();
    const client = await createClient(visa, { mobile: "9825041234" });
    const url = `/api/clients/${client.id}/phones`;

    expect((await visa.post(url).send({ mobile: "9825041234" })).status).toBe(400);
    const added = await visa.post(url).send({ mobile: "9898989898" });
    expect(added.status).toBe(201);
    expect((await visa.post(url).send({ mobile: "+91 98989 89898" })).status).toBe(409);

    expect((await visa.delete(`${url}/${added.body.phone.id}`).send({})).status).toBe(204);
    expect(await prisma.clientPhone.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: { in: ["client.phone.add", "client.phone.remove"] } } })).toBe(2);
  });

  it("changes the main number, keeping the old one as an extra number", async () => {
    const visa = await visaAgent();
    const client = await createClient(visa, { mobile: "9825041234" });
    const other = await createClient(visa, { mobile: "9825041235" });
    await visa.post(`/api/clients/${client.id}/phones`).send({ mobile: "9898989898" });

    expect((await visa.put(`/api/clients/${client.id}/mobile`).send({ mobile: other.mobile })).status).toBe(409);

    const res = await visa.put(`/api/clients/${client.id}/mobile`).send({ mobile: "9898989898" });
    expect(res.status).toBe(200);
    expect(res.body.client.mobile).toBe("+919898989898");
    expect(res.body.client.phones.map((p: { mobile: string }) => p.mobile)).toEqual(["+919825041234"]);
  });

  it("won't keep the old main number when that goes past the extra-number limit", async () => {
    const visa = await visaAgent();
    const client = await createClient(visa, { mobile: "9825041234" });
    for (const mobile of ["9898989891", "9898989892", "9898989893", "9898989894", "9898989895"]) {
      expect((await visa.post(`/api/clients/${client.id}/phones`).send({ mobile })).status).toBe(201);
    }
    const url = `/api/clients/${client.id}/mobile`;

    expect((await visa.put(url).send({ mobile: "9000000001" })).status).toBe(400);
    // Promoting an extra number frees its slot, so the old main number fits.
    expect((await visa.put(url).send({ mobile: "9898989891" })).status).toBe(200);
    expect((await visa.put(url).send({ mobile: "9000000001", keepOldAsSecondary: false })).status).toBe(200);
    expect(await prisma.clientPhone.count({ where: { clientId: client.id } })).toBe(5);
  });
});

describe("searching clients", () => {
  it("finds by name, partial mobile, extra number and passport number", async () => {
    const visa = await visaAgent();
    const rakesh = await createClient(visa, { mobile: "9825041234", name: "Rakesh Mehta" });
    const sunrise = await createClient(visa, { mobile: "9825041235", kind: "CORPORATE", name: "Sunrise Textiles" });
    await visa.post(`/api/clients/${sunrise.id}/phones`).send({ mobile: "9898989898" });
    await visa.post(`/api/clients/${rakesh.id}/members`).send({ name: "ANITA MEHTA", relationId: await relationId("SPOUSE"), passportNumber: "Z1234567" });

    const ids = async (q: string) =>
      (await visa.get(`/api/clients?q=${encodeURIComponent(q)}`)).body.clients.map((c: { id: string }) => c.id);
    expect(await ids("mehta")).toEqual([rakesh.id]);
    expect(await ids("98250 4123")).toEqual([rakesh.id, sunrise.id]);
    expect(await ids("98989")).toEqual([sunrise.id]);
    expect(await ids("z123 4567")).toEqual([rakesh.id]);
  });

  it("pages with a cursor", async () => {
    const visa = await visaAgent();
    for (const [i, name] of ["Asha", "Bhavin", "Chirag"].entries()) await createClient(visa, { mobile: `982504123${i}`, name });

    const first = await visa.get("/api/clients?limit=2");
    expect(first.body.clients.map((c: { name: string }) => c.name)).toEqual(["Asha", "Bhavin"]);
    const second = await visa.get(`/api/clients?limit=2&cursor=${first.body.nextCursor}`);
    expect(second.body.clients.map((c: { name: string }) => c.name)).toEqual(["Chirag"]);
    expect(second.body.nextCursor).toBeNull();
  });
});

describe("notes and options", () => {
  it("adds notes with their author, newest first", async () => {
    const visa = await visaAgent();
    const client = await createClient(visa, { mobile: "9825041234" });
    await visa.post(`/api/clients/${client.id}/notes`).send({ body: "Prefers calls after 6 pm." });
    await visa.post(`/api/clients/${client.id}/notes`).send({ body: "Pays the balance on delivery." });
    expect((await visa.post(`/api/clients/${client.id}/notes`).send({ body: "  " })).status).toBe(400);

    const notes = (await visa.get(`/api/clients/${client.id}/notes`)).body.notes;
    expect(notes.map((n: { body: string }) => n.body)).toEqual(["Pays the balance on delivery.", "Prefers calls after 6 pm."]);
    expect(notes[0].author.name).toBe("Aarti");
  });

  it("lists the dropdowns", async () => {
    const visa = await visaAgent();
    const res = await visa.get("/api/clients/options");
    expect(res.status).toBe(200);
    expect(res.body.billingCycles.find((c: { isDefault: boolean }) => c.isDefault).code).toBe("MONTHLY");
    expect(res.body.relations.map((r: { code: string }) => r.code)).toContain("EMPLOYEE");
    expect(res.body.states).toContainEqual({ code: "24", name: "Gujarat" });
    const names: string[] = res.body.states.map((s: { name: string }) => s.name);
    expect(names[0]).toBe("Andaman and Nicobar Islands");
    expect(names.at(-1)).toBe("Other Territory");
  });
});
