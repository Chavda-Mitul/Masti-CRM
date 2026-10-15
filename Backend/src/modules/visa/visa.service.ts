import { randomUUID } from "node:crypto";
import type { EnquiryOrigin } from "../../../generated/prisma/client";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { addDays, istDateTimeToUtc, istToday, toDbDate } from "../../lib/dates";
import { badRequest, forbidden, HttpError, notFound } from "../../lib/httpError";
import { isUniqueViolation } from "../../lib/prismaErrors";
import { saveSetting } from "../../lib/settings";
import { isHodOf } from "../auth/permissions";
import { VISA_FLOW } from "../enquiries/enquiries.seed";
import { assertCanSeeEnquiry } from "../enquiries/visibility";
import { nextOpenDay } from "../holidays/blockedDays";
import { requireMobile } from "../clients/client";
import { getClientSettings } from "../clients/clients.settings";
import { findOrCreateClientByMobile } from "../clients/clients.service";
import type { Actor, UserWithDepartments } from "../users/user";
import { countryLabel, offeringInclude, offeringLabel } from "../visaMasters/visaMasters.service";
import type { CreateVisaCaseInput, UpdateVisaSettingsInput } from "./visa.schemas";
import {
  AWB_KEY,
  DOCKET_EMAIL_KEY,
  DOCKET_KEY,
  FINAL_FILE_KEY,
  FIRST_FOLLOW_UP_KEY,
  getVisaSettings,
  INVOICE_KEY,
  CREDIT_NOTE_KEY,
  ONLINE_CHECK_KEY,
  STICKER_KEY,
  SUBMISSION_CHECK_KEY,
  RECALL_RETURN_KEY,
  PASSPORTS_BACK_CHECK_KEY,
  COLLECTION_CHECK_KEY,
  VENDOR_CONFIRM_KEY,
} from "./visa.settings";
import { toVisaCaseDto, travellersLabel, visaCaseInclude, type VisaCaseRow } from "./visaCase";

// Visa Step 1: intake (docs/decisions/0003-visa-intake.md, refreshed 9 Oct 2026).
// Nothing is sent to the client yet: the WhatsApp outbox comes with the provider integration.

const VISA = "VISA";
const FIRST_STAGE = "ENQUIRY";

// ---------------------------------------------------------------------------
// The intake dropdowns
// ---------------------------------------------------------------------------

/**
 * Countries with the visa types Masti processes for them. Only active countries, types and offerings, and only
 * offerings that have a checklist: intake copies it, so an empty one would make a case with nothing to collect.
 */
/** One visa type Masti processes for a country, with the offering intake saves against. */
export interface IntakeVisaType {
  offeringId: number;
  id: number;
  code: string;
  name: string;
}

export interface IntakeCountry {
  id: number;
  code: string;
  name: string;
  zone: string | null;
  /** "France (Schengen)" */
  label: string;
  visaTypes: IntakeVisaType[];
}

export async function listIntakeOfferings(): Promise<IntakeCountry[]> {
  const rows = await prisma.visaOffering.findMany({
    where: { isActive: true, country: { isActive: true }, visaType: { isActive: true }, checklist: { some: {} } },
    include: offeringInclude,
    orderBy: [{ country: { sortOrder: "asc" } }, { country: { name: "asc" } }, { visaType: { sortOrder: "asc" } }, { visaType: { name: "asc" } }],
  });
  const countries = new Map<number, IntakeCountry>();
  for (const o of rows) {
    const { country, visaType } = o;
    let entry = countries.get(country.id);
    if (!entry) {
      entry = { id: country.id, code: country.code, name: country.name, zone: country.zone, label: countryLabel(country), visaTypes: [] };
      countries.set(country.id, entry);
    }
    entry.visaTypes.push({ offeringId: o.id, id: visaType.id, code: visaType.code, name: visaType.name });
  }
  return [...countries.values()];
}

// ---------------------------------------------------------------------------
// Save a new visa enquiry
// ---------------------------------------------------------------------------

/** VISA-2026-0001; grows to 5 digits past 9999. */
export function formatCaseNo(prefix: string, year: number, value: number) {
  return `${prefix}-${year}-${String(value).padStart(4, "0")}`;
}

/**
 * Finds or creates the client, issues the case number, creates the enquiry, the visa case and its placeholder travellers,
 * and copies the checklist onto each traveller: all in one transaction, audited as visa.case.create.
 * The WhatsApp bot and website forms will call this with their own origin.
 * Returns `replayed: true` (and creates nothing) when the idempotency key was already used.
 */
