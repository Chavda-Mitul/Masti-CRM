import { prisma } from "../../config/prisma";
import { definedOnly, onlyChanged } from "../../lib/changes";
import { fieldError, forbidden, notFound } from "../../lib/httpError";
import { activeFilter, createAudited, saveChanges } from "../../lib/masters";
import { saveSetting } from "../../lib/settings";
import { isHodOfAny } from "../auth/permissions";
import type { UpdateFieldSettingsInput } from "../fieldJobs/field.schemas";
import { FIELD_SETTINGS_KEY, getFieldSettings } from "../fieldJobs/fieldJobs.settings";
import type { Actor, UserWithDepartments } from "../users/user";
import type {
  CreateOptionInput,
  CreateReasonInput,
  CreateSlotInput,
  UpdateOptionInput,
  UpdateReasonInput,
  UpdateSlotInput,
} from "./enquiryMasters.schemas";

// Follow-up outcomes, follow-up next steps, and postpone/cancel reasons (docs/decisions/0006-visa-documents.md Decision 7).
// Shared by every department, so the Head or any HOD edits them (like embassies). Anyone signed in reads them:
// they are the dropdowns on every case. Switched off, never deleted, so old follow-ups keep their labels.

function assertCanEdit(user: UserWithDepartments) {
  if (!isHodOfAny(user)) throw forbidden("Only the Head or an HOD can change these lists.");
}

const order = [{ sortOrder: "asc" as const }, { name: "asc" as const }];

// ---------------------------------------------------------------------------
// Follow-up outcomes ("What happened")
// ---------------------------------------------------------------------------

export async function listOutcomes(active?: boolean) {
  return prisma.followUpOutcome.findMany({ where: activeFilter(active), orderBy: order });
}

export async function createOutcome(input: CreateOptionInput, actor: Actor) {
  assertCanEdit(actor.user);
  return createAudited(actor, "followUpOutcome.create", "FollowUpOutcome", (tx) => tx.followUpOutcome.create({ data: input }));
}

export async function updateOutcome(id: number, input: UpdateOptionInput, actor: Actor) {
  assertCanEdit(actor.user);
  const before = await prisma.followUpOutcome.findUnique({ where: { id } });
  if (!before) throw notFound("Outcome not found.");
  const changes = onlyChanged(definedOnly(input), before);
  return saveChanges({
    before,
    changes,
    actor,
    action: "followUpOutcome.update",
    entityType: "FollowUpOutcome",
    entityId: id,
    write: (tx) => tx.followUpOutcome.update({ where: { id }, data: changes }),
  });
}

// ---------------------------------------------------------------------------
// Follow-up next steps
// ---------------------------------------------------------------------------

export async function listNextSteps(active?: boolean) {
  return prisma.followUpNextStep.findMany({ where: activeFilter(active), orderBy: order });
}

export async function createNextStep(input: CreateOptionInput, actor: Actor) {
  assertCanEdit(actor.user);
  return createAudited(actor, "followUpNextStep.create", "FollowUpNextStep", (tx) => tx.followUpNextStep.create({ data: input }));
}

export async function updateNextStep(id: number, input: UpdateOptionInput, actor: Actor) {
  assertCanEdit(actor.user);
  const before = await prisma.followUpNextStep.findUnique({ where: { id } });
  if (!before) throw notFound("Next step not found.");
  const changes = onlyChanged(definedOnly(input), before);
  return saveChanges({
    before,
    changes,
    actor,
    action: "followUpNextStep.update",
    entityType: "FollowUpNextStep",
    entityId: id,
    write: (tx) => tx.followUpNextStep.update({ where: { id }, data: changes }),
  });
}

// ---------------------------------------------------------------------------
// Postpone and cancel reasons
// ---------------------------------------------------------------------------

export async function listReasons(active?: boolean) {
  return prisma.enquiryReason.findMany({ where: activeFilter(active), orderBy: [{ kind: "asc" }, ...order] });
}

