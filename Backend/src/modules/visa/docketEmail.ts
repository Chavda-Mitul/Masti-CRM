import type { Email } from "../../lib/email";
import type { DocketEmailSetting } from "./visa.schemas";

// The email to the vendor when a docket is dispatched (docs/decisions/0008-visa-docket-dispatch.md Decision 8): the
// docket number, the courier and slip, and each file with its travellers, country and passports. The wording ⚠️ is
// the setting visa.docketEmail, ours until Masti approves it; the courier line and the table of files are laid out here.

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
  wording: DocketEmailSetting;
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "4", or "4 + 3 old" */
const passports = (current: number, old: number) => (old > 0 ? `${current} + ${old} old` : String(current));

/** A wording with its {tokens} filled in. As HTML, it's escaped and the docket number is bold. */
function fill(wording: string, values: Record<string, string>, html = false) {
  const value = (token: string) => {
    const v = values[token];
    if (v === undefined) return `{${token}}`;
    if (!html) return v;
    return token === "docketNo" ? `<strong>${escape(v)}</strong>` : escape(v);
  };
  return (html ? escape(wording) : wording).replace(/\{([^}]*)\}/g, (_, token: string) => value(token));
}

export function docketEmail(d: DocketEmailInput): Email {
  const total = d.files.reduce((n, f) => n + f.passports, 0);
  const totalOld = d.files.reduce((n, f) => n + f.oldPassports, 0);
  const files = `${d.files.length} ${d.files.length === 1 ? "file" : "files"}`;
  const sentBy = d.awbNo ? `${d.courier}, slip ${d.awbNo}` : d.courier;
  const values = { docketNo: d.docketNo, files, passports: passports(total, totalOld), vendor: d.vendor.name, company: d.company.name };
  const w = d.wording;

  const text = [
    fill(w.greeting, values),
    "",
    fill(w.opening, values),
    `Sent by: ${sentBy}`,
    "",
    ...d.files.map(
      (f) => `${f.caseNo} · ${f.country} · ${passports(f.passports, f.oldPassports)} passports · ${f.travellers.join(", ")}`,
    ),
    "",
    fill(w.closing, values),
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
    `<p>${fill(w.greeting, values, true)}</p>` +
    `<p>${fill(w.opening, values, true)}<br>Sent by: <strong>${escape(sentBy)}</strong></p>` +
    `<table style="border-collapse:collapse"><thead><tr><th ${cell}>File</th><th ${cell}>Travellers</th>` +
    `<th ${cell}>Country</th><th ${cell}>Passports</th></tr></thead><tbody>${rows}</tbody></table>` +
    `<p>${fill(w.closing, values, true)}</p>` +
    `<p>${escape(d.company.name)}<br>${escape(d.company.phone)}</p></div>`;

  return {
    to: d.vendor.email,
    subject: fill(w.subject, values),
    text,
    html,
    replyTo: d.company.email ?? null,
  };
}
