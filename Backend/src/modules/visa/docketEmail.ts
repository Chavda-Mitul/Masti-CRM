import type { Email } from "../../lib/email";

// The email to the vendor when a docket is dispatched (docs/decisions/0008-visa-docket-dispatch.md Decision 8): the
// docket number, the courier and slip, and each file with its travellers, country and passports. The wording ⚠️ is
// ours, for Masti to approve.

export interface DocketEmailFile {
  caseNo: string;
  travellers: string[];
  country: string;
  passports: number;
  oldPassports: number;
}

export interface DocketEmailInput {
  docketNo: string;
  vendor: { name: string; email: string };
  courier: string;
  awbNo: string | null;
  files: DocketEmailFile[];
  company: { name: string; phone: string; email?: string | null | undefined };
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "4", or "4 + 3 old" */
const passports = (current: number, old: number) => (old > 0 ? `${current} + ${old} old` : String(current));

export function docketEmail(d: DocketEmailInput): Email {
  const total = d.files.reduce((n, f) => n + f.passports, 0);
  const totalOld = d.files.reduce((n, f) => n + f.oldPassports, 0);
  const files = `${d.files.length} ${d.files.length === 1 ? "file" : "files"}`;
  const sentBy = d.awbNo ? `${d.courier}, slip ${d.awbNo}` : d.courier;

  const text = [
    `Dear ${d.vendor.name},`,
    "",
    `Docket ${d.docketNo} is on its way to you: ${files}, ${passports(total, totalOld)} passports.`,
    `Sent by: ${sentBy}`,
    "",
    ...d.files.map(
      (f) => `${f.caseNo} · ${f.country} · ${passports(f.passports, f.oldPassports)} passports · ${f.travellers.join(", ")}`,
    ),
    "",
    "Please confirm when you receive it.",
    "",
    d.company.name,
    d.company.phone,
  ].join("\n");

  const cell = 'style="padding:6px 10px;border-bottom:1px solid #e5e0d8;text-align:left;vertical-align:top"';
  const rows = d.files
    .map(
      (f) =>
        `<tr><td ${cell}>${escape(f.caseNo)}</td><td ${cell}>${escape(f.travellers.join(", "))}</td>` +
        `<td ${cell}>${escape(f.country)}</td><td ${cell}>${passports(f.passports, f.oldPassports)}</td></tr>`,
    )
    .join("");
  const html =
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1d1d1f">` +
    `<p>Dear ${escape(d.vendor.name)},</p>` +
    `<p>Docket <strong>${escape(d.docketNo)}</strong> is on its way to you: ${files}, ` +
    `${passports(total, totalOld)} passports.<br>Sent by: <strong>${escape(sentBy)}</strong></p>` +
    `<table style="border-collapse:collapse"><thead><tr><th ${cell}>File</th><th ${cell}>Travellers</th>` +
    `<th ${cell}>Country</th><th ${cell}>Passports</th></tr></thead><tbody>${rows}</tbody></table>` +
    `<p>Please confirm when you receive it.</p>` +
    `<p>${escape(d.company.name)}<br>${escape(d.company.phone)}</p></div>`;

  return {
    to: d.vendor.email,
    subject: `Docket ${d.docketNo} · ${files} · ${d.company.name}`,
    text,
    html,
    replyTo: d.company.email ?? null,
  };
}
