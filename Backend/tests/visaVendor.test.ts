import { beforeEach, describe, expect, it } from "vitest";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { holdCaseLock, maturedCase, untilWaitingOnLock, type Agent } from "./visaHelpers";

// Visa Step 3, slice 4 (docs/decisions/0007-visa-file-prep.md Decision 7): the vendor picked for the case during File
// preparation, from the active vendors covering its country.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface CaseVendor {
  id: number;
  name: string;
  city: string;
  isActive: boolean;
  contactName: string | null;
  mobile: string | null;
  coversCountry: boolean;
}
interface CaseDto {
  updatedAt: string;
  vendor: CaseVendor | null;
}

const neha = () => loginAs("neha@masti.test");
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const pick = (agent: Agent, caseNo: string, body: Record<string, unknown>) => agent.put(`/api/visa/cases/${caseNo}/vendor`).send(body);
const stageId = async (code: string) => (await prisma.departmentStage.findFirstOrThrow({ where: { code } })).id;

/** A vendor straight in the database (the master's own rules are tested in vendors.test.ts). */
async function vendor(name: string, city: string, countryCodes: string[], extra: { isActive?: boolean; contactName?: string; mobile?: string } = {}) {
  const countries = await prisma.country.findMany({ where: { code: { in: countryCodes } } });
  return prisma.vendor.create({ data: { name, city, ...extra, countries: { create: countries.map((c) => ({ countryId: c.id })) } } });
}

async function hodHeadViewer() {
  await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
  await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
  await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
  return { hod: await loginAs("riya@masti.test"), head: await loginAs("vimal@masti.test"), viewer: await loginAs("meena@masti.test") };
}

