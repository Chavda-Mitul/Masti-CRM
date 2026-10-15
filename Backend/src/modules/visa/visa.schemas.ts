import { z } from "zod";
import { DocketKind, DocumentArrival, DocumentCheck, DocumentStatus, EntryType, InvoiceTaxType, ReceivedAs } from "../../../generated/prisma/enums";

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

/**
 * The visa invoice (docs/decisions/0009-visa-invoice.md Decisions 3 and 4): Masti's number series (MVI + 8 digits,
 * continuing from startAt) and GST on the service charge. The quote's GST preview reads the rate.
 */
export const invoiceSettingSchema = z.object({
  prefix: z.string().regex(/^[A-Z]{1,8}$/, "Use 1–8 capital letters, e.g. MVI."),
  digits: z.number().int().min(4).max(12),
  startAt: z.number().int().min(1).max(2_000_000_000),
  gstRatePercent: z
    .number()
    .min(0)
    .max(28)
    .refine((r) => Math.abs(r * 100 - Math.round(r * 100)) < 1e-9, "At most 2 decimals."),
  sac: z.string().regex(/^\d{4,8}$/, "4–8 digits, e.g. 998559."),
});

/**
 * When the processor confirms the vendor got the docket (0008 Decision 9): the next open office day, afterDays after
 * dispatch, at `at` (IST). The demo's "Tomorrow 11:00".
 */
export const vendorConfirmSchema = firstFollowUpSchema;

/**
 * When an e-visa comes back to its processor to check the portal (0008 Decision 11): the next open office day, afterDays
 * after "Submitted online", at `at` (IST). Its own setting, so it changes apart from the vendor confirmation.
 */
export const onlineCheckSchema = firstFollowUpSchema;

/** The courier's slip (AWB) number (0008 Decision 6): capitals and digits, between these lengths. */
export const awbSettingSchema = z
  .object({ minLength: z.number().int().min(1).max(40), maxLength: z.number().int().min(1).max(40) })
  .refine((s) => s.minLength <= s.maxLength, { message: "The shortest can't be longer than the longest.", path: ["minLength"] });

/** The {tokens} the vendor email's wording may use, filled in for each docket. */
export const DOCKET_EMAIL_TOKENS = ["docketNo", "files", "passports", "vendor", "company"] as const;

const emailWording = (max: number) =>
  z
    .string()
    .trim()
    .min(1, "Can't be blank.")
    .max(max, `${max} characters at most.`)
    .refine(
      (s) => [...s.matchAll(/\{([^}]*)\}/g)].every((m) => (DOCKET_EMAIL_TOKENS as readonly string[]).includes(m[1]!)),
      `Use only ${DOCKET_EMAIL_TOKENS.map((t) => `{${t}}`).join(", ")}.`,
    );

/**
 * The email to the vendor at dispatch (0008 Decision 8): its wording ⚠️, each part with {tokens} filled in per docket.
 * The table of files between the opening and the closing is laid out by the code.
 */
export const docketEmailSettingSchema = z.object({
  subject: emailWording(200),
  greeting: emailWording(200),
  opening: emailWording(500),
  closing: emailWording(500),
});

export const visaSettingsSchema = z.object({
  firstFollowUp: firstFollowUpSchema,
  finalFile: finalFileSchema,
  docket: docketSettingSchema,
  sticker: stickerSettingSchema,
  invoice: invoiceSettingSchema,
  vendorConfirm: vendorConfirmSchema,
  onlineCheck: onlineCheckSchema,
  awb: awbSettingSchema,
  docketEmail: docketEmailSettingSchema,
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
export type InvoiceSetting = z.infer<typeof invoiceSettingSchema>;
export type VendorConfirmSetting = z.infer<typeof vendorConfirmSchema>;
export type OnlineCheckSetting = z.infer<typeof onlineCheckSchema>;
export type AwbSetting = z.infer<typeof awbSettingSchema>;
export type DocketEmailSetting = z.infer<typeof docketEmailSettingSchema>;
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

/** "Submitted online" (Decision 11), for an e-visa: sends the case's updatedAt, like "Add to docket". */
export const submitOnlineSchema = matureCaseSchema;

export type AddToDocketInput = z.infer<typeof addToDocketSchema>;
export type TakeOutOfDocketInput = z.infer<typeof takeOutOfDocketSchema>;
export type SubmitOnlineInput = z.infer<typeof submitOnlineSchema>;

/**
 * "Dispatch docket" (Decision 9): the courier, its slip number when it needs one (spaces dropped, made capitals; the
 * length rule is the setting visa.awb), and the case numbers the dialog showed, so a file added or taken out meanwhile
 * makes it stale.
 */
export const dispatchDocketSchema = z.object({
  courierId: z.number("Pick the courier.").int().positive("Pick the courier."),
  awbNo: z
    .string()
    .transform((s) => s.replace(/\s+/g, "").toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]*$/, "Use only letters and digits."))
    .transform((s) => s || null)
    .nullish(),
  caseNos: z.array(z.string().trim().toUpperCase().min(1).max(40)).min(1).max(200),
});

