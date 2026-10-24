import { beforeEach, describe, expect, it } from "vitest";
import { addDays, istToday } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { nextOpenDay } from "../src/modules/holidays/blockedDays";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import {
  codeConfirmed,
  decidedCase,
  dispatchCase,
  evisaCase,
  makeInvoiceable,
  mastiReady,
  raiseInvoice,
  recalledCase,
  saveCase,
  visaStaff,
  type Agent,
} from "./visaHelpers";

// Today's passport card (change request 23, docs/decisions/0017-today-dashboard.md amendment 3): for the Head and the
// Visa HOD, the booklets in our office, with the vendors, on the way back and missing from short returns, as each step
// moves them.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

type Booklets = { current: number; old: number };
const none: Booklets = { current: 0, old: 0 };

/** A small "JPEG": the server checks a photo's first bytes, not the picture. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);

const stock = async (agent: Agent) => {
  const res = await agent.get("/api/today");
  expect(res.status).toBe(200);
  return res.body.passportStock as { inOffice: Booklets; withVendors: Booklets; onTheWayBack: Booklets; missing: Booklets } | null;
};
// Read first: a request awaited inside another's .send(...) breaks supertest.
const updatedAtOf = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case.updatedAt as string;

/** The office handover of `booklets`, the case's first traveller collecting. */
async function handOver(agent: Agent, caseNo: string, booklets: Booklets) {
  const c = (await agent.get(`/api/visa/cases/${caseNo}`)).body.case;
  const photoId = (await agent.post(`/api/visa/cases/${caseNo}/handover/photo`).set("Content-Type", "image/jpeg").send(JPEG)).body.photo.id;
  await codeConfirmed(caseNo);
  const res = await agent
    .post(`/api/visa/cases/${caseNo}/handover`)
    .send({ mode: "OFFICE", booklets, receiver: { travellerId: c.travellers[0].id }, updatedAt: c.updatedAt, photoId });
  expect(res.status).toBe(200);
}

/** "Passports on the way back", collected today and expected in two office days. */
async function onTheirWay(agent: Agent, caseNo: string) {
  const expectedOn = await nextOpenDay(addDays(istToday(), 2), { office: true });
  const updatedAt = await updatedAtOf(agent, caseNo);
  const res = await agent.post(`/api/visa/cases/${caseNo}/passports-back`).send({ collectedOn: istToday(), expectedOn, updatedAt });
  expect(res.status).toBe(200);
}

async function received(agent: Agent, caseNo: string, booklets: Booklets, stickers: { travellerId: string; check: string }[] = []) {
  const updatedAt = await updatedAtOf(agent, caseNo);
  const res = await agent.post(`/api/visa/cases/${caseNo}/passports-received`).send({ booklets, stickers, updatedAt });
  expect(res.status).toBe(200);
}

