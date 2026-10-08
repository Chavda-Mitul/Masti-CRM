import { Prisma, type Client } from "../../../generated/prisma/client";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { istToday, toDbDate } from "../../lib/dates";
import { cleanEmail, normaliseMobile } from "../../lib/contact";
import { badRequest, conflict, HttpError, notFound } from "../../lib/httpError";
import { rethrowUnique } from "../../lib/prismaErrors";
import type { Actor } from "../users/user";
import { ACCOUNTS_FIELDS, assertCanChangeAccountsFields, assertCanEditClients } from "./access";
import { assertFresh, onlyChanged, pick, staleError } from "./changes";
import { clientProfileInclude, requireMobile, toClientProfile, toClientSummary, toNoteDto, toPhoneDto } from "./client";
import {
  GST_STATES,
  type AddNoteInput,
  type AddPhoneInput,
  type ChangeMobileInput,
  type CreateClientInput,
  type ListClientsQuery,
  type UpdateClientInput,
  type UpdateClientSettingsInput,
} from "./clients.schemas";
import { EXPIRY_WARNINGS_KEY, getClientSettings, INVOICE_READINESS_KEY } from "./clients.settings";
import {
  checkDuplicates,
  confirmedDuplicatesNote,
  findMobileDuplicates,
  findTaxIdDuplicates,
  type Duplicate,
} from "./duplicates";
import { incompleteWhere, readinessOf } from "./readiness";

/** Extra numbers per client, besides the main one. A sanity limit, not a business rule. */
const MAX_EXTRA_PHONES = 5;
/** Notes shown on the profile; the rest come from GET /:id/notes. */
const PROFILE_NOTES = 20;

const noteInclude = { author: { select: { id: true, name: true } } } satisfies Prisma.ClientNoteInclude;

type ClientValues = Pick<
  Client,
  | "kind"
  | "name"
  | "contactPerson"
  | "email"
  | "addressLine"
  | "area"
  | "city"
  | "stateCode"
  | "pincode"
  | "pan"
  | "gstin"
  | "accountingCode"
  | "billingCycleId"
  | "paymentHabitId"
  | "clientSince"
>;
type ClientChanges = Partial<ClientValues>;
type ClientFieldsInput = Omit<CreateClientInput, "mobile" | "confirmDuplicates">;

const TEXT_FIELDS = ["name", "contactPerson", "addressLine", "area", "city", "stateCode", "pincode", "pan", "gstin", "accountingCode"] as const;

const EMPTY_CLIENT: ClientValues = {
  kind: "INDIVIDUAL",
  name: null,
  contactPerson: null,
  email: null,
  addressLine: null,
  area: null,
  city: null,
  stateCode: null,
  pincode: null,
  pan: null,
  gstin: null,
  accountingCode: null,
  billingCycleId: 0,
  paymentHabitId: null,
  clientSince: new Date(0),
};

async function getClientRowOr404(id: string) {
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) throw notFound("Client not found.");
  return client;
}

/** Fallback if two requests race past the checks. */
const rethrowUniqueClient = rethrowUnique("This mobile number or accounting code is already used by another client.");

/**
 * Turns the request into column changes and applies the cross-field rules:
 * - only companies have a contact person (switching to INDIVIDUAL clears it)
 * - a GSTIN carries its holder's PAN: an empty PAN is filled from it, a different one is refused
 * - an empty state is filled from the GSTIN's state code
 * Returns only the fields that differ from `before`.
 */
