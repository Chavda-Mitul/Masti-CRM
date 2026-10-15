import { prisma, type Db } from "../../config/prisma";
import { audit, auditMany } from "../../lib/audit";
import { staleError } from "../../lib/changes";
import { sendEmail } from "../../lib/email";
import { conflict, fieldError, forbidden, HttpError } from "../../lib/httpError";
import { logger } from "../../lib/logger";
import { getCompanyDetails } from "../company/company.settings";
import { isHodOf } from "../auth/permissions";
import type { Actor, UserWithDepartments } from "../users/user";
import { findVisibleCase, visaStage } from "./caseLock";
import { emailSending, liveInvoiceNo, liveInvoiceSelect } from "./visaCase";
import { docketEmail } from "./docketEmail";
import type { DispatchDocketInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { dueOnOfficeDay, getVisaSettings } from "./visa.settings";

// Visa Step 4, dispatch (docs/decisions/0008-visa-docket-dispatch.md Decisions 3, 6 and 9): one press sends every case in
// the docket to the vendor. Refused until every case has its locked invoice (golden rule 3), the vendor is active and has
// an email, and the courier (and its slip number, when it has one) is given. Every case moves to Step 5 · At vendor,
// due on its processor's desk the next open office day at 11:00 ⚠️: "Confirm vendor got it".
//
// The email to the vendor (Decision 8) goes after the dispatch commits, never inside it or any other transaction: a
// failure is recorded on the docket and never undoes the dispatch; "Send again" retries it.
//
// Locks, in the same order as add and take-out: the vendor, then the docket, then its cases in id order. The cases are
// locked by hand, not with lockCase: a processor who owns only one case in the docket may still dispatch it.

const VISA = "VISA";

/** The docket with what dispatch checks: its vendor, and each case's step, owner and invoice. */
async function gather(db: Db, docketId: string) {
  return db.docket.findUniqueOrThrow({
    where: { id: docketId },
    select: {
      id: true,
      docketNo: true,
      status: true,
      vendor: { select: { id: true, name: true, city: true, isActive: true, email: true } },
      cases: {
        orderBy: { enquiryId: "asc" },
        select: {
          enquiryId: true,
          enquiry: {
            select: {
              caseNo: true,
              status: true,
              ownerId: true,
              clientId: true,
              departmentId: true,
              dueAt: true,
              stage: { select: { code: true } },
              invoice: liveInvoiceSelect,
            },
          },
        },
      },
    },
  });
}

type Gathered = Awaited<ReturnType<typeof gather>>;

export type DispatchBlockerKind = "INVOICE" | "VENDOR_OFF";
export interface DispatchBlocker {
  kind: DispatchBlockerKind;
  label: string;
  items: string[];
}

/** What stands in the way of dispatch (Decision 9), in the order to fix it. */
function blockersOf(g: Gathered): DispatchBlocker[] {
  const blockers: DispatchBlocker[] = [];
  const noInvoice = g.cases.filter((c) => !liveInvoiceNo(c.enquiry.invoice)).map((c) => c.enquiry.caseNo).sort();
  if (noInvoice.length) blockers.push({ kind: "INVOICE", label: "Raise the invoice on every file first: no file leaves without it.", items: noInvoice });
  if (!g.vendor.isActive) {
    blockers.push({ kind: "VENDOR_OFF", label: `${g.vendor.name} is switched off. Ask the Visa HOD to switch it back on.`, items: [] });
  }
  return blockers;
}

/** Decision 3: the Visa HOD, the Head, or a processor who owns at least one case in the docket. */
function canDispatch(user: UserWithDepartments, g: Gathered) {
  return isHodOf(user, VISA) || g.cases.some((c) => c.enquiry.ownerId === user.id);
}

/** When the cases are due back on their processors' desks: the next open office day, afterDays on, at `at` (IST). */
async function confirmAtOf(db: Db) {
  return dueOnOfficeDay((await getVisaSettings(db)).vendorConfirm, db);
}

/** The case the request came from, and its docket: anyone who can open the case. */
async function caseAndDocket(caseNo: string, user: UserWithDepartments) {
  const { id, docketId } = await findVisibleCase(caseNo, user);
  if (!docketId) throw conflict("This case isn't in a docket yet.");
  return { enquiryId: id, docketId };
}

/** The dialog's first look (Decision 9): what blocks dispatch, the vendor it goes to, and when the cases come back due. */
export async function dispatchCheck(caseNo: string, user: UserWithDepartments) {
  const { docketId } = await caseAndDocket(caseNo, user);
  const g = await gather(prisma, docketId);
  return {
    docketNo: g.docketNo,
    alreadyDispatched: g.status !== "OPEN",
    canDispatch: canDispatch(user, g),
    blockers: blockersOf(g),
    vendor: { name: g.vendor.name, city: g.vendor.city, email: g.vendor.email },
    confirmAt: await confirmAtOf(prisma),
  };
}

/** The courier and its slip number (Decision 6): an active courier; a slip only, and always, when it has one. */
async function checkCourier(db: Db, input: DispatchDocketInput) {
  const courier = await db.courier.findUnique({ where: { id: input.courierId } });
  if (!courier?.isActive) throw fieldError("courierId", "Pick an active courier.");
  const awbNo = input.awbNo ?? null;
  if (!courier.awbNeeded) {
    if (awbNo) throw fieldError("awbNo", `${courier.name} has no slip number. Leave it empty.`);
    return { courier, awbNo: null };
  }
  const { awb } = await getVisaSettings(db);
  if (!awbNo) throw fieldError("awbNo", "Enter the slip (AWB) number.");
  if (awbNo.length < awb.minLength || awbNo.length > awb.maxLength) {
    throw fieldError("awbNo", `The slip number is ${awb.minLength}–${awb.maxLength} letters and digits.`);
  }
  return { courier, awbNo };
}

/** Every refusal, checked once before the locks and again under them. */
function assertCanSend(g: Gathered, input: DispatchDocketInput, actor: Actor) {
  if (g.status !== "OPEN") throw conflict(`Docket ${g.docketNo} has already been dispatched.`);
  if (!canDispatch(actor.user, g)) {
    throw forbidden("Only the Visa HOD, the Head or a processor with a file in this docket can dispatch it.");
  }
  // The files the dialog showed: one added or taken out since makes the dialog stale.
  const shown = [...new Set(input.caseNos)].sort();
  const now = g.cases.map((c) => c.enquiry.caseNo).sort();
  if (shown.length !== now.length || shown.some((caseNo, i) => caseNo !== now[i])) throw staleError("docket");
  for (const c of g.cases) {
    if (c.enquiry.status !== "OPEN" || c.enquiry.stage.code !== "DISPATCH") {
      throw conflict(`${c.enquiry.caseNo} isn't waiting for dispatch any more. Reload and try again.`);
    }
  }
  const blockers = blockersOf(g);
  if (blockers.length) throw new HttpError(409, "The docket can't be dispatched yet.", { code: "DISPATCH_BLOCKED", blockers });
}

/**
 * "Dispatch docket" (Decision 9). In one transaction: every case moves to At vendor, due the next open office day at
 * 11:00 on its owner's desk; the docket is stamped with the courier, the slip number, who and when; and each case and
 * the docket get an audit row. Step 4 is read-only for those cases afterwards.
 */
export async function dispatchDocket(caseNo: string, input: DispatchDocketInput, actor: Actor) {
  const { enquiryId, docketId } = await caseAndDocket(caseNo, actor.user);
  const pre = await gather(prisma, docketId);
  assertCanSend(pre, input, actor);
  await checkCourier(prisma, input);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Vendor" WHERE "id" = ${pre.vendor.id} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Docket" WHERE "id" = ${docketId} FOR UPDATE`;
    // Taking a case out locks the docket first, so the list can't change now; adding waits too. One query for all of
    // them, in id order, however many the docket holds.
    const ids = (await gather(tx, docketId)).cases.map((c) => c.enquiryId);
    await tx.$queryRaw`SELECT "id" FROM "Enquiry" WHERE "id" = ANY(${ids}) ORDER BY "id" FOR UPDATE`;
    const g = await gather(tx, docketId);
    assertCanSend(g, input, actor);
    const { courier, awbNo } = await checkCourier(tx, input);

    const confirmAt = await confirmAtOf(tx);
    const dispatchedAt = new Date();
    const atVendor = await visaStage(tx, g.cases[0]!.enquiry.departmentId, "AT_VENDOR");
    const sent = { docketNo: g.docketNo, courier: courier.name, awbNo };
    await tx.enquiry.updateMany({ where: { id: { in: g.cases.map((c) => c.enquiryId) } }, data: { stageId: atVendor.id, dueAt: confirmAt } });
    await auditMany(
      g.cases.map((c) => ({
        actorId: actor.user.id,
        action: "visa.docket.dispatch",
        entityType: "Enquiry",
        entityId: c.enquiryId,
        clientId: c.enquiry.clientId,
        before: { stage: "DISPATCH", dueAt: c.enquiry.dueAt },
        after: { stage: "AT_VENDOR", dueAt: confirmAt, ...sent },
        ip: actor.ip,
      })),
      tx,
    );
    await tx.docket.update({
      where: { id: docketId },
      data: { status: "DISPATCHED", courierId: courier.id, awbNo, dispatchedAt, dispatchedById: actor.user.id },
    });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.docket.dispatch",
        entityType: "Docket",
        entityId: docketId,
        before: { status: "OPEN" },
        after: { status: "DISPATCHED", ...sent, cases: g.cases.map((c) => c.enquiry.caseNo).sort(), vendor: g.vendor.name },
        ip: actor.ip,
      },
      tx,
    );
  });
  // The dispatch is saved: even a failure to record the email's outcome must not turn it into an error.
  await sendVendorEmail(docketId, actor).catch((err: unknown) => logger.error({ err, docketId }, "Docket email after dispatch failed."));
  return getVisaCaseById(enquiryId);
}

/**
 * Step one of a send: under the docket's lock, so two presses of "Send again" can't both send, marks it as sending and
 * builds the email. Null when there's nothing to send: not dispatched, already sent, or another send is under way.
 */
async function markVendorEmailSending(docketId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Docket" WHERE "id" = ${docketId} FOR UPDATE`;
    const d = await tx.docket.findUniqueOrThrow({
      where: { id: docketId },
      select: {
        docketNo: true,
        status: true,
        awbNo: true,
        vendorEmailSentAt: true,
        vendorEmailSendingAt: true,
        courier: { select: { name: true } },
        vendor: { select: { name: true, email: true } },
        cases: {
          orderBy: { enquiry: { caseNo: "asc" } },
          select: {
            bookletsCurrent: true,
            bookletsOld: true,
            enquiry: { select: { caseNo: true } },
            offering: { select: { country: { select: { name: true } } } },
            travellers: { orderBy: { position: "asc" }, select: { name: true, member: { select: { name: true } } } },
          },
        },
      },
    });
    if (d.status !== "DISPATCHED" || d.vendorEmailSentAt || emailSending(d.vendorEmailSendingAt)) return null;
    await tx.docket.update({ where: { id: docketId }, data: { vendorEmailSendingAt: new Date() } });

    const to = d.vendor.email;
    const company = await getCompanyDetails(tx);
    const { docketEmail: wording } = await getVisaSettings(tx);
    const email = docketEmail({
      docketNo: d.docketNo,
      vendor: { name: d.vendor.name, email: to },
      courier: d.courier!.name,
      awbNo: d.awbNo,
      files: d.cases.map((c) => ({
        caseNo: c.enquiry.caseNo,
        travellers: c.travellers.map((t, i) => t.member?.name ?? t.name ?? `Traveller ${i + 1}`),
        country: c.offering.country.name,
        passports: c.bookletsCurrent ?? c.travellers.length,
        oldPassports: c.bookletsOld ?? 0,
      })),
      company: { name: company.name, phone: company.phone, email: company.email },
      wording,
    });
    return { to, email };
  });
}

