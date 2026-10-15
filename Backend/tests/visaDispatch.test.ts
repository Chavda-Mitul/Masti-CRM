import { beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, istDateTimeToUtc, istToday, toDbDate } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { dispatchCase, makeInvoiceable, mastiReady, untilWaitingOnLock, holdCaseLock, type Agent } from "./visaHelpers";

// Visa Step 4, dispatch (docs/decisions/0008-visa-docket-dispatch.md Decisions 3, 6 and 9): one press sends every case in
// the docket to the vendor, only once every case has its locked invoice and the vendor can take it.

/**
 * The email goes to Mailpit for real, unless a test asks the next sends to fail ("Connection refused"). `whileSending`
 * runs while the mail server is answering, before the email goes.
 */
const failures = vi.hoisted(() => ({ next: 0, whileSending: null as (() => Promise<void>) | null }));
vi.mock("../src/lib/email", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/email")>();
  return {
    ...real,
    sendEmail: async (email: Parameters<typeof real.sendEmail>[0]) => {
      await failures.whileSending?.();
      if (failures.next > 0) {
        failures.next--;
        throw new Error("Connection refused");
      }
      return real.sendEmail(email);
    },
  };
});

const mailpit = process.env.MAILPIT_URL as string;

beforeEach(async () => {
  failures.next = 0;
  failures.whileSending = null;
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
  await fetch(`${mailpit}/api/v1/messages`, { method: "DELETE" });
});

interface Mail {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}
/** Every email Mailpit caught, with the first one's text. */
async function inbox() {
  const { messages } = (await (await fetch(`${mailpit}/api/v1/messages`)).json()) as { messages: Mail[] };
  const first = messages[0] && ((await (await fetch(`${mailpit}/api/v1/message/${messages[0].ID}`)).json()) as { Text: string; HTML: string });
  return { messages, text: first?.Text ?? "", html: first?.HTML ?? "" };
}

interface CaseDto {
  updatedAt: string;
  dueAt: string;
  stage: { code: string };
  owner: { id: string; name: string } | null;
  quote: { updatedAt: string } | null;
  docket: {
    docketNo: string;
    status: string;
    courier: { name: string; awbNeeded: boolean } | null;
    awbNo: string | null;
    email: { sentAt: string | null; to: string | null; error: string | null; sending: boolean } | null;
    dispatchedAt: string | null;
    dispatchedBy: { name: string } | null;
    cases: { caseNo: string; ownerId: string | null; invoiceNo: string | null }[];
  } | null;
}
type Case = Awaited<ReturnType<typeof dispatchCase>>;

const neha = () => loginAs("neha@masti.test");
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const courierId = async (code: string) => (await prisma.courier.findUniqueOrThrow({ where: { code } })).id;
const check = (agent: Agent, caseNo: string) => agent.get(`/api/visa/cases/${caseNo}/dispatch/check`);

async function add(agent: Agent, caseNo: string) {
  const { updatedAt } = await load(agent, caseNo);
  const res = await agent.post(`/api/visa/cases/${caseNo}/docket`).send({ mode: "GROUP", updatedAt });
  expect(res.status).toBe(200);
}

async function raise(agent: Agent, c: Case, clientName = "Rakesh Mehta") {
  await makeInvoiceable(agent, c, { clientName });
  const { quoteUpdatedAt, taxType, gstRatePercent, totalPaise } = (await agent.get(`/api/visa/cases/${c.caseNo}/invoice/check`)).body.preview;
  expect((await agent.post(`/api/visa/cases/${c.caseNo}/invoice`).send({ quoteUpdatedAt, taxType, gstRatePercent, totalPaise })).status).toBe(200);
}

/** Presses Dispatch with the files the page shows (or `caseNos`), by Blue Dart unless told otherwise. */
async function dispatch(agent: Agent, caseNo: string, body: { courierId?: number | undefined; awbNo?: string | null; caseNos?: string[] } = {}) {
  const caseNos = body.caseNos ?? (await load(agent, caseNo)).docket!.cases.map((r) => r.caseNo);
  return agent.post(`/api/visa/cases/${caseNo}/dispatch`).send({ courierId: await courierId("BLUE_DART"), awbNo: "1234 5678", ...body, caseNos });
}