export async function createReason(input: CreateReasonInput, actor: Actor) {
  assertCanEdit(actor.user);
  return createAudited(actor, "enquiryReason.create", "EnquiryReason", (tx) => tx.enquiryReason.create({ data: input }));
}

export async function updateReason(id: number, input: UpdateReasonInput, actor: Actor) {
  assertCanEdit(actor.user);
  const before = await prisma.enquiryReason.findUnique({ where: { id } });
  if (!before) throw notFound("Reason not found.");
  const changes = onlyChanged(definedOnly(input), before);
  return saveChanges({
    before,
    changes,
    actor,
    action: "enquiryReason.update",
    entityType: "EnquiryReason",
    entityId: id,
    write: (tx) => tx.enquiryReason.update({ where: { id }, data: changes }),
  });
}

// ---------------------------------------------------------------------------
// Time slots for the collection and delivery boy (docs/decisions/0015-field-staff-app.md Decision 2)
// ---------------------------------------------------------------------------

const slotOrder = [{ sortOrder: "asc" as const }, { startsAt: "asc" as const }];

export async function listSlots(active?: boolean) {
  return prisma.fieldSlot.findMany({ where: activeFilter(active), orderBy: slotOrder });
}

export async function createSlot(input: CreateSlotInput, actor: Actor) {
  assertCanEdit(actor.user);
  return createAudited(actor, "fieldSlot.create", "FieldSlot", (tx) => tx.fieldSlot.create({ data: input }));
}

/** Only what changed is written; the slot still ends after it starts, with the time not sent. */
export async function updateSlot(id: number, input: UpdateSlotInput, actor: Actor) {
  assertCanEdit(actor.user);
  const before = await prisma.fieldSlot.findUnique({ where: { id } });
  if (!before) throw notFound("Time slot not found.");
  const changes = onlyChanged(definedOnly(input), before);
  if ((changes.endsAt ?? before.endsAt) <= (changes.startsAt ?? before.startsAt)) throw fieldError("endsAt", "The slot must end after it starts.");
  return saveChanges({
    before,
    changes,
    actor,
    action: "fieldSlot.update",
    entityType: "FieldSlot",
    entityId: id,
    write: (tx) => tx.fieldSlot.update({ where: { id }, data: changes }),
  });
}

// ---------------------------------------------------------------------------
// Why a visit fails, for the boy's "Couldn't complete" (docs/decisions/0015-field-staff-app.md Decision 5)
// ---------------------------------------------------------------------------

export async function listFailReasons(active?: boolean) {
  return prisma.fieldFailReason.findMany({ where: activeFilter(active), orderBy: order });
}

export async function createFailReason(input: CreateOptionInput, actor: Actor) {
  assertCanEdit(actor.user);
  return createAudited(actor, "fieldFailReason.create", "FieldFailReason", (tx) => tx.fieldFailReason.create({ data: input }));
}

export async function updateFailReason(id: number, input: UpdateOptionInput, actor: Actor) {
  assertCanEdit(actor.user);
  const before = await prisma.fieldFailReason.findUnique({ where: { id } });
  if (!before) throw notFound("Reason not found.");
  const changes = onlyChanged(definedOnly(input), before);
  return saveChanges({
    before,
    changes,
    actor,
    action: "fieldFailReason.update",
    entityType: "FieldFailReason",
    entityId: id,
    write: (tx) => tx.fieldFailReason.update({ where: { id }, data: changes }),
  });
}

/**
 * The field staff app's settings (0015 Decision 8), changed by the Head or any HOD like the field lists: only what was
 * sent changes; an unchanged save writes nothing. Audited (setting.update).
 */
export async function updateFieldSettings(input: UpdateFieldSettingsInput, actor: Actor) {
  assertCanEdit(actor.user);
  const before = await getFieldSettings();
  const after = { ...before, ...definedOnly(input) };
  if (JSON.stringify(after) === JSON.stringify(before)) return before;
  await prisma.$transaction((tx) => saveSetting(tx, { key: FIELD_SETTINGS_KEY, before, after, actorId: actor.user.id, ip: actor.ip }));
  return getFieldSettings();
}
