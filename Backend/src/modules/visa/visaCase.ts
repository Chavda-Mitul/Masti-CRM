import type { Prisma } from "../../../generated/prisma/client";
import { fromDbDate } from "../../lib/dates";
import { toStageRef } from "../enquiries/enquiry";
import { countryLabel, offeringInclude } from "../visaMasters/visaMasters.service";

// The visa case as the browser sees it (0003 "VisaCaseDto", without the message log and reminders, which come with
// the WhatsApp work).

export const visaCaseInclude = {
  department: { select: { code: true, name: true } },
  client: { select: { id: true, name: true, mobile: true } },
  source: { select: { code: true, name: true } },
  stage: true,
  owner: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  visa: {
    include: {
      offering: { include: offeringInclude },
      travellers: { orderBy: { position: "asc" }, include: { documents: { orderBy: { sortOrder: "asc" } } } },
    },
  },
} satisfies Prisma.EnquiryInclude;

export type VisaCaseRow = Prisma.EnquiryGetPayload<{ include: typeof visaCaseInclude }>;

/** "Adult 1", "Child 1": placeholders until names are taken in Step 2. */
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

export function toVisaCaseDto(row: VisaCaseRow, stageCount: number) {
  const visa = row.visa;
  if (!visa) throw new Error(`Enquiry ${row.caseNo} has no visa part.`);
  const { adults, children } = countTravellers(visa.travellers);
  return {
    id: row.id,
    caseNo: row.caseNo,
    department: row.department,
    status: row.status,
    stage: toStageRef(row.stage, stageCount),
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
    travellers: visa.travellers.map((t) => ({
      id: t.id,
      position: t.position,
      label: travellerLabel(t, adults),
      isChild: t.isChild,
      name: t.name,
      documents: t.documents.map((d) => ({
        id: d.id,
        name: d.name,
        detail: d.detail,
        requirement: d.requirement,
        quantity: d.quantity,
        note: d.note,
        status: d.status,
      })),
      pendingCount: t.documents.filter((d) => d.status === "PENDING").length,
    })),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export type VisaCaseDto = ReturnType<typeof toVisaCaseDto>;
