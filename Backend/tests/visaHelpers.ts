import { expect } from "vitest";
import { addDays, addMonths, isoWeekday, istDateTimeToUtc, istToday, toDbDate } from "../src/lib/dates";
import { gstinChecksumOk } from "../src/lib/shared.schemas";
import { createUser, loginAs, prisma } from "./helpers";

// Shared by the visa case tests (Step 2 in visaDocuments.test.ts, Step 3 in visaFilePrep.test.ts and visaTrip.test.ts,
// Step 4 in visaDocket.test.ts, Steps 6 and 7 in visaRefusalLetter.test.ts and visaPassportsBack.test.ts).

export type Agent = Awaited<ReturnType<typeof loginAs>>;

/** A Visa EDIT user, created the first time it is asked for, so a test can make several cases. */
async function visaEditor(name: string, email: string) {
  return (await prisma.user.findUnique({ where: { email } })) ?? createUser({ name, email, departments: [{ code: "VISA", access: "EDIT" }] });
}

/** Aarti Patel, Visa staff with EDIT, logged in. */
export async function visaStaff() {
  await visaEditor("Aarti Patel", "aarti@masti.test");
  return loginAs("aarti@masti.test");
}

/** France Tourist for one adult and one child, saved by `agent` (`extra` adds to or overrides the form). */
export async function saveCase(agent: Agent, extra: Record<string, unknown> = {}) {
  const fr = await prisma.country.findUniqueOrThrow({ where: { code: "FR" } });
  const offering = await prisma.visaOffering.findFirstOrThrow({ where: { countryId: fr.id } });
  const res = await agent.post("/api/visa/cases").send({
    mobile: "98250 41234",
    clientName: "Rakesh Mehta",
    sourceCode: "WHATSAPP",
    offeringId: offering.id,
    adults: 1,
    children: 1,
    travelMonth: addMonths(istToday(), 2).slice(0, 7),
    ...extra,
  });
  expect(res.status).toBe(201);
  return res.body.case as { id: string; caseNo: string; client: { id: string } };
}

/**
 * A France case (1 adult, 1 child) that matured: every paper in or made, the adult's salary slips not needed, at File
 * preparation, matured by Aarti and given to Neha Joshi (or still waiting for a processor). Set straight in the
 * database; maturity itself is tested in visaDocuments.test.ts.
 */
export async function maturedCase({ assigned = true, extra = {} as Record<string, unknown> } = {}) {
  const staff = await visaStaff();
  const saved = await saveCase(staff, extra);
  const aarti = await prisma.user.findUniqueOrThrow({ where: { email: "aarti@masti.test" } });
  const neha = await visaEditor("Neha Joshi", "neha@masti.test");
  const now = new Date();
  const docs = await prisma.visaCaseDocument.findMany({ where: { traveller: { caseId: saved.id } } });
  for (const d of docs) {
    const data =
      d.requirement === "ARRANGED_BY_US"
        ? { status: "MADE" as const, receivedAt: now, receivedById: aarti.id }
        : d.name.startsWith("Salary slips")
          ? { status: "NOT_NEEDED" as const }
          : { status: "RECEIVED" as const, receivedAs: d.requirement === "ORIGINAL" ? ("ORIGINAL" as const) : ("XEROX" as const), receivedAt: now, receivedById: aarti.id };
    await prisma.visaCaseDocument.update({ where: { id: d.id }, data });
  }
  const filePrep = await prisma.departmentStage.findFirstOrThrow({ where: { code: "FILE_PREPARATION" } });
  await prisma.enquiry.update({ where: { id: saved.id }, data: { stageId: filePrep.id, ownerId: assigned ? neha.id : null, dueAt: now } });
  await prisma.visaCase.update({ where: { enquiryId: saved.id }, data: { maturedAt: now, maturedById: aarti.id } });
  return { ...saved, staff };
}

/**
 * A matured case (see maturedCase) with all of Step 3 done, straight in the database, ready for "File ready": every
 * paper that came in or was made Checked by Neha, an acknowledgement number and an appointment for each traveller, the
 * trip details, an active France vendor (a new "Global Visa Services, Mumbai", or `vendorId`) and a saved file (a row
 * only; nothing is put in the bucket). `extra` goes to the New enquiry form, e.g. another client's mobile and name.
 */
