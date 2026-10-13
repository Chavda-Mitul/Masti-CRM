import { z } from "zod";
import { DocketKind, DocumentArrival, DocumentCheck, DocumentStatus, EntryType, ReceivedAs } from "../../../generated/prisma/enums";

// Only zod and the generated enums are imported here, so these schemas can later be shared with the frontend.

/** Sanity limits on the travellers per case, not business rules. */
export const MAX_ADULTS = 30;
export const MAX_CHILDREN = 30;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm, e.g. 11:00.");

/** When the first follow-up of a new visa enquiry is due: afterDays days later, at `at` (IST). */
export const firstFollowUpSchema = z.object({
  afterDays: z.number().int().min(0).max(30),
  at: hhmm,
});

/** The largest final file (one PDF) a case can keep (docs/decisions/0007-visa-file-prep.md Decision 8). */
export const finalFileSchema = z.object({
  maxMb: z.number().int().min(1).max(200),
});

/** Docket numbers, "D-2026-0001" (docs/decisions/0008-visa-docket-dispatch.md Decision 7): the prefix is letters only. */
export const docketSettingSchema = z.object({
  prefix: z.string().regex(/^[A-Z]{1,8}$/, "Use 1–8 capital letters, e.g. D."),
});

/** The parcel sticker's size in millimetres (0008 Decision 5): a 100 × 150 mm thermal label by default. */
const stickerMm = z.number().int().min(50, "50 mm at least.").max(300, "300 mm at most.");
export const stickerSettingSchema = z.object({ widthMm: stickerMm, heightMm: stickerMm });

export const visaSettingsSchema = z.object({
  firstFollowUp: firstFollowUpSchema,
  finalFile: finalFileSchema,
  docket: docketSettingSchema,
  sticker: stickerSettingSchema,
});
export const updateVisaSettingsSchema = visaSettingsSchema.partial();

/** "Save enquiry" on the New enquiry form. The mobile is normalised by the service (same message as the clients module). */
export const createVisaCaseSchema = z
  .object({
    mobile: z.string().trim().min(1, "Enter the client's mobile number.").max(20),
    /** Needed when the number is new; never overwrites an existing client's name. */
    clientName: z.string().trim().max(150).nullish(),
    sourceCode: z.string().trim().min(1, "Pick where the enquiry came in.").max(40),
    offeringId: z.number().int().positive("Pick a country and visa type."),
    adults: z.number().int().min(1, "At least one adult travels.").max(MAX_ADULTS),
    children: z.number().int().min(0).max(MAX_CHILDREN),
    travelMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick the travel month."),
    travelDate: z.iso.date("Use a valid date.").nullish(),
  })
  .refine((v) => !v.travelDate || v.travelDate.slice(0, 7) === v.travelMonth, {
    path: ["travelDate"],
    message: "The travel date must fall in the travel month.",
  });

/** Idempotency-Key header: any short opaque token (the frontend sends a UUID). */
export const idempotencyKeySchema = z.string().trim().min(8).max(100).optional();

export type FirstFollowUp = z.infer<typeof firstFollowUpSchema>;
export type FinalFileSetting = z.infer<typeof finalFileSchema>;
export type DocketSetting = z.infer<typeof docketSettingSchema>;
export type StickerSetting = z.infer<typeof stickerSettingSchema>;
export type VisaSettings = z.infer<typeof visaSettingsSchema>;
export type UpdateVisaSettingsInput = z.infer<typeof updateVisaSettingsSchema>;
export type CreateVisaCaseInput = z.infer<typeof createVisaCaseSchema>;

// ---------------------------------------------------------------------------
// Step 2 (docs/decisions/0006-visa-documents.md)
// ---------------------------------------------------------------------------

/** Ticking one paper on a traveller's checklist (Decision 2). The service checks status against the requirement. */
export const updateCaseDocumentSchema = z.object({
  status: z.enum(DocumentStatus),
  /** Needed for RECEIVED: what came in. */
  receivedAs: z.enum(ReceivedAs).nullish(),
});

/** Naming a traveller: linking the client's family member (Decision 3). */
export const linkTravellerSchema = z.object({
  memberId: z.uuid("Pick the family member."),
});

export type UpdateCaseDocumentInput = z.infer<typeof updateCaseDocumentSchema>;
export type LinkTravellerInput = z.infer<typeof linkTravellerSchema>;

const booklets = z.number().int().min(0, "Can't be below 0.").max(50, "50 at most.").nullable().optional();

