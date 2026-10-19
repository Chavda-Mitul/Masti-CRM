import { prisma, type Db } from "../../config/prisma";
import { definedOnly, onlyChanged } from "../../lib/changes";
import { fieldError, forbidden, notFound } from "../../lib/httpError";
import { activeFilter, createAudited, saveChanges } from "../../lib/masters";
import { saveSetting } from "../../lib/settings";
import { isHodOf, isHodOfAny, type DepartmentCode } from "../auth/permissions";
import type { UpdateFieldSettingsInput } from "../fieldJobs/field.schemas";
import { FIELD_SETTINGS_KEY, getFieldSettings } from "../fieldJobs/fieldJobs.settings";
import type { Actor, UserWithDepartments } from "../users/user";
import type {
  CreateOptionInput,
  CreateReasonInput,
  CreateSlotInput,
  CreateTaggedOptionInput,
  UpdateOptionInput,
  UpdateReasonInput,
  UpdateSlotInput,
  UpdateTaggedOptionInput,
} from "./enquiryMasters.schemas";

// Follow-up outcomes, follow-up next steps, and postpone/cancel reasons (docs/decisions/0006-visa-documents.md Decision 7).
// Each value is tagged with the departments it shows in (docs/decisions/0018-dropdowns-by-department.md): the Head, or
// the HOD of every one of those departments, edits it. Anyone signed in reads them: they are the dropdowns on every
// case. Switched off, never deleted, so old follow-ups keep their labels.
// The field lists further down are shared by every department, so the Head or any HOD edits them.

function assertCanEdit(user: UserWithDepartments) {
  if (!isHodOfAny(user)) throw forbidden("Only the Head or an HOD can change these lists.");
}

const order = [{ sortOrder: "asc" as const }, { name: "asc" as const }];

// ---------------------------------------------------------------------------
// Department tags (0018)
// ---------------------------------------------------------------------------

const departmentsInclude = { departments: { select: { department: { select: { code: true, sortOrder: true } } } } };

type Tagged = { departments: { department: { code: string; sortOrder: number } }[] };

/** The row as the API returns it and the audit log keeps it: its departments as codes, in the departments' order. */
function withCodes<Row extends Tagged>({ departments, ...row }: Row) {
  const codes = departments.map((d) => d.department).sort((a, b) => a.sortOrder - b.sortOrder).map((d) => d.code);
  return { ...row, departments: codes };
}

/** The Head, or the HOD of every department the value is (or will be) for. A value shared by several is the Head's. */
function assertCanTag(user: UserWithDepartments, codes: string[]) {
  if (!isHodOfAny(user) || !codes.every((code) => isHodOf(user, code as DepartmentCode))) {
    throw forbidden("Only the Head, or the HOD of every department this is for, can change it.");
  }
}

/**
 * The departments behind these codes, in their order. Every code must be a department, and one being added must be
 * active; one the value already has may stay, even if switched off since.
 */
async function resolveDepartments(codes: string[], alreadyTagged: string[] = []) {
  const rows = await prisma.department.findMany({ where: { code: { in: codes } }, orderBy: { sortOrder: "asc" } });
  const usable = rows.filter((d) => d.isActive || alreadyTagged.includes(d.code));
  if (usable.length !== codes.length) throw fieldError("departments", "Pick from the active departments.");
  return usable;
}

const linkTo = (departments: { id: number }[]) => ({ create: departments.map((d) => ({ departmentId: d.id })) });

/**
 * What an edit changes: the columns, and the department ids when the set itself changed (they replace the old set).
 * Checked against the departments before and after, so an HOD can neither take over nor give away another's value.
 */
async function planTaggedEdit<Input extends { departments?: string[] | undefined }>(before: { departments: string[] }, input: Input, user: UserWithDepartments) {
  assertCanTag(user, before.departments);
  if (input.departments) assertCanTag(user, input.departments);
  const tagged = input.departments && (await resolveDepartments(input.departments, before.departments));
  const changes = onlyChanged(definedOnly({ ...input, departments: tagged?.map((d) => d.code) }), before);
  const { departments: changedCodes, ...columns } = changes;
  return { changes, columns, departmentIds: changedCodes && tagged?.map((d) => d.id) };
}

// ---------------------------------------------------------------------------
// Follow-up outcomes ("What happened")
// ---------------------------------------------------------------------------

export async function listOutcomes(active?: boolean) {
  const rows = await prisma.followUpOutcome.findMany({ where: activeFilter(active), include: departmentsInclude, orderBy: order });
  return rows.map(withCodes);
}

export async function createOutcome(input: CreateTaggedOptionInput, actor: Actor) {
  assertCanTag(actor.user, input.departments);
  const { departments, ...data } = input;
  const tagged = await resolveDepartments(departments);
  return createAudited(actor, "followUpOutcome.create", "FollowUpOutcome", async (tx) =>
    withCodes(await tx.followUpOutcome.create({ data: { ...data, departments: linkTo(tagged) }, include: departmentsInclude })),
  );
}