export async function readyCase({ vendorId, extra }: { vendorId?: number; extra?: Record<string, unknown> } = {}) {
  const c = await maturedCase({ extra });
  const neha = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
  const now = new Date();
  await prisma.visaCaseDocument.updateMany({
    where: { traveller: { caseId: c.id }, status: { in: ["RECEIVED", "MADE"] } },
    data: { check: "CHECKED", checkedAt: now, checkedById: neha.id },
  });
  const travellers = await prisma.visaCaseTraveller.findMany({ where: { caseId: c.id }, orderBy: { position: "asc" } });
  for (const [i, t] of travellers.entries()) {
    await prisma.visaCaseTraveller.update({
      where: { id: t.id },
      data: { ackNo: `FRA1MU2026100648${i}`, appointmentAt: istDateTimeToUtc(addDays(istToday(), 10), "10:30") },
    });
  }
  const fr = await prisma.country.findUniqueOrThrow({ where: { code: "FR" } });
  const vendor = vendorId
    ? await prisma.vendor.findUniqueOrThrow({ where: { id: vendorId } })
    : await prisma.vendor.create({
        data: { name: "Global Visa Services", city: "Mumbai", email: "ops@globalvisa.test", countries: { create: [{ countryId: fr.id }] } },
      });
  await prisma.visaCase.update({
    where: { enquiryId: c.id },
    data: {
      departOn: toDbDate(addDays(istToday(), 30)),
      returnOn: toDbDate(addDays(istToday(), 41)),
      entryType: "SINGLE",
      vendorId: vendor.id,
    },
  });
  const file = await prisma.caseFile.create({
    data: {
      enquiryId: c.id,
      kind: "FINAL_FILE",
      storageKey: `cases/${c.id}/final/test.pdf`,
      fileName: `${c.caseNo}_Mehta_file.pdf`,
      sizeBytes: 1024,
      pageCount: 52,
      uploadedById: neha.id,
    },
  });
  return { ...c, vendor, file, travellers };
}

/**
 * A ready case (see readyCase) already marked "File ready" by Neha, at Docket & dispatch: Step 4's starting point. Set
 * straight in the database; "File ready" itself is tested in visaFileReady.test.ts.
 */
export async function dispatchCase(options: { vendorId?: number; extra?: Record<string, unknown> } = {}) {
  const c = await readyCase(options);
  const neha = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
  const dispatch = await prisma.departmentStage.findFirstOrThrow({ where: { code: "DISPATCH" } });
  const now = new Date();
  await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: dispatch.id, dueAt: now } });
  await prisma.visaCase.update({ where: { enquiryId: c.id }, data: { fileReadyAt: now, fileReadyById: neha.id } });
  return c;
}

/** Waits until another connection is blocked on a row lock: the request under test has reached the locked case. */
export async function untilWaitingOnLock() {
  for (let i = 0; i < 200; i++) {
    const [row] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (Number(row!.n) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Nothing waited on the case's lock.");
}

/** A transaction that locks the case, does `work` and holds the lock until release(): an in-flight case change. */
export function holdCaseLock(enquiryId: string, work: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<unknown>) {
  let release!: () => void;
  let locked!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const ready = new Promise<void>((resolve) => (locked = resolve));
  const done = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Enquiry" WHERE "id" = ${enquiryId} FOR UPDATE`;
      await work(tx);
      locked();
      await held;
    },
    { timeout: 15_000 },
  );
  return { ready, release, done };
}

// The visa invoice (docs/decisions/0009-visa-invoice.md): what raising one needs, shared with the dispatch tests.

