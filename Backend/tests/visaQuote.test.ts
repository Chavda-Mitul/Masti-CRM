import { beforeEach, describe, expect, it } from "vitest";
import { addMonths, istToday, toDbDate } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { dispatchCase, maturedCase, saveCase, visaStaff, type Agent } from "./visaHelpers";

// The quote on a visa case (docs/decisions/0009-visa-invoice.md Decision 2): per traveller a lump sum or itemised, plus
// Masti's service charge; GST on the service charge only. Saved whole, from Step 1 until the file goes to the vendor.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface QuoteDto {
  processingSpeed: { id: number; name: string; isActive: boolean };
  serviceChargePaise: number;
  lines: { travellerId: string; form: string; lumpSumPaise: number | null; totalPaise: number }[];
  travellersPaise: number;
  gstRatePercent: number;
  gstPaise: number;
  totalPaise: number;
  complete: boolean;
  updatedAt: string;
  updatedBy: { name: string };
}
interface CaseDto {
  updatedAt: string;
  travellers: { id: string }[];
  quote: QuoteDto | null;
}

const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const speed = async (code = "NORMAL") => (await prisma.processingSpeed.findUniqueOrThrow({ where: { code } })).id;
const reason = async (code: string) => (await prisma.enquiryReason.findUniqueOrThrow({ where: { code } })).id;

/** The adult as an itemised line, the child as a lump sum: the two forms. */
async function body(c: CaseDto, extra: Record<string, unknown> = {}) {
  const [adult, child] = c.travellers;
  return {
    processingSpeedId: await speed(),
    serviceChargePaise: 50_000,
    lines: [
      { travellerId: adult!.id, form: "ITEMISED", embassyFeePaise: 50_000, vfsFeePaise: 80_000, otherFeePaise: 211_000 },
      { travellerId: child!.id, form: "LUMP_SUM", lumpSumPaise: 200_000 },
    ],
    updatedAt: c.quote?.updatedAt ?? null,
    ...extra,
  };
}

const save = async (agent: Agent, caseNo: string, payload: object) => agent.put(`/api/visa/cases/${caseNo}/quote`).send(payload);

/** A case at the Enquiry step, Aarti's (she saved it). */
async function enquiryCase() {
  const staff = await visaStaff();
  const saved = await saveCase(staff);
  return { ...saved, staff };
}

async function hodHeadViewer() {
  await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
  await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
  await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
  return { hod: await loginAs("riya@masti.test"), head: await loginAs("vimal@masti.test"), viewer: await loginAs("meena@masti.test") };
}

describe("saving a quote", () => {
  it("works from Step 1, and the case shows the totals with GST on the service charge only", async () => {
    const c = await enquiryCase();
    const before = await load(c.staff, c.caseNo);
    const res = await save(c.staff, c.caseNo, await body(before));
    expect(res.status).toBe(200);

    const quote = (res.body.case as CaseDto).quote!;
    expect(quote).toMatchObject({
      processingSpeed: { name: "Normal", isActive: true },
      serviceChargePaise: 50_000,
      travellersPaise: 541_000,
      gstRatePercent: 18,
      gstPaise: 9_000,
      totalPaise: 600_000,
      complete: true,
      updatedBy: { name: "Aarti Patel" },
    });
    expect(quote.lines.map((l) => [l.form, l.totalPaise]).sort()).toEqual([
      ["ITEMISED", 341_000],
      ["LUMP_SUM", 200_000],
    ]);
    // The case's own token doesn't move: nobody else's open page goes stale.
    expect((res.body.case as CaseDto).updatedAt).toBe(before.updatedAt);
  });

  it("is audited once per real change, with the client, and an unchanged save writes nothing", async () => {
    const c = await enquiryCase();
    const first = (await save(c.staff, c.caseNo, await body(await load(c.staff, c.caseNo)))).body.case as CaseDto;
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.quote.save" } });
    expect(entry).toMatchObject({ entityType: "Enquiry", entityId: c.id, clientId: c.client.id, before: null });

    const same = await save(c.staff, c.caseNo, await body(first));
    expect(same.status).toBe(200);
    expect((same.body.case as CaseDto).quote!.updatedAt).toBe(first.quote!.updatedAt);
    expect(await prisma.auditLog.count({ where: { action: "visa.quote.save" } })).toBe(1);

    const changed = await save(c.staff, c.caseNo, await body(first, { serviceChargePaise: 60_000 }));
    expect((changed.body.case as CaseDto).quote).toMatchObject({ serviceChargePaise: 60_000, gstPaise: 10_800 });
    const second = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.quote.save" }, orderBy: { createdAt: "desc" } });
    expect(second).toMatchObject({ before: { serviceChargePaise: 50_000 }, after: { serviceChargePaise: 60_000 } });
  });

  it("rounds GST half up to the paisa, has none without a service charge, and follows the rate setting", async () => {
    const c = await enquiryCase();
    const { hod } = await hodHeadViewer();
    let current = (await save(c.staff, c.caseNo, await body(await load(c.staff, c.caseNo), { serviceChargePaise: 333 }))).body.case as CaseDto;
    expect(current.quote!.gstPaise).toBe(60);

    current = (await save(c.staff, c.caseNo, await body(current, { serviceChargePaise: 0 }))).body.case as CaseDto;
    expect(current.quote).toMatchObject({ gstPaise: 0, totalPaise: 541_000 });

    const settings = (await hod.get("/api/visa/settings")).body.settings;
    expect((await hod.put("/api/visa/settings").send({ invoice: { ...settings.invoice, gstRatePercent: 29 } })).status).toBe(400);
    expect((await hod.put("/api/visa/settings").send({ invoice: { ...settings.invoice, gstRatePercent: 12.345 } })).status).toBe(400);
    expect((await hod.put("/api/visa/settings").send({ invoice: { ...settings.invoice, prefix: "mvi" } })).status).toBe(400);
    expect((await hod.put("/api/visa/settings").send({ invoice: { ...settings.invoice, gstRatePercent: 5 } })).status).toBe(200);
    current = (await save(c.staff, c.caseNo, await body(current, { serviceChargePaise: 50_000 }))).body.case as CaseDto;
    expect(current.quote).toMatchObject({ gstRatePercent: 5, gstPaise: 2_500 });
  });
});