/**
 * Sends the docket's email to its vendor, once (Decision 8). Nothing is held open while the mail server answers: the
 * docket is marked as sending, the email goes, then when and to whom it went, or why not, is recorded and audited. A
 * send that went is never rolled back into "Not sent". Never throws for a failed send; false when it didn't try.
 */
async function sendVendorEmail(docketId: string, actor: Actor) {
  const marked = await markVendorEmailSending(docketId);
  if (!marked) return false;
  const { to, email } = marked;

  let error: string | null = null;
  try {
    await sendEmail(email);
  } catch (err) {
    logger.warn({ err, docketId }, "Docket email couldn't be sent.");
    error = (err instanceof Error && err.message ? err.message : "The email couldn't be sent.").slice(0, 500);
  }

  await prisma.$transaction(async (tx) => {
    await tx.docket.update({
      where: { id: docketId },
      data: error
        ? { vendorEmailError: error, vendorEmailSendingAt: null }
        : { vendorEmailSentAt: new Date(), vendorEmailTo: to, vendorEmailError: null, vendorEmailSendingAt: null },
    });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.docket.email",
        entityType: "Docket",
        entityId: docketId,
        after: error ? { sent: false, error } : { sent: true, to },
        ip: actor.ip,
      },
      tx,
    );
  });
  return true;
}

