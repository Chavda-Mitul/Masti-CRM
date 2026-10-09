import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh, staleError } from "../../lib/changes";
import { badRequest, notFound } from "../../lib/httpError";
import type { Actor } from "../users/user";
import { assertCanEditVisaMasters } from "./access";
import type { ReplaceChecklistInput } from "./visaMasters.schemas";
import { countryLabel, offeringInclude, offeringLabel } from "./visaMasters.service";

// A country × visa type checklist (docs/decisions/0005-system-masters.md §6).
// Saved whole: one PUT replaces every line in a transaction, with optimistic locking on the offering's updatedAt.
// Nothing points at the lines (intake copies them onto each traveller), so replacing them never changes an open case.

const itemInclude = {
  document: { select: { id: true, code: true, name: true, detail: true, isActive: true } },
} satisfies Prisma.VisaChecklistItemInclude;

type ItemRow = Prisma.VisaChecklistItemGetPayload<{ include: typeof itemInclude }>;

function toItemDto(item: ItemRow) {
  return {
    id: item.id,
    document: item.document,
    requirement: item.requirement,
    appliesTo: item.appliesTo,
    quantity: item.quantity,
    note: item.note,
    sortOrder: item.sortOrder,
  };
}

/** The comparable content of a line: what the audit log records and what "unchanged" compares. */
const lineOf = (item: Pick<ItemRow, "documentId" | "requirement" | "appliesTo" | "quantity" | "note">) => ({
  documentId: item.documentId,
  requirement: item.requirement,
  appliesTo: item.appliesTo,
  quantity: item.quantity,
  note: item.note,
});

async function loadChecklist(offeringId: number) {
  const offering = await prisma.visaOffering.findUnique({
    where: { id: offeringId },
    include: { ...offeringInclude, checklist: { include: itemInclude, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
  });
  if (!offering) throw notFound("Visa offering not found.");
  return offering;
}

type ChecklistRow = Awaited<ReturnType<typeof loadChecklist>>;

function toChecklistDto(offering: ChecklistRow) {
  const items = offering.checklist.map(toItemDto);
  return {
    offering: {
      id: offering.id,
      label: offeringLabel(offering),
      country: { ...offering.country, label: countryLabel(offering.country) },
      visaType: offering.visaType,
      isActive: offering.isActive,
      updatedAt: offering.updatedAt,
    },
    items,
    adults: { count: items.filter((i) => i.appliesTo !== "CHILDREN").length },
    children: { count: items.filter((i) => i.appliesTo !== "ADULTS").length },
  };
}

export async function getChecklist(offeringId: number) {
  return toChecklistDto(await loadChecklist(offeringId));
}

export async function replaceChecklist(offeringId: number, input: ReplaceChecklistInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  const before = await loadChecklist(offeringId);
  assertFresh(before.updatedAt, input.updatedAt, "checklist");

  const lines = input.items.map((item) => lineOf({ ...item, note: item.note ?? null }));
  const oldLines = before.checklist.map(lineOf);
  if (JSON.stringify(lines) === JSON.stringify(oldLines)) return toChecklistDto(before);

  // New documents must be active; ones already on the list may stay even if switched off since.
  const kept = new Set(oldLines.map((l) => l.documentId));
  const added = lines.map((l) => l.documentId).filter((id) => !kept.has(id));
  if (added.length > 0) {
    const active = await prisma.documentMaster.count({ where: { id: { in: added }, isActive: true } });
    if (active !== added.length) throw badRequest("Pick documents from the document master (active ones only).");
  }

  await prisma.$transaction(async (tx) => {
    // The updatedAt condition makes a save that raced past assertFresh fail instead of overwriting.
    const { count } = await tx.visaOffering.updateMany({
      where: { id: offeringId, updatedAt: before.updatedAt },
      data: { updatedAt: new Date() },
    });
    if (count === 0) throw staleError("checklist");
    await tx.visaChecklistItem.deleteMany({ where: { offeringId } });
    await tx.visaChecklistItem.createMany({ data: lines.map((line, i) => ({ ...line, offeringId, sortOrder: i + 1 })) });
    await audit(
      {
        actorId: actor.user.id,
        action: "visaChecklist.replace",
        entityType: "VisaOffering",
        entityId: String(offeringId),
        before: { items: oldLines },
        after: { items: lines },
        ip: actor.ip,
      },
      tx,
    );
  });

  return getChecklist(offeringId);
}
