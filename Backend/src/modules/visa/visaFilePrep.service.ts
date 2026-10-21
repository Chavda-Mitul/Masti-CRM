import { randomUUID } from "node:crypto";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh, definedOnly, onlyChanged, pick } from "../../lib/changes";
import { fromDbDate, istDateTimeToUtc } from "../../lib/dates";
import { conflict, fieldError, HttpError, notFound } from "../../lib/httpError";
import { logger } from "../../lib/logger";
import { MB, pdfPageCount, tooBigMessage } from "../../lib/pdf";
import { checkWarnings, confirmedWarningsNote, type Warning } from "../../lib/warnings";
import { deleteObject, presignGet, putObject } from "../../lib/storage";
import type { Actor } from "../users/user";
import { findVisibleCase, loadCase, lockCase, PREPARING, visaStage } from "./caseLock";
import type { CheckCaseDocumentInput, FileReadyInput, SetVendorInput, UpdateApplicationInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { dueOnOfficeDay, getVisaSettings } from "./visa.settings";
import { countTravellers, fileSafeFamilyName, travellerLabel } from "./visaCase";
import { appointmentSelect, appointmentWarnings, namedAppointments, passportWarnings, travellerPapersSelect } from "./visaWarnings";

// Visa Step 3, file preparation (docs/decisions/0007-visa-file-prep.md): the processor's check of each paper, each
// traveller's portal details, and the saved file. Every write locks the case first (caseLock.ts), so "File ready" and a change here take turns.

/**
 * The processor checks one paper again (Decision 3): Checked, or Needs replacing with a reason from the master list.
 * Each stamps who and when, to the minute; Checked clears the reason, and null sets the paper back to "to check".
 * Step 2's receipt (Original/Xerox, who received it and when) is left as it was. The audit log keeps the history.
 */
export async function checkDocument(caseNo: string, documentId: string, input: CheckCaseDocumentInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, PREPARING);
  const doc = await prisma.visaCaseDocument.findFirst({ where: { id: documentId, traveller: { caseId: enquiry.id } } });
  if (!doc) throw notFound("Document not found on this case.");
  // Papers are frozen after maturity, so this can't change while the request waits for the lock.
  if (doc.status !== "RECEIVED" && doc.status !== "MADE") {
    throw fieldError("check", "Only papers that came in, or that we made, are checked.");
  }

  const reasonId = input.check === "NEEDS_REPLACING" ? (input.reasonId ?? null) : null;

  await prisma.$transaction(async (tx) => {
    await lockCase(tx, enquiry.id, actor, PREPARING);
    // The paper as it is now, under the lock: someone may have checked it while this request waited.
    const before = await tx.visaCaseDocument.findUniqueOrThrow({ where: { id: doc.id }, include: { checkReason: true } });
    // Re-sending the same check changes nothing (and doesn't move its time).
    if (before.check === input.check && before.checkReasonId === reasonId) return;
    if (reasonId !== null) {
      const reason = await tx.documentProblemReason.findUnique({ where: { id: reasonId } });
      if (!reason?.isActive) throw fieldError("reasonId", "Pick a reason from the list.");
    }

    const now = input.check ? new Date() : null;
    const after = await tx.visaCaseDocument.update({
      where: { id: doc.id },
      data: { check: input.check, checkReasonId: reasonId, checkedAt: now, checkedById: input.check ? actor.user.id : null },
      include: { checkReason: true },
    });
    const snapshot = (d: typeof after) => ({
      name: d.name,
      check: d.check,
      checkReasonId: d.checkReasonId,
      reason: d.checkReason?.name ?? null,
      checkedAt: d.checkedAt,
      checkedById: d.checkedById,
    });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.document.check",
        entityType: "VisaCaseDocument",
        entityId: doc.id,
        clientId: enquiry.clientId,
        before: snapshot(before),
        after: snapshot(after),
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}

/**
 * One traveller's portal details (Decision 5): the acknowledgement number the portal gave, and the appointment, a day
 * and a time in India. A newly set appointment can't be in the past; there is no holiday check, because the portal
 * gave that slot. Saved whatever the visa's "Appointment needed" says: the switch only decides what "File ready" asks
 * for. Only what changed is written and audited.
 */
export async function updateApplication(caseNo: string, travellerId: string, input: UpdateApplicationInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, PREPARING);
  const found = await prisma.visaCaseTraveller.findFirst({ where: { id: travellerId, caseId: enquiry.id } });
  if (!found) throw notFound("Traveller not found on this case.");
  const { appointment, confirmWarnings, ...rest } = input;
  const sent = definedOnly({
    ...rest,
    appointmentAt: appointment === undefined ? undefined : appointment && istDateTimeToUtc(appointment.on, appointment.at),
  });

  await prisma.$transaction(async (tx) => {
    await lockCase(tx, enquiry.id, actor, PREPARING);
    const before = await tx.visaCaseTraveller.findUniqueOrThrow({ where: { id: found.id } });
    const changes = onlyChanged(sent, before);
    const keys = Object.keys(changes);
    if (keys.length === 0) return;
    if (changes.appointmentAt && changes.appointmentAt.getTime() <= Date.now()) {
      throw fieldError("appointment", "Pick a time later than now.");
    }
    // An appointment on or after the departure day can't bring the visa in time; it can still be right if the trip
    // moves (a soft warning, decided 19 Oct 2026).
    let confirmed: Warning[] = [];
    if (changes.appointmentAt && appointment) {
      const { departOn, travellers } = await tx.visaCase.findUniqueOrThrow({
        where: { enquiryId: enquiry.id },
        select: { departOn: true, travellers: { select: { isChild: true } } },
      });
      // Named as the case names them: the passport name, else "Adult 1".
      const name = before.name ?? travellerLabel(before, countTravellers(travellers).adults);
      confirmed = checkWarnings(appointmentWarnings(departOn && fromDbDate(departOn), [{ name, appointmentAt: changes.appointmentAt }]), confirmWarnings);
    }
    const after = await tx.visaCaseTraveller.update({ where: { id: found.id }, data: changes });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.traveller.application",
        entityType: "VisaCaseTraveller",
        entityId: found.id,
        clientId: enquiry.clientId,
        before: { name: before.name, ...pick(before, keys) },
        after: { name: after.name, ...pick(after, keys), ...confirmedWarningsNote(confirmed) },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}

/** "Global Visa Services · Mumbai", as the case page shows it and the audit log keeps it. */
const vendorLabel = (v: { name: string; city: string } | null) => (v ? `${v.name} · ${v.city}` : null);

/**
 * The submission agent for this case (Decision 7): one of the active vendors that cover the case's country. null clears
 * the pick. Allowed whatever the visa's "Vendor needed" says: the switch only decides what "File ready" asks for. A
 * vendor switched off after being picked stays on the case until someone picks another.
 */
export async function setVendor(caseNo: string, input: SetVendorInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, PREPARING);

  await prisma.$transaction(async (tx) => {
    await lockCase(tx, enquiry.id, actor, PREPARING);
    const visa = await tx.visaCase.findUniqueOrThrow({
      where: { enquiryId: enquiry.id },
      include: { vendor: { select: { name: true, city: true } }, offering: { include: { country: { select: { id: true, name: true } } } } },
    });
    if (visa.vendorId === input.vendorId) return;

    let picked: { name: string; city: string } | null = null;
    if (input.vendorId !== null) {
      const vendor = await tx.vendor.findUnique({
        where: { id: input.vendorId },
        include: { countries: { where: { countryId: visa.offering.country.id }, select: { countryId: true } } },
      });
      if (!vendor) throw fieldError("vendorId", "Pick a vendor from the list.");
      if (!vendor.isActive) throw fieldError("vendorId", "This vendor is switched off. Pick an active one.");
      if (vendor.countries.length === 0) throw fieldError("vendorId", `${vendor.name} doesn't cover ${visa.offering.country.name}. Pick one that does.`);
      picked = vendor;
    }

    await tx.visaCase.update({ where: { enquiryId: enquiry.id }, data: { vendorId: input.vendorId } });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.vendor.set",
        entityType: "VisaCase",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        before: { vendorId: visa.vendorId, vendor: vendorLabel(visa.vendor) },
        after: { vendorId: input.vendorId, vendor: vendorLabel(picked) },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}

// ---------------------------------------------------------------------------
// The saved file, kept as proof (Decision 8)
// ---------------------------------------------------------------------------

/**
 * Before the upload is read: the case must be one this user may change at File preparation, and the setting gives
 * the size limit. Refusing here means a wrong upload is never held in memory.
 */
export async function finalFileLimit(caseNo: string, actor: Actor) {
  await loadCase(caseNo, actor, PREPARING);
  const { maxMb } = (await getVisaSettings()).finalFile;
  return { maxBytes: maxMb * MB, tooBig: tooBigMessage(maxMb) };
}

/** "VISA-2026-0001_Mehta_file.pdf" ⚠️ (demo screen 08): the case number and the client's last name, letters and digits only. */
function finalFileName(caseNo: string, clientName: string) {
  const safe = fileSafeFamilyName(clientName);
  return safe ? `${caseNo}_${safe}_file.pdf` : `${caseNo}_file.pdf`;
}

/**
 * Saves the final file: one PDF, every page as it went to the vendor. It must really be a PDF (it starts with %PDF-
 * and opens), its pages are counted, and it goes to the private bucket under a key no other upload shares. The newest
 * upload is the current file; older ones are kept as proof. Allowed during File preparation only.
 *
 * The bucket upload happens before the case lock, so a slow upload never holds the case. Under the lock the checks are
 * repeated; if the case moved on meanwhile, the row isn't saved and the object is removed again.
 */
export async function uploadFinalFile(caseNo: string, bytes: Buffer, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, PREPARING);
  const pageCount = await pdfPageCount(bytes);

  const client = await prisma.client.findUniqueOrThrow({ where: { id: enquiry.clientId }, select: { name: true } });
  const fileName = finalFileName(enquiry.caseNo, client.name);
  const storageKey = `cases/${enquiry.id}/final/${randomUUID()}.pdf`;
  await putObject(storageKey, bytes, "application/pdf");

  try {
    await prisma.$transaction(async (tx) => {
      await lockCase(tx, enquiry.id, actor, PREPARING);
      const previous = await tx.caseFile.findFirst({
        where: { enquiryId: enquiry.id, kind: "FINAL_FILE" },
        orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      const file = await tx.caseFile.create({
        data: { enquiryId: enquiry.id, kind: "FINAL_FILE", storageKey, fileName, sizeBytes: bytes.length, pageCount, uploadedById: actor.user.id },
      });
      await audit(
        {
          actorId: actor.user.id,
          action: "visa.file.upload",
          entityType: "CaseFile",
          entityId: file.id,
          clientId: enquiry.clientId,
          after: { kind: file.kind, fileName, sizeBytes: file.sizeBytes, pageCount, storageKey, replaces: previous?.id ?? null },
          ip: actor.ip,
        },
        tx,
      );
    });
  } catch (err) {
    // Nothing points at the object: remove it so the bucket holds only files the CRM knows. Best effort.
    await deleteObject(storageKey).catch((cleanupErr: unknown) => logger.error({ err: cleanupErr, storageKey }, "Couldn't remove an unsaved upload."));
    throw err;
  }
  return getVisaCaseById(enquiry.id);
}

/**
 * A short-lived link to one of the case's files, for anyone who can open the case. Opening is audited: the file holds
 * passports and personal papers (golden rule 5).
 */
export async function openCaseFile(caseNo: string, fileId: string, actor: Actor) {
  const enquiry = await findVisibleCase(caseNo, actor.user);
  const file = await prisma.caseFile.findFirst({ where: { id: fileId, enquiryId: enquiry.id } });
  if (!file) throw notFound("File not found on this case.");

  const link = await presignGet(file.storageKey, { fileName: file.fileName });
  await audit({
    actorId: actor.user.id,
    action: "visa.file.open",
    entityType: "CaseFile",
    entityId: file.id,
    clientId: enquiry.clientId,
    after: { fileName: file.fileName, expiresAt: link.expiresAt },
    ip: actor.ip,
  });
  return link;
}

// ---------------------------------------------------------------------------
// "File ready — add to docket" (Decision 9)
// ---------------------------------------------------------------------------

const TRIP_FIELDS = ["departOn", "returnOn", "entryType"] as const;
const TRIP_WORDS: Record<(typeof TRIP_FIELDS)[number], string> = { departOn: "travelling out", returnOn: "coming back", entryType: "entry" };

/**
 * What still stands between a case and "File ready": papers not checked or needing replacing (only those that came in
 * or that we made), each traveller's acknowledgement number and appointment (if the visa needs one), the saved file,
 * an active vendor that still covers the case's country (if the visa needs one) and the trip details. Read under the
 * case's lock. Also returns the country's name, for the message.
 */
async function missingForFileReady(db: Db, enquiryId: string) {
  const visa = await db.visaCase.findUniqueOrThrow({
    where: { enquiryId },
    include: {
      offering: { select: { appointmentNeeded: true, vendorNeeded: true, country: { select: { id: true, name: true } } } },
      vendor: { select: { isActive: true, countries: { select: { countryId: true } } } },
      travellers: {
        orderBy: { position: "asc" },
        include: {
          documents: { where: { status: { in: ["RECEIVED", "MADE"] } }, orderBy: { sortOrder: "asc" }, select: { name: true, check: true } },
        },
      },
    },
  });
  const files = await db.caseFile.count({ where: { enquiryId, kind: "FINAL_FILE" } });
  const { adults } = countTravellers(visa.travellers);
  const label = (t: (typeof visa.travellers)[number]) => (t.memberId ? t.name : null) ?? travellerLabel(t, adults);
  const country = visa.offering.country;
  // Picked when it was active and covered the country (setVendor); either may have changed since in the vendor master.
  const vendorProblem = (vendor: NonNullable<typeof visa.vendor>) =>
    !vendor.isActive ? ("SWITCHED_OFF" as const) : vendor.countries.some((c) => c.countryId === country.id) ? null : ("NOT_COVERING" as const);

  const missing = {
    papers: visa.travellers
      .map((t) => ({
        traveller: label(t),
        toCheck: t.documents.filter((d) => d.check === null).map((d) => d.name),
        needsReplacing: t.documents.filter((d) => d.check === "NEEDS_REPLACING").map((d) => d.name),
      }))
      .filter((p) => p.toCheck.length > 0 || p.needsReplacing.length > 0),
    ackNo: visa.travellers.filter((t) => !t.ackNo).map(label),
    appointment: visa.offering.appointmentNeeded ? visa.travellers.filter((t) => !t.appointmentAt).map(label) : [],
    finalFile: files === 0,
    vendor: !visa.offering.vendorNeeded ? null : !visa.vendor ? ("NONE" as const) : vendorProblem(visa.vendor),
    trip: TRIP_FIELDS.filter((field) => visa[field] === null),
  };
  return { missing, country: country.name };
}

type FileReadyMissing = Awaited<ReturnType<typeof missingForFileReady>>["missing"];

/** "Rakesh: Bank statement still to check; acknowledgement no. for Aarav; the saved file (PDF)" */
function describeMissing(m: FileReadyMissing, country: string): string[] {
  return [
    ...m.papers.flatMap((p) => [
      ...(p.toCheck.length > 0 ? [`${p.traveller}: ${p.toCheck.join(", ")} still to check`] : []),
      ...(p.needsReplacing.length > 0 ? [`${p.traveller}: ${p.needsReplacing.join(", ")} needs replacing`] : []),
    ]),
    ...(m.ackNo.length > 0 ? [`acknowledgement no. for ${m.ackNo.join(", ")}`] : []),
    ...(m.appointment.length > 0 ? [`appointment for ${m.appointment.join(", ")}`] : []),
    ...(m.finalFile ? ["the saved file (PDF)"] : []),
    ...(m.vendor === "NONE" ? ["a vendor"] : []),
    ...(m.vendor === "SWITCHED_OFF" ? ["an active vendor (the one picked is switched off)"] : []),
    ...(m.vendor === "NOT_COVERING" ? [`a vendor that covers ${country} (the one picked no longer does)`] : []),
    ...(m.trip.length > 0 ? [`trip details (${m.trip.map((field) => TRIP_WORDS[field]).join(", ")})`] : []),
  ];
}

/**
 * "File ready — add to docket" (Decision 9), by the processor, the HOD or the Head. Everything Step 3 asks for is
 * checked under the case's lock, in the same transaction as the move, so a check or a pick changed at the same moment
 * either lands first and is seen, or waits and is then refused. The case moves to Docket & dispatch, due now, and stays
 * with its processor; who and when are stamped. Step 3 is read-only after this, because every Step 3 write needs File
 * preparation. A case nobody owns yet is refused: Step 4 is the processor's work.
 */
export async function markFileReady(caseNo: string, input: FileReadyInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, PREPARING);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, PREPARING);
    assertFresh(locked.updatedAt, input.updatedAt, "case");
    if (!locked.ownerId) throw conflict("Give this case to a processor first.");

    const { missing, country } = await missingForFileReady(tx, enquiry.id);
    const parts = describeMissing(missing, country);
    if (parts.length > 0) throw new HttpError(409, `Not ready yet. Still needed: ${parts.join("; ")}.`, { code: "NOT_READY", missing });
    // The last look before the file goes out (warnings, 19 and 21 Oct 2026): a passport that runs out too soon after the
    // trip, and an appointment on or after the day it begins (the trip may have moved since the appointment was booked).
    const trip = await tx.visaCase.findUniqueOrThrow({
      where: { enquiryId: enquiry.id },
      select: { departOn: true, returnOn: true, travellers: { orderBy: { position: "asc" }, select: { ...travellerPapersSelect, ...appointmentSelect } } },
    });
    const confirmed = checkWarnings(
      [
        ...(await passportWarnings(tx, trip.returnOn && fromDbDate(trip.returnOn), trip.travellers)),
        ...appointmentWarnings(trip.departOn && fromDbDate(trip.departOn), namedAppointments(trip.travellers)),
      ],
      input.confirmWarnings,
    );

    const dispatch = await visaStage(tx, enquiry.departmentId, "DISPATCH");
    // Due for the docket and dispatch on the next office day (visa.dispatchCheck ⚠️), not "now", which showed it late at
    // once (amended 21 Oct 2026).
    const dueAt = await dueOnOfficeDay((await getVisaSettings(tx)).dispatchCheck, tx);
    await tx.enquiry.update({ where: { id: enquiry.id }, data: { stageId: dispatch.id, dueAt } });
    const visa = await tx.visaCase.update({ where: { enquiryId: enquiry.id }, data: { fileReadyAt: now, fileReadyById: actor.user.id } });
    // What went to the docket: the current saved file and the vendor.
    const file = await tx.caseFile.findFirstOrThrow({
      where: { enquiryId: enquiry.id, kind: "FINAL_FILE" },
      orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.file.ready",
        entityType: "Enquiry",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        before: { stage: locked.stage.code, dueAt: locked.dueAt },
        after: {
          stage: "DISPATCH",
          dueAt,
          fileReadyAt: now,
          fileReadyById: actor.user.id,
          vendorId: visa.vendorId,
          finalFileId: file.id,
          ...confirmedWarningsNote(confirmed),
        },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVisaCaseById(enquiry.id);
}
