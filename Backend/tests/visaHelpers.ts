import { expect } from "vitest";
import { addMonths, istToday } from "../src/lib/dates";
import { createUser, loginAs, prisma } from "./helpers";

// Shared by the visa case tests (Step 2 in visaDocuments.test.ts, Step 3 in visaFilePrep.test.ts and visaTrip.test.ts).

export type Agent = Awaited<ReturnType<typeof loginAs>>;

/** Aarti Patel, Visa staff with EDIT, logged in. */
export async function visaStaff() {
  await createUser({ name: "Aarti Patel", email: "aarti@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
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
export async function maturedCase({ assigned = true } = {}) {
  const staff = await visaStaff();
  const saved = await saveCase(staff);
  const aarti = await prisma.user.findUniqueOrThrow({ where: { email: "aarti@masti.test" } });
  const neha = await createUser({ name: "Neha Joshi", email: "neha@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
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
