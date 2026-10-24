import type { MessageTemplate } from "../../../generated/prisma/client";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { whatsAppProvider, WhatsAppError, type ProviderTemplate, type TemplateDraft } from "../../lib/whatsapp";
import { placeholdersIn } from "../../lib/whatsapp/placeholders";
import { getFieldSettings } from "../fieldJobs/fieldJobs.settings";
import { ONE_TIME_CODE_TEMPLATES, TEMPLATES_WITH_FILE } from "./messages.seed";

// The CRM's wordings as the provider's templates (docs/decisions/0020-whatsapp-sending.md Amendment 2): `npm run
// whatsapp:templates -- submit` sends each to the provider, which reviews it; `check` switches on, wording by wording,
// those it approved in the CRM's current words. A wording that isn't switched on goes as plain words, which WhatsApp
// delivers only within 24 hours of the client's last message.

/**
 * An example for every placeholder the wordings use, for the provider's reviewers: a made-up case, never a client's.
 * A new placeholder needs one here, or its wording can't be submitted.
 */
export const TEMPLATE_SAMPLES: Readonly<Record<string, string>> = {
  client_name: "Rakesh Mehta",
  recipient_name: "Priya Mehta",
  traveller_name: "Priya Mehta",
  visa: "France tourist visa",
  case_no: "VISA-2026-0041",
  consent_link: "https://crm.mastitravel.com/consent#a1b2c3d4",
  office_phone: "+91 261 234 5678",
  office_address: "301, Masti House, Ring Road, Surat",
  travellers: "2 travellers",
  document_list: "Passport, original; Photos (2), 35 x 45 mm, white background; Bank statement, last 6 months",
  pending_list: "Bank statement, last 6 months (Rakesh); Leave letter (Priya)",
  total: "18,500",
  amount: "18,500",
  invoice_no: "MT/26-27/0041",
  credit_note_no: "CN/26-27/0007",
  staff_name: "Ramesh",
  visit_day: "Mon 26 Oct",
  visit_slot: "4-6 pm",
  address: "B-12, Shanti Park, Varachha, Surat",
  embassy: "French embassy, Mumbai",
  expected_date: "Tue 27 Oct",
  approved_names: "Rakesh Mehta and Priya Mehta",
  refused_names: "Aarav Mehta",
  working_days: "2 working days",
  passport_count: "2 passports and 1 old passport",
  receiver_name: "Rakesh Mehta",
  handover_time: "Sat 31 Oct, 12:10 pm",
  code: "482915",
  minutes: "10",
};

/** What `submit` and `check` found for one wording. */
export interface TemplateReport {
  code: string;
  name: string;
  /** The provider's word for it (APPROVED, PENDING, REJECTED…), or "NOT SUBMITTED". */
  status: string;
  /** Why the provider rejected or held it back. */
  reason: string | null;
  /** Switched on: its messages go as the approved template. */
  on: boolean;
  /** What must change in the wording before it can be submitted. */
  problems: string[];
  /** What `submit` did with it, or why it couldn't. */
  note: string | null;
}

/** The wording as the provider's template is made from it. */
export function templateDraft(row: Pick<MessageTemplate, "code" | "body">, codeMinutes: number): TemplateDraft {
  const oneTimeCode = ONE_TIME_CODE_TEMPLATES.has(row.code);
  return {
    code: row.code,
    body: row.body,
    kind: oneTimeCode ? "authentication" : "utility",
    withDocument: TEMPLATES_WITH_FILE.has(row.code),
    samples: Object.fromEntries(placeholdersIn(row.body).flatMap((name) => (TEMPLATE_SAMPLES[name] ? [[name, TEMPLATE_SAMPLES[name]]] : []))),
    ...(oneTimeCode ? { codeMinutes } : {}),
  };
}

