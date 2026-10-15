import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { definedOnly, onlyChanged } from "../../lib/changes";
import { badRequest, HttpError, notFound } from "../../lib/httpError";
import { activeFilter, createAudited, saveChanges } from "../../lib/masters";
import { rethrowUnique } from "../../lib/prismaErrors";
import type { Actor } from "../users/user";
import { assertCanEditEmbassies, assertCanEditVisaMasters } from "./access";
import type {
  CreateCountryInput,
  CreateDocumentInput,
  CreateDocumentProblemReasonInput,
  CreateCourierInput,
  CreateCreditNoteReasonInput,
  CreateProcessingSpeedInput,
  CreateEmbassyInput,
  CreateEnquirySourceInput,
  CreateOfferingInput,
  CreateVisaTypeInput,
  UpdateCountryInput,
  UpdateDocumentInput,
  UpdateDocumentProblemReasonInput,
  UpdateCourierInput,
  UpdateCreditNoteReasonInput,
  UpdateProcessingSpeedInput,
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

export async function createDocument(input: CreateDocumentInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  return createAudited(actor, "document.create", "DocumentMaster", (tx) => tx.documentMaster.create({ data: { ...input, detail: input.detail ?? null } }));
}

export async function updateDocument(id: number, input: UpdateDocumentInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  const before = await prisma.documentMaster.findUnique({ where: { id } });
  if (!before) throw notFound("Document not found.");
  const changes = onlyChanged(definedOnly(input), before);

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

/** "France (Schengen) · Tourist" */
export const offeringLabel = (o: OfferingRow) => `${countryLabel(o.country)} · ${o.visaType.name}`;

function toOfferingDto(o: OfferingRow & { _count?: { checklist: number } }) {
  return {
    id: o.id,
    label: offeringLabel(o),
    country: o.country,
    visaType: o.visaType,
    isActive: o.isActive,
    appointmentNeeded: o.appointmentNeeded,
    vendorNeeded: o.vendorNeeded,
    ...(o._count ? { checklistCount: o._count.checklist } : {}),
    updatedAt: o.updatedAt,
  };
}

export async function listOfferings(active?: boolean) {
  const rows = await prisma.visaOffering.findMany({
    where: activeFilter(active),
    include: { ...offeringInclude, _count: { select: { checklist: true } } },
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

export async function updateOffering(id: number, input: UpdateOfferingInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  const before = await prisma.visaOffering.findUnique({ where: { id } });
  if (!before) throw notFound("Visa offering not found.");
  const changes = onlyChanged(definedOnly(input), before);
  await saveChanges({
    before,
    changes,
    actor,
    action: "visaOffering.update",
    entityType: "VisaOffering",
    entityId: id,
    write: (tx) => tx.visaOffering.update({ where: { id }, data: changes }),
  });
  return toOfferingDto(await prisma.visaOffering.findUniqueOrThrow({ where: { id }, include: offeringInclude }));
}
