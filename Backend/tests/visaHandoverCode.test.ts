import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { decidedCase, doorCodeMessages, lastDoorCode, receivedCase, saveCase, visaStaff, type Agent } from "./visaHelpers";

// Visa Step 8: the client's one-time code at the office handover (docs/decisions/0014-visa-delivered.md Decision 2,
// amended 23 Oct 2026), as the delivery boy's at the door (0015 Decision 4). Whoever is at the desk sends it to the
// client's WhatsApp (message 16; only its hash kept; a wait before another; wrong tries counted) and checks the 6 digits
// the client reads out. No code, no handover, at every desk handover; a confirmation counts on its day only.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

/** A small "JPEG": the server checks a photo's first bytes, not the picture. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const MESSAGE = (code: string) => `${code} is your verification code.\n\nThis code expires in 10 minutes.`;
const NOT_CONFIRMED = ["The client hasn't confirmed with the code yet."];

const codePath = (caseNo: string) => `/api/visa/cases/${caseNo}/handover/code`;
const send = (agent: Agent, caseNo: string) => agent.post(codePath(caseNo)).send({});
const check = (agent: Agent, caseNo: string, code: string) => agent.post(`${codePath(caseNo)}/check`).send({ code });
const updatedAtOf = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case.updatedAt as string;
/** Lets the desk send a new code now: the last one went more than the wait ago (and it still works). */
const afterTheWait = (enquiryId: string) => prisma.handoverCode.update({ where: { enquiryId }, data: { sentAt: new Date(Date.now() - 61_000) } });

/** "Hand over" at the office: 2 + 0 counted, the first traveller collecting (or `receiver`), a fresh photo. */
async function handOver(agent: Agent, caseNo: string, receiver?: { name: string }) {
  // Read first: a request awaited inside another's .send(...) breaks supertest.
  const c = (await agent.get(`/api/visa/cases/${caseNo}`)).body.case;
  const photoId = (await agent.post(`/api/visa/cases/${caseNo}/handover/photo`).set("Content-Type", "image/jpeg").send(JPEG)).body.photo.id;
  return agent
    .post(`/api/visa/cases/${caseNo}/handover`)
    .send({ mode: "OFFICE", booklets: { current: 2, old: 0 }, receiver: receiver ?? { travellerId: c.travellers[0].id }, photoId, updatedAt: c.updatedAt });
}

