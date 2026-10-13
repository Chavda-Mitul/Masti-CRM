import { prisma, type Db } from "../../config/prisma";
import { companyDetailsSchema, type CompanyDetails } from "./company.schemas";

// Masti's own details, which the Head can change without a deploy (§7 rule 1). One row in the Setting table.

export const COMPANY_DETAILS_KEY = "company.details";

/** Given by Masti on 13 Oct 2026 (through the project lead). */
export const DEFAULT_COMPANY_DETAILS: CompanyDetails = {
  name: "MASTI TOUR AND TRAVEL",
  address: "301, Maitri, Opp. Canara Bank, Nr. Panchratna Tower, L.H. Road, Varachha, Surat-395006, (Guj.) INDIA",
  phone: "+91-93777-57580",
};

/** The current details. A missing or invalid row falls back to the default. */
export async function getCompanyDetails(db: Db = prisma): Promise<CompanyDetails> {
  const row = await db.setting.findUnique({ where: { key: COMPANY_DETAILS_KEY } });
  const parsed = companyDetailsSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : DEFAULT_COMPANY_DETAILS;
}
