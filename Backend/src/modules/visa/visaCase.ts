import type { Prisma } from "../../../generated/prisma/client";
import { fromDbDate } from "../../lib/dates";
import { lineTotalPaise, quoteTotals } from "../../lib/money";
import { maskMobile } from "../../lib/oneTimeCode";
import { toMemberDto } from "../clients/client";
import { scanKey, type CurrentScans } from "../clients/clientDocuments.service";
import { SCAN_RULE_SELECT, scanRulesOf } from "../clients/scanRules";
import type { ClientSettings } from "../clients/clients.settings";
import { toStageRef } from "../enquiries/enquiry";
import { countryLabel, offeringInclude } from "../visaMasters/visaMasters.service";
import type { DocumentRemindersSetting } from "./visa.schemas";
import { scansForFile, type PaperScanRow, type TravellerScanRow } from "./scansPdf";
import { missingBooklets } from "./shortfall";
import { decisionFileMaxMb } from "./travellerFiles";

// The visa case as the browser sees it (0003 "VisaCaseDto", extended for Step 2 by 0006). Its messages to the client
// come separately (GET /cases/:caseNo/messages, 0021), so their card can refresh by itself.

/** The steps documents are collected in: the Reminders card shows there (0006 amendment 19). */
export const COLLECTING_STAGES = ["ENQUIRY", "DOCUMENTS"];

/** The steps the scans are combined into the saved file in (0008 Amendment 1): the case shows how that went. */
const COMBINING_STAGES = ["FILE_PREPARATION", "DISPATCH"];

/**
 * Whether the case would get a pending-document reminder now (0006 amendment 19): reminders on in Settings and on the
 * case, the case open and still collecting, and a paper the client brings still pending (what we arrange is never
 * asked for). The same rule as the sweep that sends them (visaReminders.service.ts).
 */
export function remindersDue(row: VisaCaseRow, setting: DocumentRemindersSetting) {
  const visa = row.visa;
  if (!visa || !setting.enabled || !visa.remindersOn) return false;
  if (row.status !== "OPEN" || !COLLECTING_STAGES.includes(row.stage.code)) return false;
  return visa.travellers.some((t) => t.documents.some((d) => d.status === "PENDING" && d.requirement !== "ARRANGED_BY_US"));
}

/** The case page shows the latest follow-ups; older ones stay in the database and the audit log. */
export const CASE_FOLLOW_UPS = 20;

const personSelect = { select: { id: true, name: true } } as const;

/**
 * A send of the vendor email that started this long ago without recording its outcome (the server stopped mid-send)
 * is stuck, and may be retried: well past the SMTP timeouts in src/lib/email.ts.
 */
export const EMAIL_SENDING_STUCK_MS = 5 * 60_000;

/** Whether the docket's email is being sent right now: started, its outcome not recorded yet, and not stuck. */
export function emailSending(startedAt: Date | null, now = new Date()) {
  return !!startedAt && now.getTime() - startedAt.getTime() < EMAIL_SENDING_STUCK_MS;
}

/**
 * A case's invoices and whether a WHOLE credit note cancelled each (docs/decisions/0011-visa-at-vendor.md Decision 5).
 * Select them this way wherever "has its invoice" is asked (dispatch, Submitted online, the docket table), then ask
 * liveInvoiceNo: a cancelled invoice no longer counts. A case has one chain of invoices, so at most one stands.
 */
export const liveInvoicesArgs = {
  where: { kind: "MAIN" },
  select: { invoiceNo: true, creditNotes: { where: { kind: "WHOLE" }, select: { creditNoteNo: true } } },
} satisfies Prisma.InvoiceFindManyArgs;

/** The number of the case's standing invoice; null when there's none, or a credit note cancelled every one. */
export function liveInvoiceNo(invoices: { invoiceNo: string; creditNotes: unknown[] }[]) {
  return invoices.find((i) => i.creditNotes.length === 0)?.invoiceNo ?? null;
}

/** A docket and every case in it (0008): the Docket card's table and the parcel sticker read the same rows. */
export const docketSelect = {
  docketNo: true,
  kind: true,
  status: true,
  openedAt: true,
  vendor: { select: { name: true, city: true } },
  /** Dispatch (0008 Decision 9): set together when the docket is sent. */
  courier: { select: { name: true, awbNeeded: true } },
  awbNo: true,
  dispatchedAt: true,
  dispatchedBy: personSelect,
  /** The email to the vendor (Decision 8): sent, or why not. */
  vendorEmailSentAt: true,
  vendorEmailTo: true,
  vendorEmailError: true,
  vendorEmailSendingAt: true,
  cases: {
    orderBy: { enquiry: { caseNo: "asc" } },
    select: {
      enquiryId: true,
      bookletsCurrent: true,
      bookletsOld: true,
      enquiry: { select: { caseNo: true, ownerId: true, client: { select: { name: true } }, invoices: liveInvoicesArgs } },
      offering: { select: { country: { select: { name: true } } } },
      _count: { select: { travellers: true } },
    },
  },
} satisfies Prisma.DocketSelect;