/** Mehta and Shah, both Neha's, in Global Visa Services' docket. `ready` raises both invoices, so the docket can go. */
async function docketOfTwo({ ready = true } = {}) {
  await mastiReady();
  const mehta = await dispatchCase();
  const shah = await dispatchCase({ vendorId: mehta.vendor.id, extra: { mobile: "98250 41235", clientName: "Sunil Shah" } });
  const processor = await neha();
  await add(processor, mehta.caseNo);
  await add(processor, shah.caseNo);
  if (ready) {
    await raise(processor, mehta);
    await raise(processor, shah, "Sunil Shah");
  }
  return { mehta, shah, processor };
}

describe("Dispatch (Decision 9)", () => {
  it("sends every case to At vendor, due the next open office day at 11:00, and stamps the docket", async () => {
    const { mehta, shah, processor } = await docketOfTwo();
    // Tomorrow is an office holiday, so the vendor check moves to the day after.
    const today = istToday();
    await prisma.holiday.create({
      data: { name: "Office closed", startDate: toDbDate(addDays(today, 1)), endDate: toDbDate(addDays(today, 1)), targets: { create: [{ kind: "MASTI_OFFICE" }] } },
    });
    const due = istDateTimeToUtc(addDays(today, 2), "11:00").toISOString();

    const before = await check(processor, mehta.caseNo);
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ blockers: [], canDispatch: true, alreadyDispatched: false, confirmAt: due });
    expect(before.body.vendor).toEqual({ name: "Global Visa Services", city: "Mumbai", email: "ops@globalvisa.test" });

    const res = await dispatch(processor, mehta.caseNo);
    expect(res.status).toBe(200);
    const c = res.body.case as CaseDto;
    expect(c.stage.code).toBe("AT_VENDOR");
    expect(c.dueAt).toBe(due);
    expect(c.owner!.name).toBe("Neha Joshi");
    expect(c.docket).toMatchObject({ status: "DISPATCHED", courier: { name: "Blue Dart", awbNeeded: true }, awbNo: "12345678", dispatchedBy: { name: "Neha Joshi" } });

    const other = await load(processor, shah.caseNo);
    expect([other.stage.code, other.dueAt, other.docket!.status]).toEqual(["AT_VENDOR", due, "DISPATCHED"]);
    expect(await prisma.auditLog.count({ where: { action: "visa.docket.dispatch", entityType: "Enquiry" } })).toBe(2);
    const docketRow = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.docket.dispatch", entityType: "Docket" } });
    expect(docketRow.after).toMatchObject({ status: "DISPATCHED", courier: "Blue Dart", awbNo: "12345678", cases: [mehta.caseNo, shah.caseNo] });
  });

  it("follows the vendor-confirm setting, and By hand needs no slip number", async () => {
    const { mehta, processor } = await docketOfTwo();
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await loginAs("riya@masti.test");
    expect((await hod.put("/api/visa/settings").send({ vendorConfirm: { afterDays: 3, at: "10:30" } })).status).toBe(200);

    const res = await dispatch(processor, mehta.caseNo, { courierId: await courierId("BY_HAND"), awbNo: null });
    expect(res.status).toBe(200);
    const c = res.body.case as CaseDto;
    expect(c.dueAt).toBe(istDateTimeToUtc(addDays(istToday(), 3), "10:30").toISOString());
    expect(c.docket).toMatchObject({ courier: { name: "By hand (no AWB)", awbNeeded: false }, awbNo: null });
  });

  it("leaves Step 4 read-only: no taking out, no quote change; the vendor's next case starts a new docket; the sticker still prints", async () => {
    const { mehta, shah, processor } = await docketOfTwo();
    expect((await dispatch(processor, mehta.caseNo)).status).toBe(200);

    const { updatedAt } = await load(processor, mehta.caseNo);
    expect((await processor.delete(`/api/visa/cases/${mehta.caseNo}/docket`).send({ updatedAt })).status).toBe(409);
    const speed = await prisma.processingSpeed.findUniqueOrThrow({ where: { code: "NORMAL" } });
    const travellers = await prisma.visaCaseTraveller.findMany({ where: { caseId: shah.id } });
    const quoteSeen = (await load(processor, shah.caseNo)).quote!.updatedAt;
    const quote = await processor.put(`/api/visa/cases/${shah.caseNo}/quote`).send({
      processingSpeedId: speed.id,
      serviceChargePaise: 0,
      lines: travellers.map((t) => ({ travellerId: t.id, form: "LUMP_SUM", lumpSumPaise: 100 })),
      updatedAt: quoteSeen,
    });
    expect(quote.status).toBe(409);
    expect(quote.body.message).toMatch(/gone to the vendor/);
    expect((await dispatch(processor, mehta.caseNo)).body.message).toMatch(/already been dispatched/);

    const next = await dispatchCase({ vendorId: mehta.vendor.id, extra: { mobile: "98250 41236", clientName: "Kiran Bhatt" } });
    await add(processor, next.caseNo);
    expect((await load(processor, next.caseNo)).docket).toMatchObject({ status: "OPEN", cases: [{ caseNo: next.caseNo }] });
    expect((await load(processor, next.caseNo)).docket!.docketNo).not.toBe((await load(processor, mehta.caseNo)).docket!.docketNo);

    expect((await processor.get(`/api/visa/cases/${mehta.caseNo}/sticker`)).status).toBe(200);
  });
});

