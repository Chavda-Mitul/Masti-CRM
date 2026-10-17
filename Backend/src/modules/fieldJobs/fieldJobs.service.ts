import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import type { Actor } from "../users/user";

// The field staff app (docs/decisions/0015-field-staff-app.md): what every desk's field jobs share, whatever the
// department that raised them. The visa case's side (booking a pickup or a delivery) is in visa/visaFieldJobs.service.ts;
// the boy's own side comes with his phone website (phase 3).

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
