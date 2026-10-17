import { beforeEach, describe, expect, it } from "vitest";
import { addDays, istToday } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { nextOpenDay } from "../src/modules/holidays/blockedDays";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, prisma, resetDb } from "./helpers";
import { decidedCase, recalledCase, visaStaff, type Agent } from "./visaHelpers";

// A short return (docs/decisions/0013-visa-passport-back.md Decision 5, amended 17 Oct 2026): fewer booklets came back
// than went out. The handover, its photo and booking the delivery boy wait until "Received the rest" makes up the count,
// or "Clear the shortfall" records, with a reason from the list, that they won't come back. Either is for whoever can
// act on the case, whatever its status.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

type Booklets = { current: number; old: number };
interface CaseDto {
  updatedAt: string;
  dueAt: string | null;
  stage: { code: string };
  passportsReceived: {
    booklets: Booklets;
    missing: Booklets;
    shortfallCleared: { at: string; by: { name: string } | null; reason: string } | null;
  } | null;
  handover: { booklets: Booklets } | null;
  travellers: { id: string }[];
}

/** A small "JPEG": the server checks a photo's first bytes, not the picture. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const HELD_ONE = "1 current passport is missing: record it when it comes, or clear the shortfall first.";
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const reasonId = async (code: string) => (await prisma.missingPassportReason.findUniqueOrThrow({ where: { code } })).id;

/**
 * Mehta's file (decidedCase: Rakesh approved, Aarav refused; or recalledCase), `intake` going to the vendor (else one
 * current per traveller: 2 + 0), on its way back and received with `back` counted.
 */
async function shortCase({ back, intake, recalled = false }: { back: Booklets; intake?: Booklets; recalled?: boolean }) {
  const d = recalled ? { ...(await recalledCase()), adult: null } : await decidedCase();
  const { c, processor } = d;
  if (intake) await prisma.visaCase.update({ where: { enquiryId: c.id }, data: { bookletsCurrent: intake.current, bookletsOld: intake.old } });
  const expectedOn = await nextOpenDay(addDays(istToday(), 2), { office: true });
  const decided = (await load(processor, c.caseNo)).updatedAt;
  expect((await processor.post(`/api/visa/cases/${c.caseNo}/passports-back`).send({ collectedOn: istToday(), expectedOn, updatedAt: decided })).status).toBe(200);
  const inTransit = (await load(processor, c.caseNo)).updatedAt;
  const stickers = d.adult ? [{ travellerId: d.adult, check: "MATCHES" }] : [];
  const received = await processor.post(`/api/visa/cases/${c.caseNo}/passports-received`).send({ booklets: back, stickers, updatedAt: inTransit });
  expect(received.status).toBe(200);
  return { c, processor };
}

/** "Received the rest", with the case's updatedAt as the page has it (unless `updatedAt` says otherwise). */
async function receiveRest(agent: Agent, caseNo: string, booklets: Booklets, updatedAt?: string) {
  const seen = updatedAt ?? (await load(agent, caseNo)).updatedAt;
  return agent.post(`/api/visa/cases/${caseNo}/passports-received/rest`).send({ booklets, updatedAt: seen });
}

/** "Clear the shortfall", with the reason by code: "Embassy kept it" unless said. */
async function clearShortfall(agent: Agent, caseNo: string, code = "EMBASSY_KEPT") {
  const { updatedAt } = await load(agent, caseNo);
  const id = await reasonId(code);
  return agent.post(`/api/visa/cases/${caseNo}/passports-received/clear`).send({ reasonId: id, updatedAt });
}

const photo = (agent: Agent, caseNo: string) => agent.post(`/api/visa/cases/${caseNo}/handover/photo`).set("Content-Type", "image/jpeg").send(JPEG);

/** "Hand over to the client" at the office: `booklets` counted, Rakesh collecting, the photo given (else a fresh one). */
async function handOver(agent: Agent, caseNo: string, booklets: Booklets, photoId?: string) {
  // Read first: a request awaited inside another's .send(...) breaks supertest.
  const c = await load(agent, caseNo);
  const id = photoId ?? (await photo(agent, caseNo)).body.photo.id;
  return agent
    .post(`/api/visa/cases/${caseNo}/handover`)
    .send({ mode: "OFFICE", booklets, receiver: { travellerId: c.travellers[0]!.id }, photoId: id, updatedAt: c.updatedAt });
}

/** "Book the delivery boy": Ramesh, tomorrow's first open day, 4–6 pm, the client's email on file. */
async function bookDelivery(agent: Agent, caseNo: string, clientId: string) {
  await prisma.client.update({ where: { id: clientId }, data: { email: "rakesh@example.com" } });
  const ramesh = (await prisma.user.findUnique({ where: { mobile: "+919825000001" } })) ?? (await createUser({ name: "Ramesh", mobile: "+919825000001", type: "FIELD" }));
  const slot = await prisma.fieldSlot.findUniqueOrThrow({ where: { code: "EVENING" } });
  const day = await nextOpenDay(addDays(istToday(), 1), { office: true });
  const { updatedAt } = await load(agent, caseNo);
  return agent
    .post(`/api/visa/cases/${caseNo}/field-jobs`)
    .send({ kind: "DELIVERY", assigneeId: ramesh.id, day, slotId: slot.id, address: "B-702, Raghuvir Residency, Vesu, Surat 395007", updatedAt });
}

