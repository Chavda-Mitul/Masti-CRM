import { beforeEach, describe, expect, it } from "vitest";
import { addMonths, istToday, toDbDate } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { dispatchCase, holdCaseLock, readyCase, untilWaitingOnLock, type Agent } from "./visaHelpers";

// Visa Step 4, the Docket card (docs/decisions/0008-visa-docket-dispatch.md Decisions 2, 3, 4, 7 and 10): a file-ready
// case joins its vendor's docket or one of its own, and can be taken out while the docket is open.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface DocketDto {
  docketNo: string;
  kind: "GROUP" | "OWN";
  status: string;
  openedAt: string;
  vendor: { name: string; city: string };
  cases: { caseNo: string; family: string; country: string; passports: number; oldPassports: number; isThisCase: boolean }[];
  totalPassports: number;
  totalOldPassports: number;
}

interface CaseDto {
  updatedAt: string;
  docket: DocketDto | null;
  openDocket: { docketNo: string; caseCount: number } | null;
}

type Case = Awaited<ReturnType<typeof dispatchCase>>;

const year = istToday().slice(0, 4);
const neha = () => loginAs("neha@masti.test");
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const reason = async (code: string) => (await prisma.enquiryReason.findUniqueOrThrow({ where: { code } })).id;

/** Presses "Add to docket" with the case's updatedAt as the page last saw it. */
async function add(agent: Agent, caseNo: string, mode: "GROUP" | "OWN" = "GROUP", updatedAt?: string) {
  const seen = updatedAt ?? (await load(agent, caseNo)).updatedAt;
  return agent.post(`/api/visa/cases/${caseNo}/docket`).send({ mode, updatedAt: seen });
}

async function takeOut(agent: Agent, caseNo: string) {
  const { updatedAt } = await load(agent, caseNo);
  return agent.delete(`/api/visa/cases/${caseNo}/docket`).send({ updatedAt });
}

/** A second (third…) client's case for the same vendor. */
const another = (c: Case, mobile: string, clientName: string) => dispatchCase({ vendorId: c.vendor.id, extra: { mobile, clientName } });

async function hodHeadViewer() {
  await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
  await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
  await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
  return { hod: await loginAs("riya@masti.test"), head: await loginAs("vimal@masti.test"), viewer: await loginAs("meena@masti.test") };
}

describe("Add to docket (Decision 2)", () => {
  it("starts the vendor's docket D-<year>-0001, and the next case joins it", async () => {
    const mehta = await dispatchCase();
    const processor = await neha();

    const first = await add(processor, mehta.caseNo);
    expect(first.status).toBe(200);
    const docket = (first.body.case as CaseDto).docket!;
    expect(docket).toMatchObject({
      docketNo: `D-${year}-0001`,
      kind: "GROUP",
      status: "OPEN",
      vendor: { name: "Global Visa Services", city: "Mumbai" },
      cases: [{ caseNo: mehta.caseNo, family: "Mehta", country: "France", isThisCase: true }],
    });

    const shah = await another(mehta, "98250 41235", "Sunil Shah");
    expect((await load(processor, shah.caseNo)).openDocket).toEqual({ docketNo: `D-${year}-0001`, caseCount: 1 });
    const second = await add(processor, shah.caseNo);
    expect(second.status).toBe(200);
    const joined = (second.body.case as CaseDto).docket!;
    expect(joined.docketNo).toBe(`D-${year}-0001`);
    expect(joined.cases.map((c) => [c.family, c.isThisCase])).toEqual([
      ["Mehta", false],
      ["Shah", true],
    ]);
    expect(await prisma.docket.count()).toBe(1);
  });

  it('"Send on its own" makes a separate single-case docket, even while the shared one is open', async () => {
    const mehta = await dispatchCase();
    const shah = await another(mehta, "98250 41235", "Sunil Shah");
    const bhatt = await another(mehta, "98250 41236", "Kiran Bhatt");
    const processor = await neha();

    await add(processor, mehta.caseNo);
    const own = await add(processor, shah.caseNo, "OWN");
    expect(own.status).toBe(200);
    expect((own.body.case as CaseDto).docket).toMatchObject({ docketNo: `D-${year}-0002`, kind: "OWN", cases: [{ family: "Shah" }] });

    // Nobody joins an OWN docket: the next shared add goes to the shared one.
    const third = await add(processor, bhatt.caseNo);
    expect((third.body.case as CaseDto).docket).toMatchObject({ docketNo: `D-${year}-0001`, kind: "GROUP" });
    expect((third.body.case as CaseDto).docket!.cases).toHaveLength(2);
  });

  it("gives each vendor its own docket", async () => {
    const mehta = await dispatchCase();
    const fr = await prisma.country.findUniqueOrThrow({ where: { code: "FR" } });
    const delhi = await prisma.vendor.create({ data: { name: "Capital Visas", city: "Delhi", countries: { create: [{ countryId: fr.id }] } } });
    const shah = await dispatchCase({ vendorId: delhi.id, extra: { mobile: "98250 41235", clientName: "Sunil Shah" } });
    const processor = await neha();

    const a = (await add(processor, mehta.caseNo)).body.case as CaseDto;
    const b = (await add(processor, shah.caseNo)).body.case as CaseDto;
    expect(a.docket!.docketNo).not.toBe(b.docket!.docketNo);
    expect(b.docket!.vendor).toEqual({ name: "Capital Visas", city: "Delhi" });
  });

  it("is audited on the case, with the client and the docket number", async () => {
    const c = await dispatchCase();
    await add(await neha(), c.caseNo);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.docket.add" } });
    expect(entry).toMatchObject({
      entityType: "Enquiry",
      entityId: c.id,
      clientId: c.client.id,
      before: { docketNo: null },
      after: { docketNo: `D-${year}-0001`, kind: "GROUP", newDocket: true },
    });
  });

  it("doesn't move the case's updatedAt, so nobody else's open page goes stale", async () => {
    const c = await dispatchCase();
    const processor = await neha();
    const before = (await load(processor, c.caseNo)).updatedAt;
    expect((await add(processor, c.caseNo)).body.case.updatedAt).toBe(before);
  });
});