describe("what is refused", () => {
  it("a file without its invoice, or a switched-off vendor: 409 with what to fix", async () => {
    const { mehta, shah, processor } = await docketOfTwo({ ready: false });
    const blocked = await dispatch(processor, mehta.caseNo);
    expect(blocked.status).toBe(409);
    expect(blocked.body.details.code).toBe("DISPATCH_BLOCKED");
    expect(blocked.body.details.blockers).toEqual([
      { kind: "INVOICE", label: expect.stringMatching(/invoice/), items: [mehta.caseNo, shah.caseNo] },
    ]);
    expect((await check(processor, mehta.caseNo)).body.blockers).toHaveLength(1);

    await prisma.vendor.update({ where: { id: mehta.vendor.id }, data: { isActive: false } });
    await raise(processor, mehta);
    const one = await dispatch(processor, mehta.caseNo);
    expect(one.body.details.blockers.map((b: { kind: string; items: string[] }) => [b.kind, b.items])).toEqual([
      ["INVOICE", [shah.caseNo]],
      ["VENDOR_OFF", []],
    ]);
    expect(await prisma.docket.count({ where: { status: "DISPATCHED" } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "visa.docket.dispatch" } })).toBe(0);
  });

  it("no courier, a switched-off courier, a missing, malformed or wrong-length slip, a slip for By hand", async () => {
    const { mehta, processor } = await docketOfTwo();
    const field = async (body: Parameters<typeof dispatch>[2]) => {
      const res = await dispatch(processor, mehta.caseNo, body);
      expect(res.status).toBe(400);
      return Object.keys(res.body.issues ?? {});
    };
    expect(await field({ courierId: undefined })).toEqual(["courierId"]);
    await prisma.courier.update({ where: { code: "DTDC" }, data: { isActive: false } });
    expect(await field({ courierId: await courierId("DTDC") })).toEqual(["courierId"]);
    expect(await field({ awbNo: null })).toEqual(["awbNo"]);
    expect(await field({ awbNo: "AB-123" })).toEqual(["awbNo"]);
    expect(await field({ awbNo: "123" })).toEqual(["awbNo"]);
    expect(await field({ awbNo: "1".repeat(31) })).toEqual(["awbNo"]);
    expect(await field({ courierId: await courierId("BY_HAND"), awbNo: "12345678" })).toEqual(["awbNo"]);
    expect(await prisma.docket.count({ where: { status: "DISPATCHED" } })).toBe(0);
  });

  it("a stale page: a file added or taken out since the dialog opened", async () => {
    const { mehta, processor } = await docketOfTwo();
    const res = await dispatch(processor, mehta.caseNo, { caseNos: [mehta.caseNo] });
    expect(res.status).toBe(409);
    expect(res.body.details.code).toBe("STALE");
  });
});