describe("who and when", () => {
  it("the owner, the Visa HOD and the Head may; other staff and view-only users may not", async () => {
    const c = await maturedCase(); // Neha's, at File preparation
    const { hod, head, viewer } = await hodHeadViewer();
    const neha = await loginAs("neha@masti.test");

    expect((await save(viewer, c.caseNo, await body(await load(hod, c.caseNo)))).status).toBe(403);
    expect((await save(c.staff, c.caseNo, await body(await load(hod, c.caseNo)))).status).toBe(403); // Aarti
    expect((await save(neha, c.caseNo, await body(await load(neha, c.caseNo)))).status).toBe(200);
    expect((await save(hod, c.caseNo, await body(await load(hod, c.caseNo), { serviceChargePaise: 1 }))).status).toBe(200);
    expect((await save(head, c.caseNo, await body(await load(head, c.caseNo), { serviceChargePaise: 2 }))).status).toBe(200);
  });

  it("works at Docket & dispatch, not once the file has gone to the vendor, nor while postponed", async () => {
    const c = await dispatchCase();
    const neha = await loginAs("neha@masti.test");
    expect((await save(neha, c.caseNo, await body(await load(neha, c.caseNo)))).status).toBe(200);

    const atVendor = await prisma.departmentStage.findFirstOrThrow({ where: { code: "AT_VENDOR" } });
    await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: atVendor.id } });
    const late = await save(neha, c.caseNo, await body(await load(neha, c.caseNo), { serviceChargePaise: 1 }));
    expect(late.status).toBe(409);
    expect(late.body.message).toBe("The quote can't change once the file has gone to the vendor.");

    const other = await enquiryCase();
    await prisma.enquiry.update({
      where: { id: other.id },
      data: { status: "POSTPONED", reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: toDbDate(addMonths(istToday(), 1)) },
    });
    const postponed = await save(other.staff, other.caseNo, await body(await load(other.staff, other.caseNo)));
    expect(postponed.status).toBe(409);
    expect(postponed.body.message).toMatch(/postponed/);
  });
});

