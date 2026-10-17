import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { istToday, toDbDate } from "../../lib/dates";
import type { Actor } from "../users/user";
import { countTravellers, travellerLabel } from "../visa/visaCase";

// The field staff app (docs/decisions/0015-field-staff-app.md): what every desk's field jobs share, whatever the
// department that raised them. The visa case's side (booking a pickup or a delivery) is in visa/visaFieldJobs.service.ts;
// the boy's own side is his run (phase 3, listMyJobs).

/** The field staff a job can go to: active FIELD users (the Head adds them on the Users page), by name. */
export async function listFieldStaff() {
  return prisma.user.findMany({
    where: { type: "FIELD", isActive: true },
    select: { id: true, name: true, mobile: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Calls off a case's booked field jobs, in the caller's transaction: when the case is postponed or cancelled, the boy
 * mustn't go (0015 Defaults). Each is audited (field.job.cancel, with why). Returns what was called off.
 */
export async function cancelBookedFieldJobs(tx: Db, enquiryId: string, actor: Actor, why: string) {
  const jobs = await tx.fieldJob.findMany({ where: { enquiryId, status: "BOOKED" }, select: { id: true, kind: true, enquiry: { select: { clientId: true } } } });
  const now = new Date();
  for (const job of jobs) {
    await tx.fieldJob.update({ where: { id: job.id }, data: { status: "CANCELLED", cancelledAt: now, cancelledById: actor.user.id } });
    await audit(
      {
        actorId: actor.user.id,
        action: "field.job.cancel",
        entityType: "FieldJob",
        entityId: job.id,
        clientId: job.enquiry.clientId,
        before: { status: "BOOKED" },
        after: { status: "CANCELLED", why },
        ip: actor.ip,
      },
      tx,
    );
  }
  return jobs.map((j) => ({ id: j.id, kind: j.kind }));
}

/**
 * His run for a day (0015 phase 3): his own jobs only, in slot order, each with just what the stop needs: the desk
 * that raised it, the client's name, the case number, where to go (the address, the Google Maps link), whom to call;
 * for a delivery, the booklets in our stock he hands over; for a pickup, the papers still pending on the case's
 * checklist (by traveller, leaving out what we arrange ourselves). Cancelled stops come last, so he knows not to go.
 * "Done" counts finished stops (done or failed) among the ones not cancelled. Today (India) is the day when none is
 * asked for, and comes back too, so his phone names the days around it ("Yesterday", "Tomorrow") by the server's clock.
 */
export async function listMyJobs(userId: string, asked: string | undefined) {
  const today = istToday();
  const day = asked ?? today;
  const rows = await prisma.fieldJob.findMany({
    where: { assigneeId: userId, day: toDbDate(day) },
    orderBy: [{ slot: { startsAt: "asc" } }, { createdAt: "asc" }],
    select: {
      id: true,
      kind: true,
      status: true,
      address: true,
      mapLink: true,
      mobile: true,
      department: { select: { code: true } },
      slot: { select: { name: true, startsAt: true, endsAt: true } },
      enquiry: {
        select: {
          caseNo: true,
          client: { select: { name: true } },
          visa: {
            select: {
              bookletsBackCurrent: true,
              bookletsBackOld: true,
              travellers: {
                orderBy: { position: "asc" },
                select: {
                  position: true,
                  isChild: true,
                  name: true,
                  documents: {
                    where: { status: "PENDING", requirement: { not: "ARRANGED_BY_US" } },
                    orderBy: { sortOrder: "asc" },
                    select: { name: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const jobs = rows.map((j) => {
    const visa = j.enquiry.visa;
    const adults = visa ? countTravellers(visa.travellers).adults : 0;
    return {
      id: j.id,
      kind: j.kind,
      status: j.status,
      department: j.department.code,
      slot: j.slot,
      caseNo: j.enquiry.caseNo,
      client: j.enquiry.client,
      address: j.address,
      mapLink: j.mapLink,
      mobile: j.mobile,
      booklets:
        j.kind === "DELIVERY" && visa && visa.bookletsBackCurrent !== null && visa.bookletsBackOld !== null
          ? { current: visa.bookletsBackCurrent, old: visa.bookletsBackOld }
          : null,
      pending:
        j.kind === "PICKUP" && visa
          ? visa.travellers.flatMap((t) => t.documents.map((d) => ({ document: d.name, traveller: t.name ?? travellerLabel(t, adults) })))
          : [],
    };
  });
  const live = jobs.filter((j) => j.status !== "CANCELLED");
  return {
    day,
    today,
    jobs: [...live, ...jobs.filter((j) => j.status === "CANCELLED")],
    done: live.filter((j) => j.status === "DONE" || j.status === "FAILED").length,
    total: live.length,
  };
}