export const visaCaseInclude = {
  department: { select: { code: true, name: true } },
  client: { select: { id: true, name: true, mobile: true, email: true, addressLine: true, area: true, city: true, pincode: true } },
  source: { select: { code: true, name: true } },
  fieldJobs: {
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    include: {
      assignee: { select: { id: true, name: true, mobile: true } },
      slot: { select: { id: true, name: true, startsAt: true, endsAt: true } },
      createdBy: personSelect,
      cancelledBy: personSelect,
      failReason: { select: { id: true, name: true } },
      selfie: { select: { id: true, fileName: true } },
    },
  },
  stage: true,
  owner: personSelect,
  createdBy: personSelect,
  reason: { select: { id: true, code: true, name: true, kind: true } },
  /**
   * The saved files (0007 Decision 8), newest first: the newest is the current one. A case has a handful, so all are
   * loaded: the copy made from the scans (0008 Amendment 1) is shown even when a newer upload replaced it.
   */
  files: { where: { kind: "FINAL_FILE" }, orderBy: [{ uploadedAt: "desc" }, { id: "desc" }], include: { uploadedBy: personSelect } },
  /** The tax invoices (0009), newest first: the last of the chain, then any it replaced (0011 Decision 5). */
  invoices: {
    orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
    select: {
      kind: true,
      invoiceNo: true,
      replaces: { select: { invoiceNo: true } },
      /** An additional invoice's extra charges (0011 Decision 7). */
      charges: { orderBy: { position: "asc" }, select: { name: true, amountPaise: true } },
      issuedOn: true,
      issuedAt: true,
      issuedBy: personSelect,
      taxType: true,
      cgstPaise: true,
      sgstPaise: true,
      igstPaise: true,
      totalPaise: true,
      file: { select: { id: true, fileName: true } },
      /** Its credit notes (0011 Decisions 5 and 6): the WHOLE one that cancelled it, and any PART ones (a recall). */
      creditNotes: {
        orderBy: { issuedAt: "asc" },
        select: {
          kind: true,
          creditNoteNo: true,
          issuedOn: true,
          issuedBy: personSelect,
          reason: { select: { code: true, name: true } },
          totalPaise: true,
          file: { select: { id: true, fileName: true } },
        },
      },
    },
  },
  followUps: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: CASE_FOLLOW_UPS,
    include: { outcome: { select: { name: true } }, nextStep: { select: { name: true } }, by: personSelect },
  },
  visa: {
    include: {
      offering: { include: offeringInclude },
      urgency: { select: { id: true, code: true, name: true } },
      maturedBy: personSelect,
      fileReadyBy: personSelect,
      submittedOnlineBy: personSelect,
      evisaSentBy: personSelect,
      vendorReceivedBy: personSelect,
      submittedBy: personSelect,
      embassy: { select: { id: true, name: true, city: true } },
      recalledBy: personSelect,
      recallReason: { select: { name: true } },
      decidedBy: personSelect,
      passportsInTransitBy: personSelect,
      passportsReceivedBy: personSelect,
      shortfallClearedBy: personSelect,
      shortfallReason: { select: { name: true } },
      handover: { include: { by: personSelect, receiverPhoto: { select: { id: true, fileName: true } } } },
      vendor: {
        select: {
          id: true,
          name: true,
          city: true,
          isActive: true,
          contactName: true,
          mobile: true,
          email: true,
          countries: { select: { countryId: true } },
          /** Its shared open docket (0008 Decision 2): "Add to docket" joins it. */
          dockets: { where: { status: "OPEN", kind: "GROUP" }, select: { docketNo: true, _count: { select: { cases: true } } } },
        },
      },
      /** Step 4 (0008 Decision 2): the docket this case goes in, with every case in it for the docket table. */
      docket: { select: docketSelect },
      /** The price (0009 Decision 2), per traveller and Masti's service charge. */
      quote: {
        include: { processingSpeed: { select: { id: true, name: true, isActive: true } }, updatedBy: personSelect, lines: true },
      },
      travellers: {
        orderBy: { position: "asc" },
        include: {
          member: {
            include: {
              relation: true,
              // With the parent or guardian who agreed for a child (0022 amendment 2).
              consent: { include: { guardian: { select: { name: true } } } },
              consentDetailsBy: personSelect,
              // The person's open "I agree" link (0022 part 2): at most one; a child's went to their guardian.
              consentLinks: {
                where: { usedAt: null, replacedAt: null },
                select: { createdAt: true, toMobile: true, guardian: { select: { name: true } } },
                take: 1,
              },
            },
          },
          documents: {
            orderBy: { sortOrder: "asc" },
            include: {
              receivedBy: personSelect,
              checkedBy: personSelect,
              checkReason: { select: { id: true, name: true } },
              clientDocument: { select: { id: true, uploadedAt: true } },
              /**
               * The master's switch and upload rules as they are now, so changing them reaches cases already open
               * (0016 Decision 7 and Amendment 1).
               */
              document: { select: { warnIfNoScan: true, ...SCAN_RULE_SELECT } },
            },
          },
          /** Refusal letters (0012 Decision 4) and e-visas (0025), newest first: the newest of each kind is current. */
          files: { orderBy: [{ uploadedAt: "desc" }, { id: "desc" }], include: { uploadedBy: personSelect } },
        },
      },
    },
  },
} satisfies Prisma.EnquiryInclude;

