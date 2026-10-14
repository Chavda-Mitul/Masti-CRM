import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env";

// The only place the CRM sends email from (docs/decisions/0008-visa-docket-dispatch.md Decision 8), over SMTP from the
// SMTP_* settings in .env, never from code. Mailpit catches it locally and in tests.

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string | null;
}

let transport: Transporter | null = null;

function transporter() {
  if (!env.SMTP_HOST || !env.SMTP_FROM) throw new Error("Email isn't set up yet.");
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? "" } : undefined,
    // A slow or unreachable server fails within seconds; the dispatch is already saved and offers "Send again".
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transport;
}

/** Sends one email. Throws with a short reason when it can't, for the caller to record. */
export async function sendEmail(email: Email): Promise<void> {
  await transporter().sendMail({
    from: env.SMTP_FROM,
    to: email.to,
    subject: email.subject,
    text: email.text,
    html: email.html,
    ...(email.replyTo ? { replyTo: email.replyTo } : {}),
  });
}
