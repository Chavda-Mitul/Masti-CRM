import type { DocketKind } from "../../../generated/prisma/enums";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh } from "../../lib/changes";
import { istToday } from "../../lib/dates";
import { conflict, notFound } from "../../lib/httpError";
import { getCompanyDetails } from "../company/company.settings";
import { assertCanSeeEnquiry } from "../enquiries/visibility";
import type { Actor, UserWithDepartments } from "../users/user";
import { DISPATCHING, loadCase, lockCase } from "./caseLock";
import type { AddToDocketInput, TakeOutOfDocketInput } from "./visa.schemas";
import { formatCaseNo, getVisaCaseById } from "./visa.service";
import { getVisaSettings } from "./visa.settings";
import { docketOf, docketSelect } from "./visaCase";

// Visa Step 4, the Docket card (docs/decisions/0008-visa-docket-dispatch.md Decisions 2, 3, 7 and 10): a file-ready case
// joins its vendor's docket, or is taken out again while the docket is open. Dispatch comes with the Dispatch card.
//
// Locks, always in this order: the vendor, then the docket, then the case. Dispatch will lock the docket, then its cases,
// which fits. Two adds for one vendor take turns on the vendor's row, so a vendor never gets two shared open dockets
// (the partial unique index "Docket_one_open_group_per_vendor" backs this up).

/** The next docket number, "D-2026-0001", from the per-year counter, in the docket's own transaction. */
async function nextDocketNo(tx: Db, prefix: string, year: number) {
  const [counter] = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "DocketCounter" ("year", "lastValue") VALUES (${year}, 1)
    ON CONFLICT ("year") DO UPDATE SET "lastValue" = "DocketCounter"."lastValue" + 1
    RETURNING "lastValue"`;
  return formatCaseNo(prefix, year, Number(counter!.lastValue));
}

/**
 * The docket a case joins, under the vendor's lock. GROUP: the vendor's shared open docket. OWN: an emptied
 * single-case docket of the vendor's, so its number isn't wasted. Otherwise a new docket. An emptied open docket is
 * never shown, so reusing it is invisible (Decision 10).
 */
async function docketToJoin(tx: Db, vendorId: number, kind: DocketKind, actor: Actor) {
  const existing = await tx.docket.findFirst({
    where: { vendorId, kind, status: "OPEN", ...(kind === "OWN" ? { cases: { none: {} } } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, docketNo: true },
  });
  if (existing) return { ...existing, created: false };
  const { prefix } = (await getVisaSettings(tx)).docket;
  const docketNo = await nextDocketNo(tx, prefix, Number(istToday().slice(0, 4)));
  const docket = await tx.docket.create({ data: { docketNo, vendorId, kind, createdById: actor.user.id }, select: { id: true, docketNo: true } });
  return { ...docket, created: true };
}

/**
 * "Add to docket" (Decision 2): the processor, the Visa HOD or the Head. Only at Docket & dispatch, for a visa that needs
 * a vendor, with the vendor still active and covering the country. The case's updatedAt doesn't move, like the Step 3
 * edits.
 */
export async function addToDocket(caseNo: string, input: AddToDocketInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, DISPATCHING);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");
  // Step 3 is read-only by now, so the vendor can't change under us: it is safe to lock it first.
  const { vendorId } = await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: enquiry.id }, select: { vendorId: true } });
  if (vendorId === null) throw conflict("This case has no vendor, so it has no docket.");

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Vendor" WHERE "id" = ${vendorId} FOR UPDATE`;
    const docket = await docketToJoin(tx, vendorId, input.mode, actor);
    await tx.$queryRaw`SELECT "id" FROM "Docket" WHERE "id" = ${docket.id} FOR UPDATE`;
    // A dispatch that held the docket while we waited has sent it: it can't take more cases.
    const { status } = await tx.docket.findUniqueOrThrow({ where: { id: docket.id }, select: { status: true } });
    if (status !== "OPEN") throw conflict(`Docket ${docket.docketNo} was just dispatched. Try again.`);
    const locked = await lockCase(tx, enquiry.id, actor, DISPATCHING);
    assertFresh(locked.updatedAt, input.updatedAt, "case");

    const visa = await tx.visaCase.findUniqueOrThrow({
      where: { enquiryId: enquiry.id },
      select: {
        fileReadyAt: true,
        docket: { select: { docketNo: true } },
        offering: { select: { vendorNeeded: true, countryId: true, country: { select: { name: true } } } },
        vendor: { select: { name: true, isActive: true, countries: { select: { countryId: true } } } },
      },
    });
    if (!visa.fileReadyAt) throw conflict("Mark the file ready first.");
    if (!visa.offering.vendorNeeded) throw conflict("This visa needs no vendor, so it has no docket.");
    if (visa.docket) throw conflict(`This case is already in docket ${visa.docket.docketNo}.`);
    const vendor = visa.vendor!;
    if (!vendor.isActive) throw conflict(`${vendor.name} is switched off. Ask the Visa HOD to switch it back on.`);
    if (!vendor.countries.some((c) => c.countryId === visa.offering.countryId)) {
      throw conflict(`${vendor.name} no longer covers ${visa.offering.country.name}. Ask the Visa HOD.`);
    }

    // A docket that held no case until now starts its "Open since" today.
    const empty = docket.created || (await tx.visaCase.count({ where: { docketId: docket.id } })) === 0;
    if (empty && !docket.created) await tx.docket.update({ where: { id: docket.id }, data: { openedAt: new Date() } });
    await tx.visaCase.update({ where: { enquiryId: enquiry.id }, data: { docketId: docket.id } });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.docket.add",
        entityType: "Enquiry",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        before: { docketNo: null },
        after: { docketNo: docket.docketNo, kind: input.mode, newDocket: docket.created },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}

