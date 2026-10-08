import { prisma, type Db } from "../../config/prisma";
import {
  expiryWarningsSchema,
  invoiceReadinessSchema,
  type ExpiryWarnings,
  type InvoiceReadiness,
} from "./clients.schemas";

// Client rules Masti can change without a deploy (§7 rule 1). Rows in the Setting table; the Head edits them.

export const INVOICE_READINESS_KEY = "clients.invoiceReadiness";
export const EXPIRY_WARNINGS_KEY = "clients.expiryWarnings";

/** ⚠️ Our proposal, not Masti's. Confirm what must be on file before an invoice (docs/decisions/0004-client-master.md). */
export const DEFAULT_INVOICE_READINESS: InvoiceReadiness = {
  INDIVIDUAL: ["name", "addressLine", "city", "stateCode"],
  CORPORATE: ["name", "contactPerson", "addressLine", "city", "stateCode", "gstin"],
};

/** ⚠️ 12 months matches the demo: on 5 Oct 2026, Jun 2027 shows "renew soon" and Aug 2029 doesn't. */
export const DEFAULT_EXPIRY_WARNINGS: ExpiryWarnings = { passportRenewSoonMonths: 12 };

export interface ClientSettings {
  invoiceReadiness: InvoiceReadiness;
  expiryWarnings: ExpiryWarnings;
}

/** Current settings. A missing or invalid row falls back to the default. */
export async function getClientSettings(db: Db = prisma): Promise<ClientSettings> {
  const rows = await db.setting.findMany({ where: { key: { in: [INVOICE_READINESS_KEY, EXPIRY_WARNINGS_KEY] } } });
  const value = (key: string) => rows.find((r) => r.key === key)?.value;
  const readiness = invoiceReadinessSchema.safeParse(value(INVOICE_READINESS_KEY));
  const expiry = expiryWarningsSchema.safeParse(value(EXPIRY_WARNINGS_KEY));
  return {
    invoiceReadiness: readiness.success ? readiness.data : DEFAULT_INVOICE_READINESS,
    expiryWarnings: expiry.success ? expiry.data : DEFAULT_EXPIRY_WARNINGS,
  };
}