export type VisaCaseRow = Prisma.EnquiryGetPayload<{ include: typeof visaCaseInclude }>;

/** "Adult 1", "Child 1": placeholders until the traveller is linked to a family member in Step 2. */
export function travellerLabel(t: { position: number; isChild: boolean }, adults: number) {
  return t.isChild ? `Child ${t.position - adults}` : `Adult ${t.position}`;
}

/** "B-702, Raghuvir Residency, Vesu, Surat 395007": the client's address in one line, for a field job (0015). */
export function clientAddress(c: { addressLine: string | null; area: string | null; city: string | null; pincode: string | null }) {
  return [c.addressLine, c.area, [c.city, c.pincode].filter(Boolean).join(" ")].filter((part) => part && part.trim()).join(", ");
}

/** Who collected the passports (0014 Decision 3): the name typed in, or the traveller's as the case shows them. */
function receiverName(
  h: { receiverName: string | null; receiverTravellerId: string | null },
  travellers: { id: string; position: number; isChild: boolean; name: string | null }[],
  adults: number,
) {
  if (h.receiverName) return h.receiverName;
  const t = travellers.find((x) => x.id === h.receiverTravellerId);
  return t ? (t.name ?? travellerLabel(t, adults)) : "";
}

/** "Mehta" for "Rakesh Mehta": the client's last name, as the docket table and the saved file's name show it. */
export function familyName(clientName: string | null) {
  return clientName?.trim().split(/\s+/).at(-1) ?? "";
}

/** The last name as a file name may carry it: letters and digits only ("" for a name in Gujarati letters). */
export function fileSafeFamilyName(clientName: string | null) {
  return familyName(clientName).normalize("NFKD").replace(/[^A-Za-z0-9-]/g, "");
}

/** Adults and children among a case's travellers. */
export function countTravellers(travellers: { isChild: boolean }[]) {
  const children = travellers.filter((t) => t.isChild).length;
  return { adults: travellers.length - children, children };
}

/**
 * The travellers as the scans combined into the saved file read them (0008 Amendment 1, scansPdf.ts): named as the case
 * shows them ("Child 1" until named), with their papers in the checklist's order.
 */
export function scanTravellersOf(
  travellers: { position: number; isChild: boolean; name: string | null; memberId: string | null; member: { name: string } | null; documents: PaperScanRow[] }[],
): TravellerScanRow[] {
  const { adults } = countTravellers(travellers);
  return travellers.map((t) => ({ label: t.member?.name ?? t.name ?? travellerLabel(t, adults), memberId: t.memberId, documents: t.documents }));
}

/**
 * File preparation and Docket & dispatch (0008 Amendment 1): how many papers need a scan, whose are missing, and the
 * saved file made from them once it is (the newest copy the CRM made, even if an upload replaced it since).
 */
function combinedScansOf(row: VisaCaseRow, travellers: TravellerRow[], scans: CurrentScans) {
  const { found, missing } = scansForFile(scanTravellersOf(travellers), scans);
  const file = row.files.find((f) => f.scanCount !== null);
  return {
    needed: found.length + missing.reduce((n, m) => n + m.papers.length, 0),
    missing,
    file: file?.scanCount ? { id: file.id, scanCount: file.scanCount, pageCount: file.pageCount, at: file.uploadedAt, by: file.uploadedBy } : null,
  };
}

/** "2 adults, 1 child" */
export function travellersLabel(adults: number, children: number) {
  const part = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return children > 0 ? `${part(adults, "adult", "adults")}, ${part(children, "child", "children")}` : part(adults, "adult", "adults");
}

type TravellerRow = NonNullable<VisaCaseRow["visa"]>["travellers"][number];

/** A traveller's current file of one kind, the newest upload, and how many of that kind were uploaded. */
function currentFileOf(t: TravellerRow, kind: "REFUSAL_LETTER" | "EVISA" | "VISA_COPY") {
  const all = t.files.filter((f) => f.kind === kind);
  const file = all[0];
  if (!file) return null;
  return {
    id: file.id,
    fileName: file.fileName,
    sizeBytes: file.sizeBytes,
    pageCount: file.pageCount,
    uploadedAt: file.uploadedAt,
    uploadedBy: file.uploadedBy,
    copies: all.length,
  };
}