describe("who may add and take out (Decision 3)", () => {
  it("the processor, the Visa HOD and the Head may; other staff and view-only users may not", async () => {
    const c = await dispatchCase();
    const { hod, head, viewer } = await hodHeadViewer();
    const aarti = await loginAs("aarti@masti.test");

    expect((await add(viewer, c.caseNo, "GROUP", new Date().toISOString())).status).toBe(403);
    const byOther = await add(aarti, c.caseNo, "GROUP", (await load(hod, c.caseNo)).updatedAt);
    expect(byOther.status).toBe(403);

    expect((await add(hod, c.caseNo)).status).toBe(200);
    expect((await takeOut(head, c.caseNo)).status).toBe(200);
    expect((await add(await neha(), c.caseNo)).status).toBe(200);
    expect((await takeOut(hod, c.caseNo)).status).toBe(200);
  });
});

describe("what is refused", () => {
  it("before the file is ready, and once the case has moved on", async () => {
    const c = await readyCase();
    const processor = await neha();
    const early = await add(processor, c.caseNo);
    expect(early.status).toBe(409);
    expect(early.body.message).toMatch(/waits for dispatch/);

    const atVendor = await prisma.departmentStage.findFirstOrThrow({ where: { code: "AT_VENDOR" } });
    await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: atVendor.id } });
    expect((await add(processor, c.caseNo)).status).toBe(409);
  });

  it("a postponed case", async () => {
    const c = await dispatchCase();
    const processor = await neha();
    await prisma.enquiry.update({
      where: { id: c.id },
      data: { status: "POSTPONED", reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: toDbDate(addMonths(istToday(), 1)) },
    });
    const res = await add(processor, c.caseNo);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/postponed/);
  });

  it("an e-visa: a visa with Vendor needed off has no docket", async () => {
    const c = await dispatchCase();
    const offering = await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id }, select: { offeringId: true } });
    await prisma.visaOffering.update({ where: { id: offering.offeringId }, data: { vendorNeeded: false } });
    const res = await add(await neha(), c.caseNo);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/needs no vendor/);
    expect(await prisma.docket.count()).toBe(0);
  });

  it("a vendor switched off, or no longer covering the country, since the file was ready", async () => {
    const c = await dispatchCase();
    const processor = await neha();
    await prisma.vendor.update({ where: { id: c.vendor.id }, data: { isActive: false } });
    const off = await add(processor, c.caseNo);
    expect(off.status).toBe(409);
    expect(off.body.message).toBe("Global Visa Services is switched off. Ask the Visa HOD to switch it back on.");

    await prisma.vendor.update({ where: { id: c.vendor.id }, data: { isActive: true } });
    await prisma.vendorCountry.deleteMany({ where: { vendorId: c.vendor.id } });
    const gone = await add(processor, c.caseNo);
    expect(gone.status).toBe(409);
    expect(gone.body.message).toBe("Global Visa Services no longer covers France. Ask the Visa HOD.");
    // Nothing was created by the refused adds: the number isn't used up.
    expect(await prisma.docket.count()).toBe(0);
    expect(await prisma.docketCounter.count()).toBe(0);
  });

  it("a second add, a stale page, and taking out a case that isn't in a docket", async () => {
    const c = await dispatchCase();
    const processor = await neha();
    expect((await takeOut(processor, c.caseNo)).body.message).toMatch(/isn't in a docket/);

    const stale = await add(processor, c.caseNo, "GROUP", "2026-01-01T00:00:00.000Z");
    expect(stale.status).toBe(409);
    expect(stale.body.details).toMatchObject({ code: "STALE" });

    await add(processor, c.caseNo);
    const again = await add(processor, c.caseNo, "OWN");
    expect(again.status).toBe(409);
    expect(again.body.message).toBe(`This case is already in docket D-${year}-0001.`);
  });
});

