import { randomUUID } from "node:crypto";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh } from "../../lib/changes";
import { fromDbDate, istToday, wholeYearsBetween } from "../../lib/dates";
import { badRequest, conflict, fieldError } from "../../lib/httpError";
import { imageType, type ImageType } from "../../lib/images";
import { logger } from "../../lib/logger";
import { MB } from "../../lib/pdf";
import { checkWarnings, confirmedWarningsNote, type Warning } from "../../lib/warnings";
import { deleteObject, putObject } from "../../lib/storage";
import type { Actor } from "../users/user";
import { cancelBookedFieldJobs } from "../fieldJobs/fieldJobs.service";
import { EVISA_AFTER_SUBMISSION, evisaDone, PRE_DISPATCH } from "../enquiries/visibility";
import { HANDING_OVER, loadCase, lockCase, visaStage } from "./caseLock";
import type { EnquiryStatus } from "../../../generated/prisma/enums";
import { assertNotHeldShort } from "./shortfall";
import type { HandOverInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { getVisaSettings } from "./visa.settings";
import { countTravellers, travellerLabel } from "./visaCase";
import { queueHandoverMessage } from "./visaMessages";

// Visa Step 8, delivered (docs/decisions/0014-visa-delivered.md). At the office (component 1): whoever is at the desk,
// any Visa staff with EDIT, who can open a case while its passports are in our stock (Decision 5), counts the booklets
// (they must match our stock, Decision 4), records who collected them (a traveller, or someone else by name) and takes
// their photo (Decisions 3 and 6), once the client confirmed with their one-time code (Decision 2, amended 23 Oct 2026;
// visaHandoverCode.service.ts), whatever the case's status (Decision 7). The case moves to Delivered and closes; a
// cancelled one stays cancelled. The photo is uploaded as soon as it's taken; "Hand over" links it. A short return is
// settled first (0013 Decision 5, amended 17 Oct 2026). Before dispatch, a cancelled case's passports held at our
// office (counted in at intake) are handed back the same way, against the intake count; that case stays at its step
// (docs/decisions/0006-visa-documents.md amendment 15, component 3).

/** What a handover checks, read again under the lock (also the delivery boy's at the door, 0015 phase 5). */
export async function gather(db: Db, enquiryId: string) {
  return db.visaCase.findUniqueOrThrow({
    where: { enquiryId },
    select: {
      passportsReceivedAt: true,
      bookletsCurrent: true,
      bookletsOld: true,
      bookletsBackCurrent: true,
      bookletsBackOld: true,
      shortfallClearedAt: true,
      submittedOnlineAt: true,
      evisaSentAt: true,
      handover: { select: { enquiryId: true } },
      travellers: {
        orderBy: { position: "asc" },
        select: { id: true, position: true, isChild: true, name: true, outcome: true, member: { select: { dateOfBirth: true } } },
      },
    },
  });
}

type Gathered = Awaited<ReturnType<typeof gather>>;

/**
 * In our stock, and not handed over yet: received at Step 7 (and not held by a short return: the rest come in, or the
 * shortfall is cleared, first; 0013 Decision 5, amended 17 Oct 2026); a cancelled case's passports counted in at
 * intake, before dispatch, or an e-visa's at Steps 5–6; or, held at our office since intake, an e-visa's with nothing
 * left to send: sent, or everyone refused (docs/decisions/0025-evisa-after-decision.md, parts 4–5). Returns what our
 * stock holds, which the count must match. The delivery boy's handover at the door checks the same (0015 phase 5).
 */
export function assertInStock(g: Gathered, c: { status: string; stage: { code: string } }) {
  if (c.stage.code === "PASSPORT_BACK") {
    if (!g.passportsReceivedAt) throw conflict("Mark the passports received first.");
    if (g.handover) throw conflict("The passports are already handed over.");
    assertNotHeldShort({ ...g, travellerCount: g.travellers.length });
    return { current: g.bookletsBackCurrent!, old: g.bookletsBackOld! };
  }
  // A paper file at Steps 5–6: its passports are with the vendor, and come back through Passport back.
  if (EVISA_AFTER_SUBMISSION.includes(c.stage.code) && !g.submittedOnlineAt) throw conflict("Passports are handed over from Passport back.");
  if (g.handover) throw conflict("The passports are already handed over.");
  const evisa = EVISA_AFTER_SUBMISSION.includes(c.stage.code);
  if (c.status !== "CANCELLED") {
    if (!evisa) throw conflict("Only a cancelled case's passports are handed back before they go to the vendor.");
    // An e-visa's passports go back once nothing is left to send: it went to the client, or everyone was refused (0025).
    if (c.stage.code !== "DECISION" || !evisaDone(g)) throw conflict("Upload every approved traveller's e-visa first: the passports go back after it.");
  }
  const stock = { current: g.bookletsCurrent ?? 0, old: g.bookletsOld ?? 0 };
  if (stock.current + stock.old === 0) throw conflict("No booklets were counted in for this case: there's nothing to hand back.");
  return stock;
}

/**
 * Before the photo is read: the case must be one this user may hand over now, and the setting gives the size limit
 * (visa.handoverPhoto). Refusing here means a wrong upload is never held in memory.
 */
export async function handoverPhotoLimit(caseNo: string, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, HANDING_OVER);
  assertInStock(await gather(prisma, enquiry.id), enquiry);
  const { maxMb } = (await getVisaSettings()).handoverPhoto;
  return { maxBytes: maxMb * MB, tooBig: `This photo is over ${maxMb} MB. Take it again, or pick a smaller one.` };
}