/**
 * A refused traveller's current refusal letter, and how many were uploaded. A traveller changed to Approved keeps their
 * letters, which aren't shown; changed back to Refused, they show again (0012 Decision 4).
 */
function refusalLetterOf(t: TravellerRow) {
  return t.outcome === "REFUSED" ? currentFileOf(t, "REFUSAL_LETTER") : null;
}

/**
 * An approved e-visa traveller's current e-visa, and how many were uploaded (docs/decisions/0025-evisa-after-decision.md).
 * Kept, like a refusal letter, when the outcome changes; shown only while they're approved.
 */
function evisaOf(t: TravellerRow, isEvisa: boolean) {
  return isEvisa && t.outcome === "APPROVED" ? currentFileOf(t, "EVISA") : null;
}

/**
 * An approved paper visa's current visa copy, the passport's visa page or the approval letter, and how many were
 * uploaded (0012, amended 24 Oct 2026, change request 21). Kept, like a refusal letter, when the outcome changes; shown
 * only while they're approved. An e-visa's is its e-visa.
 */
function visaCopyOf(t: TravellerRow, isEvisa: boolean) {
  return !isEvisa && t.outcome === "APPROVED" ? currentFileOf(t, "VISA_COPY") : null;
}

type VendorRow = NonNullable<NonNullable<VisaCaseRow["visa"]>["vendor"]>;

/** The case's vendor, and whether it still covers the case's country. */
function vendorOf(v: VendorRow, countryId: number) {
  const { id, name, city, isActive, contactName, mobile, email } = v;
  return { id, name, city, isActive, contactName, mobile, email, coversCountry: v.countries.some((c) => c.countryId === countryId) };
}

type DocketRow = Prisma.DocketGetPayload<{ select: typeof docketSelect }>;

/**
 * The docket table (0008 Decision 4). Passports are the current booklets counted in Step 2, or one per traveller when
 * nobody counted them; old passports go in the parcel too, so the totals count both. Other cases in the docket show
 * only their number, family name, country, passports and invoice number (0009 component 4: no file leaves without its
 * invoice), never their amounts.
 */
export function docketOf(d: DocketRow, enquiryId: string) {
  const cases = d.cases.map((c) => ({
    caseNo: c.enquiry.caseNo,
    family: familyName(c.enquiry.client.name),
    country: c.offering.country.name,
    passports: c.bookletsCurrent ?? c._count.travellers,
    oldPassports: c.bookletsOld ?? 0,
    /** "MVI00000001 · locked", or null: "Raise invoice first" */
    invoiceNo: liveInvoiceNo(c.enquiry.invoices),
    /** Who may dispatch (Decision 3): a processor who owns at least one case in the docket. */
    ownerId: c.enquiry.ownerId,
    isThisCase: c.enquiryId === enquiryId,
  }));
  return {
    docketNo: d.docketNo,
    kind: d.kind,
    status: d.status,
    /** "Open since 12 Oct, not sent yet" from the next day on. */
    openedAt: d.openedAt,
    vendor: d.vendor,
    /** null until dispatched; then the courier, its slip number (null for one with none), who and when. */
    courier: d.courier,
    awbNo: d.awbNo,
    dispatchedAt: d.dispatchedAt,
    dispatchedBy: d.dispatchedBy,
    /** null until dispatched; then when and to whom it went, or why it didn't ("Send again"), or that it's going now. */
    email:
      d.status === "DISPATCHED"
        ? { sentAt: d.vendorEmailSentAt, to: d.vendorEmailTo, error: d.vendorEmailError, sending: emailSending(d.vendorEmailSendingAt) }
        : null,
    cases,
    totalPassports: cases.reduce((sum, c) => sum + c.passports, 0),
    totalOldPassports: cases.reduce((sum, c) => sum + c.oldPassports, 0),
  };
}

type QuoteRow = NonNullable<NonNullable<VisaCaseRow["visa"]>["quote"]>;

/**
 * The quote with its totals (0009 Decisions 2 and 3): each traveller's amount, Masti's service charge, GST on the
 * service charge only (the rate setting), and the total. `complete` is false if a traveller has no line.
 */
function quoteOf(q: QuoteRow, travellerIds: string[], gstRatePercent: number) {
  const lines = q.lines.map((l) => ({
    travellerId: l.travellerId,
    form: l.form,
    lumpSumPaise: l.lumpSumPaise,
    embassyFeePaise: l.embassyFeePaise,
    vfsFeePaise: l.vfsFeePaise,
    otherFeePaise: l.otherFeePaise,
    totalPaise: lineTotalPaise(l),
  }));
  return {
    processingSpeed: q.processingSpeed,
    ...quoteTotals(q.lines, q.serviceChargePaise, gstRatePercent),
    gstRatePercent,
    lines,
    complete: travellerIds.every((id) => lines.some((l) => l.travellerId === id)),
    /** The quote's own token: send it back when saving. */
    updatedAt: q.updatedAt,
    updatedBy: q.updatedBy,
  };
}

