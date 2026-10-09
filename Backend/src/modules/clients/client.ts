import type { Client, ClientMember, ClientNote, ClientPhone, Prisma, Relation } from "../../../generated/prisma/client";
import { addMonths, fromDbDate, wholeYearsBetween } from "../../lib/dates";
import { badRequest } from "../../lib/httpError";
import { cleanMobile } from "../../lib/contact";
import type { ClientSettings } from "./clients.settings";
import { readinessOf } from "./readiness";

// Shapes sent to the browser, and the input clean-up shared by the client and member services.

export function requireMobile(value: string): string {
  const mobile = cleanMobile(value);
  if (!mobile) throw badRequest("Enter a valid 10-digit Indian mobile number.");
  return mobile;
}

/** Everything the profile page shows, except notes (loaded separately). */
export const clientProfileInclude = {
  billingCycle: true,
  paymentHabit: true,
  phones: { orderBy: { createdAt: "asc" } },
  members: {
    where: { archivedAt: null },
    include: { relation: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  },
} satisfies Prisma.ClientInclude;

type ClientProfileRow = Prisma.ClientGetPayload<{ include: typeof clientProfileInclude }>;
type MemberRow = ClientMember & { relation: Relation };
type NoteRow = ClientNote & { author: { id: string; name: string } };

const lookup = (row: { id: number; code: string; name: string } | null) =>
  row ? { id: row.id, code: row.code, name: row.name } : null;

export type PassportStatus = "VALID" | "RENEW_SOON" | "EXPIRED";

/** EXPIRED before today; RENEW_SOON within the setting's window; null when no expiry is on file. */
export function passportStatus(expiry: Date | null, today: string, renewSoonMonths: number): PassportStatus | null {
  if (!expiry) return null;
  const date = fromDbDate(expiry);
  if (date < today) return "EXPIRED";
  return date <= addMonths(today, renewSoonMonths) ? "RENEW_SOON" : "VALID";
}

export function toMemberDto(member: MemberRow, today: string, settings: ClientSettings) {
  const dateOfBirth = member.dateOfBirth ? fromDbDate(member.dateOfBirth) : null;
  return {
    id: member.id,
    clientId: member.clientId,
    name: member.name,
    relation: lookup(member.relation),
    dateOfBirth,
    age: dateOfBirth ? wholeYearsBetween(dateOfBirth, today) : null,
    mobile: member.mobile,
    passportNumber: member.passportNumber,
    passportExpiry: member.passportExpiry ? fromDbDate(member.passportExpiry) : null,
    passportStatus: passportStatus(member.passportExpiry, today, settings.expiryWarnings.passportRenewSoonMonths),
    archivedAt: member.archivedAt,
    updatedAt: member.updatedAt,
  };
}

export function toPhoneDto(phone: ClientPhone) {
  return { id: phone.id, mobile: phone.mobile, label: phone.label, createdAt: phone.createdAt };
}

export function toNoteDto(note: NoteRow) {
  return { id: note.id, body: note.body, author: { id: note.author.id, name: note.author.name }, createdAt: note.createdAt };
}

/** The client's own fields, as on a list row. */
export function toClientSummary(client: Client, settings: ClientSettings) {
  return {
    id: client.id,
    kind: client.kind,
    name: client.name,
    contactPerson: client.contactPerson,
    mobile: client.mobile,
    area: client.area,
    city: client.city,
    accountingCode: client.accountingCode,
    readiness: readinessOf(client, settings.invoiceReadiness),
  };
}

export function toClientProfile(client: ClientProfileRow, notes: NoteRow[], today: string, settings: ClientSettings) {
  return {
    id: client.id,
    kind: client.kind,
    mobile: client.mobile,
    name: client.name,
    contactPerson: client.contactPerson,
    email: client.email,
    addressLine: client.addressLine,
    area: client.area,
    city: client.city,
    stateCode: client.stateCode,
    pincode: client.pincode,
    pan: client.pan,
    gstin: client.gstin,
    accountingCode: client.accountingCode,
    billingCycle: lookup(client.billingCycle),
    paymentHabit: lookup(client.paymentHabit),
    clientSince: fromDbDate(client.clientSince),
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
    readiness: readinessOf(client, settings.invoiceReadiness),
    phones: client.phones.map(toPhoneDto),
    members: client.members.map((m) => toMemberDto(m, today, settings)),
    notes: notes.map(toNoteDto),
  };
}

export type ClientProfileDto = ReturnType<typeof toClientProfile>;
export type MemberDto = ReturnType<typeof toMemberDto>;