describe("a short return holds the handover", () => {
  it("1 of 2 back: what's missing shows; the photo, the handover and the delivery boy wait; the receipt is as recorded", async () => {
    const { c, processor } = await shortCase({ back: { current: 1, old: 0 } });
    const held = await load(processor, c.caseNo);
    expect(held.passportsReceived).toMatchObject({ booklets: { current: 1, old: 0 }, missing: { current: 1, old: 0 }, shortfallCleared: null });
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.passports.received" } })).after).toMatchObject({
      booklets: { current: 1, old: 0 },
      intake: { current: 2, old: 0 },
      matchesIntake: false,
    });

    const snap = await photo(processor, c.caseNo);
    expect(snap.status).toBe(409);
    expect(snap.body.message).toBe(HELD_ONE);
    const handed = await handOver(processor, c.caseNo, { current: 1, old: 0 }, "no-photo-yet");
    expect(handed.status).toBe(409);
    expect(handed.body.message).toBe(HELD_ONE);
    const delivery = await bookDelivery(processor, c.caseNo, (await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id } })).clientId);
    expect(delivery.status).toBe(409);
    expect(delivery.body.message).toBe(HELD_ONE);
    expect(await prisma.visaHandover.count()).toBe(0);
    expect(await prisma.fieldJob.count()).toBe(0);
  });

  it("old booklets count too", async () => {
    const { c, processor } = await shortCase({ intake: { current: 2, old: 1 }, back: { current: 1, old: 0 } });
    expect((await load(processor, c.caseNo)).passportsReceived?.missing).toEqual({ current: 1, old: 1 });
    expect((await photo(processor, c.caseNo)).body.message).toBe(
      "2 passports are missing (1 current, 1 old): record them when they come, or clear the shortfall first.",
    );
  });

  it("a recalled file is held the same way", async () => {
    const { c, processor } = await shortCase({ recalled: true, back: { current: 1, old: 0 } });
    expect((await photo(processor, c.caseNo)).body.message).toBe(HELD_ONE);
  });

  it("more back than went out isn't held: shown, and handed over", async () => {
    const { c, processor } = await shortCase({ back: { current: 2, old: 1 } });
    expect((await load(processor, c.caseNo)).passportsReceived?.missing).toEqual({ current: 0, old: 0 });
    expect((await handOver(processor, c.caseNo, { current: 2, old: 1 })).status).toBe(200);
  });
});

describe("Received the rest", () => {
  it("adds the late booklets to our stock, audited; the due time stays; then the handover of 2 + 0 goes ahead", async () => {
    const { c, processor } = await shortCase({ back: { current: 1, old: 0 } });
    const before = await load(processor, c.caseNo);
    const res = await receiveRest(processor, c.caseNo, { current: 1, old: 0 });
    expect(res.status).toBe(200);
    const after = res.body.case as CaseDto;
    expect(after.passportsReceived).toMatchObject({ booklets: { current: 2, old: 0 }, missing: { current: 0, old: 0 }, shortfallCleared: null });
    expect(after.updatedAt).not.toBe(before.updatedAt);
    expect(after.dueAt).toBe(before.dueAt);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.passports.receivedRest" } });
    expect(log.actorId).toBe((await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } })).id);
    expect(log.before).toMatchObject({ booklets: { current: 1, old: 0 }, missing: { current: 1, old: 0 }, shortfallCleared: false });
    expect(log.after).toMatchObject({ added: { current: 1, old: 0 }, booklets: { current: 2, old: 0 }, missing: { current: 0, old: 0 }, shortfallCleared: false });

    const handed = await handOver(processor, c.caseNo, { current: 2, old: 0 });
    expect(handed.status).toBe(200);
    expect((handed.body.case as CaseDto).handover?.booklets).toEqual({ current: 2, old: 0 });
  });

  it("no more of a kind than is missing, at least one, from a fresh page; nothing when nothing is missing", async () => {
    const { c, processor } = await shortCase({ back: { current: 1, old: 0 } });
    const stale = (await load(processor, c.caseNo)).updatedAt;
    const issue = async (booklets: Booklets) => {
      const res = await receiveRest(processor, c.caseNo, booklets);
      expect(res.status).toBe(400);
      return res.body.issues.booklets as string[];
    };
    expect(await issue({ current: 2, old: 0 })).toEqual(["Only 1 current passport is missing."]);
    expect(await issue({ current: 0, old: 1 })).toEqual(["No old passport is missing."]);
    expect(await issue({ current: 0, old: 0 })).toEqual(["Count at least one booklet."]);

    expect((await receiveRest(processor, c.caseNo, { current: 1, old: 0 })).status).toBe(200);
    expect((await receiveRest(processor, c.caseNo, { current: 1, old: 0 }, stale)).status).toBe(409);
    const nothing = await receiveRest(processor, c.caseNo, { current: 1, old: 0 });
    expect(nothing.status).toBe(409);
    expect(nothing.body.message).toBe("Nothing is missing: every booklet that went out is back.");
  });

  it("one that turns up after the shortfall was cleared is added, and the clear is dropped once nothing is missing", async () => {
    const { c, processor } = await shortCase({ back: { current: 1, old: 0 } });
    expect((await clearShortfall(processor, c.caseNo)).status).toBe(200);
    const res = await receiveRest(processor, c.caseNo, { current: 1, old: 0 });
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).passportsReceived).toMatchObject({ booklets: { current: 2, old: 0 }, missing: { current: 0, old: 0 }, shortfallCleared: null });
    expect(await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id } })).toMatchObject({
      shortfallClearedAt: null,
      shortfallClearedById: null,
      shortfallReasonId: null,
    });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.passports.receivedRest" } });
    expect(log.before).toMatchObject({ shortfallCleared: true });
    expect(log.after).toMatchObject({ shortfallCleared: false });
  });

  it("a part of a cleared shortfall keeps the clear for the rest; the handover takes what's in stock", async () => {
    const { c, processor } = await shortCase({ intake: { current: 2, old: 1 }, back: { current: 1, old: 0 } });
    expect((await clearShortfall(processor, c.caseNo)).status).toBe(200);
    const res = await receiveRest(processor, c.caseNo, { current: 0, old: 1 });
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).passportsReceived).toMatchObject({
      booklets: { current: 1, old: 1 },
      missing: { current: 1, old: 0 },
      shortfallCleared: { reason: "Embassy kept it" },
    });
    expect((await handOver(processor, c.caseNo, { current: 1, old: 1 })).status).toBe(200);
    expect((await receiveRest(processor, c.caseNo, { current: 1, old: 0 })).body.message).toBe("Passports are received at Passport back.");
  });
});