async function resolveChanges(input: ClientFieldsInput, before: ClientValues | null, today: string): Promise<ClientChanges> {
  const changes: ClientChanges = {};
  if (input.kind !== undefined) changes.kind = input.kind;
  for (const key of TEXT_FIELDS) {
    const value = input[key];
    if (value !== undefined) changes[key] = value;
  }
  const email = cleanEmail(input.email);
  if (email !== undefined) changes.email = email;
  if (input.billingCycleId !== undefined) changes.billingCycleId = input.billingCycleId;
  if (input.paymentHabitId !== undefined) changes.paymentHabitId = input.paymentHabitId;
  if (input.clientSince !== undefined) {
    if (input.clientSince > today) throw badRequest("'Client since' can't be in the future.");
    changes.clientSince = toDbDate(input.clientSince);
  }

  const final: ClientValues = { ...(before ?? EMPTY_CLIENT), ...changes };

  if (final.kind === "INDIVIDUAL" && final.contactPerson !== null) {
    if (changes.contactPerson) throw badRequest("Only companies have a contact person.");
    changes.contactPerson = final.contactPerson = null;
  }

  if (final.gstin) {
    const panInGstin = final.gstin.slice(2, 12);
    if (final.pan === null) changes.pan = final.pan = panInGstin;
    else if (final.pan !== panInGstin) throw badRequest(`The PAN inside this GSTIN (${panInGstin}) doesn't match the PAN entered.`);
    const stateInGstin = final.gstin.slice(0, 2);
    if (final.stateCode === null && GST_STATES.some((s) => s.code === stateInGstin)) changes.stateCode = final.stateCode = stateInGstin;
  }

  const changed = before ? onlyChanged(changes, before) : changes;

  if (changed.billingCycleId !== undefined) {
    const cycle = await prisma.billingCycle.findUnique({ where: { id: changed.billingCycleId } });
    if (!cycle?.isActive) throw badRequest("Pick a billing cycle from the list.");
  }
  if (changed.paymentHabitId != null) {
    const habit = await prisma.paymentHabit.findUnique({ where: { id: changed.paymentHabitId } });
    if (!habit?.isActive) throw badRequest("Pick a payment habit from the list.");
  }
  return changed;
}

/** Accounts fields this request touches. On create only filled-in values count; on update clearing one counts too. */
function accountsFieldsIn(changes: ClientChanges, creating: boolean): string[] {
  return ACCOUNTS_FIELDS.filter((field) => (creating ? changes[field] != null : changes[field] !== undefined));
}

/** Checked after the Accounts permission, so other staff can't probe for codes. */
async function assertAccountingCodeFree(code: string | null | undefined, exceptClientId?: string) {
  if (!code) return;
  const other = await prisma.client.findFirst({
    where: { accountingCode: { equals: code, mode: "insensitive" }, ...(exceptClientId ? { id: { not: exceptClientId } } : {}) },
    select: { id: true },
  });
  if (other) throw conflict("This accounting code is already used by another client.");
}

async function taxIdDuplicates(changes: ClientChanges, exceptClientId?: string): Promise<Duplicate[]> {
  const found: Duplicate[] = [];
  if (changes.pan) found.push(await findTaxIdDuplicates("pan", changes.pan, exceptClientId));
  if (changes.gstin) found.push(await findTaxIdDuplicates("gstin", changes.gstin, exceptClientId));
  return found;
}

async function defaultBillingCycleId(): Promise<number> {
  const cycle = await prisma.billingCycle.findFirst({ where: { isDefault: true, isActive: true } });
  if (!cycle) throw new HttpError(500, "No default billing cycle is set up. Run the database seed.");
  return cycle.id;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The "Existing client" check while typing a mobile on the New enquiry form. Matches main and extra numbers. */
export async function lookupByMobile(raw: string) {
  const mobile = normaliseMobile(raw);
  if (!mobile) throw badRequest("Enter a valid 10-digit Indian mobile number.");

  const select = { id: true, name: true, kind: true, mobile: true } as const;
  const primary = await prisma.client.findUnique({ where: { mobile }, select });
  const secondary = await prisma.clientPhone.findMany({
    where: { mobile, ...(primary ? { clientId: { not: primary.id } } : {}) },
    include: { client: { select } },
    orderBy: { createdAt: "asc" },
  });
  const matches = [
    ...(primary ? [{ ...primary, matchedOn: "PRIMARY" as const }] : []),
    ...secondary.map((p) => ({ ...p.client, matchedOn: "SECONDARY" as const })),
  ];
  return { mobile, client: matches[0] ?? null, alsoMatches: matches.slice(1) };
}

/** Search by name, mobile (main or extra), passport number, PAN, GSTIN or accounting code. */
function searchWhere(q: string): Prisma.ClientWhereInput {
  const or: Prisma.ClientWhereInput[] = [
    { name: { contains: q, mode: "insensitive" } },
    { contactPerson: { contains: q, mode: "insensitive" } },
    { accountingCode: { equals: q, mode: "insensitive" } },
    { members: { some: { archivedAt: null, name: { contains: q, mode: "insensitive" } } } },
  ];
  const compact = q.replace(/\s+/g, "").toUpperCase();
  if (/^[A-Z0-9]{6,15}$/.test(compact)) {
    or.push({ pan: compact }, { gstin: compact }, { members: { some: { archivedAt: null, passportNumber: compact } } });
  }
  // Typed digits (with spaces, +, - or brackets) match any part of a number.
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 4 && /^[\d\s+\-()]+$/.test(q)) {
    const tail = digits.length > 10 ? digits.slice(-10) : digits;
    or.push({ mobile: { contains: tail } }, { phones: { some: { mobile: { contains: tail } } } });
  }
  return { OR: or };
}