describe("the client's code at the desk", () => {
  it("goes to the client's WhatsApp, kept only as a hash; masked; staff never see it; another only after the wait", async () => {
    const { c, processor } = await receivedCase();
    const before = await updatedAtOf(processor, c.caseNo);
    expect((await processor.get(codePath(c.caseNo))).body).toEqual({ code: null });

    const res = await send(processor, c.caseNo);
    expect(res.status).toBe(200);
    const state = res.body.code;
    expect(state).toMatchObject({ sentTo: "+91••••••1234", confirmedAt: null, message: { status: "QUEUED", error: null } });
    expect(Date.parse(state.expiresAt) - Date.parse(state.sentAt)).toBe(10 * 60_000);
    expect(Date.parse(state.resendAt) - Date.parse(state.sentAt)).toBe(60_000);

    // Message 16, Meta's fixed words, to the client's main number, as at the door.
    const [message] = await doorCodeMessages();
    expect(message).toMatchObject({ enquiryId: c.id, toMobile: "+919825041234", status: "QUEUED" });
    const code = await lastDoorCode();
    expect(message!.body).toBe(MESSAGE(code));
    const row = await prisma.handoverCode.findUniqueOrThrow({ where: { enquiryId: c.id } });
    expect(row.hash).toBe(createHash("sha256").update(`handover:${c.id}:${code}`).digest("hex"));
    expect(row).toMatchObject({ sentTo: "+919825041234", tries: 0, confirmedAt: null });
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.handover.code.send" } })).toMatchObject({
      entityType: "Enquiry",
      entityId: c.id,
      after: { to: "+919825041234" },
    });

    // The case's "Sent to the client" card shows the message without the code, even while it waits to go.
    const card = (await processor.get(`/api/visa/cases/${c.caseNo}/messages`)).body.messages as { title: string; body: string }[];
    expect(card.find((m) => m.title === "One-time code")!.body).toBe(MESSAGE("••••••"));
    expect(JSON.stringify(card)).not.toContain(code);
    // The case itself doesn't change: a page open on it isn't stale.
    expect(await updatedAtOf(processor, c.caseNo)).toBe(before);

    const soon = await send(processor, c.caseNo);
    expect(soon.status).toBe(409);
    expect(soon.body.message).toMatch(/^Wait \d+ seconds, then send a new code\.$/);
    await afterTheWait(c.id);
    expect((await send(processor, c.caseNo)).status).toBe(200);
    expect(await doorCodeMessages()).toHaveLength(2);
    // One code per case: the new one replaces the old.
    expect(await prisma.handoverCode.count()).toBe(1);
  });

  it("shows where its WhatsApp has got to, and why it couldn't go", async () => {
    const { c, processor } = await receivedCase();
    await send(processor, c.caseNo);
    const shown = async () => (await processor.get(codePath(c.caseNo))).body.code.message;
    expect(await shown()).toEqual({ status: "QUEUED", error: null });

    // As the outbox records it when the provider refuses it.
    const [message] = await doorCodeMessages();
    const error = "That number isn't on WhatsApp, or isn't written correctly.";
    await prisma.outboundMessage.update({ where: { id: message!.id }, data: { status: "FAILED", error, failedAt: new Date() } });
    expect(await shown()).toEqual({ status: "FAILED", error });

    // A new code has its own message: the dialog follows that one.
    await afterTheWait(c.id);
    expect((await send(processor, c.caseNo)).body.code.message).toEqual({ status: "QUEUED", error: null });
  });

  it("is checked: a typo isn't a try; wrong ones count down; then it's dead, or expires; the right one confirms", async () => {
    const { c, processor } = await receivedCase();
    const first = await check(processor, c.caseNo, "123456");
    expect(first.status).toBe(409);
    expect(first.body.message).toBe("Send the code first.");

    await send(processor, c.caseNo);
    const code = await lastDoorCode();
    const wrong = code === "000000" ? "111111" : "000000";
    const typo = await check(processor, c.caseNo, "12 34");
    expect(typo.status).toBe(400);
    expect(typo.body.issues.code).toEqual(["Type the 6 digits the client reads out."]);

    const answers: string[] = [];
    for (let i = 0; i < 5; i++) answers.push((await check(processor, c.caseNo, wrong)).body.issues.code[0]);
    expect(answers).toEqual([
      "That's not the code. 4 tries left.",
      "That's not the code. 3 tries left.",
      "That's not the code. 2 tries left.",
      "That's not the code. 1 try left.",
      "That's not the code, and that was the last try. Send a new code.",
    ]);
    expect((await prisma.handoverCode.findUniqueOrThrow({ where: { enquiryId: c.id } })).tries).toBe(5);
    expect(await prisma.auditLog.count({ where: { action: "visa.handover.code.wrong" } })).toBe(5);
    expect((await check(processor, c.caseNo, code)).body.issues.code).toEqual(["Too many wrong tries. Send a new code."]);

    await afterTheWait(c.id);
    await send(processor, c.caseNo);
    const second = await lastDoorCode();
    expect((await prisma.handoverCode.findUniqueOrThrow({ where: { enquiryId: c.id } })).tries).toBe(0);
    await prisma.handoverCode.update({
      where: { enquiryId: c.id },
      data: { sentAt: new Date(Date.now() - 11 * 60_000), expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await check(processor, c.caseNo, second)).body.issues.code).toEqual(["This code has expired. Send a new one."]);

    await send(processor, c.caseNo);
    const ok = await check(processor, c.caseNo, await lastDoorCode());
    expect(ok.status).toBe(200);
    expect(ok.body.code.confirmedAt).not.toBeNull();
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.handover.code.confirm" } })).toMatchObject({
      entityId: c.id,
      after: { sentTo: "+919825041234" },
    });
    // Confirmed stays confirmed; no new code after it.
    expect((await check(processor, c.caseNo, wrong)).status).toBe(200);
    expect((await send(processor, c.caseNo)).body.message).toBe("The client has already confirmed with the code.");
  });
});

