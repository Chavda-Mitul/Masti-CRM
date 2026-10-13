import { prisma, type Db } from "../../config/prisma";
import { companyDetailsSchema, invoiceTermsSchema, type CompanyDetails, type InvoiceTerms } from "./company.schemas";

// Masti's own details, and the invoice's terms, which the Head can change without a deploy (§7 rule 1). One Setting row
// each.

export const COMPANY_DETAILS_KEY = "company.details";
export const INVOICE_TERMS_KEY = "invoice.terms";

/**
 * Given by Masti on 13 Oct 2026 (through the project lead). The tax and bank details start empty: the Head types them
 * in (decided 13 Oct 2026), so nothing like a bank account number lives in the code.
 */
export const DEFAULT_COMPANY_DETAILS: CompanyDetails = {
  name: "MASTI TOUR AND TRAVEL",
  address: "301, Maitri, Opp. Canara Bank, Nr. Panchratna Tower, L.H. Road, Varachha, Surat-395006, (Guj.) INDIA",
  phone: "+91-93777-57580",
  phone2: null,
  email: null,
  website: null,
  pan: null,
  gstin: null,
  stateCode: null,
  bank: null,
};

/** ⚠️ The five terms on Masti's current invoices (0009 Decision 8): generic wording, edited by the Head. */
export const DEFAULT_INVOICE_TERMS: InvoiceTerms = {
  lines: [
    "Subject to Surat jurisdiction.",
    "Without original invoice no refund is permissible.",
    "Interest @ 24% will be charged on delayed payment.",
    "Cheque to be drawn in favour of the company name.",
    "Kindly check all details carefully to avoid unnecessary complications.",
  ],
};

/** The current details. A missing or invalid row falls back to the default. */
export async function getCompanyDetails(db: Db = prisma): Promise<CompanyDetails> {
  const row = await db.setting.findUnique({ where: { key: COMPANY_DETAILS_KEY } });
  const parsed = companyDetailsSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : DEFAULT_COMPANY_DETAILS;
}

export async function getInvoiceTerms(db: Db = prisma): Promise<InvoiceTerms> {
  const row = await db.setting.findUnique({ where: { key: INVOICE_TERMS_KEY } });
  const parsed = invoiceTermsSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : DEFAULT_INVOICE_TERMS;
}

/**
 * What the first invoice still needs from Masti's details (0009 Decision 8), in the order the card shows them. Raising
 * an invoice (component 3) is refused while this isn't empty.
 */
export function invoiceMissing(details: CompanyDetails, images: { logo: unknown; signature: unknown }): string[] {
  return [
    !details.pan && "PAN",
    !details.gstin && "GSTIN",
    !details.stateCode && "State",
    !details.bank && "Bank details",
    !images.logo && "Logo",
    !images.signature && "Signature",
  ].filter((label): label is string => typeof label === "string");
}