/**
 * Saves a photo of the person collecting the passports (Decision 6): really the JPEG or PNG it says it is, in the
 * private bucket under a key no other upload shares, as a case file of its own. The bucket upload happens before the
 * case lock; under the lock the checks are repeated, and if they fail now the object is removed again. Nothing about the
 * case changes until "Hand over" links the photo, so an open page doesn't go stale.
 */
export async function uploadHandoverPhoto(caseNo: string, bytes: Buffer, contentType: ImageType, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, HANDING_OVER);
  if (bytes.length === 0) throw badRequest("Take the photo first.");
  if (imageType(bytes) !== contentType) throw badRequest(`This isn't a ${contentType === "image/png" ? "PNG" : "JPEG"} photo. Take it again.`);
  assertInStock(await gather(prisma, enquiry.id), enquiry);
  const extension = contentType === "image/png" ? "png" : "jpg";
  const fileName = `${enquiry.caseNo}_receiver.${extension}`;
  const storageKey = `cases/${enquiry.id}/handover/${randomUUID()}.${extension}`;
  await putObject(storageKey, bytes, contentType);

  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await lockCase(tx, enquiry.id, actor, HANDING_OVER);
      assertInStock(await gather(tx, enquiry.id), locked);
      const file = await tx.caseFile.create({
        data: { enquiryId: enquiry.id, kind: "RECEIVER_PHOTO", storageKey, fileName, sizeBytes: bytes.length, uploadedById: actor.user.id },
        select: { id: true, fileName: true, uploadedAt: true },
      });
      await audit(
        {
          actorId: actor.user.id,
          action: "visa.file.upload",
          entityType: "CaseFile",
          entityId: file.id,
          clientId: enquiry.clientId,
          after: { kind: "RECEIVER_PHOTO", fileName, sizeBytes: bytes.length, storageKey },
          ip: actor.ip,
        },
        tx,
      );
      return file;
    });
  } catch (err) {
    // Nothing points at the object: remove it so the bucket holds only files the CRM knows. Best effort.
    await deleteObject(storageKey).catch((cleanupErr: unknown) => logger.error({ err: cleanupErr, storageKey }, "Couldn't remove an unsaved upload."));
    throw err;
  }
}

/**
 * The booklets match our stock (Decision 4: a missing one is found first), and who collected them: a traveller on the
 * case, or someone else by name. Returns the name the handover shows.
 */