describe("no code, no handover", () => {
  it("the handover waits for the client's code, then keeps its proof", async () => {
    const { c, processor } = await receivedCase();
    const early = await handOver(processor, c.caseNo);
    expect(early.status).toBe(400);
    expect(early.body.issues.code).toEqual(NOT_CONFIRMED);
    // Sent, but not confirmed yet: still no.
    await send(processor, c.caseNo);
    expect((await handOver(processor, c.caseNo)).body.issues.code).toEqual(NOT_CONFIRMED);
    expect(await prisma.visaHandover.count()).toBe(0);

    await check(processor, c.caseNo, await lastDoorCode());
    const res = await handOver(processor, c.caseNo);
    expect(res.status).toBe(200);
    const { confirmedAt } = await prisma.handoverCode.findUniqueOrThrow({ where: { enquiryId: c.id } });
    expect(await prisma.visaHandover.findUniqueOrThrow({ where: { enquiryId: c.id } })).toMatchObject({
      mode: "OFFICE",
      codeSentTo: "+919825041234",
      codeConfirmedAt: confirmedAt,
    });
    expect(res.body.case).toMatchObject({ stage: { code: "DELIVERED" }, status: "CLOSED" });
    expect(res.body.case.handover.code).toEqual({ sentTo: "+91••••••1234", confirmedAt: confirmedAt!.toISOString() });
    const logged = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.handover" } });
    expect(logged.after).toMatchObject({ code: { sentTo: "+919825041234", confirmedAt: confirmedAt!.toISOString() } });

    // Handed over: no more codes for it.
    const after = await send(processor, c.caseNo);
    expect(after.status).toBe(409);
    expect(after.body.message).toBe("Passports are handed over from Passport back.");
  });

  it("a code confirmed on another day doesn't count: a new one is sent", async () => {
    const { c, processor } = await receivedCase();
    await send(processor, c.caseNo);
    await check(processor, c.caseNo, await lastDoorCode());
    const yesterday = Date.now() - 24 * 60 * 60_000;
    await prisma.handoverCode.update({
      where: { enquiryId: c.id },
      data: { sentAt: new Date(yesterday - 60_000), expiresAt: new Date(yesterday + 9 * 60_000), confirmedAt: new Date(yesterday) },
    });
    expect((await processor.get(codePath(c.caseNo))).body.code.confirmedAt).toBeNull();
    expect((await handOver(processor, c.caseNo)).body.issues.code).toEqual(NOT_CONFIRMED);
    expect((await check(processor, c.caseNo, "123456")).body.issues.code).toEqual(["This code has expired. Send a new one."]);

    expect((await send(processor, c.caseNo)).status).toBe(200);
    expect((await check(processor, c.caseNo, await lastDoorCode())).status).toBe(200);
    expect((await handOver(processor, c.caseNo)).status).toBe(200);
  });

  it("a cancelled case's passports handed back before dispatch need it too", async () => {
    const staff = await visaStaff();
    const c = await saveCase(staff);
    expect((await staff.post(`/api/visa/cases/${c.caseNo}/start`).send({})).status).toBe(200);
    expect((await staff.patch(`/api/visa/cases/${c.caseNo}`).send({ bookletsCurrent: 2, bookletsOld: 0 })).status).toBe(200);
    const reasonId = (await prisma.enquiryReason.findUniqueOrThrow({ where: { code: "TRIP_CANCELLED" } })).id;
    // Read first: a request awaited inside another's .send(...) breaks supertest.
    const updatedAt = await updatedAtOf(staff, c.caseNo);
    expect((await staff.post(`/api/enquiries/${c.caseNo}/cancel`).send({ reasonId, updatedAt })).status).toBe(200);

    const early = await handOver(staff, c.caseNo, { name: "Sunita Mehta" });
    expect(early.status).toBe(400);
    expect(early.body.issues.code).toEqual(NOT_CONFIRMED);
    expect((await send(staff, c.caseNo)).status).toBe(200);
    expect((await check(staff, c.caseNo, await lastDoorCode())).status).toBe(200);
    const res = await handOver(staff, c.caseNo, { name: "Sunita Mehta" });
    expect(res.status).toBe(200);
    expect(res.body.case).toMatchObject({ status: "CANCELLED", stage: { code: "DOCUMENTS" }, handover: { code: { sentTo: "+91••••••1234" } } });
  });
});

describe("who may, and when", () => {
  it("anyone at the desk who may hand over, once the passports are in our stock; not view-only users or other departments", async () => {
    const before = await decidedCase();
    const atDecision = await send(before.processor, before.c.caseNo);
    expect(atDecision.status).toBe(409);
    expect(atDecision.body.message).toBe("Passports are handed over from Passport back.");
    expect(await doorCodeMessages()).toHaveLength(0);

    const { c } = await receivedCase({ extra: { mobile: "98250 41237", clientName: "Sunil Shah" }, vendorId: before.c.vendor.id });
    const kiranUser = await createUser({ name: "Kiran Desai", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    const kiran = await loginAs("kiran@masti.test");
    expect((await send(kiran, c.caseNo)).status).toBe(200);
    expect(await prisma.handoverCode.findUniqueOrThrow({ where: { enquiryId: c.id } })).toMatchObject({ sentById: kiranUser.id, sentTo: "+919825041237" });
    expect((await check(kiran, c.caseNo, await lastDoorCode())).status).toBe(200);

    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    await createUser({ name: "Hetal", email: "hetal@masti.test", departments: [{ code: "HOLIDAYS", access: "EDIT" }] });
    for (const email of ["meena@masti.test", "hetal@masti.test"]) {
      const agent = await loginAs(email);
      expect((await agent.get(codePath(c.caseNo))).status).toBe(403);
      expect((await send(agent, c.caseNo)).status).toBe(403);
      expect((await check(agent, c.caseNo, "123456")).status).toBe(403);
    }
  });
});

describe("the database", () => {
  it("keeps one code per case, its times in order", async () => {
    const { c } = await receivedCase();
    const neha = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
    const now = Date.now();
    const code = (data: Record<string, unknown>) =>
      prisma.handoverCode.create({
        data: { enquiryId: c.id, hash: "x", sentAt: new Date(now), sentTo: "+919825041234", sentById: neha.id, expiresAt: new Date(now + 600_000), ...data } as never,
      });
    await expect(code({ expiresAt: new Date(now) })).rejects.toThrow(/HandoverCode_times/);
    await expect(code({ tries: -1 })).rejects.toThrow(/HandoverCode_times/);
    await expect(code({ confirmedAt: new Date(now - 1000) })).rejects.toThrow(/HandoverCode_times/);
    await code({});
    await expect(code({})).rejects.toThrow(/Unique constraint|HandoverCode_pkey/);
  });
});
