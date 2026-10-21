import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { staleError } from "../../lib/changes";
import { fieldError } from "../../lib/httpError";
import type { Actor } from "../users/user";
import { assertCanEditVisaMasters } from "../visaMasters/access";
import { wordingInUse } from "./consent.public.service";
import type { AddConsentWordingInput } from "./consent.schemas";

// The consent form's wording in Settings (docs/decisions/0022-consent-form.md, part 2b). The Head and the Visa HOD add
// versions; the newest is the one clients agree to. A version is never changed or removed (a database trigger), so each
// consent keeps the exact words it was given to.

/** Every version, newest first: the first is the one in use. A null addedBy is the draft set up with the system. */
export async function listConsentWordings() {
  return prisma.consentWording.findMany({
    orderBy: { id: "desc" },
    select: { id: true, body: true, createdAt: true, addedBy: { select: { id: true, name: true } } },
  });
}

/**
 * A new version, used from now on. basedOnId is the version the editor opened: if another was added since, the save is
 * stale (409), so nobody replaces words they haven't seen.
 */
export async function addConsentWording(input: AddConsentWordingInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  await prisma.$transaction(async (tx) => {
    // Two saves at once: the second waits here, then finds the first one's version in use and is told to reload.
    await tx.$queryRaw`SELECT "id" FROM "ConsentWording" WHERE "id" = ${input.basedOnId} FOR UPDATE`;
    const inUse = await wordingInUse(tx);
    if (inUse.id !== input.basedOnId) throw staleError("wording");
    if (inUse.body === input.body) throw fieldError("body", "That's the wording already in use. Change something first.");
    const version = await tx.consentWording.create({ data: { body: input.body, addedById: actor.user.id } });
    await audit(
      {
        actorId: actor.user.id,
        action: "consent.wording.add",
        entityType: "ConsentWording",
        entityId: String(version.id),
        before: { versionId: inUse.id },
        after: { versionId: version.id, body: input.body },
        ip: actor.ip,
      },
      tx,
    );
  });
  return listConsentWordings();
}