export async function createVisaEnquiry(input: CreateVisaCaseInput, origin: EnquiryOrigin, actor: Actor, idempotencyKey?: string) {
  if (idempotencyKey) {
    const existing = await prisma.enquiry.findUnique({ where: { idempotencyKey }, select: { id: true } });
    if (existing) return { case: await getVisaCaseById(existing.id), clientCreated: false, replayed: true };
  }

  const mobile = requireMobile(input.mobile);
  const today = istToday();

  const source = await prisma.enquirySource.findUnique({ where: { code: input.sourceCode } });
  if (!source?.isActive || (origin === "STAFF" && !source.staffSelectable)) throw badRequest("Pick where the enquiry came in.");

  const offering = await prisma.visaOffering.findUnique({ where: { id: input.offeringId }, include: offeringInclude });
  if (!offering?.isActive || !offering.country.isActive || !offering.visaType.isActive) {
    throw badRequest("We don't process this country and visa type any more. Pick another.");
  }

  if (input.travelMonth < today.slice(0, 7)) throw badRequest("The travel month can't be in the past.");
  if (input.travelDate && input.travelDate < today) throw badRequest("The travel date can't be in the past.");

  const department = await prisma.department.findUnique({ where: { code: VISA } });
  if (!department?.isActive) throw new HttpError(500, "The Visa department is not set up. Run the database seed.");
  const stage = await prisma.departmentStage.findUnique({
    where: { departmentId_flow_code: { departmentId: department.id, flow: VISA_FLOW, code: FIRST_STAGE } },
  });
  if (!stage) throw new HttpError(500, "The visa steps are not set up. Run the database seed.");

  // Copied as it is now: later edits to the master never change this case (0003 Decision 3).
  const checklist = await prisma.visaChecklistItem.findMany({
    where: { offeringId: offering.id },
    include: { document: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  if (checklist.length === 0) throw badRequest("This visa has no document checklist yet. Ask the Visa HOD to set it up in Settings → Masters.");

  const { firstFollowUp } = await getVisaSettings();
  // A follow-up due on a day the office is closed (the weekly Sunday off, an office holiday) moves to the next open day,
  // or Monday morning would open with Saturday's enquiries already late.
  const dueAt = istDateTimeToUtc(await nextOpenDay(addDays(today, firstFollowUp.afterDays), { office: true }), firstFollowUp.at);
  const year = Number(today.slice(0, 4));

  const save = () =>
    prisma.$transaction(async (tx) => {
      const { client, created: clientCreated } = await findOrCreateClientByMobile(tx, mobile, actor, input.clientName, "clientName");

      const [counter] = await tx.$queryRaw<{ lastValue: number }[]>`
        INSERT INTO "CaseCounter" ("departmentId", "year", "lastValue") VALUES (${department.id}, ${year}, 1)
        ON CONFLICT ("departmentId", "year") DO UPDATE SET "lastValue" = "CaseCounter"."lastValue" + 1
        RETURNING "lastValue"`;
      const caseNo = formatCaseNo(department.casePrefix, year, Number(counter!.lastValue));

      const enquiry = await tx.enquiry.create({
        data: {
          caseNo,
          departmentId: department.id,
          clientId: client.id,
          sourceId: source.id,
          origin,
          idempotencyKey: idempotencyKey ?? null,
          stageId: stage.id,
          ownerId: actor.user.id,
          dueAt,
          createdById: actor.user.id,
        },
      });
      await tx.visaCase.create({
        data: {
          enquiryId: enquiry.id,
          offeringId: offering.id,
          travelMonth: toDbDate(`${input.travelMonth}-01`),
          travelDate: input.travelDate ? toDbDate(input.travelDate) : null,
          // Trip details start from the exact date, if there was one (0007 Decision 4); travelDate stays as filed.
          departOn: input.travelDate ? toDbDate(input.travelDate) : null,
        },
      });

      const travellers = Array.from({ length: input.adults + input.children }, (_, i) => ({
        id: randomUUID(),
        caseId: enquiry.id,
        position: i + 1,
        isChild: i >= input.adults,
      }));
      await tx.visaCaseTraveller.createMany({ data: travellers });
      await tx.visaCaseDocument.createMany({
        data: travellers.flatMap((t) =>
          checklist
            .filter((line) => line.appliesTo === "ALL" || line.appliesTo === (t.isChild ? "CHILDREN" : "ADULTS"))
            .map((line, i) => ({
              travellerId: t.id,
              documentId: line.documentId,
              name: line.document.name,
              detail: line.document.detail,
              requirement: line.requirement,
              quantity: line.quantity,
              note: line.note,
              sortOrder: i + 1,
            })),
        ),
      });

      await audit(
        {
          actorId: actor.user.id,
          action: "visa.case.create",
          entityType: "Enquiry",
          entityId: enquiry.id,
          clientId: client.id,
          after: {
            caseNo,
            origin,
            client: { id: client.id, mobile: client.mobile, created: clientCreated },
            source: source.code,
            offering: { id: offering.id, label: offeringLabel(offering) },
            travellers: travellersLabel(input.adults, input.children),
            travelMonth: input.travelMonth,
            travelDate: input.travelDate ?? null,
            stage: stage.code,
            ownerId: actor.user.id,
            dueAt,
            checklistLines: checklist.length,
          },
          ip: actor.ip,
        },
        tx,
      );
      return { id: enquiry.id, clientCreated };
    });

  let saved: { id: string; clientCreated: boolean };
  try {
    saved = await save();
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // A double-clicked Save that raced past the check above: return the case the first click made.
    if (idempotencyKey) {
      const existing = await prisma.enquiry.findUnique({ where: { idempotencyKey }, select: { id: true } });
      if (existing) return { case: await getVisaCaseById(existing.id), clientCreated: false, replayed: true };
    }
    // Two intakes created the same new client at once; this time the client exists.
    saved = await save();
  }
  return { case: await getVisaCaseById(saved.id), clientCreated: saved.clientCreated, replayed: false };
}

// ---------------------------------------------------------------------------
// Reading a case
// ---------------------------------------------------------------------------

/**
 * The DTO for a loaded row: its flow's steps (the step chips, "step 2 of 8"), the passport-warning setting, and the
 * largest final file allowed (the page checks it before uploading).
 */
async function toDto(row: VisaCaseRow) {
  const [steps, clientSettings, visaSettings] = await Promise.all([
    prisma.departmentStage.findMany({
      where: { departmentId: row.stage.departmentId, flow: row.stage.flow },
      orderBy: { sortOrder: "asc" },
      select: { code: true, name: true },
    }),
    getClientSettings(),
    getVisaSettings(),
  ]);
  return toVisaCaseDto(row, steps, istToday(), clientSettings, visaSettings.finalFile.maxMb, visaSettings.invoice.gstRatePercent);
}

export async function getVisaCaseById(id: string) {
  return toDto(await prisma.enquiry.findUniqueOrThrow({ where: { id }, include: visaCaseInclude }));
}

/** The case page. Staff open only their own cases, the HOD the department's, the Head all (0006 Decision 1). */
export async function getVisaCase(caseNo: string, user: UserWithDepartments) {
  const row = await prisma.enquiry.findUnique({ where: { caseNo: caseNo.toUpperCase() }, include: visaCaseInclude });
  if (!row?.visa) throw notFound("Case not found.");
  assertCanSeeEnquiry(user, row);
  return toDto(row);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSettings() {
  return getVisaSettings();
}

/**
 * The Head or the Visa HOD. A follow-up timing change applies to enquiries saved after it; a file size limit to the next
 * upload; a docket prefix to the next new docket; a sticker size to the next print; the GST rate to the quotes' preview
 * (and later to the next invoice); the vendor-confirm timing and slip-number lengths to the next dispatch; the portal
 * check's timing to the next "Submitted online"; the file-number check's to the next "Vendor got it"; the collection
 * reminder's to the next save of a collection date; the passports-back check's to the next decision; the vendor email's wording to the next email. Only the keys sent and changed are written, each audited on its own.
 */
export async function updateSettings(input: UpdateVisaSettingsInput, actor: Actor) {
  if (!isHodOf(actor.user, VISA)) throw forbidden("Only the Head or the Visa HOD can change visa settings.");
  const before = await getVisaSettings();
  const changes = [
    { key: FIRST_FOLLOW_UP_KEY, before: before.firstFollowUp, after: input.firstFollowUp },
    { key: FINAL_FILE_KEY, before: before.finalFile, after: input.finalFile },
    { key: DOCKET_KEY, before: before.docket, after: input.docket },
    { key: STICKER_KEY, before: before.sticker, after: input.sticker },
    { key: INVOICE_KEY, before: before.invoice, after: input.invoice },
    { key: CREDIT_NOTE_KEY, before: before.creditNote, after: input.creditNote },
    { key: VENDOR_CONFIRM_KEY, before: before.vendorConfirm, after: input.vendorConfirm },
    { key: ONLINE_CHECK_KEY, before: before.onlineCheck, after: input.onlineCheck },
    { key: SUBMISSION_CHECK_KEY, before: before.submissionCheck, after: input.submissionCheck },
    { key: RECALL_RETURN_KEY, before: before.recallReturn, after: input.recallReturn },
    { key: PASSPORTS_BACK_CHECK_KEY, before: before.passportsBackCheck, after: input.passportsBackCheck },
    { key: COLLECTION_CHECK_KEY, before: before.collectionCheck, after: input.collectionCheck },
    { key: AWB_KEY, before: before.awb, after: input.awb },
    { key: DOCKET_EMAIL_KEY, before: before.docketEmail, after: input.docketEmail },
  ].filter((c) => c.after && JSON.stringify(c.after) !== JSON.stringify(c.before));
  if (changes.length === 0) return before;
  await prisma.$transaction(async (tx) => {
    for (const c of changes) await saveSetting(tx, { key: c.key, before: c.before, after: c.after!, actorId: actor.user.id, ip: actor.ip });
  });
  return getVisaSettings();
}
