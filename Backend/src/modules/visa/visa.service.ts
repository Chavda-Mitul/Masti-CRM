import { randomUUID } from "node:crypto";
import type { EnquiryOrigin } from "../../../generated/prisma/client";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { addDays, istDateTimeToUtc, istToday, toDbDate } from "../../lib/dates";
import { badRequest, forbidden, HttpError, notFound } from "../../lib/httpError";
import { isUniqueViolation } from "../../lib/prismaErrors";
import { saveSetting } from "../../lib/settings";
import { isHodOf } from "../auth/permissions";
import { requireMobile } from "../clients/client";
import { findOrCreateClientByMobile } from "../clients/clients.service";
import type { Actor } from "../users/user";
import { countryLabel, offeringInclude, offeringLabel } from "../visaMasters/visaMasters.service";
import type { CreateVisaCaseInput, UpdateVisaSettingsInput } from "./visa.schemas";
import { FIRST_FOLLOW_UP_KEY, getVisaSettings } from "./visa.settings";
import { toVisaCaseDto, travellersLabel, visaCaseInclude } from "./visaCase";

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
  const stage = await prisma.departmentStage.findUnique({ where: { departmentId_code: { departmentId: department.id, code: FIRST_STAGE } } });
  if (!stage) throw new HttpError(500, "The visa steps are not set up. Run the database seed.");

  // Copied as it is now: later edits to the master never change this case (0003 Decision 3).
  const checklist = await prisma.visaChecklistItem.findMany({
    where: { offeringId: offering.id },
    include: { document: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  if (checklist.length === 0) throw badRequest("This visa has no document checklist yet. Ask the Visa HOD to set it up in Settings → Masters.");

  const { firstFollowUp } = await getVisaSettings();
  const dueAt = istDateTimeToUtc(addDays(today, firstFollowUp.afterDays), firstFollowUp.at);
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

async function stageCount(departmentId: number) {
  return prisma.departmentStage.count({ where: { departmentId } });
}

async function getVisaCaseById(id: string) {
  const row = await prisma.enquiry.findUniqueOrThrow({ where: { id }, include: visaCaseInclude });
  return toVisaCaseDto(row, await stageCount(row.departmentId));
}

export async function getVisaCase(caseNo: string) {
  const row = await prisma.enquiry.findUnique({ where: { caseNo: caseNo.toUpperCase() }, include: visaCaseInclude });
  if (!row?.visa) throw notFound("Case not found.");
  return toVisaCaseDto(row, await stageCount(row.departmentId));
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSettings() {
  return getVisaSettings();
}

/** The Head or the Visa HOD. A change applies to enquiries saved after it. */
export async function updateSettings(input: UpdateVisaSettingsInput, actor: Actor) {
  if (!isHodOf(actor.user, VISA)) throw forbidden("Only the Head or the Visa HOD can change visa timing.");
  const before = await getVisaSettings();
  if (!input.firstFollowUp || JSON.stringify(input.firstFollowUp) === JSON.stringify(before.firstFollowUp)) return before;
  const after = input.firstFollowUp;
  await prisma.$transaction((tx) =>
    saveSetting(tx, { key: FIRST_FOLLOW_UP_KEY, before: before.firstFollowUp, after, actorId: actor.user.id, ip: actor.ip }),
  );
  return getVisaSettings();
}