describe("who may dispatch (Decision 3)", () => {
  it("the Visa HOD, the Head, and a processor who owns one case in it; not other staff, view-only users or other departments", async () => {
    const { mehta, shah } = await docketOfTwo();
    const kiran = await createUser({ name: "Kiran", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    await createUser({ name: "Hetal", email: "hetal@masti.test", departments: [{ code: "HOLIDAYS", access: "EDIT" }] });
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const [other, viewer, holidays] = [await loginAs("kiran@masti.test"), await loginAs("meena@masti.test"), await loginAs("hetal@masti.test")];
    const hod = await loginAs("riya@masti.test");
    const caseNos = [mehta.caseNo, shah.caseNo];

    expect((await dispatch(other, mehta.caseNo, { caseNos })).status).toBe(403);
    expect((await dispatch(viewer, mehta.caseNo, { caseNos })).status).toBe(403);
    expect((await dispatch(holidays, mehta.caseNo, { caseNos })).status).toBe(403);
    expect((await check(hod, mehta.caseNo)).body.canDispatch).toBe(true);

    // Kiran owns Shah's case only: still allowed to send the whole docket.
    await prisma.enquiry.update({ where: { id: shah.id }, data: { ownerId: kiran.id } });
    expect((await check(other, shah.caseNo)).body.canDispatch).toBe(true);
    const res = await dispatch(other, shah.caseNo, { caseNos });
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).docket!.dispatchedBy!.name).toBe("Kiran");
    expect((await load(hod, mehta.caseNo)).owner!.name).toBe("Neha Joshi");
  });

  it("the Head may", async () => {
    const { mehta } = await docketOfTwo();
    const head = await loginAs("vimal@masti.test");
    expect((await dispatch(head, mehta.caseNo)).status).toBe(200);
  });
});

describe("taking turns (locks: vendor, then docket, then its cases)", () => {
  /** Holds the docket's row, doing `work` first, until release(): an add, a take-out or a dispatch in flight. */
  function holdDocket(docketNo: string, work: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<unknown>) {
    let release!: () => void;
    let locked!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const ready = new Promise<void>((resolve) => (locked = resolve));
    const done = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Docket" WHERE "docketNo" = ${docketNo} FOR UPDATE`;
        await work(tx);
        locked();
        await held;
      },
      { timeout: 15_000 },
    );
    return { ready, release, done };
  }

  it("a dispatch that waited behind a take-out is refused as stale, and sends nothing", async () => {
    const { mehta, shah, processor } = await docketOfTwo();
    const { docketNo } = (await load(processor, mehta.caseNo)).docket!;
    const takeOut = holdDocket(docketNo, (tx) => tx.visaCase.update({ where: { enquiryId: shah.id }, data: { docketId: null } }));
    await takeOut.ready;
    const sent = dispatch(processor, mehta.caseNo, { caseNos: [mehta.caseNo, shah.caseNo] }).then((r) => r);
    try {
      await untilWaitingOnLock();
    } finally {
      takeOut.release();
    }
    await takeOut.done;
    const res = await sent;
    expect(res.status).toBe(409);
    expect(res.body.details.code).toBe("STALE");
    expect(await prisma.docket.count({ where: { status: "DISPATCHED" } })).toBe(0);
  });

  it("a take-out that waited behind a dispatch is refused", async () => {
    const { mehta, processor } = await docketOfTwo();
    const { docketNo } = (await load(processor, mehta.caseNo)).docket!;
    const { updatedAt } = await load(processor, mehta.caseNo);
    const blueDart = await courierId("BLUE_DART");
    const neha = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
    const sending = holdDocket(docketNo, (tx) =>
      tx.docket.update({ where: { docketNo }, data: { status: "DISPATCHED", courierId: blueDart, awbNo: "12345678", dispatchedAt: new Date(), dispatchedById: neha.id } }),
    );
    await sending.ready;
    const takeOut = processor.delete(`/api/visa/cases/${mehta.caseNo}/docket`).send({ updatedAt }).then((r) => r);
    try {
      await untilWaitingOnLock();
    } finally {
      sending.release();
    }
    await sending.done;
    const res = await takeOut;
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/dispatched/);
    expect((await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: mehta.id } })).docketId).not.toBeNull();
  });

  it("a dispatch that waited behind a change to one of its cases sees it", async () => {
    const { mehta, shah, processor } = await docketOfTwo();
    const atVendor = await prisma.departmentStage.findFirstOrThrow({ where: { code: "AT_VENDOR" } });
    const change = holdCaseLock(shah.id, (tx) => tx.enquiry.update({ where: { id: shah.id }, data: { stageId: atVendor.id } }));
    await change.ready;
    const sent = dispatch(processor, mehta.caseNo, { caseNos: [mehta.caseNo, shah.caseNo] }).then((r) => r);
    try {
      await untilWaitingOnLock();
    } finally {
      change.release();
    }
    await change.done;
    const res = await sent;
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(new RegExp(`${shah.caseNo} isn't waiting for dispatch`));
    expect((await prisma.enquiry.findUniqueOrThrow({ where: { id: mehta.id }, include: { stage: true } })).stage.code).toBe("DISPATCH");
  });
});

