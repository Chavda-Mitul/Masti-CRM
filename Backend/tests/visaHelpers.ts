import { expect } from "vitest";
import { addDays, addMonths, istDateTimeToUtc, istToday, toDbDate } from "../src/lib/dates";
import { createUser, loginAs, prisma } from "./helpers";

// Shared by the visa case tests (Step 2 in visaDocuments.test.ts, Step 3 in visaFilePrep.test.ts and visaTrip.test.ts,
// Step 4 in visaDocket.test.ts).

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
    : await prisma.vendor.create({ data: { name: "Global Visa Services", city: "Mumbai", countries: { create: [{ countryId: fr.id }] } } });
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
