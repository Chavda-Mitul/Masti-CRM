import type { Prisma } from "../../../generated/prisma/client";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { definedOnly, onlyChanged } from "../../lib/changes";
import { badRequest, conflict, fieldError, HttpError, notFound } from "../../lib/httpError";
import { activeFilter, createAudited, saveChanges } from "../../lib/masters";
import { rethrowUnique } from "../../lib/prismaErrors";
import type { Actor } from "../users/user";
import { assertCanEditEmbassies, assertCanEditVisaMasters } from "./access";
import { NORMAL_URGENCY, uploadRulesProblem, type UploadRules } from "./visaMasters.schemas";
import type {
  CreateCountryInput,
  CreateDocumentInput,
  CreateDocumentProblemReasonInput,
  CreateCourierInput,
  CreateCreditNoteReasonInput,
  CreateRecallReasonInput,
  CreateMissingPassportReasonInput,
  CreateExtraChargeInput,
  CreateProcessingSpeedInput,
  CreateUrgencyLevelInput,
  CreateEmbassyInput,
  CreateEnquirySourceInput,
  CreateOfferingInput,
  CreateVisaTypeInput,
  UpdateCountryInput,
  UpdateDocumentInput,
  UpdateDocumentProblemReasonInput,
  UpdateCourierInput,
  UpdateCreditNoteReasonInput,
  UpdateRecallReasonInput,
  UpdateMissingPassportReasonInput,
  UpdateExtraChargeInput,
  UpdateProcessingSpeedInput,
  UpdateUrgencyLevelInput,
  UpdateEmbassyInput,
  UpdateEnquirySourceInput,
  UpdateOfferingInput,
  UpdateVisaTypeInput,
} from "./visaMasters.schemas";

// Countries, visa types, embassies, documents and offerings (docs/decisions/0005-system-masters.md §6), and the reasons
// a paper needs replacing (docs/decisions/0007-visa-file-prep.md Decision 3).
// Masters are switched off (isActive), never deleted, so reports and old cases keep their names.
// Codes never change once created. Every change is audited with before/after of the changed fields.

/** "France (Schengen)" */
export const countryLabel = (c: { name: string; zone: string | null }) => (c.zone ? `${c.name} (${c.zone})` : c.name);

// ---------------------------------------------------------------------------
// Countries
// ---------------------------------------------------------------------------

