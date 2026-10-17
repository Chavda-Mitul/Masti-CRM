import { randomUUID } from "node:crypto";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh } from "../../lib/changes";
import { badRequest, conflict, fieldError } from "../../lib/httpError";
import { imageType, type ImageType } from "../../lib/images";
import { logger } from "../../lib/logger";
import { deleteObject, putObject } from "../../lib/storage";
import type { Actor } from "../users/user";
import { cancelBookedFieldJobs } from "../fieldJobs/fieldJobs.service";
import { HANDING_OVER, loadCase, lockCase, visaStage } from "./caseLock";
import { MB } from "./casePdf";
import type { EnquiryStatus } from "../../../generated/prisma/enums";
import { assertNotHeldShort } from "./shortfall";
import type { HandOverInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { getVisaSettings } from "./visa.settings";
import { countTravellers, travellerLabel } from "./visaCase";

// Visa Step 8, delivered (docs/decisions/0014-visa-delivered.md). At the office (component 1): whoever is at the desk,
// any Visa staff with EDIT, who can open a case while its passports are in our stock (Decision 5), counts the booklets
// (they must match our stock, Decision 4), records who collected them (a traveller, or someone else by name) and takes
// their photo (Decisions 3 and 6), whatever the case's status (Decision 7). The case moves to Delivered and closes; a
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
      handover: { select: { enquiryId: true } },
      travellers: { orderBy: { position: "asc" }, select: { id: true, position: true, isChild: true, name: true } },
    },
  });
}

type Gathered = Awaited<ReturnType<typeof gather>>;

/**
 * In our stock, and not handed over yet: received at Step 7 (and not held by a short return: the rest come in, or the
 * shortfall is cleared, first; 0013 Decision 5, amended 17 Oct 2026), or before dispatch, a cancelled case's passports
 * counted in at intake. Returns what our stock holds, which the count must match. The delivery boy's handover at the
 * door checks the same (0015 phase 5).
 */
export function assertInStock(g: Gathered, c: { status: string; stage: { code: string } }) {
  if (c.stage.code === "PASSPORT_BACK") {
    if (!g.passportsReceivedAt) throw conflict("Mark the passports received first.");
    if (g.handover) throw conflict("The passports are already handed over.");
    assertNotHeldShort({ ...g, travellerCount: g.travellers.length });
    return { current: g.bookletsBackCurrent!, old: g.bookletsBackOld! };
  }
  if (g.handover) throw conflict("The passports are already handed over.");
  if (c.status !== "CANCELLED") throw conflict("Only a cancelled case's passports are handed back before they go to the vendor.");
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

/** The photo, uploaded for this case's handover (Decision 3). */
async function checkPhoto(db: Db, enquiryId: string, photoId: string) {
  const photo = await db.caseFile.findUnique({ where: { id: photoId }, select: { enquiryId: true, kind: true } });
  if (!photo || photo.enquiryId !== enquiryId || photo.kind !== "RECEIVER_PHOTO") throw fieldError("photoId", "Take a photo of the person collecting.");
}

/**
 * The passports are back with the client (Decision 7), in the caller's transaction: the case moves to Delivered with no
 * due time (handed back before dispatch, a cancelled case stays at its step: 0006 amendment 15); an open or postponed
 * case closes (its reason and resume date cleared), a cancelled one stays cancelled; and any job still booked for the
 * field boy is called off, with why. Returns whether it closed and what was called off, for the caller's audit. The
 * office handover and the delivery boy's at the door (0015 phase 5) both end here.
 */
export async function deliverCase(
  tx: Db,
  locked: { id: string; departmentId: number; status: EnquiryStatus; stage: { code: string } },
  actor: Actor,
  why: string,
) {
  const delivered = locked.stage.code === "PASSPORT_BACK" ? await visaStage(tx, locked.departmentId, "DELIVERED") : null;
  const closes = locked.status === "OPEN" || locked.status === "POSTPONED";
  await tx.enquiry.update({
    where: { id: locked.id },
    data: {
      ...(delivered ? { stageId: delivered.id } : {}),
      dueAt: null,
      ...(closes ? { status: "CLOSED", reasonId: null, resumeOn: null } : {}),
    },
  });
  const fieldJobsCancelled = await cancelBookedFieldJobs(tx, locked.id, actor, why);
  return { closes, fieldJobsCancelled };
}

/**
 * "Hand over to the client" at the office (Decisions 3–7), by any Visa staff with EDIT, whatever the case's status. In
 * one transaction under the case lock: the handover (how, when, who handed over, the booklets, who collected them,
 * their photo); the move to Delivered with no due time; an open or postponed case closes (its reason and resume date
 * cleared), a cancelled one stays cancelled; a delivery booked for the boy is called off (0015); and the audit
 * (visa.handover). Handed back before dispatch, a cancelled case stays at its step, with no due time (0006 amendment 15).
 */
export async function handOver(caseNo: string, input: HandOverInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, HANDING_OVER);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");
  const pre = await gather(prisma, enquiry.id);
  checkHandover(pre, assertInStock(pre, enquiry), input);
  await checkPhoto(prisma, enquiry.id, input.photoId);

  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, HANDING_OVER);
    assertFresh(locked.updatedAt, input.updatedAt, "case");
    const g = await gather(tx, enquiry.id);
    const receiver = checkHandover(g, assertInStock(g, locked), input);
    await checkPhoto(tx, enquiry.id, input.photoId);

    const beforeDispatch = locked.stage.code !== "PASSPORT_BACK";
    // Handed over here: a delivery booked for the boy is called off (0015).
    const { closes, fieldJobsCancelled } = await deliverCase(tx, locked, actor, "handed over at the office");
    await tx.visaHandover.create({
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
          stage: beforeDispatch ? locked.stage.code : "DELIVERED",
          ...(beforeDispatch ? { beforeDispatch: true } : {}),
          status: closes ? "CLOSED" : locked.status,
          mode: "OFFICE",
          booklets: input.booklets,
          receiver,
          receiverIsTraveller: !!input.receiver.travellerId,
          photoId: input.photoId,
          ...(fieldJobsCancelled.length > 0 ? { fieldJobsCancelled } : {}),
        },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}