describe("what is refused", () => {
  it("lines that aren't exactly the case's travellers", async () => {
    const c = await enquiryCase();
    const current = await load(c.staff, c.caseNo);
    const full = await body(current);
    const [adultLine] = full.lines;

    const missing = await save(c.staff, c.caseNo, { ...full, lines: [adultLine] });
    expect(missing.status).toBe(400);
    expect(missing.body.issues.lines).toEqual(["Give every traveller an amount."]);
    expect((await save(c.staff, c.caseNo, { ...full, lines: [adultLine, adultLine] })).status).toBe(400);

    const other = await saveCase(c.staff, { mobile: "98250 41299", clientName: "Kiran Shah" });
    const stranger = (await load(c.staff, other.caseNo)).travellers[0]!.id;
    expect((await save(c.staff, c.caseNo, { ...full, lines: [adultLine, { travellerId: stranger, form: "LUMP_SUM", lumpSumPaise: 1 }] })).status).toBe(400);
    expect(await prisma.visaQuote.count()).toBe(0);
  });

  it("amounts of the wrong form, negative, fractional or over the limit", async () => {
    const c = await enquiryCase();
    const full = await body(await load(c.staff, c.caseNo));
    const [adult, child] = full.lines as Record<string, unknown>[];
    const withChild = (line: Record<string, unknown>) => save(c.staff, c.caseNo, { ...full, lines: [adult, { ...child, ...line }] });

    expect((await withChild({ embassyFeePaise: 100 })).status).toBe(400); // a lump sum with an itemised amount
    expect((await withChild({ form: "ITEMISED" })).status).toBe(400); // itemised without its three amounts
    expect((await withChild({ lumpSumPaise: -1 })).status).toBe(400);
    expect((await withChild({ lumpSumPaise: 10.5 })).status).toBe(400);
    expect((await withChild({ lumpSumPaise: 100_000_001 })).status).toBe(400);
    expect((await save(c.staff, c.caseNo, { ...full, serviceChargePaise: -5 })).status).toBe(400);
    expect(await prisma.visaQuote.count()).toBe(0);
  });

  it("a switched-off processing speed as a new choice, but keeping the current one is fine", async () => {
    const c = await enquiryCase();
    const express = await speed("EXPRESS");
    const saved = (await save(c.staff, c.caseNo, await body(await load(c.staff, c.caseNo), { processingSpeedId: express }))).body.case as CaseDto;
    await prisma.processingSpeed.update({ where: { id: express }, data: { isActive: false } });

    expect((await save(c.staff, c.caseNo, await body(saved, { processingSpeedId: express, serviceChargePaise: 1 }))).status).toBe(200);
    const again = (await load(c.staff, c.caseNo)).quote!;
    expect(again.processingSpeed).toMatchObject({ name: "Express", isActive: false });

    const superPriority = await speed("SUPER_PRIORITY");
    await prisma.processingSpeed.update({ where: { id: superPriority }, data: { isActive: false } });
    const refused = await save(c.staff, c.caseNo, await body(await load(c.staff, c.caseNo), { processingSpeedId: superPriority }));
    expect(refused.status).toBe(400);
    expect(refused.body.issues.processingSpeedId).toBeDefined();
  });

  it("a page that missed someone else's save (the quote's own token)", async () => {
    const c = await enquiryCase();
    const opened = await load(c.staff, c.caseNo);
    expect((await save(c.staff, c.caseNo, await body(opened))).status).toBe(200);

    // A second page still thinks there's no quote.
    const second = await save(c.staff, c.caseNo, await body(opened, { serviceChargePaise: 1 }));
    expect(second.status).toBe(409);
    expect(second.body.details).toMatchObject({ code: "STALE" });

    const current = await load(c.staff, c.caseNo);
    expect((await save(c.staff, c.caseNo, await body(current, { serviceChargePaise: 2 }))).status).toBe(200);
    // The token it had is now old.
    const old = await save(c.staff, c.caseNo, await body(current, { serviceChargePaise: 3 }));
    expect(old.body.details).toMatchObject({ code: "STALE" });
  });
});

describe("processing speeds (the master list)", () => {
  it("are seeded, read by Visa staff, and written only by the Visa HOD or the Head", async () => {
    const staff = await visaStaff();
    const { hod, head } = await hodHeadViewer();
    const list = (await staff.get("/api/masters/processing-speeds")).body.processingSpeeds as { code: string }[];
    expect(list.map((s) => s.code)).toEqual(["NORMAL", "EXPRESS", "SUPER_PRIORITY"]);

    expect((await staff.post("/api/masters/processing-speeds").send({ code: "TATKAL", name: "Tatkal" })).status).toBe(403);
    const created = await hod.post("/api/masters/processing-speeds").send({ code: " tatkal ", name: "Tatkal" });
    expect(created.status).toBe(201);
    expect(created.body.processingSpeed.code).toBe("TATKAL");
    expect((await head.post("/api/masters/processing-speeds").send({ code: "TATKAL", name: "Again" })).status).toBe(409);

    const id = created.body.processingSpeed.id as number;
    const renamed = await head.patch(`/api/masters/processing-speeds/${id}`).send({ name: "Tatkal (fast)", code: "OTHER" });
    expect(renamed.body.processingSpeed).toMatchObject({ code: "TATKAL", name: "Tatkal (fast)" });
    expect(await prisma.auditLog.count({ where: { action: { in: ["processingSpeed.create", "processingSpeed.update"] } } })).toBe(2);
  });
});