export type DispatchDocketInput = z.infer<typeof dispatchDocketSchema>;

// ---------------------------------------------------------------------------
// The quote (docs/decisions/0009-visa-invoice.md Decision 2). Money is in paise, as integers.
// ---------------------------------------------------------------------------

/** ₹10,00,000 per amount: a sanity limit, not a business rule (checked in the database too). */
export const MAX_AMOUNT_PAISE = 100_000_000;

/**
 * ₹1,00,00,000 for the travellers' amounts and the service charge together: a sanity limit, not a business rule. With
 * GST (at most 28%) on the service charge, the invoice's total then always fits its column (an INTEGER, ₹2.14 crore).
 */
export const MAX_QUOTE_PAISE = 1_000_000_000;

const paise = z
  .number("Enter an amount.")
  .int("Whole paise only.")
  .min(0, "Can't be below 0.")
  .max(MAX_AMOUNT_PAISE, "₹10,00,000 at most.");

/** One traveller's amount: a lump sum, or itemised. Fields of the other form are refused, not ignored. */
const quoteLineSchema = z.discriminatedUnion("form", [
  z.strictObject({ travellerId: z.uuid(), form: z.literal("LUMP_SUM"), lumpSumPaise: paise }),
  z.strictObject({ travellerId: z.uuid(), form: z.literal("ITEMISED"), embassyFeePaise: paise, vfsFeePaise: paise, otherFeePaise: paise }),
]);

/**
 * Saving the whole quote. `updatedAt` is the quote's own token: null for a new quote, else the quote's updatedAt as the
 * page loaded it (a change by someone else in between is a 409 STALE).
 */
export const saveQuoteSchema = z
  .object({
    processingSpeedId: z.number("Pick the processing speed.").int().positive("Pick the processing speed."),
    serviceChargePaise: paise,
    lines: z.array(quoteLineSchema).min(1, "Give every traveller an amount.").max(MAX_ADULTS + MAX_CHILDREN),
    updatedAt: z.iso.datetime("Reload and try again.").nullable(),
  })
  .refine(
    (q) =>
      q.lines.reduce((sum, l) => sum + (l.form === "LUMP_SUM" ? l.lumpSumPaise : l.embassyFeePaise + l.vfsFeePaise + l.otherFeePaise), 0) +
        q.serviceChargePaise <=
      MAX_QUOTE_PAISE,
    { path: ["lines"], message: "The quote comes to more than ₹1,00,00,000 before GST." },
  );

export type SaveQuoteInput = z.infer<typeof saveQuoteSchema>;

/**
 * Raising the invoice (docs/decisions/0009-visa-invoice.md): what the dialog showed, sent back (the quote's updatedAt,
 * the GST rate, the tax type and the total), so an invoice is never made from amounts nobody saw.
 */
export const raiseInvoiceSchema = z.object({
  quoteUpdatedAt: z.iso.datetime("Reload and try again."),
  taxType: z.enum(InvoiceTaxType, "Reload and try again."),
  gstRatePercent: z.number("Reload and try again."),
  totalPaise: z.number("Reload and try again.").int("Reload and try again."),
});

export type RaiseInvoiceInput = z.infer<typeof raiseInvoiceSchema>;