describe("the email to the vendor (Decision 8)", () => {
  it("goes once the docket is dispatched: the docket, the courier and slip, and each file's travellers, country and passports", async () => {
    const { mehta, shah, processor } = await docketOfTwo();
    await prisma.visaCase.update({ where: { enquiryId: shah.id }, data: { bookletsCurrent: 3, bookletsOld: 2 } });
    expect((await load(processor, mehta.caseNo)).docket!.email).toBeNull();

    const res = await dispatch(processor, mehta.caseNo);
    expect(res.status).toBe(200);
    const { docketNo, email } = (res.body.case as CaseDto).docket!;
    expect(email).toMatchObject({ to: "ops@globalvisa.test", error: null });
    expect(email!.sentAt).not.toBeNull();

    const { messages, text, html } = await inbox();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.To.map((t) => t.Address)).toEqual(["ops@globalvisa.test"]);
    expect(messages[0]!.Subject).toBe(`Docket ${docketNo} · 2 files · MASTI TOUR AND TRAVEL`);
    expect(text).toContain("Sent by: Blue Dart, slip 12345678");
    expect(text).toContain(`${mehta.caseNo} · France · 2 passports · Rakesh Mehta, Aarav Test`);
    expect(text).toContain(`${shah.caseNo} · France · 3 + 2 old passports · Sunil Shah, Aarav Test`);
    expect(text).toContain("5 + 2 old passports");
    expect(html).toContain("<table");
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.docket.email" } })).toMatchObject({
      entityType: "Docket",
      after: { sent: true, to: "ops@globalvisa.test" },
    });
  });

  it("a failed send never undoes the dispatch; Send again sends it, once", async () => {
    const { mehta, shah, processor } = await docketOfTwo();
    failures.next = 1;
    const res = await dispatch(processor, mehta.caseNo);
    expect(res.status).toBe(200);
    const c = res.body.case as CaseDto;
    expect(c.stage.code).toBe("AT_VENDOR");
    expect(c.docket!.email).toEqual({ sentAt: null, to: null, error: "Connection refused", sending: false });
    expect((await inbox()).messages).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { action: "visa.docket.email", after: { path: ["sent"], equals: false } } })).toBe(1);

    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    const viewer = await loginAs("meena@masti.test");
    expect((await viewer.post(`/api/visa/cases/${mehta.caseNo}/dispatch/email`).send({})).status).toBe(403);

    const again = await processor.post(`/api/visa/cases/${shah.caseNo}/dispatch/email`).send({});
    expect(again.status).toBe(200);
    expect((again.body.case as CaseDto).docket!.email).toMatchObject({ to: "ops@globalvisa.test", error: null });
    expect((await inbox()).messages).toHaveLength(1);

    const twice = await processor.post(`/api/visa/cases/${mehta.caseNo}/dispatch/email`).send({});
    expect(twice.status).toBe(409);
    expect(twice.body.message).toMatch(/already gone to ops@globalvisa.test/);
    expect((await inbox()).messages).toHaveLength(1);
  });

  it("holds nothing open while the mail server answers: the docket is marked as sending, not locked", async () => {
    const { mehta, processor } = await docketOfTwo();
    const { docketNo } = (await load(processor, mehta.caseNo)).docket!;
    const seen: { sendingAt: Date | null; locked: boolean }[] = [];
    failures.whileSending = async () => {
      const { vendorEmailSendingAt } = await prisma.docket.findUniqueOrThrow({ where: { docketNo }, select: { vendorEmailSendingAt: true } });
      // NOWAIT fails at once if the send still held the docket's row.
      const locked = await prisma
        .$transaction(async (tx) => tx.$queryRaw`SELECT "id" FROM "Docket" WHERE "docketNo" = ${docketNo} FOR UPDATE NOWAIT`)
        .then(() => false, () => true);
      seen.push({ sendingAt: vendorEmailSendingAt, locked });
    };
    expect((await dispatch(processor, mehta.caseNo)).status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.sendingAt).not.toBeNull();
    expect(seen[0]!.locked).toBe(false);
    expect(await prisma.docket.findUniqueOrThrow({ where: { docketNo } })).toMatchObject({ vendorEmailSendingAt: null, vendorEmailTo: "ops@globalvisa.test" });
  });

  it("two presses of Send again at once send it once", async () => {
    const { mehta, shah, processor } = await docketOfTwo();
    failures.next = 1;
    expect((await dispatch(processor, mehta.caseNo)).status).toBe(200);
    failures.whileSending = () => new Promise((resolve) => setTimeout(resolve, 300));
    const both = await Promise.all([
      processor.post(`/api/visa/cases/${mehta.caseNo}/dispatch/email`).send({}),
      processor.post(`/api/visa/cases/${shah.caseNo}/dispatch/email`).send({}),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(both.find((r) => r.status === 409)!.body.message).toMatch(/being sent right now|already gone/);
    expect((await inbox()).messages).toHaveLength(1);
  });

  it("Send again waits while a send is under way; one stuck for 5 minutes (the server stopped mid-send) may be retried", async () => {
    const { mehta, processor } = await docketOfTwo();
    failures.next = 1;
    expect((await dispatch(processor, mehta.caseNo)).status).toBe(200);
    const { docketNo } = (await load(processor, mehta.caseNo)).docket!;

    await prisma.docket.update({ where: { docketNo }, data: { vendorEmailSendingAt: new Date() } });
    expect((await load(processor, mehta.caseNo)).docket!.email).toMatchObject({ sentAt: null, sending: true });
    const busy = await processor.post(`/api/visa/cases/${mehta.caseNo}/dispatch/email`).send({});
    expect(busy.status).toBe(409);
    expect(busy.body.message).toMatch(/being sent right now/);
    expect((await inbox()).messages).toHaveLength(0);

    await prisma.docket.update({ where: { docketNo }, data: { vendorEmailSendingAt: new Date(Date.now() - 5 * 60_000 - 1000) } });
    expect((await load(processor, mehta.caseNo)).docket!.email).toMatchObject({ sentAt: null, sending: false });
    const retried = await processor.post(`/api/visa/cases/${mehta.caseNo}/dispatch/email`).send({});
    expect(retried.status).toBe(200);
    expect((retried.body.case as CaseDto).docket!.email).toMatchObject({ to: "ops@globalvisa.test", error: null, sending: false });
    expect((await inbox()).messages).toHaveLength(1);
  });

  it("isn't sent before dispatch", async () => {
    const { mehta, processor } = await docketOfTwo();
    const res = await processor.post(`/api/visa/cases/${mehta.caseNo}/dispatch/email`).send({});
    expect(res.status).toBe(409);
    expect((await inbox()).messages).toHaveLength(0);
  });
});

