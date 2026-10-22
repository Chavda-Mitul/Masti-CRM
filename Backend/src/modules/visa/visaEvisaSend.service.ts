import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh } from "../../lib/changes";
import { dayLabel, fromDbDate, istToday, timeLabel } from "../../lib/dates";
import { conflict, HttpError } from "../../lib/httpError";
import type { Actor, UserWithDepartments } from "../users/user";
import { CHECKING_EVISA, findVisibleCase, loadCase, lockCase } from "./caseLock";
import type { SendEvisaInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { dueOnOfficeDay, getVisaSettings } from "./visa.settings";
import { countTravellers, travellerLabel } from "./visaCase";
import { deliverCase } from "./visaHandover.service";
import { queueEvisaMessage } from "./visaMessages";

// E-visas after the decision, part 3 (docs/decisions/0025-evisa-after-decision.md): "Send the e-visa". Once every
// approved traveller's e-visa PDF is uploaded and marked Matches (a mismatch blocks it, decided 22 Oct 2026), it goes to
// the client on WhatsApp, one message per traveller with their PDF (message 19). With no passports held, the case moves
// to Delivered and closes; with passports held (booklets counted at intake), it stays at Decision, due for the handover
// (part 4). Whoever can act on the case presses it (its owner, the Visa HOD, the Head), under the case's lock. Once sent,
// the PDFs, their checks and the decision can't change.

/** What sending checks, read again under the lock. */
async function gather(db: Db, enquiryId: string) {
  return db.visaCase.findUniqueOrThrow({
    where: { enquiryId },
    select: {
      submittedOnlineAt: true,
      evisaSentAt: true,
      bookletsCurrent: true,
      bookletsOld: true,
      travellers: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          position: true,
          isChild: true,
          name: true,
          outcome: true,
          visaNo: true,
          validFrom: true,
          validTo: true,
          stickerCheck: true,
          files: { where: { kind: "EVISA" }, orderBy: [{ uploadedAt: "desc" }, { id: "desc" }], take: 1, select: { id: true, fileName: true } },
        },
      },
    },
  });
}

type Gathered = Awaited<ReturnType<typeof gather>>;

/** Why it can't go yet, one line per approved traveller who isn't ready, in the case's order. */
export interface SendBlocker {
  kind: "NO_PDF" | "NOT_CHECKED" | "MISMATCH";
  travellerId: string;
  label: string;
}

/** The approved travellers, with the name the case shows them by and their current e-visa. */
function approvedOf(g: Gathered) {
  const { adults } = countTravellers(g.travellers);
  return g.travellers
    .filter((t) => t.outcome === "APPROVED")
    .map((t) => ({ ...t, label: t.name ?? travellerLabel(t, adults), file: t.files[0] ?? null }));
}

function blockersOf(g: Gathered): SendBlocker[] {
  return approvedOf(g).flatMap((t): SendBlocker[] => {
    if (!t.file) return [{ kind: "NO_PDF", travellerId: t.id, label: `Upload ${t.label}'s e-visa.` }];
    if (!t.stickerCheck) return [{ kind: "NOT_CHECKED", travellerId: t.id, label: `Check ${t.label}'s e-visa against the passport.` }];
    if (t.stickerCheck === "MISMATCH") {
      return [{ kind: "MISMATCH", travellerId: t.id, label: `${t.label}'s e-visa doesn't match the passport: get it corrected first.` }];
    }
    return [];
  });
}

/** The booklets counted in at intake, which we still hold: an e-visa's passports never went to a vendor. */
function heldBooklets(g: Gathered) {
  return (g.bookletsCurrent ?? 0) + (g.bookletsOld ?? 0);
}

/** The refusals that mean this case isn't sent, or not yet. */
function assertCanSend(g: Gathered) {
  if (!g.submittedOnlineAt) throw conflict("This visa has a sticker, not an e-visa: its passports come back from the vendor.");
  if (g.evisaSentAt) throw conflict(`The e-visa went to the client on ${dayLabel(istToday(g.evisaSentAt))}, ${timeLabel(g.evisaSentAt)}.`);
  if (approvedOf(g).length === 0) throw conflict("No one was approved: there's no e-visa to send.");
  const blockers = blockersOf(g);
  if (blockers.length) throw new HttpError(409, "The e-visa can't be sent yet.", { code: "SEND_BLOCKED", blockers });
}

/**
 * The dialog's first look: what blocks it, who gets a message with which file, and what happens to the case: it closes,
 * or, with passports held, it's due for the handover (visa.handoverCheck ⚠️).
 */
export async function sendEvisaCheck(caseNo: string, user: UserWithDepartments) {
  const { id } = await findVisibleCase(caseNo, user);
  const g = await gather(prisma, id);
  const held = heldBooklets(g);
  return {
    blockers: blockersOf(g),
    travellers: approvedOf(g).map((t) => ({ name: t.label, fileName: t.file?.fileName ?? null })),
    held,
    closes: held === 0,
    dueAt: held === 0 ? null : await dueOnOfficeDay((await getVisaSettings()).handoverCheck),
  };
}

/**
 * "Send the e-visa" (part 3). In one transaction under the case lock: who sent it and when; message 19 for each approved
 * traveller, carrying their current e-visa; then the case moves to Delivered and closes, or, with passports held, stays
 * at Decision, due for the handover; audited (visa.evisa.sent).
 */
export async function sendEvisa(caseNo: string, input: SendEvisaInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, CHECKING_EVISA);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");
  assertCanSend(await gather(prisma, enquiry.id));

  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, CHECKING_EVISA);
    assertFresh(locked.updatedAt, input.updatedAt, "case");
    const g = await gather(tx, enquiry.id);
    assertCanSend(g);

    await tx.visaCase.update({ where: { enquiryId: enquiry.id }, data: { evisaSentAt: new Date(), evisaSentById: actor.user.id } });
    const sent = approvedOf(g);
    for (const t of sent) {
      await queueEvisaMessage(tx, enquiry.id, {
        id: t.id,
        name: t.label,
        visaNo: t.visaNo!,
        validFrom: fromDbDate(t.validFrom!),
        validTo: fromDbDate(t.validTo!),
        fileId: t.file!.id,
      });
    }

    const held = heldBooklets(g);
    let closes = false;
    let dueAt: Date | null = null;
    if (held === 0) {
      ({ closes } = await deliverCase(tx, locked, actor, "the e-visa was sent", { evisa: true }));
    } else {
      dueAt = await dueOnOfficeDay((await getVisaSettings(tx)).handoverCheck, tx);
      await tx.enquiry.update({ where: { id: enquiry.id }, data: { dueAt } });
    }
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.evisa.sent",
        entityType: "Enquiry",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        before: { stage: "DECISION", status: locked.status, dueAt: locked.dueAt },
        after: {
          stage: closes ? "DELIVERED" : "DECISION",
          status: closes ? "CLOSED" : locked.status,
          dueAt,
          bookletsHeld: held,
          travellers: sent.map((t) => ({ name: t.label, fileId: t.file!.id })),
        },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}
