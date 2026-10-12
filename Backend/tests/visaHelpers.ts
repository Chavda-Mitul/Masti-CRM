import { expect } from "vitest";
import { addMonths, istToday } from "../src/lib/dates";
import { createUser, loginAs, prisma } from "./helpers";

// Shared by the visa case tests (Step 2 in visaDocuments.test.ts, Step 3 in visaFilePrep.test.ts).

export type Agent = Awaited<ReturnType<typeof loginAs>>;

/** Aarti Patel, Visa staff with EDIT, logged in. */
export async function visaStaff() {
  await createUser({ name: "Aarti Patel", email: "aarti@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
  return loginAs("aarti@masti.test");
}

/** France Tourist for one adult and one child, saved by `agent`. */
export async function saveCase(agent: Agent) {
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
  });
  expect(res.status).toBe(201);
  return res.body.case as { id: string; caseNo: string; client: { id: string } };
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