describe("the case's vendor (Decision 7)", () => {
  it("is picked by the processor from the active vendors covering the country, audited, and can be changed or cleared", async () => {
    const c = await maturedCase();
    const mumbai = await vendor("Global Visa Services", "Mumbai", ["FR", "CN"], { contactName: "Sanjay Rao", mobile: "+919820012345" });
    const delhi = await vendor("Capital Visas", "Delhi", ["FR"]);
    const processor = await neha();
    const before = await load(processor, c.caseNo);
    expect(before.vendor).toBeNull();

    const res = await pick(processor, c.caseNo, { vendorId: mumbai.id });
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).vendor).toEqual({
      id: mumbai.id,
      name: "Global Visa Services",
      city: "Mumbai",
      isActive: true,
      contactName: "Sanjay Rao",
      mobile: "+919820012345",
      email: null,
      coversCountry: true,
    });
    // A field on the case, like the checks: nobody's open page goes stale.
    expect((res.body.case as CaseDto).updatedAt).toBe(before.updatedAt);

    // The same vendor again writes nothing; another replaces it; null clears it.
    expect((await pick(processor, c.caseNo, { vendorId: mumbai.id })).status).toBe(200);
    expect((await pick(processor, c.caseNo, { vendorId: delhi.id })).body.case.vendor).toMatchObject({ id: delhi.id, city: "Delhi" });
    expect((await pick(processor, c.caseNo, { vendorId: null })).body.case.vendor).toBeNull();

    const entries = await prisma.auditLog.findMany({ where: { action: "visa.vendor.set" }, orderBy: { createdAt: "asc" } });
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      entityType: "VisaCase",
      entityId: c.id,
      clientId: c.client.id,
      before: { vendorId: null, vendor: null },
      after: { vendorId: mumbai.id, vendor: "Global Visa Services · Mumbai" },
    });
    expect(entries[1]).toMatchObject({
      before: { vendor: "Global Visa Services · Mumbai" },
      after: { vendorId: delhi.id, vendor: "Capital Visas · Delhi" },
    });
    expect(entries[2]).toMatchObject({ after: { vendorId: null, vendor: null } });
  });

  it("refuses an unknown vendor, a switched-off one and one that doesn't cover the country", async () => {
    const c = await maturedCase();
    const off = await vendor("Old Agency", "Mumbai", ["FR"], { isActive: false });
    const china = await vendor("Great Wall Visas", "Delhi", ["CN"]);
    const processor = await neha();

    const unknown = await pick(processor, c.caseNo, { vendorId: 999_999 });
    expect(unknown.status).toBe(400);
    expect(unknown.body.issues.vendorId[0]).toMatch(/from the list/);
    const switchedOff = await pick(processor, c.caseNo, { vendorId: off.id });
    expect(switchedOff.status).toBe(400);
    expect(switchedOff.body.issues.vendorId[0]).toMatch(/switched off/);
    const elsewhere = await pick(processor, c.caseNo, { vendorId: china.id });
    expect(elsewhere.status).toBe(400);
    expect(elsewhere.body.issues.vendorId[0]).toMatch(/doesn't cover France/);
    for (const body of [{}, { vendorId: "1" }, { vendorId: 0 }]) {
      const res = await pick(processor, c.caseNo, body);
      expect(res.status).toBe(400);
      expect(res.body.issues.vendorId).toBeDefined();
    }

    expect((await load(processor, c.caseNo)).vendor).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "visa.vendor.set" } })).toBe(0);
  });

  it("is for file preparation only, by the processor, the HOD or the Head", async () => {
    const c = await maturedCase();
    const v = await vendor("Global Visa Services", "Mumbai", ["FR"]);
    const { hod, head, viewer } = await hodHeadViewer();

    // Aarti matured the case: it is Neha's now.
    expect((await pick(c.staff, c.caseNo, { vendorId: v.id })).status).toBe(403);
    expect((await pick(viewer, c.caseNo, { vendorId: v.id })).status).toBe(403);
    expect((await pick(hod, c.caseNo, { vendorId: v.id })).status).toBe(200);
    expect((await pick(head, c.caseNo, { vendorId: null })).status).toBe(200);

    await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: await stageId("DISPATCH") } });
    const late = await pick(hod, c.caseNo, { vendorId: v.id });
    expect(late.status).toBe(409);
    expect(late.body.message).toMatch(/during file preparation/);
    await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: await stageId("DOCUMENTS") } });
    expect((await pick(hod, c.caseNo, { vendorId: v.id })).status).toBe(409);
    expect((await load(hod, c.caseNo)).vendor).toBeNull();
  });

  it("waits for a processor: until one is assigned, only the HOD or the Head picks", async () => {
    const c = await maturedCase({ assigned: false });
    const v = await vendor("Global Visa Services", "Mumbai", ["FR"]);
    const { hod } = await hodHeadViewer();

    expect((await pick(await neha(), c.caseNo, { vendorId: v.id })).status).toBe(403);
    expect((await pick(hod, c.caseNo, { vendorId: v.id })).status).toBe(200);
  });

  it("stays on the case when switched off later, flagged, and the vendor can't be deleted", async () => {
    const c = await maturedCase();
    const v = await vendor("Global Visa Services", "Mumbai", ["FR"]);
    const processor = await neha();
    expect((await pick(processor, c.caseNo, { vendorId: v.id })).status).toBe(200);

    await prisma.vendor.update({ where: { id: v.id }, data: { isActive: false } });
    expect((await load(processor, c.caseNo)).vendor).toMatchObject({ id: v.id, isActive: false });
    // Re-sending the picked vendor is no change, so it isn't refused for being switched off.
    expect((await pick(processor, c.caseNo, { vendorId: v.id })).status).toBe(200);

    // Restrict: the case keeps the vendor it picked (its countries are removed first, so only the case holds it).
    await prisma.vendorCountry.deleteMany({ where: { vendorId: v.id } });
    await expect(prisma.vendor.delete({ where: { id: v.id } })).rejects.toThrow();
  });

  it("stays on the case when the case's country is taken off it later, flagged", async () => {
    const c = await maturedCase();
    const v = await vendor("Global Visa Services", "Mumbai", ["FR", "CN"]);
    const processor = await neha();
    expect((await pick(processor, c.caseNo, { vendorId: v.id })).status).toBe(200);

    const fr = await prisma.country.findUniqueOrThrow({ where: { code: "FR" } });
    await prisma.vendorCountry.delete({ where: { vendorId_countryId: { vendorId: v.id, countryId: fr.id } } });
    expect((await load(processor, c.caseNo)).vendor).toMatchObject({ id: v.id, isActive: true, coversCountry: false });
    // Re-sending it is no change, so it isn't refused; picked afresh, it is, like any vendor that doesn't cover the country.
    expect((await pick(processor, c.caseNo, { vendorId: v.id })).status).toBe(200);
    expect((await pick(processor, c.caseNo, { vendorId: null })).status).toBe(200);
    expect((await pick(processor, c.caseNo, { vendorId: v.id })).body.issues.vendorId[0]).toMatch(/doesn't cover France/);
  });

  it("waits for a change that moves the case on, then is refused and saves nothing", async () => {
    const c = await maturedCase();
    const v = await vendor("Global Visa Services", "Mumbai", ["FR"]);
    const processor = await neha();
    const dispatch = await stageId("DISPATCH");

    const fileReady = holdCaseLock(c.id, (tx) => tx.enquiry.update({ where: { id: c.id }, data: { stageId: dispatch } }));
    await fileReady.ready;
    const pending = pick(processor, c.caseNo, { vendorId: v.id }).then((r) => r);
    try {
      await untilWaitingOnLock();
    } finally {
      fileReady.release();
    }
    await fileReady.done;
    const res = await pending;
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/during file preparation/);
    expect((await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id } })).vendorId).toBeNull();
  });
});
