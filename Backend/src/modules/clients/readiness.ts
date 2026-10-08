import type { ClientKind, Prisma } from "../../../generated/prisma/client";
import { prisma, type Db } from "../../config/prisma";
import { HttpError, notFound } from "../../lib/httpError";
import type { InvoiceReadiness, ReadinessField } from "./clients.schemas";
import { getClientSettings } from "./clients.settings";

// "Minimal at enquiry, complete before invoicing" ✅. Which fields count is the clients.invoiceReadiness setting.

const LABELS: Record<ReadinessField, string> = {
  name: "Name",
  contactPerson: "Contact person",
  email: "Email",
  addressLine: "Address",
  area: "Area",
  city: "City",
  stateCode: "State",
  pincode: "PIN code",
  pan: "PAN",
  gstin: "GSTIN",
  accountingCode: "Accounting code",
};

export interface Readiness {
  ready: boolean;
  missing: { field: ReadinessField; label: string }[];
}

type ReadinessView = { kind: ClientKind } & Record<ReadinessField, string | null>;

export function readinessOf(client: ReadinessView, rules: InvoiceReadiness): Readiness {
  const missing = rules[client.kind].filter((field) => client[field] == null).map((field) => ({ field, label: LABELS[field] }));
  return { ready: missing.length === 0, missing };
}

/** Prisma filter for clients missing at least one required field. Wrap in NOT for complete clients. */
export function incompleteWhere(rules: InvoiceReadiness): Prisma.ClientWhereInput {
  const kinds = (Object.keys(rules) as ClientKind[]).filter((kind) => rules[kind].length > 0);
  return { OR: kinds.map((kind) => ({ kind, OR: rules[kind].map((field) => ({ [field]: null })) })) };
}

/**
 * For the invoice module: call inside the transaction that raises the invoice.
 * Throws 422 { code: "CLIENT_INCOMPLETE", missing } when a required field is empty.
 */
export async function assertInvoiceReady(clientId: string, db: Db = prisma): Promise<void> {
  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) throw notFound("Client not found.");
  const readiness = readinessOf(client, (await getClientSettings(db)).invoiceReadiness);
  if (!readiness.ready) {
    throw new HttpError(422, "Complete the client's details before raising an invoice.", {
      code: "CLIENT_INCOMPLETE",
      clientId,
      missing: readiness.missing,
    });
  }
}
