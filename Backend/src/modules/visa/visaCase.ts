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
          documents: { orderBy: { sortOrder: "asc" }, include: { receivedBy: personSelect } },
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
 */
export function toVisaCaseDto(row: VisaCaseRow, steps: { code: string; name: string }[], today: string, clientSettings: ClientSettings) {
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
    adults,
    children,
    travelMonth: fromDbDate(visa.travelMonth).slice(0, 7),
    travelDate: visa.travelDate ? fromDbDate(visa.travelDate) : null,
    owner: row.owner,
    dueAt: row.dueAt,
    arrival: visa.arrival,
    booklets: { current: visa.bookletsCurrent, old: visa.bookletsOld },
    maturedAt: visa.maturedAt,
    maturedBy: visa.maturedBy,
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
        })),
        /** In or made; "8 / 11 for Rakesh". */
        done: t.documents.filter((d) => d.status === "RECEIVED" || d.status === "MADE").length,
        /** Everything not marked "Not needed". */
        need: t.documents.filter((d) => d.status !== "NOT_NEEDED").length,
        pendingCount: t.documents.filter((d) => d.status === "PENDING").length,
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
