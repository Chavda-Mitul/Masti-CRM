import type { Prisma } from "../../../generated/prisma/client";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { definedOnly, onlyChanged, pick } from "../../lib/changes";
import { badRequest, HttpError, notFound } from "../../lib/httpError";
import { rethrowUnique } from "../../lib/prismaErrors";
import type { Actor } from "../users/user";
import { assertCanEditEmbassies, assertCanEditVisaMasters } from "./access";
import type {
  CreateCountryInput,
  CreateDocumentInput,
  CreateEmbassyInput,
  CreateOfferingInput,
  CreateVisaTypeInput,
  UpdateCountryInput,
  UpdateDocumentInput,
  UpdateEmbassyInput,
  UpdateOfferingInput,
  UpdateVisaTypeInput,
} from "./visaMasters.schemas";

// Countries, visa types, embassies, documents and offerings (docs/decisions/0005-system-masters.md §6).
// Masters are switched off (isActive), never deleted, so reports and old cases keep their names.
// Codes never change once created. Every change is audited with before/after of the changed fields.

const rethrowCode = rethrowUnique("This code is already used.");

/** "France (Schengen)" */
export const countryLabel = (c: { name: string; zone: string | null }) => (c.zone ? `${c.name} (${c.zone})` : c.name);

interface SaveOptions<Row> {
  before: Row;
  changes: object;
  actor: Actor;
  action: string;
  entityType: string;
  entityId: string | number;
  write: (tx: Db) => Promise<Row>;
}

/** Writes only real changes, audited in the same transaction. Returns the current row either way. */
async function saveChanges<Row extends object>({ before, changes, actor, action, entityType, entityId, write }: SaveOptions<Row>) {
  const keys = Object.keys(changes);
  if (keys.length === 0) return before;
  return prisma.$transaction(async (tx) => {
    const after = await write(tx);
    await audit(
      { actorId: actor.user.id, action, entityType, entityId: String(entityId), before: pick(before, keys), after: pick(after, keys), ip: actor.ip },
      tx,
    );
    return after;
  });
}

async function createAudited<Row extends { id: number }>(actor: Actor, action: string, entityType: string, create: (tx: Db) => Promise<Row>) {
  return prisma
    .$transaction(async (tx) => {
      const row = await create(tx);
      await audit({ actorId: actor.user.id, action, entityType, entityId: String(row.id), after: row, ip: actor.ip }, tx);
      return row;
    })
    .catch(rethrowCode);
}

const activeFilter = (active: boolean | undefined) => (active === undefined ? {} : { isActive: active });

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
  const changes = onlyChanged(input, before);
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