describe("Clear the shortfall", () => {
  it("by whoever can act, with an active reason, audited, once; then the desk hands over what's in our stock", async () => {
    const { c, processor } = await shortCase({ back: { current: 1, old: 0 } });
    // Aarti, Visa staff at the desk, opens the case (its passports are in our stock) but can't settle it.
    const aarti = await visaStaff();
    expect((await clearShortfall(aarti, c.caseNo)).status).toBe(403);
    expect((await receiveRest(aarti, c.caseNo, { current: 1, old: 0 })).status).toBe(403);

    await prisma.missingPassportReason.update({ where: { code: "LOST_REPORTED" }, data: { isActive: false } });
    const off = await clearShortfall(processor, c.caseNo, "LOST_REPORTED");
    expect(off.status).toBe(400);
    expect(off.body.issues.reasonId).toEqual(["Pick an active reason."]);
    const { updatedAt } = await load(processor, c.caseNo);
    const unknown = await processor.post(`/api/visa/cases/${c.caseNo}/passports-received/clear`).send({ reasonId: 999999, updatedAt });
    expect(unknown.body.issues.reasonId).toEqual(["Pick an active reason."]);

    const res = await clearShortfall(processor, c.caseNo);
    expect(res.status).toBe(200);
    const cleared = res.body.case as CaseDto;
    expect(cleared.passportsReceived).toMatchObject({
      booklets: { current: 1, old: 0 },
      missing: { current: 1, old: 0 },
      shortfallCleared: { by: { name: "Neha Joshi" }, reason: "Embassy kept it" },
    });
    expect(cleared.updatedAt).not.toBe(updatedAt);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.passports.shortfallCleared" } });
    expect(log.after).toMatchObject({ missing: { current: 1, old: 0 }, reason: "Embassy kept it" });
    const twice = await clearShortfall(processor, c.caseNo);
    expect(twice.status).toBe(409);
    expect(twice.body.message).toBe("The shortfall is already cleared.");

    const handed = await handOver(aarti, c.caseNo, { current: 1, old: 0 });
    expect(handed.status).toBe(200);
    // The delivered case keeps what was missing and why.
    expect((handed.body.case as CaseDto).passportsReceived?.shortfallCleared).toMatchObject({ reason: "Embassy kept it" });
  });

  it("not when nothing is missing", async () => {
    const { c, processor } = await shortCase({ back: { current: 2, old: 0 } });
    const res = await clearShortfall(processor, c.caseNo);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Nothing is missing: every booklet that went out is back.");
  });

  it("the database keeps when, by whom and why together, and only once received", async () => {
    const { c } = await shortCase({ back: { current: 1, old: 0 } });
    const where = { enquiryId: c.id };
    await expect(prisma.visaCase.update({ where, data: { shortfallClearedAt: new Date() } })).rejects.toThrow();
    const neha = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
    await prisma.visaCase.update({ where, data: { shortfallClearedAt: new Date(), shortfallClearedById: neha.id, shortfallReasonId: await reasonId("EMBASSY_KEPT") } });
    const unreceived = { passportsReceivedAt: null, passportsReceivedById: null, bookletsBackCurrent: null, bookletsBackOld: null };
    await expect(prisma.visaCase.update({ where, data: unreceived })).rejects.toThrow();
  });
});