/** What WhatsApp would refuse in a wording, in plain words, before it goes to the provider. A code's words are the provider's. */
export function templateProblems(draft: TemplateDraft): string[] {
  if (draft.kind === "authentication") return [];
  const words = draft.body.trim();
  const problems: string[] = [];
  if (words.length > 1024) problems.push(`Its words are ${words.length} characters; WhatsApp takes 1,024 at most.`);
  if (/^\{\{\w+\}\}/.test(words)) problems.push("It starts with a placeholder: WhatsApp wants words first.");
  if (/\{\{\w+\}\}$/.test(words)) problems.push("It ends with a placeholder: WhatsApp wants words last.");
  if (/\}\}\s*\{\{/.test(words)) problems.push("Two placeholders sit side by side: WhatsApp wants words between them.");
  for (const name of placeholdersIn(words)) {
    if (!/^[a-z_]+$/.test(name)) problems.push(`{{${name}}} must be lowercase letters and _ only.`);
    if (!draft.samples[name]) problems.push(`{{${name}}} has no sample for the reviewers (TEMPLATE_SAMPLES).`);
  }
  return problems;
}

/**
 * `check`, and with `submit` first sending each wording to the provider: a new template for one it lacks, a change for
 * one whose words differ (not while it's still under review). Then each wording is switched on (`providerTemplateId`,
 * audited) only when its template is approved in the wording's current words, and off otherwise.
 */
export async function syncTemplates({ submit }: { submit: boolean }): Promise<TemplateReport[]> {
  const provider = whatsAppProvider();
  if (!provider) throw new WhatsAppError("WhatsApp is off: set WHATSAPP_PROVIDER in Backend/.env.", false);
  if (!provider.templates) {
    throw new WhatsAppError(
      provider.name === "meta"
        ? "Add META_WHATSAPP_BUSINESS_ACCOUNT_ID to Backend/.env (App Dashboard → WhatsApp → API Setup)."
        : `${provider.name}'s templates aren't made by the CRM: make them in its own console and put each one's id on its wording.`,
      false,
    );
  }
  const rows = await prisma.messageTemplate.findMany({ orderBy: { id: "asc" } });
  const { otpMinutes } = await getFieldSettings();
  const drafts = rows.map((row) => templateDraft(row, otpMinutes));
  const problems = new Map(drafts.map((draft) => [draft.code, templateProblems(draft)]));
  const notes = new Map<string, string>();

  let found = await provider.templates.find(drafts);
  if (submit) {
    for (const draft of drafts) {
      const existing = found.get(draft.code) ?? null;
      // A rejected template goes again even in our words, for Meta to review again (a rejected one may be changed any
      // number of times). If its reason is about the words, change them first.
      if (problems.get(draft.code)!.length > 0 || (existing?.current && existing.status !== "REJECTED")) continue;
      if (existing?.status === "PENDING") {
        notes.set(draft.code, "Its words changed while Meta reviews the old ones: submit again once the review is done.");
        continue;
      }
      try {
        await provider.templates.submit(draft, existing);
        notes.set(draft.code, existing ? "Changed words sent for review." : "Sent for review.");
      } catch (err) {
        notes.set(draft.code, err instanceof Error ? err.message : String(err));
      }
    }
    found = await provider.templates.find(drafts);
  }

  const reports: TemplateReport[] = [];
  for (const row of rows) {
    const template: ProviderTemplate | null = found.get(row.code) ?? null;
    const id = template && template.status === "APPROVED" && template.current ? template.name : null;
    if (id !== row.providerTemplateId) {
      await prisma.$transaction(async (tx) => {
        await tx.messageTemplate.update({ where: { id: row.id }, data: { providerTemplateId: id } });
        await audit(
          {
            action: "message.template.provider",
            entityType: "MessageTemplate",
            entityId: String(row.id),
            before: { providerTemplateId: row.providerTemplateId },
            after: { providerTemplateId: id },
          },
          tx,
        );
      });
    }
    reports.push({
      code: row.code,
      name: row.name,
      status: template?.status ?? "NOT SUBMITTED",
      reason: template?.reason ?? null,
      on: id !== null,
      problems: problems.get(row.code) ?? [],
      note: notes.get(row.code) ?? (template && template.status === "APPROVED" && !template.current ? "Approved, but in older words: submit again." : null),
    });
  }
  return reports;
}