export function checkHandover(g: Gathered, stock: { current: number; old: number }, input: Pick<HandOverInput, "booklets" | "receiver">) {
  if (input.booklets.current !== stock.current || input.booklets.old !== stock.old) {
    throw fieldError("booklets", `Count again: our stock has ${stock.current} current + ${stock.old} old. Find what's missing before handing over.`);
  }
  if (input.receiver.name) return input.receiver.name;
  const t = g.travellers.find((x) => x.id === input.receiver.travellerId);
  if (!t) throw fieldError("receiver", "Pick someone on this case, or Someone else.");
  return t.name ?? travellerLabel(t, countTravellers(g.travellers).adults);
}

/**
 * A child picked as who collected the passports (a soft warning, decided 19 Oct 2026, M46): they're usually handed to
 * an adult. Younger than ⚠️ visa.childAge (seeded 18) today, or, with no birth date on file, in a child's place on the
 * case. Someone else by name isn't checked. Also the delivery boy's at the door (0015 phase 5).
 */
export async function receiverWarnings(db: Db, g: Gathered, receiver: { travellerId?: string | null | undefined }): Promise<Warning[]> {
  const t = receiver.travellerId ? g.travellers.find((x) => x.id === receiver.travellerId) : undefined;
  if (!t) return [];
  const born = t.member?.dateOfBirth ? fromDbDate(t.member.dateOfBirth) : null;
  const age = born ? wholeYearsBetween(born, istToday()) : null;
  const child = age === null ? t.isChild : age < (await getVisaSettings(db)).childAge.adultFrom;
  if (!child) return [];
  const name = t.name ?? travellerLabel(t, countTravellers(g.travellers).adults);
  const who = age === null ? `${name} is on the case as a child` : `${name} is ${age}`;
  return [{ code: "CHILD_COLLECTS", message: `${who}: passports are usually handed to an adult.` }];
}

/** The photo, uploaded for this case's handover (Decision 3). */
async function checkPhoto(db: Db, enquiryId: string, photoId: string) {
  const photo = await db.caseFile.findUnique({ where: { id: photoId }, select: { enquiryId: true, kind: true } });
  if (!photo || photo.enquiryId !== enquiryId || photo.kind !== "RECEIVER_PHOTO") throw fieldError("photoId", "Take a photo of the person collecting.");
}

/**
 * The client confirmed their code today (India): a confirmation from another day doesn't count, as the door's is good
 * only on its stop's day (Decision 2, amended 23 Oct 2026).
 */
export const confirmedToday = (code: { confirmedAt: Date | null } | null, now = new Date()) => !!code?.confirmedAt && istToday(code.confirmedAt) === istToday(now);

/** The client's code for this handover, confirmed today: where it went and when (Decision 2, amended 23 Oct 2026). */
async function confirmedCode(db: Db, enquiryId: string) {
  const code = await db.handoverCode.findUnique({ where: { enquiryId }, select: { sentTo: true, confirmedAt: true } });
  if (!code?.confirmedAt || !confirmedToday(code)) throw fieldError("code", "The client hasn't confirmed with the code yet.");
  return { sentTo: code.sentTo, confirmedAt: code.confirmedAt };
}

/**
 * The passports are back with the client (Decision 7), in the caller's transaction: the case moves to Delivered with no
 * due time (handed back before dispatch, a cancelled case stays at its step: 0006 amendment 15); an open or postponed
 * case closes (its reason and resume date cleared), a cancelled one stays cancelled; and any job still booked for the
 * field boy is called off, with why. Returns whether it closed and what was called off, for the caller's audit. The
 * office handover and the delivery boy's at the door (0015 phase 5) both end here, and so does an e-visa, whose case
 * moves to Delivered from Decision (`evisa`, docs/decisions/0025-evisa-after-decision.md).
 */