export async function listCountries(active?: boolean) {
  return prisma.country.findMany({ where: activeFilter(active), orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function createCountry(input: CreateCountryInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  return createAudited(actor, "country.create", "Country", (tx) => tx.country.create({ data: { ...input, zone: input.zone ?? null } }));
}

export async function updateCountry(id: number, input: UpdateCountryInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  const before = await prisma.country.findUnique({ where: { id } });
  if (!before) throw notFound("Country not found.");
  const changes = onlyChanged(definedOnly(input), before);
  return saveChanges({
    before,
    changes,
    actor,
    action: "country.update",
    entityType: "Country",
    entityId: id,
    write: (tx) => tx.country.update({ where: { id }, data: changes }),
  });
}

// ---------------------------------------------------------------------------
// Visa types
// ---------------------------------------------------------------------------

export async function listVisaTypes(active?: boolean) {
  return prisma.visaType.findMany({ where: activeFilter(active), orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function createVisaType(input: CreateVisaTypeInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  return createAudited(actor, "visaType.create", "VisaType", (tx) => tx.visaType.create({ data: input }));
}

export async function updateVisaType(id: number, input: UpdateVisaTypeInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  const before = await prisma.visaType.findUnique({ where: { id } });
  if (!before) throw notFound("Visa type not found.");
  const changes = onlyChanged(definedOnly(input), before);
  return saveChanges({
    before,
    changes,
    actor,
    action: "visaType.update",
    entityType: "VisaType",
    entityId: id,
    write: (tx) => tx.visaType.update({ where: { id }, data: changes }),
  });
}

// ---------------------------------------------------------------------------
// Embassies
// ---------------------------------------------------------------------------

const embassyInclude = { country: { select: { id: true, code: true, name: true, zone: true } } } satisfies Prisma.EmbassyInclude;

export async function listEmbassies(query: { active?: boolean | undefined; countryId?: number | undefined }) {
  return prisma.embassy.findMany({
    where: { ...activeFilter(query.active), ...(query.countryId ? { countryId: query.countryId } : {}) },
    include: embassyInclude,
    orderBy: [{ country: { name: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function createEmbassy(input: CreateEmbassyInput, actor: Actor) {
  assertCanEditEmbassies(actor.user);
  const country = await prisma.country.findUnique({ where: { id: input.countryId } });
  if (!country?.isActive) throw badRequest("Pick an active country.");
  return createAudited(actor, "embassy.create", "Embassy", (tx) => tx.embassy.create({ data: input, include: embassyInclude }));
}

export async function updateEmbassy(id: number, input: UpdateEmbassyInput, actor: Actor) {
  assertCanEditEmbassies(actor.user);
  const before = await prisma.embassy.findUnique({ where: { id }, include: embassyInclude });
  if (!before) throw notFound("Embassy not found.");
  const changes = onlyChanged(definedOnly(input), before);
  return saveChanges({
    before,
    changes,
    actor,
    action: "embassy.update",
    entityType: "Embassy",
    entityId: id,
    write: (tx) => tx.embassy.update({ where: { id }, data: changes, include: embassyInclude }),
  });
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function listDocuments(active?: boolean) {
  return prisma.documentMaster.findMany({ where: activeFilter(active), orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

/** The upload rules go together (min below max, photo pairs): checked on the whole row, so a partial save can't split them. */
function assertUploadRules(rules: UploadRules) {
  const problem = uploadRulesProblem(rules);
  if (problem) throw fieldError(problem.field, problem.message);
}

export async function createDocument(input: CreateDocumentInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  const data = {
    ...input,
    detail: input.detail ?? null,
    minSizeMb: input.minSizeMb ?? null,
    maxSizeMb: input.maxSizeMb ?? null,
    photoWidthMm: input.photoWidthMm ?? null,
    photoHeightMm: input.photoHeightMm ?? null,
    minWidthPx: input.minWidthPx ?? null,
    minHeightPx: input.minHeightPx ?? null,
    maxWidthPx: input.maxWidthPx ?? null,
    maxHeightPx: input.maxHeightPx ?? null,
  };
  assertUploadRules(data);
  return createAudited(actor, "document.create", "DocumentMaster", (tx) => tx.documentMaster.create({ data }));
}

export async function updateDocument(id: number, input: UpdateDocumentInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  const before = await prisma.documentMaster.findUnique({ where: { id } });
  if (!before) throw notFound("Document not found.");
  const changes = onlyChanged(definedOnly(input), before);
  assertUploadRules({ ...before, ...changes });

  // A document on an active checklist can't be switched off: intake would copy a document nobody can see.
  if (changes.isActive === false) {
    const offerings = await prisma.visaOffering.findMany({
      where: { isActive: true, checklist: { some: { documentId: id } } },
      include: offeringInclude,
      orderBy: { id: "asc" },
    });
    if (offerings.length > 0) {
      const labels = offerings.map(offeringLabel);
      throw new HttpError(409, `This document is on ${labels.length} active checklist(s): ${labels.join(", ")}. Take it off them first.`, {
        code: "IN_USE",
        offerings: offerings.map((o) => ({ id: o.id, label: offeringLabel(o) })),
      });
    }
  }

  return saveChanges({
    before,
    changes,
    actor,
    action: "document.update",
    entityType: "DocumentMaster",
    entityId: id,
    write: (tx) => tx.documentMaster.update({ where: { id }, data: changes }),
  });
}

// ---------------------------------------------------------------------------
// Document problems: why a paper needs replacing (Step 3)
// ---------------------------------------------------------------------------

export async function listDocumentProblemReasons(active?: boolean) {
  return prisma.documentProblemReason.findMany({ where: activeFilter(active), orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function createDocumentProblemReason(input: CreateDocumentProblemReasonInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  return createAudited(actor, "documentProblemReason.create", "DocumentProblemReason", (tx) =>
    tx.documentProblemReason.create({ data: input }),
  );
}

export async function updateDocumentProblemReason(id: number, input: UpdateDocumentProblemReasonInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  const before = await prisma.documentProblemReason.findUnique({ where: { id } });
  if (!before) throw notFound("Reason not found.");
  const changes = onlyChanged(definedOnly(input), before);
  return saveChanges({
    before,
    changes,
    actor,
    action: "documentProblemReason.update",
    entityType: "DocumentProblemReason",
    entityId: id,
    write: (tx) => tx.documentProblemReason.update({ where: { id }, data: changes }),
  });
}

// ---------------------------------------------------------------------------
// Processing speeds: Normal, Express… picked on a visa case's quote (docs/decisions/0009-visa-invoice.md)
// ---------------------------------------------------------------------------

export async function listProcessingSpeeds(active?: boolean) {
  return prisma.processingSpeed.findMany({ where: activeFilter(active), orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function createProcessingSpeed(input: CreateProcessingSpeedInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  return createAudited(actor, "processingSpeed.create", "ProcessingSpeed", (tx) => tx.processingSpeed.create({ data: input }));
}

export async function updateProcessingSpeed(id: number, input: UpdateProcessingSpeedInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  const before = await prisma.processingSpeed.findUnique({ where: { id } });
  if (!before) throw notFound("Processing speed not found.");
  const changes = onlyChanged(definedOnly(input), before);
  return saveChanges({
    before,
    changes,
    actor,
    action: "processingSpeed.update",
    entityType: "ProcessingSpeed",
    entityId: id,
    write: (tx) => tx.processingSpeed.update({ where: { id }, data: changes }),
  });
}

// ---------------------------------------------------------------------------
// Urgency levels: Normal, Urgent… picked on New enquiry, changed on the case (docs/decisions/0003-visa-intake.md
// amendment 1)
// ---------------------------------------------------------------------------

export async function listUrgencyLevels(active?: boolean) {
  return prisma.urgencyLevel.findMany({ where: activeFilter(active), orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function createUrgencyLevel(input: CreateUrgencyLevelInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  return createAudited(actor, "urgencyLevel.create", "UrgencyLevel", (tx) => tx.urgencyLevel.create({ data: input }));
}

export async function updateUrgencyLevel(id: number, input: UpdateUrgencyLevelInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  const before = await prisma.urgencyLevel.findUnique({ where: { id } });
  if (!before) throw notFound("Urgency level not found.");
  const changes = onlyChanged(definedOnly(input), before);
  // Every new enquiry starts on Normal (also checked in the migration).
  if (changes.isActive === false && before.code === NORMAL_URGENCY) {
    throw conflict(`${before.name} is where every new enquiry starts, so it can't be switched off. Rename it instead.`);
  }
  return saveChanges({
    before,
    changes,
    actor,
    action: "urgencyLevel.update",
    entityType: "UrgencyLevel",
    entityId: id,
    write: (tx) => tx.urgencyLevel.update({ where: { id }, data: changes }),
  });
}

// ---------------------------------------------------------------------------
// Couriers: how a docket goes to the vendor (docs/decisions/0008-visa-docket-dispatch.md Decision 6)
// ---------------------------------------------------------------------------

export async function listCouriers(active?: boolean) {
  return prisma.courier.findMany({ where: activeFilter(active), orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function createCourier(input: CreateCourierInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  return createAudited(actor, "courier.create", "Courier", (tx) => tx.courier.create({ data: input }));
}

export async function updateCourier(id: number, input: UpdateCourierInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  const before = await prisma.courier.findUnique({ where: { id } });
  if (!before) throw notFound("Courier not found.");
  const changes = onlyChanged(definedOnly(input), before);
  return saveChanges({
    before,
    changes,
    actor,
    action: "courier.update",
    entityType: "Courier",
    entityId: id,
    write: (tx) => tx.courier.update({ where: { id }, data: changes }),
  });
}

// ---------------------------------------------------------------------------
// Credit-note reasons (docs/decisions/0011-visa-at-vendor.md Decision 5)
// ---------------------------------------------------------------------------

export async function listCreditNoteReasons(active?: boolean) {
  return prisma.creditNoteReason.findMany({ where: activeFilter(active), orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function createCreditNoteReason(input: CreateCreditNoteReasonInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  return createAudited(actor, "creditNoteReason.create", "CreditNoteReason", (tx) => tx.creditNoteReason.create({ data: input }));
}

export async function updateCreditNoteReason(id: number, input: UpdateCreditNoteReasonInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  const before = await prisma.creditNoteReason.findUnique({ where: { id } });
  if (!before) throw notFound("Credit-note reason not found.");
  const changes = onlyChanged(definedOnly(input), before);
  return saveChanges({
    before,
    changes,
    actor,
    action: "creditNoteReason.update",
    entityType: "CreditNoteReason",
    entityId: id,
    write: (tx) => tx.creditNoteReason.update({ where: { id }, data: changes }),
  });
}

// ---------------------------------------------------------------------------
// Recall reasons (docs/decisions/0011-visa-at-vendor.md Decision 6)
// ---------------------------------------------------------------------------

export async function listRecallReasons(active?: boolean) {
  return prisma.recallReason.findMany({ where: activeFilter(active), orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function createRecallReason(input: CreateRecallReasonInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  return createAudited(actor, "recallReason.create", "RecallReason", (tx) => tx.recallReason.create({ data: input }));
}

export async function updateRecallReason(id: number, input: UpdateRecallReasonInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  const before = await prisma.recallReason.findUnique({ where: { id } });
  if (!before) throw notFound("Recall reason not found.");
  const changes = onlyChanged(definedOnly(input), before);
  return saveChanges({
    before,
    changes,
    actor,
    action: "recallReason.update",
    entityType: "RecallReason",
    entityId: id,
    write: (tx) => tx.recallReason.update({ where: { id }, data: changes }),
  });
}

// ---------------------------------------------------------------------------
// Missing passport reasons (docs/decisions/0013-visa-passport-back.md Decision 5, amended 17 Oct 2026)
// ---------------------------------------------------------------------------

export async function listMissingPassportReasons(active?: boolean) {
  return prisma.missingPassportReason.findMany({ where: activeFilter(active), orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function createMissingPassportReason(input: CreateMissingPassportReasonInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  return createAudited(actor, "missingPassportReason.create", "MissingPassportReason", (tx) => tx.missingPassportReason.create({ data: input }));
}

export async function updateMissingPassportReason(id: number, input: UpdateMissingPassportReasonInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  const before = await prisma.missingPassportReason.findUnique({ where: { id } });
  if (!before) throw notFound("Missing passport reason not found.");
  const changes = onlyChanged(definedOnly(input), before);
  return saveChanges({
    before,
    changes,
    actor,
    action: "missingPassportReason.update",
    entityType: "MissingPassportReason",
    entityId: id,
    write: (tx) => tx.missingPassportReason.update({ where: { id }, data: changes }),
  });
}

// ---------------------------------------------------------------------------
// Extra charges, for the additional invoice (docs/decisions/0011-visa-at-vendor.md Decision 7)
// ---------------------------------------------------------------------------

export async function listExtraCharges(active?: boolean) {
  return prisma.extraCharge.findMany({ where: activeFilter(active), orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function createExtraCharge(input: CreateExtraChargeInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  return createAudited(actor, "extraCharge.create", "ExtraCharge", (tx) => tx.extraCharge.create({ data: input }));
}

export async function updateExtraCharge(id: number, input: UpdateExtraChargeInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  const before = await prisma.extraCharge.findUnique({ where: { id } });
  if (!before) throw notFound("Extra charge not found.");
  const changes = onlyChanged(definedOnly(input), before);
  return saveChanges({
    before,
    changes,
    actor,
    action: "extraCharge.update",
    entityType: "ExtraCharge",
    entityId: id,
    write: (tx) => tx.extraCharge.update({ where: { id }, data: changes }),
  });
}

// ---------------------------------------------------------------------------
// Enquiry sources ("Came in through")
// Shared by every department, but edited like the visa masters (the Head or the Visa HOD) until another
// department's intake exists (0003, refreshed 9 Oct 2026).
// ---------------------------------------------------------------------------

export async function listEnquirySources(active?: boolean) {
  return prisma.enquirySource.findMany({ where: activeFilter(active), orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function createEnquirySource(input: CreateEnquirySourceInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  return createAudited(actor, "enquirySource.create", "EnquirySource", (tx) => tx.enquirySource.create({ data: input }));
}

export async function updateEnquirySource(id: number, input: UpdateEnquirySourceInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  const before = await prisma.enquirySource.findUnique({ where: { id } });
  if (!before) throw notFound("Source not found.");
  const changes = onlyChanged(definedOnly(input), before);
  return saveChanges({
    before,
    changes,
    actor,
    action: "enquirySource.update",
    entityType: "EnquirySource",
    entityId: id,
    write: (tx) => tx.enquirySource.update({ where: { id }, data: changes }),
  });
}

// ---------------------------------------------------------------------------
// Offerings (country × visa type)
// ---------------------------------------------------------------------------

export const offeringInclude = {
  country: { select: { id: true, code: true, name: true, zone: true, isActive: true } },
  visaType: { select: { id: true, code: true, name: true, isActive: true } },
} satisfies Prisma.VisaOfferingInclude;

type OfferingRow = Prisma.VisaOfferingGetPayload<{ include: typeof offeringInclude }>;

/**
 * The portal a visa's cases open (0024 component 3), for reads outside transactions only: offeringInclude is also used
 * inside them, where Prisma 7 + adapter-pg take one relation at most.
 */
export const offeringPortalInclude = {
  portalLogin: { select: { id: true, name: true, status: true } },
} satisfies Prisma.VisaOfferingInclude;

/** The visa's portal as the screens show it; a removed one counts as none (removing clears the link anyway). */
export function offeringPortal(o: { portalLogin?: { id: string; name: string; status: string } | null }) {
  return o.portalLogin?.status === "ACTIVE" ? { id: o.portalLogin.id, name: o.portalLogin.name } : null;
}

/** "France (Schengen) · Tourist" */
export const offeringLabel = (o: OfferingRow) => `${countryLabel(o.country)} · ${o.visaType.name}`;

function toOfferingDto(o: OfferingRow & { _count?: { checklist: number }; portalLogin?: { id: string; name: string; status: string } | null }) {
  return {
    id: o.id,
    label: offeringLabel(o),
    country: o.country,
    visaType: o.visaType,
    isActive: o.isActive,
    appointmentNeeded: o.appointmentNeeded,
    vendorNeeded: o.vendorNeeded,
    portal: offeringPortal(o),
    ...(o._count ? { checklistCount: o._count.checklist } : {}),
    updatedAt: o.updatedAt,
  };
}

export async function listOfferings(active?: boolean) {
  const rows = await prisma.visaOffering.findMany({
    where: activeFilter(active),
    include: { ...offeringInclude, ...offeringPortalInclude, _count: { select: { checklist: true } } },
    orderBy: [{ country: { sortOrder: "asc" } }, { country: { name: "asc" } }, { visaType: { sortOrder: "asc" } }],
  });
  return rows.map(toOfferingDto);
}

export async function createOffering(input: CreateOfferingInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  const [country, visaType] = await Promise.all([
    prisma.country.findUnique({ where: { id: input.countryId } }),
    prisma.visaType.findUnique({ where: { id: input.visaTypeId } }),
  ]);
  if (!country?.isActive) throw badRequest("Pick an active country.");
  if (!visaType?.isActive) throw badRequest("Pick an active visa type.");

  const row = await prisma
    .$transaction(async (tx) => {
      // No two-relation include inside a transaction (see holidayInclude); the full row is loaded after commit.
      const created = await tx.visaOffering.create({ data: input });
      await audit(
        {
          actorId: actor.user.id,
          action: "visaOffering.create",
          entityType: "VisaOffering",
          entityId: String(created.id),
          after: { countryId: created.countryId, visaTypeId: created.visaTypeId, label: `${countryLabel(country)} · ${visaType.name}` },
          ip: actor.ip,
        },
        tx,
      );
      return created;
    })
    .catch(rethrowUnique("This country and visa type are already set up."));
  const full = await prisma.visaOffering.findUniqueOrThrow({ where: { id: row.id }, include: offeringInclude });
  return toOfferingDto({ ...full, _count: { checklist: 0 } });
}

/**
 * Switching "Vendor needed" on mustn't strand a case already at Docket & dispatch with no vendor: it could then be neither
 * put in a docket nor submitted online, and only File preparation picks a vendor (decided 19 Oct 2026, project lead).
 * Refused while any open or postponed case of this visa waits there without one; the message names them.
 */
async function assertNoneWaitWithoutVendor(db: Db, offeringId: number) {
  const waiting = await db.enquiry.findMany({
    where: { status: { in: ["OPEN", "POSTPONED"] }, stage: { code: "DISPATCH" }, visa: { is: { offeringId, vendorId: null } } },
    select: { caseNo: true },
    orderBy: { caseNo: "asc" },
    take: 6,
  });
  if (waiting.length === 0) return;
  const named = waiting.slice(0, 5).map((c) => c.caseNo);
  const more = waiting.length > 5 ? " and more" : "";
  const one = waiting.length === 1;
  throw conflict(
    `${named.join(", ")}${more} ${one ? "is" : "are"} at Docket & dispatch with no vendor. Submit ${one ? "it" : "them"} online first: with ` +
      `Vendor needed on, ${one ? "it" : "they"} couldn't be sent at all.`,
  );
}

export async function updateOffering(id: number, input: UpdateOfferingInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  const before = await prisma.visaOffering.findUnique({ where: { id } });
  if (!before) throw notFound("Visa offering not found.");
  // A visa's cases open one of the Visa department's portals that's still in use (0024 component 3).
  if (input.portalLoginId) {
    const portal = await prisma.portalLogin.findFirst({
      where: { id: input.portalLoginId, status: "ACTIVE", department: { code: "VISA", isActive: true } },
      select: { id: true },
    });
    if (!portal) throw fieldError("portalLoginId", "Pick one of the Visa department's portals.");
  }
  const changes = onlyChanged(definedOnly(input), before);
  await saveChanges({
    before,
    changes,
    actor,
    action: "visaOffering.update",
    entityType: "VisaOffering",
    entityId: id,
    write: async (tx) => {
      if (changes.vendorNeeded === true) await assertNoneWaitWithoutVendor(tx, id);
      return tx.visaOffering.update({ where: { id }, data: changes });
    },
  });
  return toOfferingDto(await prisma.visaOffering.findUniqueOrThrow({ where: { id }, include: { ...offeringInclude, ...offeringPortalInclude } }));
}