export async function listClients(query: ListClientsQuery) {
  const settings = await getClientSettings();
  const and: Prisma.ClientWhereInput[] = [];
  if (query.kind) and.push({ kind: query.kind });
  if (query.incomplete !== undefined) {
    const incomplete = incompleteWhere(settings.invoiceReadiness);
    and.push(query.incomplete ? incomplete : { NOT: incomplete });
  }
  if (query.q) and.push(searchWhere(query.q));

  const rows = await prisma.client.findMany({
    where: { AND: and },
    orderBy: [{ name: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, query.limit);
  return {
    clients: page.map((c) => toClientSummary(c, settings)),
    nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export async function getClient(id: string) {
  const client = await prisma.client.findUnique({ where: { id }, include: clientProfileInclude });
  if (!client) throw notFound("Client not found.");
  const [notes, settings] = await Promise.all([
    prisma.clientNote.findMany({ where: { clientId: id }, include: noteInclude, orderBy: { createdAt: "desc" }, take: PROFILE_NOTES }),
    getClientSettings(),
  ]);
  return toClientProfile(client, notes, istToday(), settings);
}

export async function getReadiness(id: string) {
  const client = await getClientRowOr404(id);
  return readinessOf(client, (await getClientSettings()).invoiceReadiness);
}

/** States by name for the dropdown, with the "Other Territory" catch-all kept last. */
const STATES_BY_NAME = [...GST_STATES].sort((a, b) =>
  a.code === "97" ? 1 : b.code === "97" ? -1 : a.name.localeCompare(b.name, "en-IN"),
);

/** The dropdowns on the client forms. */
export async function getClientOptions() {
  const active = { where: { isActive: true }, orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }] };
  const [billingCycles, paymentHabits, relations] = await Promise.all([
    prisma.billingCycle.findMany({ ...active, select: { id: true, code: true, name: true, isDefault: true } }),
    prisma.paymentHabit.findMany({ ...active, select: { id: true, code: true, name: true } }),
    prisma.relation.findMany({ ...active, select: { id: true, code: true, name: true } }),
  ]);
  return { kinds: ["INDIVIDUAL", "CORPORATE"], billingCycles, paymentHabits, relations, states: STATES_BY_NAME };
}

// ---------------------------------------------------------------------------
// Creating and changing clients
// ---------------------------------------------------------------------------

/** Only the mobile is needed; the rest is completed before invoicing. */
export async function createClient(input: CreateClientInput, actor: Actor) {
  assertCanEditClients(actor.user);
  const mobile = requireMobile(input.mobile);
  const existing = await prisma.client.findUnique({ where: { mobile }, select: { id: true } });
  if (existing) {
    throw new HttpError(409, "A client with this mobile number already exists.", { code: "CLIENT_EXISTS", clientId: existing.id });
  }

  const today = istToday();
  const changes = await resolveChanges(input, null, today);
  assertCanChangeAccountsFields(actor.user, accountsFieldsIn(changes, true));
  await assertAccountingCodeFree(changes.accountingCode);
  const confirmed = checkDuplicates([await findMobileDuplicates(mobile), ...(await taxIdDuplicates(changes))], input.confirmDuplicates);
  const billingCycleId = changes.billingCycleId ?? (await defaultBillingCycleId());

  const created = await prisma
    .$transaction(async (tx) => {
      const client = await tx.client.create({
        data: { ...changes, mobile, billingCycleId, clientSince: changes.clientSince ?? toDbDate(today), createdById: actor.user.id },
      });
      await audit(
        {
          actorId: actor.user.id,
          action: "client.create",
          entityType: "Client",
          entityId: client.id,
          clientId: client.id,
          after: { ...client, ...confirmedDuplicatesNote(confirmed) },
          ip: actor.ip,
        },
        tx,
      );
      return client;
    })
    .catch(rethrowUniqueClient);

  return getClient(created.id);
}

/** Partial update. `updatedAt` must be the value the browser read (optimistic locking). */
export async function updateClient(id: string, input: UpdateClientInput, actor: Actor) {
  assertCanEditClients(actor.user);
  const before = await getClientRowOr404(id);
  assertFresh(before.updatedAt, input.updatedAt, "client");

  const changes = await resolveChanges(input, before, istToday());
  const keys = Object.keys(changes);
  if (keys.length === 0) return getClient(id);
  assertCanChangeAccountsFields(actor.user, accountsFieldsIn(changes, false));
  await assertAccountingCodeFree(changes.accountingCode, id);
  const confirmed = checkDuplicates(await taxIdDuplicates(changes, id), input.confirmDuplicates);

  await prisma
    .$transaction(async (tx) => {
      // The updatedAt condition makes a save that raced past assertFresh fail instead of overwriting.
      const { count } = await tx.client.updateMany({ where: { id, updatedAt: before.updatedAt }, data: changes });
      if (count === 0) throw staleError("client");
      const after = await tx.client.findUniqueOrThrow({ where: { id } });
      await audit(
        {
          actorId: actor.user.id,
          action: "client.update",
          entityType: "Client",
          entityId: id,
          clientId: id,
          before: pick(before, keys),
          after: { ...pick(after, keys), ...confirmedDuplicatesNote(confirmed) },
          ip: actor.ip,
        },
        tx,
      );
    })
    .catch(rethrowUniqueClient);

  return getClient(id);
}

/** Makes another number the main one (lookup key and WhatsApp number). The old one can stay as an extra number. */
export async function changeMobile(id: string, input: ChangeMobileInput, actor: Actor) {
  assertCanEditClients(actor.user);
  const before = await getClientRowOr404(id);
  const mobile = requireMobile(input.mobile);
  if (mobile === before.mobile) return getClient(id);

  const owner = await prisma.client.findUnique({ where: { mobile }, select: { id: true } });
  if (owner) {
    throw new HttpError(409, "This number is already the main number of another client.", { code: "CLIENT_EXISTS", clientId: owner.id });
  }
  if (input.keepOldAsSecondary) {
    // The new main number leaves the extra list if it was on it; the old main number joins it.
    const phones = await prisma.clientPhone.findMany({ where: { clientId: id }, select: { mobile: true } });
    const extrasAfter = phones.filter((p) => p.mobile !== mobile).length + 1;
    if (extrasAfter > MAX_EXTRA_PHONES) {
      throw badRequest(`A client can have at most ${MAX_EXTRA_PHONES} extra numbers. Remove one, or don't keep the old main number.`);
    }
  }
  const confirmed = checkDuplicates([await findMobileDuplicates(mobile, id)], input.confirmDuplicates);

  await prisma
    .$transaction(async (tx) => {
      // If it was one of this client's extra numbers, it moves up.
      await tx.clientPhone.deleteMany({ where: { clientId: id, mobile } });
      await tx.client.update({ where: { id }, data: { mobile } });
      if (input.keepOldAsSecondary) {
        await tx.clientPhone.create({ data: { clientId: id, mobile: before.mobile, label: "Previous main number", createdById: actor.user.id } });
      }
      await audit(
        {
          actorId: actor.user.id,
          action: "client.mobile.change",
          entityType: "Client",
          entityId: id,
          clientId: id,
          before: { mobile: before.mobile },
          after: { mobile, keptOldAsSecondary: input.keepOldAsSecondary, ...confirmedDuplicatesNote(confirmed) },
          ip: actor.ip,
        },
        tx,
      );
    })
    .catch(rethrowUniqueClient);

  return getClient(id);
}

export async function addPhone(clientId: string, input: AddPhoneInput, actor: Actor) {
  assertCanEditClients(actor.user);
  const client = await getClientRowOr404(clientId);
  const mobile = requireMobile(input.mobile);
  if (mobile === client.mobile) throw badRequest("This is already the client's main number.");
  const phones = await prisma.clientPhone.findMany({ where: { clientId }, select: { mobile: true } });
  if (phones.some((p) => p.mobile === mobile)) throw conflict("This number is already saved for this client.");
  if (phones.length >= MAX_EXTRA_PHONES) throw badRequest(`A client can have at most ${MAX_EXTRA_PHONES} extra numbers.`);
  const confirmed = checkDuplicates([await findMobileDuplicates(mobile, clientId)], input.confirmDuplicates);

  const phone = await prisma
    .$transaction(async (tx) => {
      const created = await tx.clientPhone.create({
        data: { clientId, mobile, label: input.label ?? null, createdById: actor.user.id },
      });
      await audit(
        {
          actorId: actor.user.id,
          action: "client.phone.add",
          entityType: "ClientPhone",
          entityId: created.id,
          clientId: clientId,
          after: { ...created, ...confirmedDuplicatesNote(confirmed) },
          ip: actor.ip,
        },
        tx,
      );
      return created;
    })
    .catch(rethrowUniqueClient);

  return toPhoneDto(phone);
}

export async function removePhone(clientId: string, phoneId: string, actor: Actor) {
  assertCanEditClients(actor.user);
  const phone = await prisma.clientPhone.findFirst({ where: { id: phoneId, clientId } });
  if (!phone) throw notFound("Number not found on this client.");

  await prisma.$transaction(async (tx) => {
    await tx.clientPhone.delete({ where: { id: phone.id } });
    await audit(
      { actorId: actor.user.id, action: "client.phone.remove", entityType: "ClientPhone", entityId: phone.id, clientId, before: phone, ip: actor.ip },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// Notes: free text, never reported on, append-only
// ---------------------------------------------------------------------------

export async function listNotes(clientId: string) {
  await getClientRowOr404(clientId);
  const notes = await prisma.clientNote.findMany({ where: { clientId }, include: noteInclude, orderBy: { createdAt: "desc" } });
  return notes.map(toNoteDto);
}

export async function addNote(clientId: string, input: AddNoteInput, actor: Actor) {
  assertCanEditClients(actor.user);
  await getClientRowOr404(clientId);

  const note = await prisma.$transaction(async (tx) => {
    const created = await tx.clientNote.create({ data: { clientId, body: input.body, authorId: actor.user.id }, include: noteInclude });
    await audit(
      {
        actorId: actor.user.id,
        action: "client.note.add",
        entityType: "ClientNote",
        entityId: created.id,
        clientId: clientId,
        after: { clientId, body: created.body },
        ip: actor.ip,
      },
      tx,
    );
    return created;
  });

  return toNoteDto(note);
}

// ---------------------------------------------------------------------------
// Settings (Head only; the route checks)
// ---------------------------------------------------------------------------

export async function getSettings() {
  return getClientSettings();
}

export async function updateSettings(input: UpdateClientSettingsInput, actor: Actor) {
  const before = await getClientSettings();
  const updates = [
    { key: INVOICE_READINESS_KEY, value: input.invoiceReadiness, previous: before.invoiceReadiness },
    { key: EXPIRY_WARNINGS_KEY, value: input.expiryWarnings, previous: before.expiryWarnings },
  ];

  await prisma.$transaction(async (tx) => {
    for (const { key, value, previous } of updates) {
      if (value === undefined) continue;
      await tx.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
      await audit(
        { actorId: actor.user.id, action: "setting.update", entityType: "Setting", entityId: key, before: previous, after: value, ip: actor.ip },
        tx,
      );
    }
  });

  return getClientSettings();
}