export async function updateOutcome(id: number, input: UpdateTaggedOptionInput, actor: Actor) {
  const row = await prisma.followUpOutcome.findUnique({ where: { id }, include: departmentsInclude });
  if (!row) throw notFound("Outcome not found.");
  const before = withCodes(row);
  const { changes, columns, departmentIds } = await planTaggedEdit(before, input, actor.user);
  return saveChanges({
    before,
    changes,
    actor,
    action: "followUpOutcome.update",
    entityType: "FollowUpOutcome",
    entityId: id,
    write: async (tx: Db) => {
      await tx.followUpOutcome.update({ where: { id }, data: columns });
      if (departmentIds) {
        await tx.followUpOutcomeDepartment.deleteMany({ where: { outcomeId: id } });
        await tx.followUpOutcomeDepartment.createMany({ data: departmentIds.map((departmentId) => ({ outcomeId: id, departmentId })) });
      }
      return withCodes(await tx.followUpOutcome.findUniqueOrThrow({ where: { id }, include: departmentsInclude }));
    },
  });
}

// ---------------------------------------------------------------------------
// Follow-up next steps
// ---------------------------------------------------------------------------

export async function listNextSteps(active?: boolean) {
  const rows = await prisma.followUpNextStep.findMany({ where: activeFilter(active), include: departmentsInclude, orderBy: order });
  return rows.map(withCodes);
}

export async function createNextStep(input: CreateTaggedOptionInput, actor: Actor) {
  assertCanTag(actor.user, input.departments);
  const { departments, ...data } = input;
  const tagged = await resolveDepartments(departments);
  return createAudited(actor, "followUpNextStep.create", "FollowUpNextStep", async (tx) =>
    withCodes(await tx.followUpNextStep.create({ data: { ...data, departments: linkTo(tagged) }, include: departmentsInclude })),
  );
}

export async function updateNextStep(id: number, input: UpdateTaggedOptionInput, actor: Actor) {
  const row = await prisma.followUpNextStep.findUnique({ where: { id }, include: departmentsInclude });
  if (!row) throw notFound("Next step not found.");
  const before = withCodes(row);
  const { changes, columns, departmentIds } = await planTaggedEdit(before, input, actor.user);
  return saveChanges({
    before,
    changes,
    actor,
    action: "followUpNextStep.update",
    entityType: "FollowUpNextStep",
    entityId: id,
    write: async (tx: Db) => {
      await tx.followUpNextStep.update({ where: { id }, data: columns });
      if (departmentIds) {
        await tx.followUpNextStepDepartment.deleteMany({ where: { nextStepId: id } });
        await tx.followUpNextStepDepartment.createMany({ data: departmentIds.map((departmentId) => ({ nextStepId: id, departmentId })) });
      }
      return withCodes(await tx.followUpNextStep.findUniqueOrThrow({ where: { id }, include: departmentsInclude }));
    },
  });
}

// ---------------------------------------------------------------------------
// Postpone and cancel reasons
// ---------------------------------------------------------------------------

export async function listReasons(active?: boolean) {
  const rows = await prisma.enquiryReason.findMany({ where: activeFilter(active), include: departmentsInclude, orderBy: [{ kind: "asc" }, ...order] });
  return rows.map(withCodes);
}

export async function createReason(input: CreateReasonInput, actor: Actor) {
  assertCanTag(actor.user, input.departments);
  const { departments, ...data } = input;
  const tagged = await resolveDepartments(departments);
  return createAudited(actor, "enquiryReason.create", "EnquiryReason", async (tx) =>
    withCodes(await tx.enquiryReason.create({ data: { ...data, departments: linkTo(tagged) }, include: departmentsInclude })),
  );
}

export async function updateReason(id: number, input: UpdateReasonInput, actor: Actor) {
  const row = await prisma.enquiryReason.findUnique({ where: { id }, include: departmentsInclude });
  if (!row) throw notFound("Reason not found.");
  const before = withCodes(row);
  const { changes, columns, departmentIds } = await planTaggedEdit(before, input, actor.user);
  return saveChanges({
    before,
    changes,
    actor,
    action: "enquiryReason.update",
    entityType: "EnquiryReason",
    entityId: id,
    write: async (tx: Db) => {
      await tx.enquiryReason.update({ where: { id }, data: columns });
      if (departmentIds) {
        await tx.enquiryReasonDepartment.deleteMany({ where: { reasonId: id } });
        await tx.enquiryReasonDepartment.createMany({ data: departmentIds.map((departmentId) => ({ reasonId: id, departmentId })) });
      }
      return withCodes(await tx.enquiryReason.findUniqueOrThrow({ where: { id }, include: departmentsInclude }));
    },
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