/**
 * "Take out of docket" (Decision 10): whoever can act on the case, until the docket is dispatched. An emptied docket
 * stays, unseen, for the vendor's next case of the same kind.
 */
export async function takeOutOfDocket(caseNo: string, input: TakeOutOfDocketInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, DISPATCHING);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");
  const { docketId } = await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: enquiry.id }, select: { docketId: true } });
  if (!docketId) throw conflict("This case isn't in a docket.");

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Docket" WHERE "id" = ${docketId} FOR UPDATE`;
    const locked = await lockCase(tx, enquiry.id, actor, DISPATCHING);
    assertFresh(locked.updatedAt, input.updatedAt, "case");
    const visa = await tx.visaCase.findUniqueOrThrow({
      where: { enquiryId: enquiry.id },
      select: { docketId: true, docket: { select: { docketNo: true, status: true } } },
    });
    if (!visa.docket) throw conflict("This case isn't in a docket.");
    if (visa.docketId !== docketId) throw conflict(`This case moved to docket ${visa.docket.docketNo}. Reload and try again.`);
    if (visa.docket.status !== "OPEN") throw conflict(`Docket ${visa.docket.docketNo} has been dispatched, so its cases can't change.`);

    await tx.visaCase.update({ where: { enquiryId: enquiry.id }, data: { docketId: null } });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.docket.remove",
        entityType: "Enquiry",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        before: { docketNo: visa.docket.docketNo },
        after: { docketNo: null },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}

/**
 * The parcel sticker (Decision 5): the docket's number, the vendor, each case with its passports and the totals (the
 * same counts as the Docket card), Masti's details for "From", and the label size. Anyone who can open the case can
 * print it, a dispatched docket too (a reprint). Printing changes nothing, so it isn't audited.
 */
export async function docketSticker(caseNo: string, user: UserWithDepartments) {
  const row = await prisma.enquiry.findUnique({
    where: { caseNo: caseNo.toUpperCase() },
    select: { id: true, ownerId: true, department: { select: { code: true } }, visa: { select: { docket: { select: docketSelect } } } },
  });
  if (!row?.visa) throw notFound("Case not found.");
  assertCanSeeEnquiry(user, row);
  if (!row.visa.docket) throw conflict("This case isn't in a docket yet.");

  const docket = docketOf(row.visa.docket, row.id);
  const [from, { sticker }] = await Promise.all([getCompanyDetails(), getVisaSettings()]);
  return {
    docketNo: docket.docketNo,
    status: docket.status,
    vendor: docket.vendor,
    cases: docket.cases.map(({ caseNo, passports, oldPassports }) => ({ caseNo, passports, oldPassports })),
    totalPassports: docket.totalPassports,
    totalOldPassports: docket.totalOldPassports,
    from,
    size: sticker,
  };
}

/**
 * Postpone and cancel call this inside their transaction, after their update has locked the case's row, so it can't
 * race an add (Decision 10): a case in an open docket must be taken out first.
 */
export async function assertNotInOpenDocket(tx: Db, enquiryId: string) {
  const visa = await tx.visaCase.findUnique({ where: { enquiryId }, select: { docket: { select: { docketNo: true, status: true } } } });
  if (visa?.docket?.status === "OPEN") throw conflict(`Take it out of docket ${visa.docket.docketNo} first.`);
}