describe("Today's passport card", () => {
  it("is for the Head and the Visa HOD only, everyone else gets none", async () => {
    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    // An HOD elsewhere who works visa cases, and a view-only visa user: neither leads Visa.
    await createUser({
      name: "Kiran",
      email: "kiran@masti.test",
      departments: [
        { code: "HOTELS", role: "HOD" },
        { code: "VISA", access: "EDIT" },
      ],
    });
    await createUser({ name: "Mona", email: "mona@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    const empty = { inOffice: none, withVendors: none, onTheWayBack: none, missing: none };

    expect(await stock(await loginAs("vimal@masti.test"))).toEqual(empty);
    expect(await stock(await loginAs("riya@masti.test"))).toEqual(empty);
    expect(await stock(await visaStaff())).toBeNull();
    expect(await stock(await loginAs("kiran@masti.test"))).toBeNull();
    expect(await stock(await loginAs("mona@masti.test"))).toBeNull();
  });

  it("counts them in at intake, keeps them in the office while the docket is open, and moves them to the vendor at dispatch", async () => {
    const head = await mastiReady();
    const aarti = await visaStaff();
    const other = await saveCase(aarti, { mobile: "9825000001", clientName: "Sunita Patel" });
    // Nobody counted this one's booklets yet: it isn't counted.
    await saveCase(aarti, { mobile: "9825000002", clientName: "Mehul Shah" });
    expect((await stock(head))!.inOffice).toEqual(none);
    const counted = await aarti.patch(`/api/visa/cases/${other.caseNo}`).send({ arrival: "CLIENT_BRINGS", bookletsCurrent: 3, bookletsOld: 1 });
    expect(counted.status).toBe(200);
    expect((await stock(head))!.inOffice).toEqual({ current: 3, old: 1 });

    const c = await dispatchCase();
    await prisma.visaCase.update({ where: { enquiryId: c.id }, data: { bookletsCurrent: 2, bookletsOld: 1 } });
    const processor = await loginAs("neha@masti.test");
    const seen = await updatedAtOf(processor, c.caseNo);
    const docket = await processor.post(`/api/visa/cases/${c.caseNo}/docket`).send({ mode: "OWN", updatedAt: seen });
    expect(docket.status).toBe(200);
    await makeInvoiceable(processor, c, { clientName: "Rakesh Mehta" });
    await raiseInvoice(processor, c.caseNo);
    // Packed, not sent: still here.
    expect(await stock(head)).toMatchObject({ inOffice: { current: 5, old: 2 }, withVendors: none });

    const courier = await prisma.courier.findUniqueOrThrow({ where: { code: "BLUE_DART" } });
    const sent = await processor.post(`/api/visa/cases/${c.caseNo}/dispatch`).send({ courierId: courier.id, awbNo: "12345678", caseNos: [c.caseNo] });
    expect(sent.status).toBe(200);
    expect(await stock(head)).toEqual({ inOffice: { current: 3, old: 1 }, withVendors: { current: 2, old: 1 }, onTheWayBack: none, missing: none });
  });

  it("follows them back: on the way, in the office as counted, a short return's missing ones apart, out at the handover", async () => {
    const head = await mastiReady();
    const { c, processor, adult } = await decidedCase();
    await prisma.visaCase.update({ where: { enquiryId: c.id }, data: { bookletsCurrent: 2, bookletsOld: 1 } });
    expect(await stock(head)).toEqual({ inOffice: none, withVendors: { current: 2, old: 1 }, onTheWayBack: none, missing: none });

    await onTheirWay(processor, c.caseNo);
    expect(await stock(head)).toEqual({ inOffice: none, withVendors: none, onTheWayBack: { current: 2, old: 1 }, missing: none });

    // The old one didn't come back with them.
    await received(processor, c.caseNo, { current: 2, old: 0 }, [{ travellerId: adult, check: "MATCHES" }]);
    expect(await stock(head)).toEqual({ inOffice: { current: 2, old: 0 }, withVendors: none, onTheWayBack: none, missing: { current: 0, old: 1 } });

    const short = await updatedAtOf(processor, c.caseNo);
    const rest = await processor.post(`/api/visa/cases/${c.caseNo}/passports-received/rest`).send({ booklets: { current: 0, old: 1 }, updatedAt: short });
    expect(rest.status).toBe(200);
    expect(await stock(head)).toEqual({ inOffice: { current: 2, old: 1 }, withVendors: none, onTheWayBack: none, missing: none });

    await handOver(processor, c.caseNo, { current: 2, old: 1 });
    expect(await stock(head)).toEqual({ inOffice: none, withVendors: none, onTheWayBack: none, missing: none });
  });

  it("counts a recalled file's with the vendor, one per traveller when nobody counted them, and drops a cleared shortfall", async () => {
    const head = await mastiReady();
    const { c, processor } = await recalledCase();
    expect(await stock(head)).toMatchObject({ inOffice: none, withVendors: { current: 2, old: 0 } });

    await onTheirWay(processor, c.caseNo);
    await received(processor, c.caseNo, { current: 1, old: 0 });
    expect(await stock(head)).toMatchObject({ inOffice: { current: 1, old: 0 }, onTheWayBack: none, missing: { current: 1, old: 0 } });

    const reasonId = (await prisma.missingPassportReason.findUniqueOrThrow({ where: { code: "EMBASSY_KEPT" } })).id;
    const short = await updatedAtOf(processor, c.caseNo);
    const cleared = await processor.post(`/api/visa/cases/${c.caseNo}/passports-received/clear`).send({ reasonId, updatedAt: short });
    expect(cleared.status).toBe(200);
    expect(await stock(head)).toMatchObject({ inOffice: { current: 1, old: 0 }, missing: none });
  });

  it("keeps a cancelled case's and an e-visa's in the office until they're handed back", async () => {
    const head = await mastiReady();
    // An e-visa whose passports were counted in: they never go to a vendor.
    await evisaCase({ held: 2 });
    expect(await stock(head)).toMatchObject({ inOffice: { current: 2, old: 0 }, withVendors: none });

    const aarti = await visaStaff();
    const other = await saveCase(aarti, { mobile: "9825000001", clientName: "Sunita Patel" });
    expect((await aarti.patch(`/api/visa/cases/${other.caseNo}`).send({ arrival: "CLIENT_BRINGS", bookletsCurrent: 1, bookletsOld: 2 })).status).toBe(200);
    const reasonId = (await prisma.enquiryReason.findUniqueOrThrow({ where: { code: "TRIP_CANCELLED" } })).id;
    await prisma.enquiry.update({ where: { id: other.id }, data: { status: "CANCELLED", reasonId } });
    expect((await stock(head))!.inOffice).toEqual({ current: 3, old: 2 });

    await handOver(aarti, other.caseNo, { current: 1, old: 2 });
    expect((await stock(head))!.inOffice).toEqual({ current: 2, old: 0 });
  });
});