/** How the documents reach us, and booklets received (Decision 4). Booklets are optional (amended 10 Oct 2026). */
export const updateVisaCaseSchema = z.object({
  arrival: z.enum(DocumentArrival).nullable().optional(),
  bookletsCurrent: booklets,
  bookletsOld: booklets,
});

export type UpdateVisaCaseInput = z.infer<typeof updateVisaCaseSchema>;

/** "Mark documents complete" (Decision 8). Sends the updatedAt the page loaded: a change by someone else is a 409 STALE. */
export const matureCaseSchema = z.object({
  updatedAt: z.iso.datetime("Reload and try again."),
});

export type MatureCaseInput = z.infer<typeof matureCaseSchema>;

/** "File ready — add to docket" (0007 Decision 9) sends the case's updatedAt, like maturity. */
export const fileReadySchema = matureCaseSchema;

export type FileReadyInput = z.infer<typeof fileReadySchema>;

// ---------------------------------------------------------------------------
// Step 3 (docs/decisions/0007-visa-file-prep.md)
// ---------------------------------------------------------------------------

/**
 * The processor's check of one paper (Decision 3): Checked, or Needs replacing with a reason from the master list;
 * null sets it back to "to check". The reason is ignored unless the paper needs replacing.
 */
export const checkCaseDocumentSchema = z
  .object({
    check: z.enum(DocumentCheck).nullable(),
    reasonId: z.number().int().positive().nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.check === "NEEDS_REPLACING" && v.reasonId == null) {
      ctx.addIssue({ code: "custom", path: ["reasonId"], message: "Pick what's wrong with it." });
    }
  });

export type CheckCaseDocumentInput = z.infer<typeof checkCaseDocumentSchema>;

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const somethingToChange = (v: object) => Object.values(v).some((value) => value !== undefined);

/**
 * Trip details (Decision 4). Each field is optional (only what changed is sent) and null clears it. The service checks
 * the dates against today and against each other, on the values as stored.
 */
export const updateTripSchema = z
  .object({
    departOn: z.iso.date("Use a valid date.").nullable().optional(),
    returnOn: z.iso.date("Use a valid date.").nullable().optional(),
    entryType: z.enum(EntryType).nullable().optional(),
    /** The hotel's name and city: data for the forms, so short text is allowed here (not a reason or a status). */
    hotelStay: z.preprocess(blankToNull, z.string().trim().max(200, "200 characters at most.").nullable()).optional(),
  })
  .refine(somethingToChange, { message: "Nothing to change." });

export type UpdateTripInput = z.infer<typeof updateTripSchema>;

/** "fra1 mu2026 0648" is FRA1MU20260648: spaces go, letters become capitals. Blank clears it. */
const ackNo = z.preprocess(
  (value) => (typeof value === "string" ? value.replace(/\s+/g, "").toUpperCase() || null : value),
  z.string().regex(/^[A-Z0-9]{4,40}$/, "Capitals and digits only, 4–40 characters.").nullable(),
);

/**
 * One traveller's portal details (Decision 5): the acknowledgement number, and the appointment as a day and a time in
 * India (as follow-ups are sent). null clears either.
 */
export const updateApplicationSchema = z
  .object({
    ackNo: ackNo.optional(),
    appointment: z
      .object({
        on: z.iso.date("Pick the day."),
        at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick the time."),
      })
      .nullable()
      .optional(),
  })
  .refine(somethingToChange, { message: "Nothing to change." });

export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;

/** The case's vendor (Decision 7), from the active vendors covering its country. null clears the pick. */
export const setVendorSchema = z.object({
  vendorId: z.number("Pick a vendor.").int().positive("Pick a vendor.").nullable(),
});

export type SetVendorInput = z.infer<typeof setVendorSchema>;

// ---------------------------------------------------------------------------
// Step 4 (docs/decisions/0008-visa-docket-dispatch.md)
// ---------------------------------------------------------------------------

/**
 * "Add to docket" (Decision 2): GROUP joins the vendor's shared open docket ("Several files in one"), OWN starts a
 * docket holding just this case ("One file per docket"). Sends the case's updatedAt, like "File ready".
 */
export const addToDocketSchema = z.object({
  mode: z.enum(DocketKind, "Pick how this file goes."),
  updatedAt: z.iso.datetime("Reload and try again."),
});

/** "Take out of docket" (Decision 10), while the docket is open. */
export const takeOutOfDocketSchema = matureCaseSchema;

export type AddToDocketInput = z.infer<typeof addToDocketSchema>;
export type TakeOutOfDocketInput = z.infer<typeof takeOutOfDocketSchema>;
