import type { ApiClient, Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { definedOnly, onlyChanged, pick } from "../../lib/changes";
import { badRequest, notFound } from "../../lib/httpError";
import { rethrowUnique } from "../../lib/prismaErrors";
import { isIpOrCidr } from "../auth/officeNetwork";
import type { Actor } from "../users/user";
import type { CreateApiClientInput, UpdateApiClientInput } from "./apiClients.schemas";
import { generateApiKey, hashApiKey } from "./apiKey";

// Machine accounts (docs/decisions/0005-system-masters.md §5). Head only (the routes check it).
// The key is returned once, by create and rotate, and never stored or audited.

const include = { createdBy: { select: { id: true, name: true } } } satisfies Prisma.ApiClientInclude;
type ApiClientRow = Prisma.ApiClientGetPayload<{ include: typeof include }>;

export function toApiClientDto(row: ApiClientRow) {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: `mcrm_${row.keyPrefix}_…`,
    scopes: row.scopes,
    allowedIps: row.allowedIps,
    isActive: row.isActive,
    lastUsedAt: row.lastUsedAt,
    lastUsedIp: row.lastUsedIp,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
  };
}

/** What the audit log keeps: never the key or its hash. */
const auditFields = (row: Pick<ApiClient, "name" | "scopes" | "allowedIps" | "isActive" | "keyPrefix">) => ({
  name: row.name,
  scopes: row.scopes,
  allowedIps: row.allowedIps,
  isActive: row.isActive,
  keyPrefix: row.keyPrefix,
});

const rethrowName = rethrowUnique("Another machine account already has this name.");

function assertValidIps(entries: string[] | undefined) {
  const bad = entries?.filter((entry) => !isIpOrCidr(entry)) ?? [];
  if (bad.length > 0) throw badRequest(`Not a valid IP address or range: ${bad.join(", ")}. Use e.g. 203.0.113.10 or 203.0.113.0/24.`);
}

async function getRowOr404(id: string) {
  const row = await prisma.apiClient.findUnique({ where: { id }, include });
  if (!row) throw notFound("Machine account not found.");
  return row;
}

export async function listApiClients() {
  const rows = await prisma.apiClient.findMany({ include, orderBy: { name: "asc" } });
  return rows.map(toApiClientDto);
}

export async function createApiClient(input: CreateApiClientInput, actor: Actor) {
  assertValidIps(input.allowedIps);
  const { key, prefix, hash } = generateApiKey();
  const row = await prisma
    .$transaction(async (tx) => {
      const created = await tx.apiClient.create({
        data: { name: input.name, scopes: input.scopes, allowedIps: input.allowedIps, keyPrefix: prefix, keyHash: hash, createdById: actor.user.id },
        include,
      });
      await audit(
        { actorId: actor.user.id, action: "apiClient.create", entityType: "ApiClient", entityId: created.id, after: auditFields(created), ip: actor.ip },
        tx,
      );
      return created;
    })
    .catch(rethrowName);
  return { client: toApiClientDto(row), key };
}

export async function updateApiClient(id: string, input: UpdateApiClientInput, actor: Actor) {
  assertValidIps(input.allowedIps);
  const before = await getRowOr404(id);
  const changes = onlyChanged(definedOnly(input), before);
  const keys = Object.keys(changes);
  if (keys.length === 0) return toApiClientDto(before);

  const row = await prisma
    .$transaction(async (tx) => {
      const updated = await tx.apiClient.update({ where: { id }, data: changes, include });
      await audit(
        {
          actorId: actor.user.id,
          action: "apiClient.update",
          entityType: "ApiClient",
          entityId: id,
          before: pick(before, keys),
          after: pick(updated, keys),
          ip: actor.ip,
        },
        tx,
      );
      return updated;
    })
    .catch(rethrowName);
  return toApiClientDto(row);
}

/** A new key; the old one stops working at once. */
export async function rotateApiClientKey(id: string, actor: Actor) {
  const before = await getRowOr404(id);
  const { key, prefix, hash } = generateApiKey();
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.apiClient.update({ where: { id }, data: { keyPrefix: prefix, keyHash: hash }, include });
    await audit(
      {
        actorId: actor.user.id,
        action: "apiClient.rotate",
        entityType: "ApiClient",
        entityId: id,
        before: { keyPrefix: before.keyPrefix },
        after: { keyPrefix: prefix },
        ip: actor.ip,
      },
      tx,
    );
    return updated;
  });
  return { client: toApiClientDto(row), key };
}

export async function setApiClientActive(id: string, isActive: boolean, actor: Actor) {
  const before = await getRowOr404(id);
  if (before.isActive === isActive) return toApiClientDto(before);
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.apiClient.update({ where: { id }, data: { isActive }, include });
    await audit(
      {
        actorId: actor.user.id,
        action: isActive ? "apiClient.activate" : "apiClient.deactivate",
        entityType: "ApiClient",
        entityId: id,
        before: { isActive: before.isActive },
        after: { isActive },
        ip: actor.ip,
      },
      tx,
    );
    return updated;
  });
  return toApiClientDto(row);
}

/** For requireApiClient: the account this key belongs to, or null. */
export async function findApiClientByKey(key: string) {
  return prisma.apiClient.findUnique({ where: { keyHash: hashApiKey(key) } });
}

/** Records the last use. Not audited: the changes the client makes are. */
export async function markApiClientUsed(id: string, ip: string | null) {
  await prisma.apiClient.update({ where: { id }, data: { lastUsedAt: new Date(), lastUsedIp: ip } });
}
