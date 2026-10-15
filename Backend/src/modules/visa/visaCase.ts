import type { Prisma } from "../../../generated/prisma/client";
import { fromDbDate } from "../../lib/dates";
import { lineTotalPaise, quoteTotals } from "../../lib/money";
import { toMemberDto } from "../clients/client";
import type { ClientSettings } from "../clients/clients.settings";
import { toStageRef } from "../enquiries/enquiry";
import { countryLabel, offeringInclude } from "../visaMasters/visaMasters.service";

// The visa case as the browser sees it (0003 "VisaCaseDto", extended for Step 2 by 0006), without the message log and
// reminders, which come with the WhatsApp work.

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
      enquiry: { select: { caseNo: true, ownerId: true, client: { select: { name: true } }, invoice: { select: { invoiceNo: true } } } },
      offering: { select: { country: { select: { name: true } } } },
      _count: { select: { travellers: true } },
    },
  },
} satisfies Prisma.DocketSelect;

export const visaCaseInclude = {
  department: { select: { code: true, name: true } },
  client: { select: { id: true, name: true, mobile: true } },
  source: { select: { code: true, name: true } },
  stage: true,
  owner: personSelect,
  createdBy: personSelect,
  reason: { select: { id: true, code: true, name: true, kind: true } },
  /** The current final file (0007 Decision 8): the newest upload. Older ones are counted, not loaded. */
  files: { where: { kind: "FINAL_FILE" }, orderBy: [{ uploadedAt: "desc" }, { id: "desc" }], take: 1, include: { uploadedBy: personSelect } },
  _count: { select: { files: { where: { kind: "FINAL_FILE" } } } },
  /** The tax invoice (0009), once raised. */
  invoice: {
    select: {
      invoiceNo: true,
      issuedOn: true,
      issuedAt: true,
      issuedBy: personSelect,
      taxType: true,
      cgstPaise: true,
      sgstPaise: true,
      igstPaise: true,
      totalPaise: true,
      file: { select: { id: true, fileName: true } },
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
      maturedBy: personSelect,
      fileReadyBy: personSelect,
      submittedOnlineBy: personSelect,
      vendorReceivedBy: personSelect,
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
          member: { include: { relation: true, consent: true } },
          documents: {
            orderBy: { sortOrder: "asc" },
            include: { receivedBy: personSelect, checkedBy: personSelect, checkReason: { select: { id: true, name: true } } },
          },
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

/** "2 adults, 1 child" */
export function travellersLabel(adults: number, children: number) {
  const part = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return children > 0 ? `${part(adults, "adult", "adults")}, ${part(children, "child", "children")}` : part(adults, "adult", "adults");
}

type TravellerRow = NonNullable<VisaCaseRow["visa"]>["travellers"][number];

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
    invoiceNo: c.enquiry.invoice?.invoiceNo ?? null,
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

/** The vendor's shared open docket, while this case isn't in one: "Add to docket D-2026-0003 (2 cases)". */
function openDocketOf(vendor: VendorRow | null) {
  const open = vendor?.dockets[0];
  return open && open._count.cases > 0 ? { docketNo: open.docketNo, caseCount: open._count.cases } : null;
}

/** The consent card (0006 Decision 5): flagged until the "I agree" link, which comes with WhatsApp, fills it. */
function consentOf(t: TravellerRow) {
  if (!t.member) return { state: "UNLINKED" as const };
  if (!t.member.consent) return { state: "NONE" as const };
  return { state: "ON_FILE" as const, agreedAt: t.member.consent.agreedAt };
}

/**
 * @param steps the case's flow, in order: the step chips ("Enquiry → Documents → …")
 * @param today IST date, for the travellers' age and passport status
 * @param finalFileMaxMb the setting visa.finalFile.maxMb
 * @param gstRatePercent the setting visa.invoice.gstRatePercent, for the quote's GST
 */
export function toVisaCaseDto(
  row: VisaCaseRow,
  steps: { code: string; name: string }[],
  today: string,
  clientSettings: ClientSettings,
  finalFileMaxMb: number,
  gstRatePercent: number,
) {
  const finalFile = row.files[0];
  const visa = row.visa;
  if (!visa) throw new Error(`Enquiry ${row.caseNo} has no visa part.`);
  const { adults, children } = countTravellers(visa.travellers);
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
    client: row.client,
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
    finalFileCopies: row._count.files,
    finalFileMaxMb,
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
    /** An e-visa's "Submitted online" (Decision 11): who and when, instead of a docket. */
    submittedOnline: visa.submittedOnlineAt && { at: visa.submittedOnlineAt, by: visa.submittedOnlineBy },
    /** Step 5 (0011 Decision 2): "Vendor got it, papers checked", who and when. */
    vendorReceived: visa.vendorReceivedAt && { at: visa.vendorReceivedAt, by: visa.vendorReceivedBy },
    /** The locked tax invoice (0009), or null until it is raised. */
    invoice: row.invoice && {
      invoiceNo: row.invoice.invoiceNo,
      issuedOn: fromDbDate(row.invoice.issuedOn),
      issuedAt: row.invoice.issuedAt,
      issuedBy: row.invoice.issuedBy,
      taxType: row.invoice.taxType,
      gstPaise: row.invoice.cgstPaise + row.invoice.sgstPaise + row.invoice.igstPaise,
      totalPaise: row.invoice.totalPaise,
      file: row.invoice.file,
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
        documents: t.documents.map((d) => ({
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
          /** The processor's check in Step 3 (0007 Decision 3): null until checked. */
          check: d.check,
          checkReason: d.checkReason,
          checkedAt: d.checkedAt,
          checkedBy: d.checkedBy,
        })),
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
