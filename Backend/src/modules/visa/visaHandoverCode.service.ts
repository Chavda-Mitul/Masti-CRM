import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { conflict, fieldError } from "../../lib/httpError";
import { checkCode, codeExpiresAt, codeHash, codeResendAt, maskMobile, newCode, resendRefusal } from "../../lib/oneTimeCode";
import { getFieldSettings } from "../fieldJobs/fieldJobs.settings";
import { FIELD_DOOR_CODE } from "../messages/messages.seed";
import { queueMessage } from "../messages/messages.service";
import type { Actor } from "../users/user";
import { HANDING_OVER, loadCase, lockCase } from "./caseLock";
import { assertInStock, confirmedToday, gather } from "./visaHandover.service";

// The client's one-time code at the office handover (docs/decisions/0014-visa-delivered.md Decision 2, amended 23 Oct
// 2026), as the delivery boy's at the door (docs/decisions/0015-field-staff-app.md Decision 4): whoever is at the desk,
// anyone who may hand the passports over now, sends it to the client's WhatsApp (message 16) and checks the 6 digits the
// client reads out. No code, no handover. The rules are the `field` setting's ⚠️ (lib/oneTimeCode.ts). Sending and
// checking don't change the case (its updatedAt stays), so an open page doesn't go stale; each is audited.

/** What the code is hashed with: this case's handover. */
const codeScope = (enquiryId: string) => `handover:${enquiryId}`;

/** The code's WhatsApp message (message 16): one per code sent. */
const codeMessageKey = (enquiryId: string, sentAt: Date) => `${FIELD_DOOR_CODE}:handover:${enquiryId}:${sentAt.toISOString()}`;

/**
 * Where the client's code stands, as the dialog shows it: where it went (masked), until when it works, when another may
 * be sent, when the client confirmed it (today only: a confirmation from another day doesn't count), and where its
 * WhatsApp has got to. Null until one is sent.
 */
async function codeState(db: Db, enquiryId: string) {
  const sent = await db.handoverCode.findUnique({ where: { enquiryId } });
  if (!sent) return null;
  const message = await db.outboundMessage.findUnique({ where: { idempotencyKey: codeMessageKey(enquiryId, sent.sentAt) }, select: { status: true, error: true } });
  return {
    sentTo: maskMobile(sent.sentTo),
    sentAt: sent.sentAt,
    expiresAt: sent.expiresAt,
    resendAt: codeResendAt(sent.sentAt, await getFieldSettings(db)),
    confirmedAt: confirmedToday(sent) ? sent.confirmedAt : null,
    message,
  };
}

/** Where this case's code stands, for anyone who may hand its passports over. */
export async function getHandoverCode(caseNo: string, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, HANDING_OVER);
  return { code: await codeState(prisma, enquiry.id) };
}

/**
 * "Send the code": a new 6-digit code to the client's WhatsApp, their main number, while the passports can be handed
 * over; a new one only after the wait, never once the client has confirmed today. In one transaction under the case
 * lock: the code (its hash only, replacing any earlier one), message 16 queued (the outbox keeps the code from staff,
 * lib/whatsapp/secrets.ts), and the audit (visa.handover.code.send).
 */
export async function sendHandoverCode(caseNo: string, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, HANDING_OVER);
  assertInStock(await gather(prisma, enquiry.id), enquiry);
  const settings = await getFieldSettings();
  const code = newCode();
  const now = new Date();
  const expiresAt = codeExpiresAt(now, settings);
  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, HANDING_OVER);
    assertInStock(await gather(tx, enquiry.id), locked);
    const sent = await tx.handoverCode.findUnique({ where: { enquiryId: enquiry.id } });
    if (confirmedToday(sent, now)) throw conflict("The client has already confirmed with the code.");
    const wait = resendRefusal(sent?.sentAt ?? null, settings, now);
    if (wait) throw conflict(wait);
    const { mobile } = await tx.client.findUniqueOrThrow({ where: { id: locked.clientId }, select: { mobile: true } });
    const data = { hash: codeHash(codeScope(enquiry.id), code), sentAt: now, sentTo: mobile, sentById: actor.user.id, expiresAt, tries: 0, confirmedAt: null };
    await tx.handoverCode.upsert({ where: { enquiryId: enquiry.id }, create: { enquiryId: enquiry.id, ...data }, update: data });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.handover.code.send",
        entityType: "Enquiry",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        after: { to: mobile, expiresAt },
        ip: actor.ip,
      },
      tx,
    );
    await queueMessage(tx, {
      template: FIELD_DOOR_CODE,
      clientId: enquiry.clientId,
      enquiryId: enquiry.id,
      key: codeMessageKey(enquiry.id, now),
      variables: { code, minutes: String(settings.otpMinutes) },
    });
  });
  return { code: await codeState(prisma, enquiry.id) };
}

/**
 * "Check" the code the client reads out, under the case lock: refused once it has expired or after the setting's wrong
 * tries, until a new one is sent. A wrong try is counted and audited (visa.handover.code.wrong): its transaction commits
 * first, and the refusal is thrown after it. The right code confirms the client (visa.handover.code.confirm); checking
 * again the same day changes nothing.
 */
export async function checkHandoverCode(caseNo: string, code: string, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, HANDING_OVER);
  const settings = await getFieldSettings();
  const now = new Date();
  const refusal = await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, HANDING_OVER);
    assertInStock(await gather(tx, enquiry.id), locked);
    const sent = await tx.handoverCode.findUnique({ where: { enquiryId: enquiry.id } });
    if (!sent) throw conflict("Send the code first.");
    if (confirmedToday(sent, now)) return null;
    const check = checkCode(sent, codeScope(enquiry.id), code, settings, now);
    if (check.result === "refused") return check.message;
    const entry = { actorId: actor.user.id, entityType: "Enquiry", entityId: enquiry.id, clientId: enquiry.clientId, ip: actor.ip };
    if (check.result === "wrong") {
      await tx.handoverCode.update({ where: { enquiryId: enquiry.id }, data: { tries: check.tries } });
      await audit({ ...entry, action: "visa.handover.code.wrong", after: { tries: check.tries, left: check.left } }, tx);
      return check.message;
    }
    await tx.handoverCode.update({ where: { enquiryId: enquiry.id }, data: { confirmedAt: now } });
    await audit({ ...entry, action: "visa.handover.code.confirm", after: { confirmedAt: now, sentTo: sent.sentTo } }, tx);
    return null;
  });
  if (refusal) throw fieldError("code", refusal);
  return { code: await codeState(prisma, enquiry.id) };
}
