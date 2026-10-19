import type { Prisma } from "../../../generated/prisma/client";
import type { VendorKind } from "../../../generated/prisma/enums";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { definedOnly, onlyChanged, pick } from "../../lib/changes";
import { cleanEmail, cleanMobile } from "../../lib/contact";
import { fieldError, notFound } from "../../lib/httpError";
import { activeFilter, assertCountriesUsable } from "../../lib/masters";
import { rethrowUnique } from "../../lib/prismaErrors";
import type { Actor } from "../users/user";
import { assertCanEditVisaMasters } from "../visaMasters/access";
import type { CreateVendorInput, UpdateVendorInput, VendorListQuery } from "./vendors.schemas";

// The vendor master (docs/decisions/0007-visa-file-prep.md Decision 7): visa submission agents and the countries they
// cover. Only the Visa HOD or the Head adds, edits or switches one off; adding a vendor approves it (no "Waiting HOD").
// Switched off, never deleted: a case that picked a vendor keeps it. Every change is audited.

const vendorInclude = {
  countries: { include: { country: { select: { id: true, code: true, name: true, zone: true } } } },
} satisfies Prisma.VendorInclude;

type VendorRow = Prisma.VendorGetPayload<{ include: typeof vendorInclude }>;

function toVendorDto(row: VendorRow) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    city: row.city,
    contactName: row.contactName,
    mobile: row.mobile,
    email: row.email,
    isActive: row.isActive,
    /** By name: "China", "France (Schengen)". */
    countries: row.countries.map((c) => c.country).sort((a, b) => a.name.localeCompare(b.name)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type VendorDto = ReturnType<typeof toVendorDto>;

const sortedIds = (ids: number[]) => [...ids].sort((a, b) => a - b);

/** What the audit log keeps, and what an edit is compared against: the columns, and the countries as sorted ids. */
function snapshot(dto: VendorDto) {
  return {
    name: dto.name,
    city: dto.city,
    contactName: dto.contactName,
    mobile: dto.mobile,
    email: dto.email,
    isActive: dto.isActive,
    countryIds: sortedIds(dto.countries.map((c) => c.id)),
  };
}

/** Every vendor, or only active ones, or only those covering one country (the case's vendor picker). */
export async function listVendors(query: VendorListQuery) {
  const rows = await prisma.vendor.findMany({
    where: { ...activeFilter(query.active), ...(query.countryId ? { countries: { some: { countryId: query.countryId } } } : {}) },
    include: vendorInclude,
    orderBy: [{ name: "asc" }, { city: "asc" }],
  });
  return rows.map(toVendorDto);
}

/**
 * One vendor per kind, name and city, whatever the capitals. Compared with lower() exactly as the unique index
 * ("Vendor_kind_name_city_unique") does, so the friendly check and the database never disagree.
 */
async function assertNotDuplicate(kind: VendorKind, name: string, city: string, exceptId?: number) {
  const [twin] = await prisma.$queryRaw<{ name: string; city: string }[]>`
    SELECT "name", "city" FROM "Vendor"
    WHERE "kind" = ${kind}::"VendorKind" AND lower("name") = lower(${name}) AND lower("city") = lower(${city})
      AND "id" <> ${exceptId ?? 0}
    LIMIT 1`;
  if (twin) throw fieldError("name", `${twin.name} in ${twin.city} is already a vendor.`);
}

/** Two saves of the same new vendor at the same moment: the index stops the second. */
const rethrowDuplicate = rethrowUnique("A vendor with this name is already in this city.");

export async function createVendor(input: CreateVendorInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  await assertCountriesUsable(input.countryIds);
  const data = {
    name: input.name,
    city: input.city,
    contactName: input.contactName ?? null,
    mobile: cleanMobile(input.mobile) ?? null,
    email: cleanEmail(input.email)!,
    isActive: input.isActive,
  };
  await assertNotDuplicate("VISA_AGENT", data.name, data.city);

  return prisma
    .$transaction(async (tx) => {
      const row = await tx.vendor.create({
        data: { ...data, countries: { create: input.countryIds.map((countryId) => ({ countryId })) } },
        include: vendorInclude,
      });
      const vendor = toVendorDto(row);
      await audit(
        { actorId: actor.user.id, action: "vendor.create", entityType: "Vendor", entityId: String(row.id), after: snapshot(vendor), ip: actor.ip },
        tx,
      );
      return vendor;
    })
    .catch(rethrowDuplicate);
}

/** Changes only what was sent and differs. New countries replace the old set. Switching off is always allowed. */
export async function updateVendor(id: number, input: UpdateVendorInput, actor: Actor) {
  assertCanEditVisaMasters(actor.user);
  const row = await prisma.vendor.findUnique({ where: { id }, include: vendorInclude });
  if (!row) throw notFound("Vendor not found.");
  const before = snapshot(toVendorDto(row));

  const sent = definedOnly({
    ...input,
    mobile: cleanMobile(input.mobile),
    // Never cleared: the schema refuses an empty email.
    email: input.email === undefined ? undefined : cleanEmail(input.email)!,
    countryIds: input.countryIds && sortedIds(input.countryIds),
  });
  const changes = onlyChanged(sent, before);
  const keys = Object.keys(changes);
  if (keys.length === 0) return toVendorDto(row);

  const { countryIds, ...columns } = changes;
  if (countryIds) await assertCountriesUsable(countryIds, before.countryIds);
  if (columns.name !== undefined || columns.city !== undefined) {
    await assertNotDuplicate(row.kind, columns.name ?? row.name, columns.city ?? row.city, id);
  }

  return prisma
    .$transaction(async (tx) => {
      // updatedAt is set by hand so a change to the countries alone still moves it.
      await tx.vendor.update({ where: { id }, data: { ...columns, updatedAt: new Date() } });
      if (countryIds) {
        await tx.vendorCountry.deleteMany({ where: { vendorId: id } });
        await tx.vendorCountry.createMany({ data: countryIds.map((countryId) => ({ vendorId: id, countryId })) });
      }
      const vendor = toVendorDto(await tx.vendor.findUniqueOrThrow({ where: { id }, include: vendorInclude }));
      await audit(
        {
          actorId: actor.user.id,
          action: "vendor.update",
          entityType: "Vendor",
          entityId: String(id),
          before: pick(before, keys),
          after: pick(snapshot(vendor), keys),
          ip: actor.ip,
        },
        tx,
      );
      return vendor;
    })
    .catch(rethrowDuplicate);
}
