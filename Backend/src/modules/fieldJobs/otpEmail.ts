import type { FieldJobKind } from "../../../generated/prisma/enums";
import type { Email } from "../../lib/email";

// The email that carries the client's one-time code (docs/decisions/0015-field-staff-app.md Decision 4). Fixed wording
// (decided 17 Oct 2026), with Masti's name and phone from Company details, until an approved SMS or WhatsApp template
// takes over (M2). The code is in the subject too, so the client can read it from the notification.

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface OtpEmailInput {
  to: string;
  /** The client, by first name. */
  client: string;
  /** The boy at the door, by first name. */
  boy: string;
  company: { name: string; phone: string | null; email: string | null };
  caseNo: string;
  /** A pickup collects the documents; a delivery hands the passports over. */
  kind: FieldJobKind;
  code: string;
  /** How long the code works. */
  minutes: number;
}

export function otpEmail(d: OtpEmailInput): Email {
  const greeting = `Hello ${d.client},`;
  const why = d.kind === "PICKUP" ? `to collect the documents for ${d.caseNo}` : `to hand over the passports for ${d.caseNo}`;
  const visit = `${d.boy} from ${d.company.name} is at your door ${why}. Give him this code to confirm:`;
  const closing = `It works for ${d.minutes} minutes. If you didn't expect this, don't share it${d.company.phone ? `, and call us on ${d.company.phone}` : ""}.`;
  return {
    to: d.to,
    subject: `Your code for ${d.company.name}: ${d.code}`,
    text: [greeting, `${visit} ${d.code}`, closing].join("\n\n"),
    html: [
      `<p>${escape(greeting)}</p>`,
      `<p>${escape(visit)} <strong style="font-size:20px;letter-spacing:2px">${escape(d.code)}</strong></p>`,
      `<p>${escape(closing)}</p>`,
    ].join("\n"),
    replyTo: d.company.email,
  };
}
