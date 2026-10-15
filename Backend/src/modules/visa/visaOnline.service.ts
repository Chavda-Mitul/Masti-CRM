import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh } from "../../lib/changes";
import { conflict, HttpError } from "../../lib/httpError";
import type { Actor, UserWithDepartments } from "../users/user";
import { DISPATCHING, findVisibleCase, loadCase, lockCase, visaStage } from "./caseLock";
import type { SubmitOnlineInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { dueOnOfficeDay, getVisaSettings } from "./visa.settings";
import type { DispatchBlocker } from "./visaDispatch.service";

// Visa Step 4 for e-visas (docs/decisions/0008-visa-docket-dispatch.md Decision 11): a visa whose "Vendor needed" is off
// goes in on the portal, so it has no docket, sticker, courier or vendor email. "Submitted online" needs the locked
// invoice, like dispatch (golden rule 3), and moves the case to Step 5 · At vendor, due back on its processor's desk the
// next open office day at 11:00 ⚠️ to check the portal (the setting visa.onlineCheck).
//
// Whoever can act on the case presses it (its owner, the Visa HOD, the Head), under the case's own lock like every
// other Step 4 change to one case. "Add to docket" takes the same lock, so the two can't both happen.

/** What the press checks, read again under the lock. */
async function gather(db: Db, enquiryId: string) {
  return db.enquiry.findUniqueOrThrow({
    where: { id: enquiryId },
    select: {
      invoice: { select: { invoiceNo: true } },
      visa: {
        select: {
          fileReadyAt: true,
          docket: { select: { docketNo: true } },
          offering: { select: { vendorNeeded: true } },
        },
      },
    },
  });
}

type Gathered = Awaited<ReturnType<typeof gather>>;

/** What stands in the way: only the invoice. A case that goes by docket never shows the button. */
function blockersOf(g: Gathered): DispatchBlocker[] {
  if (g.invoice) return [];
  return [{ kind: "INVOICE", label: "Raise the invoice first: no file is submitted without it.", items: [] }];
}

/** The refusals that mean this case doesn't go online, or not yet. */
function assertGoesOnline(g: Gathered) {
  const visa = g.visa!;
  if (!visa.fileReadyAt) throw conflict("Mark the file ready first.");
  if (visa.docket) throw conflict(`Take it out of docket ${visa.docket.docketNo} first.`);
  if (visa.offering.vendorNeeded) throw conflict("This visa needs a vendor: add it to a docket.");
  const blockers = blockersOf(g);
  if (blockers.length) throw new HttpError(409, "It can't be submitted yet.", { code: "SUBMIT_BLOCKED", blockers });
}

/** The dialog's first look: what blocks it, and when the case comes back due to check the portal. */
export async function submitOnlineCheck(caseNo: string, user: UserWithDepartments) {
  const { id } = await findVisibleCase(caseNo, user);
  const g = await gather(prisma, id);
  return {
    blockers: blockersOf(g),
    dueAt: await dueOnOfficeDay((await getVisaSettings()).onlineCheck),
  };
}

/**
 * "Submitted online" (Decision 11). In one transaction: the case moves to At vendor, due the next open office day at
 * 11:00 ⚠️ on its owner's desk, with who pressed it and when; audited. Step 4 is read-only afterwards.
 */
export async function submitOnline(caseNo: string, input: SubmitOnlineInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, DISPATCHING);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");
  assertGoesOnline(await gather(prisma, enquiry.id));

  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, DISPATCHING);
    assertFresh(locked.updatedAt, input.updatedAt, "case");
    const g = await gather(tx, enquiry.id);
    assertGoesOnline(g);

    const dueAt = await dueOnOfficeDay((await getVisaSettings(tx)).onlineCheck, tx);
    const atVendor = await visaStage(tx, locked.departmentId, "AT_VENDOR");
    await tx.enquiry.update({ where: { id: enquiry.id }, data: { stageId: atVendor.id, dueAt } });
    await tx.visaCase.update({ where: { enquiryId: enquiry.id }, data: { submittedOnlineAt: new Date(), submittedOnlineById: actor.user.id } });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.submittedOnline",
        entityType: "Enquiry",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        before: { stage: "DISPATCH", dueAt: locked.dueAt },
        after: { stage: "AT_VENDOR", dueAt, invoiceNo: g.invoice!.invoiceNo },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}