describe("docket numbers (Decision 7)", () => {
  it("follow the prefix setting and the year's counter", async () => {
    const c = await dispatchCase();
    const { hod } = await hodHeadViewer();
    expect((await hod.put("/api/visa/settings").send({ docket: { prefix: "dk" } })).status).toBe(400);
    expect((await hod.put("/api/visa/settings").send({ docket: { prefix: "DK" } })).status).toBe(200);
    await prisma.docketCounter.create({ data: { year: Number(year) - 1, lastValue: 57 } });
    await prisma.docketCounter.create({ data: { year: Number(year), lastValue: 41 } });

    expect(((await add(await neha(), c.caseNo)).body.case as CaseDto).docket!.docketNo).toBe(`DK-${year}-0042`);
  });

  it("only the Visa HOD or the Head changes the prefix", async () => {
    await dispatchCase();
    const res = await (await neha()).put("/api/visa/settings").send({ docket: { prefix: "X" } });
    expect(res.status).toBe(403);
  });
});

describe("Take out of docket (Decision 10)", () => {
  it("empties the case's docket; the emptied docket is reused with its number and a fresh Open since", async () => {
    const mehta = await dispatchCase();
    const shah = await another(mehta, "98250 41235", "Sunil Shah");
    const processor = await neha();
    await add(processor, mehta.caseNo);
    await prisma.docket.updateMany({ data: { openedAt: new Date("2026-10-01T05:00:00Z") } });

    const out = await takeOut(processor, mehta.caseNo);
    expect(out.status).toBe(200);
    expect((out.body.case as CaseDto).docket).toBeNull();
    // An empty docket is never offered to join.
    expect((await load(processor, shah.caseNo)).openDocket).toBeNull();
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.docket.remove" } });
    expect(entry).toMatchObject({ entityId: mehta.id, clientId: mehta.client.id, before: { docketNo: `D-${year}-0001` } });

    const before = Date.now();
    const joined = (await add(processor, shah.caseNo)).body.case as CaseDto;
    expect(joined.docket!.docketNo).toBe(`D-${year}-0001`);
    expect(new Date(joined.docket!.openedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(await prisma.docket.count()).toBe(1);
  });

  it("reuses an emptied single-case docket for the vendor's next single case", async () => {
    const mehta = await dispatchCase();
    const shah = await another(mehta, "98250 41235", "Sunil Shah");
    const processor = await neha();
    await add(processor, mehta.caseNo, "OWN");
    await takeOut(processor, mehta.caseNo);
    expect(((await add(processor, shah.caseNo, "OWN")).body.case as CaseDto).docket!.docketNo).toBe(`D-${year}-0001`);
    // A shared add doesn't take the single-case docket.
    expect(((await add(processor, mehta.caseNo)).body.case as CaseDto).docket!.docketNo).toBe(`D-${year}-0002`);
  });
});

describe("postpone and cancel while in a docket (Decision 10)", () => {
  it("are refused until the case is taken out", async () => {
    const c = await dispatchCase();
    const processor = await neha();
    await add(processor, c.caseNo);
    const postpone = async () => {
      const body = { reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: addMonths(istToday(), 1), updatedAt: (await load(processor, c.caseNo)).updatedAt };
      return processor.post(`/api/enquiries/${c.caseNo}/postpone`).send(body);
    };

    const refused = await postpone();
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe(`Take it out of docket D-${year}-0001 first.`);
    const cancelBody = { reasonId: await reason("TRIP_CANCELLED"), updatedAt: (await load(processor, c.caseNo)).updatedAt };
    const cancel = await processor.post(`/api/enquiries/${c.caseNo}/cancel`).send(cancelBody);
    expect(cancel.status).toBe(409);
    expect(await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "OPEN" });
    expect(await prisma.auditLog.count({ where: { action: { in: ["enquiry.postpone", "enquiry.cancel"] } } })).toBe(0);

    await takeOut(processor, c.caseNo);
    expect((await postpone()).status).toBe(200);
  });
});

describe("passports (Decision 4)", () => {
  it("counts the current booklets, or one per traveller, and old booklets in the totals", async () => {
    const mehta = await dispatchCase();
    const shah = await another(mehta, "98250 41235", "Sunil Shah");
    await prisma.visaCase.update({ where: { enquiryId: shah.id }, data: { bookletsCurrent: 3, bookletsOld: 2 } });
    const processor = await neha();
    await add(processor, mehta.caseNo);
    const docket = ((await add(processor, shah.caseNo)).body.case as CaseDto).docket!;

    expect(docket.cases.map((c) => [c.family, c.passports, c.oldPassports])).toEqual([
      ["Mehta", 2, 0],
      ["Shah", 3, 2],
    ]);
    expect(docket).toMatchObject({ totalPassports: 5, totalOldPassports: 2 });
  });
});

describe("taking turns (locks: vendor, then docket, then case)", () => {
  /** Holds a FOR UPDATE lock on one row until release(). */
  function holdRow(table: "Vendor", id: number) {
    let release!: () => void;
    let locked!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const ready = new Promise<void>((resolve) => (locked = resolve));
    const done = prisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(`SELECT "id" FROM "${table}" WHERE "id" = $1 FOR UPDATE`, id);
        locked();
        await held;
      },
      { timeout: 15_000 },
    );
    return { ready, release, done };
  }

  async function waiting(n: number) {
    for (let i = 0; i < 200; i++) {
      const [row] = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if (Number(row!.n) >= n) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Fewer than ${n} requests waited.`);
  }

  it("two shared adds for one vendor at the same moment end in one docket", async () => {
    const mehta = await dispatchCase();
    const shah = await another(mehta, "98250 41235", "Sunil Shah");
    const processor = await neha();
    const [seenA, seenB] = [(await load(processor, mehta.caseNo)).updatedAt, (await load(processor, shah.caseNo)).updatedAt];

    const vendor = holdRow("Vendor", mehta.vendor.id);
    await vendor.ready;
    const a = add(processor, mehta.caseNo, "GROUP", seenA).then((r) => r);
    const b = add(processor, shah.caseNo, "GROUP", seenB).then((r) => r);
    try {
      await waiting(2);
    } finally {
      vendor.release();
    }
    await vendor.done;
    expect([(await a).status, (await b).status]).toEqual([200, 200]);
    expect(await prisma.docket.count()).toBe(1);
    expect(await prisma.visaCase.count({ where: { docketId: { not: null } } })).toBe(2);
  });

  it("an add that waited behind a postpone is refused, and creates no docket", async () => {
    const c = await dispatchCase();
    const processor = await neha();
    const seen = (await load(processor, c.caseNo)).updatedAt;
    const reasonId = await reason("TRAVEL_DATES_MOVED");

    const postpone = holdCaseLock(c.id, (tx) =>
      tx.enquiry.update({ where: { id: c.id }, data: { status: "POSTPONED", reasonId, resumeOn: toDbDate(addMonths(istToday(), 1)) } }),
    );
    await postpone.ready;
    const pending = add(processor, c.caseNo, "GROUP", seen).then((r) => r);
    try {
      await untilWaitingOnLock();
    } finally {
      postpone.release();
    }
    await postpone.done;
    const res = await pending;
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/postponed/);
    expect(await prisma.docket.count()).toBe(0);
  });

  it("a postpone that waited behind an add is refused", async () => {
    const c = await dispatchCase();
    const processor = await neha();
    const seen = (await load(processor, c.caseNo)).updatedAt;
    const reasonId = await reason("TRAVEL_DATES_MOVED");

    const adding = holdCaseLock(c.id, async (tx) => {
      const docket = await tx.docket.create({
        data: { docketNo: `D-${year}-0099`, vendorId: c.vendor.id, kind: "GROUP", createdById: (await tx.user.findFirstOrThrow({ where: { email: "neha@masti.test" } })).id },
      });
      await tx.visaCase.update({ where: { enquiryId: c.id }, data: { docketId: docket.id } });
    });
    await adding.ready;
    const pending = processor
      .post(`/api/enquiries/${c.caseNo}/postpone`)
      .send({ reasonId, resumeOn: addMonths(istToday(), 1), updatedAt: seen })
      .then((r) => r);
    try {
      await untilWaitingOnLock();
    } finally {
      adding.release();
    }
    await adding.done;
    const res = await pending;
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(`Take it out of docket D-${year}-0099 first.`);
  });

  it("the database allows one shared open docket per vendor, and any number of single-case ones", async () => {
    const c = await dispatchCase();
    const createdById = (await prisma.user.findFirstOrThrow({ where: { email: "neha@masti.test" } })).id;
    const docket = (n: number, kind: "GROUP" | "OWN") =>
      prisma.docket.create({ data: { docketNo: `D-${year}-000${n}`, vendorId: c.vendor.id, kind, createdById } });
    await docket(1, "GROUP");
    await docket(2, "OWN");
    await docket(3, "OWN");
    await expect(docket(4, "GROUP")).rejects.toThrow();
    await expect(prisma.docket.create({ data: { docketNo: "d-1", vendorId: c.vendor.id, kind: "OWN", createdById } })).rejects.toThrow();
  });
});

describe("the parcel sticker (Decision 5)", () => {
  interface Sticker {
    docketNo: string;
    vendor: { name: string; city: string };
    cases: { caseNo: string; passports: number; oldPassports: number }[];
    totalPassports: number;
    totalOldPassports: number;
    from: { name: string; address: string; phone: string };
    size: { widthMm: number; heightMm: number };
  }
  const sticker = (agent: Agent, caseNo: string) => agent.get(`/api/visa/cases/${caseNo}/sticker`);

  it("lists the docket's cases with their passports, the totals, Masti's details and the label size", async () => {
    const mehta = await dispatchCase();
    const shah = await another(mehta, "98250 41235", "Sunil Shah");
    await prisma.visaCase.update({ where: { enquiryId: shah.id }, data: { bookletsCurrent: 3, bookletsOld: 2 } });
    const processor = await neha();
    await add(processor, mehta.caseNo);
    await add(processor, shah.caseNo);

    const res = await sticker(processor, mehta.caseNo);
    expect(res.status).toBe(200);
    expect(res.body.sticker as Sticker).toEqual({
      docketNo: `D-${year}-0001`,
      status: "OPEN",
      vendor: { name: "Global Visa Services", city: "Mumbai" },
      cases: [
        { caseNo: mehta.caseNo, passports: 2, oldPassports: 0 },
        { caseNo: shah.caseNo, passports: 3, oldPassports: 2 },
      ],
      totalPassports: 5,
      totalOldPassports: 2,
      from: {
        name: "MASTI TOUR AND TRAVEL",
        address: "301, Maitri, Opp. Canara Bank, Nr. Panchratna Tower, L.H. Road, Varachha, Surat-395006, (Guj.) INDIA",
        phone: "+91-93777-57580",
      },
      size: { widthMm: 100, heightMm: 150 },
    });

    // A case taken out is no longer on the label.
    await takeOut(processor, shah.caseNo);
    expect(((await sticker(processor, mehta.caseNo)).body.sticker as Sticker).cases.map((c) => c.caseNo)).toEqual([mehta.caseNo]);
  });

  it("follows the company details and the size setting", async () => {
    const c = await dispatchCase();
    const { hod, head } = await hodHeadViewer();
    await add(await neha(), c.caseNo);
    expect((await head.put("/api/company/details").send({ phone: "+91-90000-00000" })).status).toBe(200);
    expect((await hod.put("/api/visa/settings").send({ sticker: { widthMm: 40, heightMm: 150 } })).status).toBe(400);
    expect((await hod.put("/api/visa/settings").send({ sticker: { widthMm: 100, heightMm: 400 } })).status).toBe(400);
    expect((await hod.put("/api/visa/settings").send({ sticker: { widthMm: 102, heightMm: 152 } })).status).toBe(200);

    const label = (await sticker(hod, c.caseNo)).body.sticker as Sticker;
    expect(label.from.phone).toBe("+91-90000-00000");
    expect(label.size).toEqual({ widthMm: 102, heightMm: 152 });
  });

  it("is for anyone who can open the case, and only once it is in a docket", async () => {
    const c = await dispatchCase();
    const { viewer } = await hodHeadViewer();
    const processor = await neha();
    const early = await sticker(processor, c.caseNo);
    expect(early.status).toBe(409);
    expect(early.body.message).toBe("This case isn't in a docket yet.");

    await add(processor, c.caseNo);
    expect((await sticker(viewer, c.caseNo)).status).toBe(200);
    // Aarti is Visa staff, but the case is Neha's: she can't open it, so she can't print its label.
    expect((await sticker(await loginAs("aarti@masti.test"), c.caseNo)).status).toBe(403);
    expect((await sticker(processor, "VISA-2026-9999")).status).toBe(404);
  });
});
