import { prisma } from "../../config/prisma";
import { HttpError } from "../../lib/httpError";

// Soft duplicate warnings. A passport number, PAN, GSTIN or extra mobile already on file elsewhere is often a
// double entry, but not always (one person in two families, an accountant's number on two companies).
// So the first save answers 409 with the matches; staff check them and send the same request again
// with confirmDuplicates: true. The confirmation is written to the audit log.

export type DuplicateField = "mobile" | "pan" | "gstin" | "passportNumber";

export interface DuplicateMatch {
  clientId: string;
  clientName: string;
  clientMobile: string;
  /** Set for passport matches. */
  memberId?: string;
  memberName?: string;
}

export interface Duplicate {
  field: DuplicateField;
  value: string;
  matches: DuplicateMatch[];
}

const MESSAGES: Record<DuplicateField, string> = {
  mobile: "This mobile number is already on file for another client.",
  pan: "This PAN is already on file for another client.",
  gstin: "This GSTIN is already on file for another client.",
  passportNumber: "This passport number is already on file for another person.",
};

/**
 * Throws 409 { code: "DUPLICATE", duplicates } unless the request confirmed them.
 * Returns what was confirmed, for the audit entry.
 */
export function checkDuplicates(duplicates: Duplicate[], confirmed: boolean): Duplicate[] {
  const found = duplicates.filter((d) => d.matches.length > 0);
  if (found.length > 0 && !confirmed) {
    const message = found.length === 1 ? MESSAGES[found[0]!.field] : "Some of these details are already on file for another client.";
    throw new HttpError(409, `${message} Check, then save again to confirm.`, { code: "DUPLICATE", duplicates: found });
  }
  return found;
}

/** Merged into the audit "after" when staff saved past a warning. */
export function confirmedDuplicatesNote(confirmed: Duplicate[]) {
  return confirmed.length > 0 ? { confirmedDuplicates: confirmed } : {};
}

const clientSummary = { id: true, name: true, mobile: true } as const;

const toMatch = (client: { id: string; name: string; mobile: string }): DuplicateMatch => ({
  clientId: client.id,
  clientName: client.name,
  clientMobile: client.mobile,
});

/** Other clients with this PAN or GSTIN. */
export async function findTaxIdDuplicates(field: "pan" | "gstin", value: string, exceptClientId?: string): Promise<Duplicate> {
  const clients = await prisma.client.findMany({
    where: { [field]: value, ...(exceptClientId ? { id: { not: exceptClientId } } : {}) },
    select: clientSummary,
    take: 10,
  });
  return { field, value, matches: clients.map(toMatch) };
}

/** Other clients that have this number as their main or an extra number. */
export async function findMobileDuplicates(mobile: string, exceptClientId?: string): Promise<Duplicate> {
  const notSelf = exceptClientId ? { id: { not: exceptClientId } } : {};
  const clients = await prisma.client.findMany({
    where: { ...notSelf, OR: [{ mobile }, { phones: { some: { mobile } } }] },
    select: clientSummary,
    take: 10,
  });
  return { field: "mobile", value: mobile, matches: clients.map(toMatch) };
}

/** Other people (on the family list) with this passport number. */
export async function findPassportDuplicates(passportNumber: string, exceptMemberId?: string): Promise<Duplicate> {
  const members = await prisma.clientMember.findMany({
    where: { passportNumber, archivedAt: null, ...(exceptMemberId ? { id: { not: exceptMemberId } } : {}) },
    select: { id: true, name: true, client: { select: clientSummary } },
    take: 10,
  });
  return {
    field: "passportNumber",
    value: passportNumber,
    matches: members.map((m) => ({ ...toMatch(m.client), memberId: m.id, memberName: m.name })),
  };
}