describe("the database", () => {
  it("refuses a dispatched docket without who, when and the courier, and a lowercase slip number", async () => {
    const { mehta, processor } = await docketOfTwo();
    const { docketNo } = (await load(processor, mehta.caseNo)).docket!;
    await expect(prisma.docket.update({ where: { docketNo }, data: { status: "DISPATCHED" } })).rejects.toThrow();
    await expect(prisma.docket.update({ where: { docketNo }, data: { awbNo: "12345678" } })).rejects.toThrow();
    const res = await dispatch(processor, mehta.caseNo);
    expect(res.status).toBe(200);
    await expect(prisma.docket.update({ where: { docketNo }, data: { awbNo: "abc123" } })).rejects.toThrow();
    // Sent means when and to whom, and no error.
    await expect(prisma.docket.update({ where: { docketNo }, data: { vendorEmailTo: null } })).rejects.toThrow();
    await expect(prisma.docket.update({ where: { docketNo }, data: { vendorEmailError: "x" } })).rejects.toThrow();
    // A sent email isn't sending.
    await expect(prisma.docket.update({ where: { docketNo }, data: { vendorEmailSendingAt: new Date() } })).rejects.toThrow();
  });

  it("refuses an open docket marked as sending its email", async () => {
    const { mehta, processor } = await docketOfTwo();
    const { docketNo } = (await load(processor, mehta.caseNo)).docket!;
    await expect(prisma.docket.update({ where: { docketNo }, data: { vendorEmailSendingAt: new Date() } })).rejects.toThrow();
  });
});