/** Why "Send again" can't send now, if it can't. */
async function assertCanResend(docketId: string, docketNo: string) {
  const d = await prisma.docket.findUniqueOrThrow({
    where: { id: docketId },
    select: { status: true, vendorEmailSentAt: true, vendorEmailTo: true, vendorEmailSendingAt: true },
  });
  if (d.status !== "DISPATCHED") throw conflict(`Docket ${docketNo} hasn't been dispatched yet.`);
  if (d.vendorEmailSentAt) throw conflict(`The email for docket ${docketNo} has already gone to ${d.vendorEmailTo}.`);
  if (emailSending(d.vendorEmailSendingAt)) {
    throw conflict(`The email for docket ${docketNo} is being sent right now. Reload in a minute to see if it went.`);
  }
}

/**
 * "Send again" (Decision 8): for whoever may dispatch the docket, once it is dispatched and only while its email
 * hasn't gone and isn't going, so the vendor never gets it twice.
 */
export async function resendVendorEmail(caseNo: string, actor: Actor) {
  const { enquiryId, docketId } = await caseAndDocket(caseNo, actor.user);
  const g = await gather(prisma, docketId);
  if (!canDispatch(actor.user, g)) {
    throw forbidden("Only the Visa HOD, the Head or a processor with a file in this docket can send its email.");
  }
  await assertCanResend(docketId, g.docketNo);
  // Another press got there between the check and the mark: say what it did.
  if (!(await sendVendorEmail(docketId, actor))) await assertCanResend(docketId, g.docketNo);
  return getVisaCaseById(enquiryId);
}