export async function deliverCase(
  tx: Db,
  locked: { id: string; departmentId: number; status: EnquiryStatus; stage: { code: string } },
  actor: Actor,
  why: string,
  { evisa = false }: { evisa?: boolean } = {},
) {
  const toDelivered = locked.stage.code === "PASSPORT_BACK" || (evisa && locked.stage.code === "DECISION");
  const delivered = toDelivered ? await visaStage(tx, locked.departmentId, "DELIVERED") : null;
  const closes = locked.status === "OPEN" || locked.status === "POSTPONED";
  await tx.enquiry.update({
    where: { id: locked.id },
    data: {
      ...(delivered ? { stageId: delivered.id } : {}),
      dueAt: null,
      ...(closes ? { status: "CLOSED", reasonId: null, resumeOn: null } : {}),
    },
  });
  const fieldJobsCancelled = await cancelBookedFieldJobs(tx, { enquiryId: locked.id }, actor, why);
  return { closes, delivered: !!delivered, fieldJobsCancelled };
}

/**
 * "Hand over to the client" at the office (Decisions 3–7), by any Visa staff with EDIT, whatever the case's status, once
 * the client confirmed with their code today (Decision 2, amended 23 Oct 2026). In one transaction under the case lock:
 * the handover (how, when, who handed over, the booklets, who collected them, their photo, the code's proof); the move to
 * Delivered with no due time; an open or postponed case closes (its reason and resume date cleared), a cancelled one
 * stays cancelled; a delivery booked for the boy is called off (0015); and the audit (visa.handover). Handed back before
 * dispatch, a cancelled case stays at its step, with no due time (0006 amendment 15).
 */
export async function handOver(caseNo: string, input: HandOverInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, HANDING_OVER);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");
  const pre = await gather(prisma, enquiry.id);
  checkHandover(pre, assertInStock(pre, enquiry), input);
  await checkPhoto(prisma, enquiry.id, input.photoId);
  await confirmedCode(prisma, enquiry.id);
  checkWarnings(await receiverWarnings(prisma, pre, input.receiver), input.confirmWarnings);

  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, HANDING_OVER);
    assertFresh(locked.updatedAt, input.updatedAt, "case");
    const g = await gather(tx, enquiry.id);
    const receiver = checkHandover(g, assertInStock(g, locked), input);
    await checkPhoto(tx, enquiry.id, input.photoId);
    const code = await confirmedCode(tx, enquiry.id);
    const confirmed = checkWarnings(await receiverWarnings(tx, g, input.receiver), input.confirmWarnings);

    const beforeDispatch = PRE_DISPATCH.includes(locked.stage.code);
    // Handed over here: a delivery booked for the boy is called off (0015). An e-visa's case with nothing left to send
    // is Delivered (0025).
    const { closes, delivered, fieldJobsCancelled } = await deliverCase(tx, locked, actor, "handed over at the office", {
      evisa: !!g.submittedOnlineAt && evisaDone(g) && locked.status !== "CANCELLED",
    });
    const handover = await tx.visaHandover.create({
      data: {
        enquiryId: enquiry.id,
        mode: "OFFICE",
        at: new Date(),
        byId: actor.user.id,
        bookletsCurrent: input.booklets.current,
        bookletsOld: input.booklets.old,
        receiverTravellerId: input.receiver.travellerId ?? null,
        receiverName: input.receiver.name ?? null,
        receiverPhotoId: input.photoId,
        codeSentTo: code.sentTo,
        codeConfirmedAt: code.confirmedAt,
      },
    });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.handover",
        entityType: "Enquiry",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        before: { stage: locked.stage.code, status: locked.status, dueAt: locked.dueAt },
        after: {
          stage: delivered ? "DELIVERED" : locked.stage.code,
          ...(beforeDispatch ? { beforeDispatch: true } : {}),
          status: closes ? "CLOSED" : locked.status,
          mode: "OFFICE",
          booklets: input.booklets,
          receiver,
          receiverIsTraveller: !!input.receiver.travellerId,
          photoId: input.photoId,
          code,
          ...(fieldJobsCancelled.length > 0 ? { fieldJobsCancelled } : {}),
          ...confirmedWarningsNote(confirmed),
        },
        ip: actor.ip,
      },
      tx,
    );
    // Message 15 (docs/whatsapp-visa-messages.md), a cancelled case's hand-back too.
    await queueHandoverMessage(tx, enquiry.id, { booklets: input.booklets, receiver, at: handover.at });
  });
  return getVisaCaseById(enquiry.id);
}
