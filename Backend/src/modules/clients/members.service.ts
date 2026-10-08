import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { cleanMobile } from "../../lib/contact";
import { istToday, toDbDate } from "../../lib/dates";
import { badRequest, notFound } from "../../lib/httpError";
import type { Actor } from "../users/user";
import { assertCanEditClients } from "./access";
import { assertFresh, onlyChanged, pick, staleError } from "./changes";
import { toMemberDto } from "./client";
import type { CreateMemberInput, UpdateMemberInput } from "./clients.schemas";
import { getClientSettings } from "./clients.settings";
import { checkDuplicates, confirmedDuplicatesNote, findPassportDuplicates } from "./duplicates";

// Family & travellers ✅ (or a corporate's employees). Members are archived, never deleted: past cases will point at them.

const memberInclude = { relation: true } satisfies Prisma.ClientMemberInclude;

async function assertClientExists(clientId: string) {
  if (!(await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } }))) throw notFound("Client not found.");
}

async function getMemberOr404(clientId: string, memberId: string) {
  const member = await prisma.clientMember.findFirst({ where: { id: memberId, clientId }, include: memberInclude });
  if (!member) throw notFound("Person not found on this client.");
  return member;
}

async function assertRelation(relationId: number) {
  const relation = await prisma.relation.findUnique({ where: { id: relationId } });
  if (!relation?.isActive) throw badRequest("Pick a relation from the list.");
}

function assertBirthDate(dateOfBirth: string | null | undefined, today: string) {
  if (dateOfBirth && dateOfBirth > today) throw badRequest("Date of birth can't be in the future.");
}

const optionalDate = (value: string | null) => (value ? toDbDate(value) : null);

async function toDto(member: Parameters<typeof toMemberDto>[0]) {
  return toMemberDto(member, istToday(), await getClientSettings());
}

export async function createMember(clientId: string, input: CreateMemberInput, actor: Actor) {
  assertCanEditClients(actor.user);
  await assertClientExists(clientId);
  await assertRelation(input.relationId);
  assertBirthDate(input.dateOfBirth, istToday());
  const mobile = cleanMobile(input.mobile) ?? null;
  const passportNumber = input.passportNumber ?? null;
  const confirmed = checkDuplicates(passportNumber ? [await findPassportDuplicates(passportNumber)] : [], input.confirmDuplicates);
  const last = await prisma.clientMember.aggregate({ where: { clientId }, _max: { sortOrder: true } });

  const member = await prisma.$transaction(async (tx) => {
    const created = await tx.clientMember.create({
      data: {
        clientId,
        name: input.name,
        relationId: input.relationId,
        dateOfBirth: optionalDate(input.dateOfBirth ?? null),
        mobile,
        passportNumber,
        passportExpiry: optionalDate(input.passportExpiry ?? null),
        sortOrder: (last._max.sortOrder ?? 0) + 1,
        createdById: actor.user.id,
      },
      include: memberInclude,
    });
    await audit(
      {
        actorId: actor.user.id,
        action: "client.member.create",
        entityType: "ClientMember",
        entityId: created.id,
        clientId: clientId,
        after: { ...created, ...confirmedDuplicatesNote(confirmed) },
        ip: actor.ip,
      },
      tx,
    );
    return created;
  });

  return toDto(member);
}

/** Partial update. `updatedAt` must be the value the browser read (optimistic locking). */
export async function updateMember(clientId: string, memberId: string, input: UpdateMemberInput, actor: Actor) {
  assertCanEditClients(actor.user);
  const before = await getMemberOr404(clientId, memberId);
  if (before.archivedAt) throw badRequest("This person was taken off the family list.");
  assertFresh(before.updatedAt, input.updatedAt, "person");

  const requested: Prisma.ClientMemberUncheckedUpdateManyInput = {};
  if (input.name !== undefined) requested.name = input.name;
  if (input.relationId !== undefined) requested.relationId = input.relationId;
  if (input.dateOfBirth !== undefined) {
    assertBirthDate(input.dateOfBirth, istToday());
    requested.dateOfBirth = optionalDate(input.dateOfBirth);
  }
  const mobile = cleanMobile(input.mobile);
  if (mobile !== undefined) requested.mobile = mobile;
  if (input.passportNumber !== undefined) requested.passportNumber = input.passportNumber;
  if (input.passportExpiry !== undefined) requested.passportExpiry = optionalDate(input.passportExpiry);

  const changes = onlyChanged(requested, before);
  const keys = Object.keys(changes);
  if (keys.length === 0) return toDto(before);
  if (typeof changes.relationId === "number") await assertRelation(changes.relationId);
  const confirmed = checkDuplicates(
    typeof changes.passportNumber === "string" ? [await findPassportDuplicates(changes.passportNumber, memberId)] : [],
    input.confirmDuplicates,
  );

  const after = await prisma.$transaction(async (tx) => {
    const { count } = await tx.clientMember.updateMany({ where: { id: memberId, updatedAt: before.updatedAt }, data: changes });
    if (count === 0) throw staleError("person");
    const updated = await tx.clientMember.findUniqueOrThrow({ where: { id: memberId }, include: memberInclude });
    await audit(
      {
        actorId: actor.user.id,
        action: "client.member.update",
        entityType: "ClientMember",
        entityId: memberId,
        clientId: clientId,
        before: pick(before, keys),
        after: { ...pick(updated, keys), ...confirmedDuplicatesNote(confirmed) },
        ip: actor.ip,
      },
      tx,
    );
    return updated;
  });

  return toDto(after);
}

/** Takes a person off the family list. Safe to repeat. */
export async function archiveMember(clientId: string, memberId: string, actor: Actor) {
  assertCanEditClients(actor.user);
  const before = await getMemberOr404(clientId, memberId);
  if (before.archivedAt) return toDto(before);

  const after = await prisma.$transaction(async (tx) => {
    const updated = await tx.clientMember.update({ where: { id: memberId }, data: { archivedAt: new Date() }, include: memberInclude });
    await audit(
      {
        actorId: actor.user.id,
        action: "client.member.archive",
        entityType: "ClientMember",
        entityId: memberId,
        clientId: clientId,
        before: { archivedAt: null },
        after: { archivedAt: updated.archivedAt },
        ip: actor.ip,
      },
      tx,
    );
    return updated;
  });

  return toDto(after);
}
