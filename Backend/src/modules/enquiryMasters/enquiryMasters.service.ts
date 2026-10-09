import { prisma } from "../../config/prisma";
import { definedOnly, onlyChanged } from "../../lib/changes";
import { forbidden, notFound } from "../../lib/httpError";
import { activeFilter, createAudited, saveChanges } from "../../lib/masters";
import { isHodOfAny } from "../auth/permissions";
import type { Actor, UserWithDepartments } from "../users/user";
import type { CreateOptionInput, CreateReasonInput, UpdateOptionInput, UpdateReasonInput } from "./enquiryMasters.schemas";

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
