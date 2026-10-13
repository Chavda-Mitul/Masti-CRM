import { z } from "zod";

// Only zod is imported here, so these schemas can later be shared with the frontend.

const line = (max: number) => z.string().trim().min(1, "Can't be blank.").max(max, `${max} characters at most.`);

/**
 * Masti's own details (docs/decisions/0008-visa-docket-dispatch.md Decision 5): the "From" on the parcel sticker, and
 * later the invoice header (0009 adds the GSTIN and the rest). Data, not a reason or a status, so text is allowed.
 */
export const companyDetailsSchema = z.object({
  name: line(100),
  address: line(300),
  phone: line(30),
});

export const updateCompanyDetailsSchema = companyDetailsSchema.partial();

export type CompanyDetails = z.infer<typeof companyDetailsSchema>;
export type UpdateCompanyDetailsInput = z.infer<typeof updateCompanyDetailsSchema>;
