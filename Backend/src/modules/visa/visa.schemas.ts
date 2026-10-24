import { z } from "zod";
import { DocketKind, DocumentArrival, DocumentCheck, DocumentStatus, EntryType, InvoiceTaxType, ReceivedAs, StickerCheck, VisaOutcome } from "../../../generated/prisma/enums";
import { confirmWarnings, PERSON_NAME_MESSAGE, PERSON_NAME_PATTERN, timeOfDay } from "../../lib/shared.schemas";
import { letterTextSchema } from "../coveringLetters/coveringLetters.schemas";

// Only zod and the generated enums are imported here, so these schemas can later be shared with the frontend.

/** Sanity limits on the travellers per case, not business rules. */
export const MAX_ADULTS = 30;
export const MAX_CHILDREN = 30;

/** When the first follow-up of a new visa enquiry is due: afterDays days later, at `at` (IST). */
export const firstFollowUpSchema = z.object({
  afterDays: z.number().int().min(0).max(30),
  at: timeOfDay,
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
 * The credit note's own number series (docs/decisions/0011-visa-at-vendor.md Decision 5): Masti had none, so it starts
 * at startAt. Never restarted by year, like the invoice's.
 */
export const creditNoteSettingSchema = z.object({
  prefix: z.string().regex(/^[A-Z]{1,8}$/, "Use 1–8 capital letters, e.g. MCN."),
  digits: z.number().int().min(4).max(12),
  startAt: z.number().int().min(1).max(2_000_000_000),
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

/**
 * When a file the vendor got comes back to its processor for the file number, when no traveller has an appointment still
 * to come (docs/decisions/0011-visa-at-vendor.md Decision 2): the next open office day, afterDays on, at `at` (IST).
 */
export const submissionCheckSchema = firstFollowUpSchema;

/**
 * When a recalled file comes back to its processor to chase the vendor for the papers (0011 Decision 6): the next open
 * office day, afterDays after the recall, at `at` (IST).
 */
export const recallReturnSchema = firstFollowUpSchema;

/**
 * When a decided file comes back to its processor to check the passports are on their way back
 * (docs/decisions/0012-visa-decision.md Decision 7): the next open office day, afterDays after the decision, at `at` (IST).
 */
export const passportsBackCheckSchema = firstFollowUpSchema;

/**
 * When passports on their way back come back to their processor (docs/decisions/0013-visa-passport-back.md
 * Decision 3): the next open office day, afterDays after the expected day, at `at` (IST).
 */
export const arrivalCheckSchema = firstFollowUpSchema;

/**
 * How long a passport must still run after the trip comes back (decided 19 Oct 2026; many embassies want 3 to 6
 * months): less is a warning when a traveller is linked, when the return changes, and at File ready.
 */
export const passportValiditySchema = z.object({ monthsAfterReturn: z.number().int().min(0).max(24) });

/**
 * The age from which a traveller counts as an adult for the warnings (decided 19 Oct 2026; embassies differ): an adult
 * linked into a child's place or a child into an adult's, and a child picked as who collected the passports.
 */
export const childAgeSchema = z.object({ adultFrom: z.number().int().min(1).max(25) });

/**
 * About how many working days after the decision the passports reach our office, as the decision messages (10–12) tell
 * the client (docs/whatsapp-visa-messages.md point 4, still open with Masti).
 */
export const passportsArriveSchema = z.object({ workingDays: z.number().int().min(1).max(30) });

/**
 * The covering letter's print (docs/decisions/0019-covering-letters.md Decision 11): the blank space at the top of the
 * first page for the client's letterhead, in millimetres. The print page's "Plain paper" leaves it out.
 */
export const coveringLetterSettingSchema = z.object({
  letterheadMm: z.number().int("Whole millimetres.").min(0, "0 mm at least.").max(120, "120 mm at most."),
});

/**
 * When a matured case is due with the Visa HOD to be given to a processor (docs/decisions/0006-visa-documents.md,
 * amended 16 Oct 2026): the next open office day, afterDays after maturity, at `at` (IST).
 */
export const assignCheckSchema = firstFollowUpSchema;

/**
 * When a file marked File ready is due with its processor for the docket and dispatch (0007 Decision 9, amended
 * 21 Oct 2026): the next open office day, afterDays after File ready, at `at` (IST).
 */
export const dispatchCheckSchema = firstFollowUpSchema;

/**
 * When received passports come back to their processor to arrange the handover (0013 Decision 5): the next open
 * office day, afterDays after they were received, at `at` (IST).
 */
export const handoverCheckSchema = firstFollowUpSchema;

/** The largest receiver photo the server takes, in MB (0014 Decision 6); the browser shrinks photos well below it. */
export const handoverPhotoSchema = z.object({
  maxMb: z.number().int().min(1).max(20),
});

/**
 * When a submitted file comes back to its processor before the expected collection date (0011 Decision 4): the open office
 * day daysBefore the date, at `at` (IST). The meeting's "reminded a day before to check with the vendor".
 */
export const collectionCheckSchema = z.object({
  daysBefore: z.number().int().min(0).max(30),
  at: timeOfDay,
});

/** How a reminder reaches the client. */
export const REMINDER_CHANNELS = ["WHATSAPP", "SMS"] as const;

/**
 * Pending-document reminders to the client (0003 Decision 7, 0006 amendment 19): on or off for every case, every
 * everyDays days after the document list, at sendAt (IST), on WhatsApp or SMS. Nothing is sent until WhatsApp is
 * connected.
 */
export const documentRemindersSchema = z.object({
  enabled: z.boolean(),
  everyDays: z.number().int().min(1, "1 day at least.").max(30, "30 days at most."),
  sendAt: timeOfDay,
  channel: z.enum(REMINDER_CHANNELS, "Pick WhatsApp or SMS."),
});

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
  creditNote: creditNoteSettingSchema,
  vendorConfirm: vendorConfirmSchema,
  onlineCheck: onlineCheckSchema,
  submissionCheck: submissionCheckSchema,
  recallReturn: recallReturnSchema,
  passportsBackCheck: passportsBackCheckSchema,
  arrivalCheck: arrivalCheckSchema,
  assignCheck: assignCheckSchema,
  dispatchCheck: dispatchCheckSchema,
  handoverCheck: handoverCheckSchema,
  handoverPhoto: handoverPhotoSchema,
  collectionCheck: collectionCheckSchema,
  awb: awbSettingSchema,
  docketEmail: docketEmailSettingSchema,
  passportValidity: passportValiditySchema,
  childAge: childAgeSchema,
  passportsArrive: passportsArriveSchema,
  documentReminders: documentRemindersSchema,
  coveringLetter: coveringLetterSettingSchema,
});
export const updateVisaSettingsSchema = visaSettingsSchema.partial();

/** The covering letter to fill in on the case's card (docs/decisions/0019-covering-letters.md): one that fits, or the default. */
export const coveringLetterQuerySchema = z.object({ formatId: z.coerce.number().int().positive().optional() });

/**
 * "Make the letter" (0019 Decision 10, amendment 1): one of the covering letters that fit the case, the wording its text
 * started from (today's, or the made letter's), and the text as staff left it.
 */
export const makeCoveringLetterSchema = z.object({
  formatId: z.number("Pick a covering letter.").int().positive("Pick a covering letter."),
  versionId: z.number("Reload and try again.").int().positive("Reload and try again."),
  letter: letterTextSchema,
});

/** "Write the whole letter with AI" (0019 amendment 4): the letter as it stands on the card. */
export const writeLetterSchema = z.object({ letter: letterTextSchema });

/** "Save enquiry" on the New enquiry form. The mobile is normalised by the service (same message as the clients module). */
export const createVisaCaseSchema = z
  .object({
    mobile: z.string().trim().min(1, "Enter the client's mobile number.").max(20),
    /** Needed when the number is new; never overwrites an existing client's name. */
    clientName: z.string().trim().max(150).nullish(),
    /** "Use Rakesh Mehta": the number is this client's family member's own; it is saved there as an extra number. */
    familyClientId: z.uuid().nullish(),
    sourceCode: z.string().trim().min(1, "Pick where the enquiry came in.").max(40),
    offeringId: z.number().int().positive("Pick a country and visa type."),
    adults: z.number().int().min(1, "At least one adult travels.").max(MAX_ADULTS),
    children: z.number().int().min(0).max(MAX_CHILDREN),
    travelMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick the travel month."),
    travelDate: z.iso.date("Use a valid date.").nullish(),
    /** How urgent it is (docs/decisions/0003-visa-intake.md amendment 1): an active level; none is Normal. */
    urgencyId: z.number("Pick how urgent it is.").int().positive("Pick how urgent it is.").nullish(),
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
export type CreditNoteSetting = z.infer<typeof creditNoteSettingSchema>;
export type VendorConfirmSetting = z.infer<typeof vendorConfirmSchema>;
export type OnlineCheckSetting = z.infer<typeof onlineCheckSchema>;
export type SubmissionCheckSetting = z.infer<typeof submissionCheckSchema>;
export type RecallReturnSetting = z.infer<typeof recallReturnSchema>;
export type PassportsBackCheckSetting = z.infer<typeof passportsBackCheckSchema>;
export type ArrivalCheckSetting = z.infer<typeof arrivalCheckSchema>;
export type AssignCheckSetting = z.infer<typeof assignCheckSchema>;
export type DispatchCheckSetting = z.infer<typeof dispatchCheckSchema>;
export type HandoverCheckSetting = z.infer<typeof handoverCheckSchema>;
export type HandoverPhotoSetting = z.infer<typeof handoverPhotoSchema>;
export type CollectionCheckSetting = z.infer<typeof collectionCheckSchema>;
export type AwbSetting = z.infer<typeof awbSettingSchema>;
export type DocketEmailSetting = z.infer<typeof docketEmailSettingSchema>;
export type PassportValiditySetting = z.infer<typeof passportValiditySchema>;
export type ChildAgeSetting = z.infer<typeof childAgeSchema>;
export type PassportsArriveSetting = z.infer<typeof passportsArriveSchema>;
export type DocumentRemindersSetting = z.infer<typeof documentRemindersSchema>;
export type CoveringLetterSetting = z.infer<typeof coveringLetterSettingSchema>;
export type MakeCoveringLetterInput = z.infer<typeof makeCoveringLetterSchema>;
export type WriteLetterInput = z.infer<typeof writeLetterSchema>;
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
  /** Saving again past a warning (a passport that runs out too soon after the trip, an age that doesn't fit the place). */
  confirmWarnings,
});

export type UpdateCaseDocumentInput = z.infer<typeof updateCaseDocumentSchema>;
export type LinkTravellerInput = z.infer<typeof linkTravellerSchema>;
export type ConsentDetailsInput = z.infer<typeof consentDetailsSchema>;

const booklets = z.number().int().min(0, "Can't be below 0.").max(50, "50 at most.").nullable().optional();

/** How the documents reach us, and booklets received (Decision 4). Booklets are optional (amended 10 Oct 2026). */
export const updateVisaCaseSchema = z.object({
  arrival: z.enum(DocumentArrival).nullable().optional(),
  bookletsCurrent: booklets,
  bookletsOld: booklets,
});

export type UpdateVisaCaseInput = z.infer<typeof updateVisaCaseSchema>;

/** The case's Reminders switch (0006 amendment 19). A plain on/off, so no updatedAt, like a tick. */
export const setRemindersSchema = z.object({
  on: z.boolean("Say on or off."),
});

export type SetRemindersInput = z.infer<typeof setRemindersSchema>;

/** How urgent the case is (docs/decisions/0003-visa-intake.md amendment 1). A plain pick, like the Reminders switch. */
export const setUrgencySchema = z.object({
  urgencyId: z.number("Pick how urgent it is.").int().positive("Pick how urgent it is."),
});

export type SetUrgencyInput = z.infer<typeof setUrgencySchema>;

/** "Mark documents complete" (Decision 8). Sends the updatedAt the page loaded: a change by someone else is a 409 STALE. */
export const matureCaseSchema = z.object({
  updatedAt: z.iso.datetime("Reload and try again."),
});

export type MatureCaseInput = z.infer<typeof matureCaseSchema>;

/** "File ready — add to docket" (0007 Decision 9) sends the case's updatedAt, like maturity. */
/** "File ready" (0007 Decision 9): the case's updatedAt, and saving again past a warning (a passport that runs out too soon). */
export const fileReadySchema = matureCaseSchema.extend({ confirmWarnings });

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

/**
 * A traveller's consent form details (docs/decisions/0022-consent-form.md, part 1 and amendment 1), every field each
 * time: staff fill them in by asking the client. `answers` holds one answer per field in use, keyed by the field's id;
 * "" or null leaves one empty. The fields are a master, so the service checks each answer against its field (its kind,
 * and whether it's required). For a child, guardianId is the family member who agrees for them (amendment 2); it's
 * dropped for an adult. updatedAt is the person's, as the browser read it.
 */
export const consentDetailsSchema = z.object({
  answers: z.record(z.string().regex(/^\d+$/, "Reload and try again."), z.string().max(1000, "At most 1000 characters.").nullable()),
  guardianId: z.uuid("Pick the parent or guardian who agrees for them.").nullable().default(null),
  updatedAt: z.iso.datetime("Reload and try again."),
});

/** A partial update names at least one field (saving again past a warning, confirmWarnings, isn't a change). */
const somethingToChange = (v: object) => Object.entries(v).some(([key, value]) => key !== "confirmWarnings" && value !== undefined);

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
    /** Saving again past a warning (a passport that runs out too soon after the new return). */
    confirmWarnings,
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
    /** Saving again past a warning (an appointment on or after the departure day). */
    confirmWarnings,
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

// ---------------------------------------------------------------------------
// Step 5, at the vendor (docs/decisions/0011-visa-at-vendor.md)
// ---------------------------------------------------------------------------

/** "Vendor got it, papers checked" (Decision 2): sends the case's updatedAt. */
export const vendorReceivedSchema = matureCaseSchema;

/** The vendor's file number ⚠️ (Decision 4): spaces dropped, capitals; then capitals, digits, "-" and "/", 3–40. */
export const VENDOR_FILE_NO_PATTERN = /^[A-Z0-9][A-Z0-9/-]{2,39}$/;

/** The furthest ahead a collection date may be: a sanity limit, not a business rule. */
export const MAX_COLLECTION_DAYS_AHEAD = 366;

/**
 * "Submitted at the embassy" (Decisions 3 and 4): the vendor's file number, the embassy and the expected collection
 * date, saved together. The same body changes them later, at Step 5.
 */
export const saveSubmissionSchema = z.object({
  vendorFileNo: z
    .string("Enter the vendor's file number.")
    .transform((s) => s.replace(/\s+/g, "").toUpperCase())
    .pipe(
      z
        .string()
        .min(1, "Enter the vendor's file number.")
        .regex(VENDOR_FILE_NO_PATTERN, "Use 3–40 letters, digits, - or /, starting with a letter or digit."),
    ),
  embassyId: z.number("Pick the embassy.").int().positive("Pick the embassy."),
  collectionOn: z.iso.date("Pick the expected collection date."),
  updatedAt: z.iso.datetime("Reload and try again."),
  /** Saving again past a warning (a collection date on or after the day the trip begins). */
  confirmWarnings,
});

/**
 * "Cancel with a credit note" (Decision 5): the invoice and the total the dialog showed (a different one is refused),
 * and why, from the credit-note reasons list.
 */
export const cancelInvoiceSchema = z.object({
  invoiceNo: z.string().trim().toUpperCase().min(1).max(40),
  reasonId: z.number("Pick why it's cancelled.").int().positive("Pick why it's cancelled."),
  totalPaise: z.number().int().min(0),
});

/**
 * "Take the file back" (Decision 6): why, from the recall-reasons list, and the invoice and case as the dialog showed
 * them. `refunds` is only for the HOD's "Change refund": per traveller (the invoice's line position), what goes back.
 * `invoiceNo` is null when nothing can go back: a cancelled case whose invoice was already cancelled whole
 * (docs/decisions/0006-visa-documents.md amendment 15).
 */
export const recallSchema = z.object({
  invoiceNo: z.string().trim().toUpperCase().min(1).max(40).nullable(),
  reasonId: z.number("Pick why it's taken back.").int().positive("Pick why it's taken back."),
  refunds: z
    .array(z.object({ position: z.number().int().min(1), refundPaise: z.number().int().min(0).max(100_000_000) }))
    .max(60)
    .optional(),
  updatedAt: z.iso.datetime("Reload and try again."),
});

// ---------------------------------------------------------------------------
// Step 6: the decision (docs/decisions/0012-visa-decision.md)
// ---------------------------------------------------------------------------

/**
 * A sticker or e-visa number ⚠️ (Decision 3), once its spaces are made single and its letters capitals: capitals,
 * digits, spaces, "-" and "/", 3–40, starting and ending with a letter or digit.
 */
export const VISA_NO_PATTERN = /^[A-Z0-9][A-Z0-9 /-]{1,38}[A-Z0-9]$/;

/**
 * "Record the decision" (Decisions 2 and 6): every traveller's outcome at once, Approved or Refused, with nothing typed
 * (amended 23 Oct 2026, change request 21): an approved one's number and dates are added later with Change. The service
 * checks each traveller is the case's, once.
 */
export const recordDecisionSchema = z.object({
  outcomes: z
    .array(
      z.object({
        travellerId: z.string().trim().min(1).max(64),
        outcome: z.enum(VisaOutcome, "Pick Approved or Refused for everyone."),
      }),
    )
    .min(1, "Record a decision for everyone.")
    .max(60),
  updatedAt: z.iso.datetime("Reload and try again."),
  /** Saving again past a warning (an e-visa where everyone is refused closes the case, 0025 part 5). */
  confirmWarnings,
});

/**
 * "Change" on one traveller's row at Step 6 (Decision 6): the outcome, and for an approved one the number (cleaned up)
 * and the dates it's valid, each optional (Decision 3, amended 23 Oct 2026). Sends the case's updatedAt as the dialog
 * opened with it: a change by someone else since is a 409 STALE.
 */
export const changeDecisionSchema = z.object({
  outcome: z.enum(VisaOutcome, "Pick Approved or Refused."),
  visaNo: z
    .string()
    .transform((s) => s.trim().replace(/\s+/g, " ").toUpperCase())
    .pipe(z.string().regex(VISA_NO_PATTERN, "Use 3–40 letters, digits, spaces, - or /, starting and ending with a letter or digit."))
    .nullish(),
  validFrom: z.iso.date("Pick the date the visa is valid from.").nullish(),
  validTo: z.iso.date("Pick the date the visa is valid to.").nullish(),
  /** Once the passports are received, an approved traveller's sticker checked again (0013 Decision 5, amended 19 Oct). */
  stickerCheck: z.enum(StickerCheck, "Pick Matches or Doesn't match.").nullish(),
  updatedAt: z.iso.datetime("Reload and try again."),
  confirmWarnings,
});

/**
 * "Passports on the way back" (docs/decisions/0013-visa-passport-back.md Decision 3): the day the vendor collected
 * them and the day they're expected at our office. The service checks both against today, the dispatch and the
 * office calendar.
 */
export const sendPassportsBackSchema = z.object({
  collectedOn: z.iso.date("Pick the day the vendor collected the passports."),
  expectedOn: z.iso.date("Pick the day the passports are expected at our office."),
  updatedAt: z.iso.datetime("Reload and try again."),
});

/** A booklet count at receipt: whole booklets, 0–50 (as at intake). */
const bookletsBack = (what: string) =>
  z.number(`Count the ${what} booklets.`).int("Count whole booklets.").min(0, "Can't be below 0.").max(50, "50 at most.");

/**
 * "Mark received" (docs/decisions/0013-visa-passport-back.md Decision 5): the booklets counted at the office, current
 * and old, and each approved traveller's sticker checked against their name and dates. The service checks the
 * travellers.
 */
export const receivePassportsSchema = z.object({
  booklets: z.object({ current: bookletsBack("current"), old: bookletsBack("old") }),
  stickers: z
    .array(z.object({ travellerId: z.string().trim().min(1).max(64), check: z.enum(StickerCheck, "Pick Matches or Doesn't match.") }))
    .max(60),
  updatedAt: z.iso.datetime("Reload and try again."),
});

/**
 * "Received the rest" of a short return (docs/decisions/0013-visa-passport-back.md Decision 5, amended 17 Oct 2026):
 * the late booklets, current and old, added to our stock. The service checks each against what's still missing.
 */
export const receiveRestSchema = z.object({
  booklets: z.object({ current: bookletsBack("current"), old: bookletsBack("old") }),
  updatedAt: z.iso.datetime("Reload and try again."),
});

/** "Clear the shortfall" (same amendment): why the missing passports won't come back, picked from the list. */
export const clearShortfallSchema = z.object({
  reasonId: z.number("Pick why it won't come back.").int().positive("Pick why it won't come back."),
  updatedAt: z.iso.datetime("Reload and try again."),
});

export type RecordDecisionInput = z.infer<typeof recordDecisionSchema>;
export type ReceivePassportsInput = z.infer<typeof receivePassportsSchema>;
export type ReceiveRestInput = z.infer<typeof receiveRestSchema>;
export type ClearShortfallInput = z.infer<typeof clearShortfallSchema>;

/** Who collected the passports, by name, when it isn't a traveller on the case (0014 Decision 3). */
const receiverName = z
  .string()
  .trim()
  .min(2, "Enter the name of the person collecting.")
  .max(100, "100 characters at most.")
  .regex(PERSON_NAME_PATTERN, PERSON_NAME_MESSAGE);

/** The booklets handed over (0014 Decision 4): counted, and checked against our stock by the service. */
export const handOverBookletsSchema = z.object({ current: bookletsBack("current"), old: bookletsBack("old") });

/** Who collected the passports (0014 Decision 3): a traveller on the case, or someone else by name; exactly one. */
export const receiverSchema = z
  .object({ travellerId: z.string().trim().min(1).max(64).nullish(), name: receiverName.nullish() })
  .refine((r) => !!r.travellerId !== !!r.name, "Pick who collected the passports.");

/**
 * "Hand over to the client" at the office (docs/decisions/0014-visa-delivered.md Decisions 3 and 4): the booklets
 * counted (the service checks them against our stock), who collected them (a traveller on the case, or someone else by
 * name: exactly one) and the photo uploaded for it. The delivery boy hands over at the door from his phone (0015
 * phase 5, fieldJobs/field.schemas.ts).
 */
export const handOverSchema = z.object({
  mode: z.enum(["OFFICE"], "The delivery boy hands over from his phone."),
  booklets: handOverBookletsSchema,
  receiver: receiverSchema,
  photoId: z.string("Take a photo of the person collecting.").trim().min(1, "Take a photo of the person collecting.").max(64),
  updatedAt: z.iso.datetime("Reload and try again."),
  /** Saving again past a warning (a child picked as who collected). */
  confirmWarnings,
});
export type HandOverInput = z.infer<typeof handOverSchema>;

/** Where Google Maps lives: a share link (maps.app.goo.gl, goo.gl/maps) or a google.com / google.co.in maps address. */
const GOOGLE_HOSTS = new Set(["www.google.com", "google.com", "maps.google.com", "www.google.co.in", "google.co.in"]);

/** Is this a Google Maps link (docs/decisions/0015-field-staff-app.md Decision 3)? */
export function isGoogleMapsLink(text: string) {
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") return false;
    if (url.hostname === "maps.app.goo.gl") return true;
    if (url.hostname === "goo.gl") return url.pathname.startsWith("/maps");
    return GOOGLE_HOSTS.has(url.hostname) && url.pathname.startsWith("/maps");
  } catch {
    return false;
  }
}

/** The client's location in Google Maps, when they shared one: optional; blank means none. */
const mapLink = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z
    .string()
    .trim()
    .max(500, "That link is too long.")
    .refine(isGoogleMapsLink, "Paste a Google Maps link, e.g. https://maps.app.goo.gl/…")
    .nullish(),
);