export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
export const PAN = "ABCDE1234F";
export function gstinFor(pan: string, state = "24") {
  const first14 = `${state}${pan}1Z`;
  return first14 + [..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"].find((c) => gstinChecksumOk(first14 + c));
}

/** Masti's details, logo and signature, filled in by the Head: what the first invoice needs. */
export async function mastiReady() {
  await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
  const head = await loginAs("vimal@masti.test");
  const details = await head.put("/api/company/details").send({
    gstin: gstinFor(PAN),
    bank: { accountName: "Test Travels", accountNo: "123456789012", bankName: "Test Bank", branch: "Varachha", ifsc: "TEST0000123" },
  });
  expect(details.body.missingForInvoice).toEqual(["Logo", "Signature"]);
  await head.put("/api/company/images/logo").set("Content-Type", "image/png").send(PNG);
  await head.put("/api/company/images/signature").set("Content-Type", "image/png").send(PNG);
  return head;
}

/** Completes any case's client, names its two travellers and enters a quote (the adult itemised 500 + 800 + 2,110, the child a lump sum of 2,000, a service charge of 500), as `agent`. */
export async function makeInvoiceable(
  agent: Agent,
  saved: { id: string; caseNo: string; client: { id: string } },
  { state = "24", clientName = "Rakesh Mehta", service = 50_000 } = {},
) {
  await prisma.client.update({ where: { id: saved.client.id }, data: { addressLine: "12, Test Society", city: "Surat", stateCode: state } });
  const travellers = await prisma.visaCaseTraveller.findMany({ where: { caseId: saved.id }, orderBy: { position: "asc" } });
  await prisma.visaCaseTraveller.update({ where: { id: travellers[0]!.id }, data: { name: clientName } });
  await prisma.visaCaseTraveller.update({ where: { id: travellers[1]!.id }, data: { name: "Aarav Test" } });
  const speed = await prisma.processingSpeed.findUniqueOrThrow({ where: { code: "NORMAL" } });
  const quote = await agent.put(`/api/visa/cases/${saved.caseNo}/quote`).send({
    processingSpeedId: speed.id,
    serviceChargePaise: service,
    lines: [
      { travellerId: travellers[0]!.id, form: "ITEMISED", embassyFeePaise: 50_000, vfsFeePaise: 80_000, otherFeePaise: 211_000 },
      { travellerId: travellers[1]!.id, form: "LUMP_SUM", lumpSumPaise: 200_000 },
    ],
    updatedAt: null,
  });
  expect(quote.status).toBe(200);
  return { travellers };
}

/**
 * Moves every traveller's embassy appointment to yesterday, 10:30 in India: the appointments have been, as when the
 * vendor submits the file (it can't be marked submitted before the earliest one, 0011 Decision 3, 16 Oct 2026).
 */
export async function appointmentsHeld(caseId: string) {
  await prisma.visaCaseTraveller.updateMany({
    where: { caseId, appointmentAt: { not: null } },
    data: { appointmentAt: istDateTimeToUtc(addDays(istToday(), -1), "10:30") },
  });
}

// Steps 6 and 7 (docs/decisions/0012-visa-decision.md, 0013-visa-passport-back.md): a decided file, and a recalled one.

/** A Wednesday at least 10 days out: an open day for the French embassy in Mumbai. */
export function aWednesday() {
  let day = addDays(istToday(), 10);
  while (isoWeekday(day) !== 3) day = addDays(day, 1);
  return day;
}

const updatedAtOf = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case.updatedAt as string;

/** Raises the case's invoice from its quote, as the Raise dialog does. */
async function raiseInvoice(agent: Agent, caseNo: string) {
  const { quoteUpdatedAt, taxType, gstRatePercent, totalPaise } = (await agent.get(`/api/visa/cases/${caseNo}/invoice/check`)).body.preview;
  expect((await agent.post(`/api/visa/cases/${caseNo}/invoice`).send({ quoteUpdatedAt, taxType, gstRatePercent, totalPaise })).status).toBe(200);
}

/**
 * Mehta's file, Neha's, submitted at the embassy (unless `decided` is false, the decision recorded too: Rakesh approved,
 * valid 20–60 days from today, Aarav refused). `extra` and `vendorId` make another family's file.
 */
export async function decidedCase({ decided = true, extra, vendorId }: { decided?: boolean; extra?: Record<string, unknown>; vendorId?: number } = {}) {
  if (!(await prisma.user.findUnique({ where: { email: "vimal@masti.test" } }))) await mastiReady();
  const c = await dispatchCase({ ...(vendorId ? { vendorId } : {}), ...(extra ? { extra } : {}) });
  const processor = await loginAs("neha@masti.test");
  const seen = await updatedAtOf(processor, c.caseNo);
  expect((await processor.post(`/api/visa/cases/${c.caseNo}/docket`).send({ mode: "OWN", updatedAt: seen })).status).toBe(200);
  await makeInvoiceable(processor, c, { clientName: "Rakesh Mehta" });
  await raiseInvoice(processor, c.caseNo);
  const courier = await prisma.courier.findUniqueOrThrow({ where: { code: "BLUE_DART" } });
  expect((await processor.post(`/api/visa/cases/${c.caseNo}/dispatch`).send({ courierId: courier.id, awbNo: "12345678", caseNos: [c.caseNo] })).status).toBe(200);
  const received = await updatedAtOf(processor, c.caseNo);
  expect((await processor.post(`/api/visa/cases/${c.caseNo}/vendor-received`).send({ updatedAt: received })).status).toBe(200);
  await appointmentsHeld(c.id);
  const embassy = await prisma.embassy.findUniqueOrThrow({ where: { code: "FR-MUM" } });
  const now = await updatedAtOf(processor, c.caseNo);
  const sub = await processor
    .put(`/api/visa/cases/${c.caseNo}/submission`)
    .send({ vendorFileNo: "FR-MUM88421", embassyId: embassy.id, collectionOn: aWednesday(), updatedAt: now });
  expect(sub.status).toBe(200);

  const [a, k] = await prisma.visaCaseTraveller.findMany({ where: { caseId: c.id }, orderBy: { position: "asc" } });
  await prisma.visaCaseTraveller.update({ where: { id: a!.id }, data: { name: "Rakesh Mehta" } });
  await prisma.visaCaseTraveller.update({ where: { id: k!.id }, data: { name: "Aarav Mehta" } });
  if (decided) {
    const outcomes = [
      { travellerId: a!.id, outcome: "APPROVED", visaNo: "0182 4471", validFrom: addDays(istToday(), 20), validTo: addDays(istToday(), 60) },
      { travellerId: k!.id, outcome: "REFUSED" },
    ];
    const updatedAt = await updatedAtOf(processor, c.caseNo);
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/decision`).send({ outcomes, updatedAt })).status).toBe(200);
  }
  return { c, processor, adult: a!.id, child: k!.id };
}

/**
 * Mehta's file, Neha's, invoiced, sent to the vendor on its own By hand and taken back ("Embassy taking too long",
 * the embassy fee credited): at Passport back, recalled, with no decision.
 */
export async function recalledCase({ extra, vendorId }: { extra?: Record<string, unknown>; vendorId?: number } = {}) {
  if (!(await prisma.user.findUnique({ where: { email: "vimal@masti.test" } }))) await mastiReady();
  const c = await dispatchCase({ ...(vendorId ? { vendorId } : {}), ...(extra ? { extra } : {}) });
  const processor = await loginAs("neha@masti.test");
  await makeInvoiceable(processor, c, { clientName: "Rakesh Mehta" });
  await raiseInvoice(processor, c.caseNo);
  const seen = await updatedAtOf(processor, c.caseNo);
  expect((await processor.post(`/api/visa/cases/${c.caseNo}/docket`).send({ mode: "OWN", updatedAt: seen })).status).toBe(200);
  const courier = await prisma.courier.findUniqueOrThrow({ where: { code: "BY_HAND" } });
  expect((await processor.post(`/api/visa/cases/${c.caseNo}/dispatch`).send({ courierId: courier.id, awbNo: null, caseNos: [c.caseNo] })).status).toBe(200);
  const reasonId = (await prisma.recallReason.findUniqueOrThrow({ where: { code: "EMBASSY_DELAY" } })).id;
  const { invoice, updatedAt } = (await processor.get(`/api/visa/cases/${c.caseNo}`)).body.case;
  expect((await processor.post(`/api/visa/cases/${c.caseNo}/recall`).send({ invoiceNo: invoice.invoiceNo, reasonId, updatedAt })).status).toBe(200);
  return { c, processor };
}