type InvoiceRow = VisaCaseRow["invoices"][number];

/** One invoice for the case page: its totals and PDF, what it replaced, and the credit note that cancelled it. */
function invoiceOf(inv: InvoiceRow) {
  const note = inv.creditNotes.find((n) => n.kind === "WHOLE");
  const plain = (n: InvoiceRow["creditNotes"][number]) => ({
    creditNoteNo: n.creditNoteNo,
    issuedOn: fromDbDate(n.issuedOn),
    issuedBy: n.issuedBy,
    reason: n.reason.name,
    totalPaise: n.totalPaise,
    file: n.file,
  });
  return {
    invoiceNo: inv.invoiceNo,
    issuedOn: fromDbDate(inv.issuedOn),
    issuedAt: inv.issuedAt,
    issuedBy: inv.issuedBy,
    taxType: inv.taxType,
    gstPaise: inv.cgstPaise + inv.sgstPaise + inv.igstPaise,
    totalPaise: inv.totalPaise,
    file: inv.file,
    /** The cancelled invoice this one replaces (0011 Decision 5). */
    replaces: inv.replaces?.invoiceNo ?? null,
    /** Cancelled by a WHOLE credit note (0011 Decision 5): it no longer counts as the case's invoice. */
    cancelled: note ? plain(note) : null,
    /** What PART credit notes gave back on it (a recall, 0011 Decision 6); it still stands. */
    partCredits: inv.creditNotes.filter((n) => n.kind === "PART").map(plain),
  };
}

/** The vendor's shared open docket, while this case isn't in one: "Add to docket D-2026-0003 (2 cases)". */
function openDocketOf(vendor: VendorRow | null) {
  const open = vendor?.dockets[0];
  return open && open._count.cases > 0 ? { docketNo: open.docketNo, caseCount: open._count.cases } : null;
}

/**
 * The consent card (0006 Decision 5, 0022): the person's form details, which staff fill in, and their consent, which the
 * client gives through the "I agree" link (0022 part 2) or signed on paper before the CRM (part 3, paperYear). Flagged
 * until then. guardian: for a child, who the link went to and who agreed (amendment 2).
 */
function consentOf(t: TravellerRow) {
  if (!t.member) return { state: "UNLINKED" as const };
  const details = consentDetailsOf(t.member);
  const { consent } = t.member;
  if (!consent) {
    const open = t.member.consentLinks[0];
    const link = open ? { sentAt: open.createdAt, toMobile: open.toMobile, guardian: open.guardian?.name ?? null } : null;
    return { state: "NONE" as const, details, link };
  }
  const { id, agreedAt, paperYear } = consent;
  return { state: "ON_FILE" as const, id, agreedAt, paperYear, guardian: consent.guardian?.name ?? null, details };
}

/**
 * Whether the consent form's details are filled in (docs/decisions/0022-consent-form.md, part 1): filledAt stays null
 * until staff save the form. The form itself, its fields and answers, loads on its own (amendment 1).
 */
function consentDetailsOf(m: NonNullable<TravellerRow["member"]>) {
  return { filledAt: m.consentDetailsAt, filledBy: m.consentDetailsBy };
}

/**
 * @param steps the case's flow, in order: the step chips ("Enquiry → Documents → …")
 * @param today IST date, for the travellers' age and passport status
 * @param finalFileMaxMb the setting visa.finalFile.maxMb
 * @param gstRatePercent the setting visa.invoice.gstRatePercent, for the quote's GST
 * @param scans the current scan of each linked traveller's papers in the client's vault (currentScansOf)
 * @param reminders the setting visa.documentReminders, and when the next reminder goes out (null if none is due)
 */
