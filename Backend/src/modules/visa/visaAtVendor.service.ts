import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh } from "../../lib/changes";
import { conflict } from "../../lib/httpError";
import type { Actor, UserWithDepartments } from "../users/user";
import { findVisibleCase, loadCase, lockCase, WITH_VENDOR } from "./caseLock";
import type { VendorReceivedInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { dueOnOfficeDay, getVisaSettings } from "./visa.settings";

// Visa Step 5, at the vendor (docs/decisions/0011-visa-at-vendor.md). "Vendor got it, papers checked" (Decision 2) is
// confirmed per file, on its own case page, by whoever can act on the case. The file then comes back due when the vendor
// submits it: the earliest traveller's appointment still to come, or the next open office day at 11:00 ⚠️
// (visa.submissionCheck). An e-visa has no vendor, so it has nothing to confirm.

/** What "Vendor got it" checks, read again under the lock. */
async function gather(db: Db, enquiryId: string) {
  return db.visaCase.findUniqueOrThrow({
    where: { enquiryId },
    select: {
      vendorReceivedAt: true,
      docket: { select: { docketNo: true } },
      travellers: { select: { appointmentAt: true } },
    },
  });
}

type Gathered = Awaited<ReturnType<typeof gather>>;

/**
 * When the file comes back due after "Vendor got it": the earliest appointment still to come, when the vendor submits
 * it; with none, the next open office day at 11:00 ⚠️.
 */
async function dueAfterReceipt(db: Db, g: Gathered) {
  const now = Date.now();
  const appointments = g.travellers.map((t) => t.appointmentAt).filter((at): at is Date => !!at && at.getTime() > now);
  if (appointments.length) {
    return { dueAt: new Date(Math.min(...appointments.map((at) => at.getTime()))), dueReason: "APPOINTMENT" as const };
  }
  return { dueAt: await dueOnOfficeDay((await getVisaSettings(db)).submissionCheck, db), dueReason: "NEXT_DAY" as const };
}

function assertCanConfirm(g: Gathered) {
  if (!g.docket) throw conflict("This file went in online: there's no vendor to confirm.");
  if (g.vendorReceivedAt) throw conflict("The vendor already has this file: it's recorded.");
}

/** The dialog's first look: when the file comes back due, and why then. */
export async function vendorReceivedCheck(caseNo: string, user: UserWithDepartments) {
  const { id } = await findVisibleCase(caseNo, user);
  return dueAfterReceipt(prisma, await gather(prisma, id));
}

/**
 * "Vendor got it, papers checked" (Decision 2). In one transaction: who and when are stamped on this file only, it
 * comes back due at the appointment (or the next office day), and it's audited. The other files in its docket don't
 * change.
 */
export async function markVendorReceived(caseNo: string, input: VendorReceivedInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, WITH_VENDOR);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");
  assertCanConfirm(await gather(prisma, enquiry.id));

  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, WITH_VENDOR);
    assertFresh(locked.updatedAt, input.updatedAt, "case");
    const g = await gather(tx, enquiry.id);
    assertCanConfirm(g);

    const { dueAt, dueReason } = await dueAfterReceipt(tx, g);
    await tx.enquiry.update({ where: { id: enquiry.id }, data: { dueAt } });
    await tx.visaCase.update({ where: { enquiryId: enquiry.id }, data: { vendorReceivedAt: new Date(), vendorReceivedById: actor.user.id } });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.vendorReceived",
        entityType: "Enquiry",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        before: { dueAt: locked.dueAt },
        after: { dueAt, dueReason, docketNo: g.docket!.docketNo },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}
