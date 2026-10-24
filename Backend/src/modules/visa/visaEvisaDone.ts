import type { VisaOutcome } from "../../../generated/prisma/enums";
import type { Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import type { Actor } from "../users/user";
import type { LockedCase } from "./caseLock";
import { dueOnOfficeDay, getVisaSettings } from "./visa.settings";
import { countTravellers, travellerLabel } from "./visaCase";
import { deliverCase } from "./visaHandover.service";

// E-visas after the decision (docs/decisions/0025-evisa-after-decision.md, amended 24 Oct 2026, change request 21 part
// 3): each approved traveller's e-visa goes to the client when it's uploaded (message 19, visaEvisa.service.ts), with
// no check and no "Send the e-visa". Once every approved traveller's has gone, the case does what that button did:
// who and when (VisaCase.evisaSentAt), then Delivered and closed with no passports held, or due for their handover
// (visa.handoverCheck ⚠️). The upload that sends the last one finishes it, or a Change that leaves no approved traveller
// waiting.

/** What finishing reads: the e-visa, the passports we hold, and each traveller's outcome and newest e-visa. */
export function evisaState(db: Db, enquiryId: string) {
  return db.visaCase.findUniqueOrThrow({
    where: { enquiryId },
    select: {
      submittedOnlineAt: true,
      evisaSentAt: true,
      bookletsCurrent: true,
      bookletsOld: true,
      handover: { select: { enquiryId: true } },
      travellers: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          position: true,
          isChild: true,
          name: true,
          outcome: true,
          files: { where: { kind: "EVISA" }, orderBy: [{ uploadedAt: "desc" }, { id: "desc" }], take: 1, select: { id: true } },
        },
      },
    },
  });
}

export type EvisaState = Awaited<ReturnType<typeof evisaState>>;
type Traveller = EvisaState["travellers"][number];

/**
 * Nothing left to send: an e-visa not yet finished, someone approved, and every approved traveller's e-visa uploaded
 * (each went when it was). `outcomeOf` reads a change about to be saved.
 */
export function evisasAllIn(s: EvisaState, outcomeOf: (t: Traveller) => VisaOutcome | null = (t) => t.outcome) {
  if (!s.submittedOnlineAt || s.evisaSentAt) return false;
  const approved = s.travellers.filter((t) => outcomeOf(t) === "APPROVED");
  return approved.length > 0 && approved.every((t) => t.files.length > 0);
}

/** The passports we hold for the case: booklets counted in at intake, not handed back yet. */
export function heldBooklets(s: Pick<EvisaState, "handover" | "bookletsCurrent" | "bookletsOld">) {
  return s.handover ? 0 : (s.bookletsCurrent ?? 0) + (s.bookletsOld ?? 0);
}

/**
 * Every approved traveller's e-visa has gone (read again after the save, under the case's lock): who and when; then
 * Delivered and closed with no passports held, or, with passports held, due for their handover. Audited
 * (visa.evisa.sent).
 */
export async function finishEvisas(tx: Db, locked: LockedCase, s: EvisaState, actor: Actor) {
  await tx.visaCase.update({ where: { enquiryId: locked.id }, data: { evisaSentAt: new Date(), evisaSentById: actor.user.id } });
  const held = heldBooklets(s);
  let closes = false;
  let dueAt: Date | null = null;
  if (held === 0) {
    ({ closes } = await deliverCase(tx, locked, actor, "every approved traveller's e-visa went to the client", { evisa: true }));
  } else {
    dueAt = await dueOnOfficeDay((await getVisaSettings(tx)).handoverCheck, tx);
    await tx.enquiry.update({ where: { id: locked.id }, data: { dueAt } });
  }
  const { adults } = countTravellers(s.travellers);
  await audit(
    {
      actorId: actor.user.id,
      action: "visa.evisa.sent",
      entityType: "Enquiry",
      entityId: locked.id,
      clientId: locked.clientId,
      before: { stage: "DECISION", status: locked.status, dueAt: locked.dueAt },
      after: {
        stage: closes ? "DELIVERED" : "DECISION",
        status: closes ? "CLOSED" : locked.status,
        dueAt,
        bookletsHeld: held,
        travellers: s.travellers
          .filter((t) => t.outcome === "APPROVED")
          .map((t) => ({ name: t.name ?? travellerLabel(t, adults), fileId: t.files[0]?.id ?? null })),
      },
      ip: actor.ip,
    },
    tx,
  );
  return { closes, dueAt };
}
