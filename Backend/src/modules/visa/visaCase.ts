import type { Prisma } from "../../../generated/prisma/client";
import { fromDbDate } from "../../lib/dates";
import { toMemberDto } from "../clients/client";
import type { ClientSettings } from "../clients/clients.settings";
import { toStageRef } from "../enquiries/enquiry";
import { countryLabel, offeringInclude } from "../visaMasters/visaMasters.service";

// The visa case as the browser sees it (0003 "VisaCaseDto", extended for Step 2 by 0006), without the message log and
// reminders, which come with the WhatsApp work.

/** The case page shows the latest follow-ups; older ones stay in the database and the audit log. */
export const CASE_FOLLOW_UPS = 20;

const personSelect = { select: { id: true, name: true } } as const;

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
  followUps: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: CASE_FOLLOW_UPS,
    include: { outcome: { select: { name: true } }, nextStep: { select: { name: true } }, by: personSelect },
  },
  visa: {
    include: {
      offering: { include: offeringInclude },
      maturedBy: personSelect,
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
 */
export function toVisaCaseDto(
  row: VisaCaseRow,
  steps: { code: string; name: string }[],
  today: string,
  clientSettings: ClientSettings,
  finalFileMaxMb: number,
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