/**
 * The collection or delivery boy's job (docs/decisions/0015-field-staff-app.md Decisions 2 and 3): who goes, on which
 * day and slot, and where (the address, and the client's Google Maps link if they shared one). The service checks
 * the boy, the day and the slot.
 */
export const changeFieldJobSchema = z.object({
  assigneeId: z.string("Pick who goes.").trim().min(1, "Pick who goes.").max(64),
  day: z.iso.date("Pick the day."),
  slotId: z.number("Pick the time slot.").int().positive("Pick the time slot."),
  address: z.string("Enter the address.").trim().min(1, "Enter the address.").max(300, "300 characters at most."),
  mapLink,
  updatedAt: z.iso.datetime("Reload and try again."),
});
/** "Book the collection boy" (phase 1) or "Book the delivery boy" (phase 2). */
export const bookFieldJobSchema = changeFieldJobSchema.extend({
  kind: z.enum(["PICKUP", "DELIVERY"], "Pick a pickup or a delivery."),
});
export type ChangeFieldJobInput = z.infer<typeof changeFieldJobSchema>;
export type BookFieldJobInput = z.infer<typeof bookFieldJobSchema>;
export type SendPassportsBackInput = z.infer<typeof sendPassportsBackSchema>;
export type ChangeDecisionInput = z.infer<typeof changeDecisionSchema>;
export type CancelInvoiceInput = z.infer<typeof cancelInvoiceSchema>;
export type RecallInput = z.infer<typeof recallSchema>;
export type VendorReceivedInput = z.infer<typeof vendorReceivedSchema>;
export type SaveSubmissionInput = z.infer<typeof saveSubmissionSchema>;

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

/**
 * The file's one additional invoice (Decision 7): extra charges picked from the list, each with its amount (no GST),
 * against the main invoice the dialog showed, with the total it showed.
 */
export const raiseAdditionalInvoiceSchema = z.object({
  mainInvoiceNo: z.string().trim().toUpperCase().min(1).max(40),
  charges: z
    .array(
      z.object({
        chargeId: z.number("Pick the charge.").int().positive("Pick the charge."),
        amountPaise: z.number("Enter the amount.").int().min(1, "Enter an amount above 0.").max(MAX_AMOUNT_PAISE, "At most ₹10,00,000 per charge."),
      }),
    )
    .min(1, "Add at least one charge.")
    .max(10, "At most 10 charges."),
  totalPaise: z.number().int().min(0),
});

export type RaiseAdditionalInvoiceInput = z.infer<typeof raiseAdditionalInvoiceSchema>;