export function toVisaCaseDto(
  row: VisaCaseRow,
  steps: { code: string; name: string }[],
  today: string,
  clientSettings: ClientSettings,
  finalFileMaxMb: number,
  gstRatePercent: number,
  scans: CurrentScans,
  reminders: { setting: DocumentRemindersSetting; nextAt: Date | null },
) {
  const finalFile = row.files[0];
  const visa = row.visa;
  if (!visa) throw new Error(`Enquiry ${row.caseNo} has no visa part.`);
  const { adults, children } = countTravellers(visa.travellers);
  // The main invoice's chain, and the additional invoice's (0011 Decision 7): newest first, each.
  const mainInvoices = row.invoices.filter((i) => i.kind === "MAIN");
  const additionalInvoices = row.invoices.filter((i) => i.kind === "ADDITIONAL");
  return {
    id: row.id,
    caseNo: row.caseNo,
    department: row.department,
    status: row.status,
    stage: toStageRef(row.stage, steps.length),
    steps,
    /** Send it back with every case action: a change by someone else in between is a 409 STALE. */
    updatedAt: row.updatedAt,
    reason: row.reason,
    resumeOn: row.resumeOn ? fromDbDate(row.resumeOn) : null,
    /** The client, with their email (the field boy's one-time code goes there, 0015) and address in one line. */
    client: { id: row.client.id, name: row.client.name, mobile: row.client.mobile, email: row.client.email, address: clientAddress(row.client) },
    /** The collection and delivery boy's jobs for this case (0015), newest first. */
    fieldJobs: row.fieldJobs.map((j) => ({
      id: j.id,
      kind: j.kind,
      status: j.status,
      assignee: j.assignee,
      day: fromDbDate(j.day),
      slot: j.slot,
      address: j.address,
      mapLink: j.mapLink,
      mobile: j.mobile,
      bookedAt: j.createdAt,
      bookedBy: j.createdBy,
      cancelledAt: j.cancelledAt,
      cancelledBy: j.cancelledBy,
      /** Done or couldn't complete (0015 phase 4): when, the place his phone gave, and why it failed. */
      finishedAt: j.finishedAt,
      place: j.latitude !== null && j.longitude !== null && j.accuracyM !== null ? { lat: j.latitude, lng: j.longitude, accuracy: j.accuracyM } : null,
      failReason: j.failReason,
      /** Done (0015 Decision 4): the booklets he counted, his selfie, and when the client confirmed the code. */
      counted: j.bookletsCurrent !== null && j.bookletsOld !== null ? { current: j.bookletsCurrent, old: j.bookletsOld } : null,
      selfie: j.selfie,
      otpConfirmedAt: j.otpConfirmedAt,
    })),
    source: row.source,
    origin: row.origin,
    offeringId: visa.offeringId,
    country: { id: visa.offering.country.id, name: visa.offering.country.name, zone: visa.offering.country.zone, label: countryLabel(visa.offering.country) },
    visaType: { id: visa.offering.visaType.id, name: visa.offering.visaType.name },
    /** The visa's switches (0007 Decision 6), read live: correcting one helps the cases already open. */
    appointmentNeeded: visa.offering.appointmentNeeded,
    vendorNeeded: visa.offering.vendorNeeded,
    adults,
    children,
    travelMonth: fromDbDate(visa.travelMonth).slice(0, 7),
    travelDate: visa.travelDate ? fromDbDate(visa.travelDate) : null,
    /** How urgent it is (0003 amendment 1): every level but Normal (NORMAL_URGENCY) shows as a red tag. */
    urgency: visa.urgency,
    /** Trip details (0007 Decision 4). The duration is worked out from the two dates. */
    trip: {
      departOn: visa.departOn ? fromDbDate(visa.departOn) : null,
      returnOn: visa.returnOn ? fromDbDate(visa.returnOn) : null,
      entryType: visa.entryType,
      hotelStay: visa.hotelStay,
    },
    owner: row.owner,
    dueAt: row.dueAt,
    arrival: visa.arrival,
    booklets: { current: visa.bookletsCurrent, old: visa.bookletsOld },
    /**
     * The Reminders card (0006 amendment 19): the case's switch, the setting, and the next one (null when none is due).
     * Nothing is sent until WhatsApp is connected.
     */
    reminders: {
      on: visa.remindersOn,
      enabled: reminders.setting.enabled,
      everyDays: reminders.setting.everyDays,
      sendAt: reminders.setting.sendAt,
      channel: reminders.setting.channel,
      nextAt: reminders.nextAt,
    },
    maturedAt: visa.maturedAt,
    maturedBy: visa.maturedBy,
    /** Step 3's saved file, kept as proof: the current one, how many were uploaded in all, and the size limit. */
    finalFile: finalFile
      ? {
          id: finalFile.id,
          fileName: finalFile.fileName,
          sizeBytes: finalFile.sizeBytes,
          pageCount: finalFile.pageCount,
          uploadedAt: finalFile.uploadedAt,
          uploadedBy: finalFile.uploadedBy,
        }
      : null,
    finalFileCopies: row.files.length,
    finalFileMaxMb,
    /** The largest refusal letter, visa copy or e-visa taken (travellerFiles.ts): the page checks it first. */
    decisionFileMaxMb: decisionFileMaxMb(finalFileMaxMb),
    /** The largest scan "Save scan" takes (clients.documents.maxMb, 0016 Decision 5): the page checks it first. */
    scanMaxMb: clientSettings.documents.maxMb,
    /**
     * The submission agent (Decision 7). isActive false, or coversCountry false (the case's country was taken off the
     * vendor since it was picked): "File ready" will ask for another.
     */
    vendor: visa.vendor && vendorOf(visa.vendor, visa.offering.country.id),
    /** "File ready — add to docket" (Decision 9): Step 3 is done and read-only. */
    fileReadyAt: visa.fileReadyAt,
    fileReadyBy: visa.fileReadyBy,
    /** Step 4 (0008): the docket this case is in, or else the vendor's shared open docket it would join. */
    docket: visa.docket && docketOf(visa.docket, row.id),
    openDocket: row.stage.code === "DISPATCH" && !visa.docket ? openDocketOf(visa.vendor) : null,
    /** The scans combined into the saved file (0008 Amendment 1), or what's missing: during file preparation and at Docket & dispatch. */
    combinedScans: COMBINING_STAGES.includes(row.stage.code) ? combinedScansOf(row, visa.travellers, scans) : null,
    /** An e-visa's "Submitted online" (Decision 11): who and when, instead of a docket. */
    submittedOnline: visa.submittedOnlineAt && { at: visa.submittedOnlineAt, by: visa.submittedOnlineBy },
    /** "Send the e-visa" (0025, part 3): who sent each approved traveller's e-visa to the client, and when. */
    evisaSent: visa.evisaSentAt && { at: visa.evisaSentAt, by: visa.evisaSentBy },
    /** Step 5 (0011 Decision 2): "Vendor got it, papers checked", who and when. */
    vendorReceived: visa.vendorReceivedAt && { at: visa.vendorReceivedAt, by: visa.vendorReceivedBy },
    /** "Submitted at the embassy" (0011 Decisions 3 and 4): the vendor's file number, the embassy and the collection date. */
    submission: visa.submittedAt && {
      vendorFileNo: visa.vendorFileNo!,
      embassy: visa.embassy!,
      collectionOn: fromDbDate(visa.collectionOn!),
      at: visa.submittedAt,
      by: visa.submittedBy,
    },
    /**
     * The case's latest tax invoice (0009), or null until one is raised. When a credit note cancelled it
     * (`cancelled`), it no longer counts and a corrected one can be raised (0011 Decision 5).
     */
    invoice: mainInvoices[0] ? invoiceOf(mainInvoices[0]) : null,
    /** The earlier invoices of the chain, each cancelled and replaced, newest first. */
    earlierInvoices: mainInvoices.slice(1).map(invoiceOf),
    /**
     * The file's one additional invoice (0011 Decision 7), "MVI…-A", for extra charges with no GST; null until raised.
     * When cancelled, its replacement is the latest; the earlier ones follow in `earlierAdditionalInvoices`.
     */
    additionalInvoice: additionalInvoices[0] ? { ...invoiceOf(additionalInvoices[0]), charges: additionalInvoices[0].charges } : null,
    earlierAdditionalInvoices: additionalInvoices.slice(1).map((i) => ({ ...invoiceOf(i), charges: i.charges })),
    /** "Take the file back" (0011 Decision 6): who, when, why, and the credit note that gave the embassy fee back. */
    recall: visa.recalledAt && {
      at: visa.recalledAt,
      by: visa.recalledBy,
      reason: visa.recallReason!.name,
      creditNote: (() => {
        const n = row.invoices.flatMap((i) => i.creditNotes).find((c) => c.kind === "PART" && c.reason.code === "RECALL");
        return n ? { creditNoteNo: n.creditNoteNo, totalPaise: n.totalPaise, file: n.file } : null;
      })(),
    },
    /** "Record the decision" (0012 Decision 6): who and when; each traveller's outcome is on the traveller. */
    decision: visa.decidedAt && { at: visa.decidedAt, by: visa.decidedBy },
    /** "Passports on the way back" (0013 Decision 3): the day the vendor collected them, the day expected, who and when. */
    passportsBack: visa.passportsInTransitAt && {
      collectedOn: fromDbDate(visa.passportsCollectedOn!),
      expectedOn: fromDbDate(visa.passportsExpectedOn!),
      at: visa.passportsInTransitAt,
      by: visa.passportsInTransitBy,
    },
    /**
     * "Mark received" (0013 Decision 5): in our passport stock, by whom and when, with the booklets counted (plus any
     * received later). `missing`: per kind, what went out and isn't back; while any is and the shortfall isn't cleared,
     * the handover waits (amended 17 Oct 2026). `shortfallCleared`: when, by whom and why it won't come back.
     */
    passportsReceived: visa.passportsReceivedAt && {
      at: visa.passportsReceivedAt,
      by: visa.passportsReceivedBy,
      booklets: { current: visa.bookletsBackCurrent!, old: visa.bookletsBackOld! },
      missing: missingBooklets({ ...visa, travellerCount: visa.travellers.length }),
      shortfallCleared: visa.shortfallClearedAt && {
        at: visa.shortfallClearedAt,
        by: visa.shortfallClearedBy,
        reason: visa.shortfallReason!.name,
      },
    },
    /**
     * Handed back to the client (0014): how, when and by whom, the booklets, who collected them, their photo, and the
     * client's code (where it went, masked, and when they confirmed it; Decision 2, amended 23 Oct 2026).
     */
    handover: visa.handover && {
      mode: visa.handover.mode,
      at: visa.handover.at,
      by: visa.handover.by,
      booklets: { current: visa.handover.bookletsCurrent, old: visa.handover.bookletsOld },
      receiver: { name: receiverName(visa.handover, visa.travellers, adults), travellerId: visa.handover.receiverTravellerId },
      photo: visa.handover.receiverPhoto,
      code: { sentTo: maskMobile(visa.handover.codeSentTo), confirmedAt: visa.handover.codeConfirmedAt },
      /** At the door (0015 phase 5): the delivery boy's job, whose proof (his selfie, the place) the case sends. */
      fieldJobId: visa.handover.fieldJobId,
    },
    /** The GST rate on the service charge (the setting visa.invoice), for a quote being entered. */
    gstRatePercent,
    /** The price (0009): null until someone enters it. */
    quote: visa.quote && quoteOf(visa.quote, visa.travellers.map((t) => t.id), gstRatePercent),
    travellers: visa.travellers.map((t) => {
      const member = t.member ? toMemberDto(t.member, today, clientSettings) : null;
      return {
        id: t.id,
        position: t.position,
        label: travellerLabel(t, adults),
        isChild: t.isChild,
        /** The family member's current name once linked; until then the name it was filed under, if any. */
        name: member?.name ?? t.name,
        member: member && {
          id: member.id,
          name: member.name,
          relation: member.relation,
          age: member.age,
          passportNumber: member.passportNumber,
          passportExpiry: member.passportExpiry,
          passportStatus: member.passportStatus,
        },
        consent: consentOf(t),
        /** Step 3, from the government portal (0007 Decision 5). */
        ackNo: t.ackNo,
        appointmentAt: t.appointmentAt,
        /**
         * Step 6 (0012): Approved, with the sticker (or e-visa) number and dates once added with Change (each optional,
         * amended 23 Oct 2026), or Refused; null until recorded.
         */
        decision: t.outcome && {
          outcome: t.outcome,
          visaNo: t.visaNo,
          validFrom: t.validFrom && fromDbDate(t.validFrom),
          validTo: t.validTo && fromDbDate(t.validTo),
        },
        /**
         * An approved traveller's sticker, checked when the passports were received (0013 Decision 5); an e-visa's PDF,
         * checked at Decision (0025). Null until checked.
         */
        stickerCheck: t.stickerCheck,
        /** The refusal letter (0012 Decision 4): the current upload, shown only while the traveller is refused. */
        refusalLetter: refusalLetterOf(t),
        /** An e-visa's PDF (0025): the current upload, shown only while the traveller is approved. */
        evisa: evisaOf(t, !!visa.submittedOnlineAt),
        /** A paper visa's visa copy (0012, amended 24 Oct 2026): the current upload, shown only while approved. */
        visaCopy: visaCopyOf(t, !!visa.submittedOnlineAt),
        documents: t.documents.map((d) => {
          const onFile = (t.memberId && scans.get(scanKey(t.memberId, d.documentId))) || null;
          return {
            id: d.id,
            name: d.name,
            detail: d.detail,
            requirement: d.requirement,
            quantity: d.quantity,
            note: d.note,
            status: d.status,
            receivedAs: d.receivedAs,
            receivedAt: d.receivedAt,
            receivedBy: d.receivedBy,
            /** The current copy of this paper in the client's vault (0016 Decision 5), for a traveller linked to a person. */
            onFile,
            /** The copy an On file paper was printed from; it may be older than the current one. */
            fromScan: d.clientDocument,
            /**
             * "Scan not saved" (0016 Decision 7), a warning only: the master asks for it, the paper came in as an
             * original or a xerox, and no copy was kept since the case was opened. An older trip's copy doesn't count.
             */
            noScan:
              d.document.warnIfNoScan &&
              d.status === "RECEIVED" &&
              (d.receivedAs === "ORIGINAL" || d.receivedAs === "XEROX") &&
              !!t.memberId &&
              (!onFile || onFile.uploadedAt < row.createdAt),
            /** What "Save scan" takes for this paper (0016 Amendment 1), checked first in the browser. */
            scanRules: scanRulesOf(d.document),
            /** The processor's check in Step 3 (0007 Decision 3): null until checked. */
            check: d.check,
            checkReason: d.checkReason,
            checkedAt: d.checkedAt,
            checkedBy: d.checkedBy,
          };
        }),
        /** In or made; "8 / 11 for Rakesh". */
        done: t.documents.filter((d) => d.status === "RECEIVED" || d.status === "MADE").length,
        /** Everything not marked "Not needed". */
        need: t.documents.filter((d) => d.status !== "NOT_NEEDED").length,
        pendingCount: t.documents.filter((d) => d.status === "PENDING").length,
        /** Step 3: papers the processor has checked, and papers flagged to be replaced. */
        checked: t.documents.filter((d) => d.check === "CHECKED").length,
        needsReplacing: t.documents.filter((d) => d.check === "NEEDS_REPLACING").length,
      };
    }),
    followUps: row.followUps.map((f) => ({
      id: f.id,
      outcome: f.outcome.name,
      nextStep: f.nextStep.name,
      nextAt: f.nextAt,
      by: f.by,
      createdAt: f.createdAt,
    })),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export type VisaCaseDto = ReturnType<typeof toVisaCaseDto>;
