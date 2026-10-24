import { PDFDocument, StandardFonts } from "pdf-lib";
import { metaFailure } from "./metaErrors";
import { GRAPH_API } from "./metaGraph";
import { placeholdersIn } from "./placeholders";
import { WhatsAppError, type ProviderTemplate, type TemplateDraft, type WhatsAppTemplates } from "./types";

// Meta's message templates (https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview;
// docs/decisions/0020-whatsapp-sending.md Amendment 2): one per CRM wording, in one language, reviewed by Meta. Only an
// approved one can be sent, and it reaches a client even after the 24 hours. The door code is an authentication
// template, whose words Meta writes itself.

export interface MetaTemplateSettings {
  accessToken: string;
  /** The WhatsApp Business Account the templates belong to (META_WHATSAPP_BUSINESS_ACCOUNT_ID). */
  businessAccountId: string;
  /** Every template's language (META_TEMPLATE_LANGUAGE). */
  language: string;
}

/** Meta gets this long to answer each call. */
const TIMEOUT_MS = 30_000;

/** A template as Meta lists it. */
interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category?: string;
  rejected_reason?: string;
  components?: { type: string; format?: string; text?: string; code_expiration_minutes?: number }[];
}

/** Meta's name for a wording's template: its code with "_" for anything but a–z, 0–9 and "_" ("visa_documents_received"). */
export function metaTemplateName(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

/**
 * The request that makes a draft's template: an authentication one in Meta's own words with a Copy code button, or a
 * utility one in ours, with named values, their samples, and a document header when it carries a PDF. A change to an
 * existing template sends only its `components`.
 */
export function metaTemplateRequest(draft: TemplateDraft, language: string, documentHandle?: string) {
  const name = metaTemplateName(draft.code);
  if (draft.kind === "authentication") {
    return {
      name,
      language,
      category: "authentication",
      components: [
        // No "For your security, do not share this code." line, as drafted (docs/whatsapp-visa-messages.md, message 16).
        { type: "body", add_security_recommendation: false },
        ...(draft.codeMinutes ? [{ type: "footer", code_expiration_minutes: draft.codeMinutes }] : []),
        { type: "buttons", buttons: [{ type: "otp", otp_type: "copy_code", text: "Copy code" }] },
      ],
    };
  }
  const names = placeholdersIn(draft.body);
  return {
    name,
    language,
    category: "utility",
    parameter_format: "named",
    components: [
      ...(draft.withDocument ? [{ type: "header", format: "document", example: { header_handle: [documentHandle ?? ""] } }] : []),
      {
        type: "body",
        text: draft.body,
        ...(names.length > 0 ? { example: { body_text_named_params: names.map((param) => ({ param_name: param, example: draft.samples[param] ?? "" })) } } : {}),
      },
    ],
  };
}

export function metaTemplates(settings: MetaTemplateSettings): WhatsAppTemplates {
  const { accessToken, businessAccountId, language } = settings;
  let sampleHandle: Promise<string> | undefined;

  /** One call to Meta, in plain words when it refuses. */
  async function graph<T>(url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(init.body !== undefined && !(init.body instanceof Uint8Array) ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
        ...(init.body === undefined ? {} : { body: init.body instanceof Uint8Array ? init.body : JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // A template call is run by hand (npm run whatsapp:templates), so it's simply run again.
      const cause = (error as { cause?: unknown } | null)?.cause;
      throw new WhatsAppError(`Couldn't reach Meta: ${cause instanceof Error ? cause.message : error instanceof Error ? error.message : String(error)}`, true, { cause: error });
    }
    const answer = (await response.json().catch(() => null)) as
      | (T & {
          error?: { code?: number; error_subcode?: number; message?: string; error_user_title?: string; error_user_msg?: string; error_data?: { details?: string } };
        })
      | null;
    if (!response.ok || !answer || answer.error) {
      const error = answer?.error;
      if (error?.code === undefined) throw new WhatsAppError(`Meta answered ${response.status} without saying why.`, response.status >= 500);
      // Meta explains a template refusal in its own words (e.g. "Cannot create message template: This WhatsApp Business
      // account does not have permission…"), which say more than the sending ones in metaErrors.ts.
      if (error.error_user_msg) {
        throw new WhatsAppError(`${error.error_user_title ? `${error.error_user_title}: ` : ""}${error.error_user_msg} (Meta error ${error.code})`, false);
      }
      throw new WhatsAppError(metaFailure(error.code, error.error_subcode, error.error_data?.details ?? error.message ?? "no details"), false);
    }
    return answer;
  }

  /** Every template on the WhatsApp account, page by page. */
  async function listAll(): Promise<MetaTemplate[]> {
    const all: MetaTemplate[] = [];
    let url: string | undefined =
      `${GRAPH_API}/${businessAccountId}/message_templates?fields=id,name,language,status,category,rejected_reason,components&limit=100`;
    while (url) {
      const page: { data?: MetaTemplate[]; paging?: { next?: string } } = await graph(url);
      all.push(...(page.data ?? []));
      url = page.paging?.next;
    }
    return all;
  }

  /**
   * A sample PDF for a document header, uploaded once per run through Meta's Resumable Upload API: Meta reviews a
   * template with a file by an example of one. The app's id, which the upload goes to, comes from the token itself.
   */
  function documentHandle(): Promise<string> {
    sampleHandle ??= (async () => {
      const token: { data?: { app_id?: string } } = await graph(`${GRAPH_API}/debug_token?input_token=${encodeURIComponent(accessToken)}`);
      const appId = token.data?.app_id;
      if (!appId) throw new WhatsAppError("Meta didn't say which app the access token belongs to, so the sample PDF can't be uploaded.", false);
      const bytes = await samplePdf();
      const session: { id?: string } = await graph(
        `${GRAPH_API}/${appId}/uploads?file_name=sample.pdf&file_length=${bytes.length}&file_type=application/pdf`,
        { method: "POST" },
      );
      if (!session.id) throw new WhatsAppError("Meta didn't open an upload for the sample PDF.", false);
      const uploaded: { h?: string } = await graph(`${GRAPH_API}/${session.id}`, {
        method: "POST",
        body: bytes,
        headers: { Authorization: `OAuth ${accessToken}`, file_offset: "0" },
      });
      if (!uploaded.h) throw new WhatsAppError("Meta took the sample PDF but gave no handle for it.", false);
      return uploaded.h;
    })();
    return sampleHandle;
  }

  return {
    async find(drafts) {
      const theirs = await listAll();
      const found = new Map<string, ProviderTemplate | null>();
      for (const draft of drafts) {
        const template = theirs.find((t) => t.name === metaTemplateName(draft.code) && t.language === language);
        found.set(
          draft.code,
          template
            ? {
                name: template.name,
                id: template.id,
                status: template.status,
                // Meta keeps the last rejection's reason through a new review; it only matters while it stands.
                reason:
                  template.rejected_reason && template.rejected_reason !== "NONE" && ["REJECTED", "PAUSED", "DISABLED"].includes(template.status)
                    ? template.rejected_reason
                    : null,
                current: isCurrent(template, draft),
              }
            : null,
        );
      }
      return found;
    },

    async submit(draft, existing) {
      const request = metaTemplateRequest(draft, language, draft.withDocument ? await documentHandle() : undefined);
      if (existing) {
        // A change replaces every component. Named values need their format said again, or Meta rejects the words
        // (INVALID_FORMAT, seen 24 Oct 2026).
        const format = "parameter_format" in request ? { parameter_format: request.parameter_format } : {};
        await graph(`${GRAPH_API}/${existing.id}`, { method: "POST", body: { ...format, components: request.components } });
      } else {
        await graph(`${GRAPH_API}/${businessAccountId}/message_templates`, { method: "POST", body: request });
      }
    },
  };
}

/** The template says what the draft says: the same words and document header, or for a code, the same minutes. */
function isCurrent(template: MetaTemplate, draft: TemplateDraft): boolean {
  const parts = template.components ?? [];
  if (draft.kind === "authentication") {
    const footer = parts.find((p) => p.type.toUpperCase() === "FOOTER");
    const minutes = footer?.code_expiration_minutes ?? Number(/(\d+) minutes/.exec(footer?.text ?? "")?.[1]);
    return template.category?.toUpperCase() === "AUTHENTICATION" && (draft.codeMinutes === undefined || minutes === draft.codeMinutes);
  }
  const body = parts.find((p) => p.type.toUpperCase() === "BODY")?.text ?? "";
  const hasDocument = parts.some((p) => p.type.toUpperCase() === "HEADER" && p.format?.toUpperCase() === "DOCUMENT");
  return sameWords(body, draft.body) && hasDocument === draft.withDocument;
}

function sameWords(a: string, b: string): boolean {
  const plain = (text: string) => text.replace(/\r\n/g, "\n").trim();
  return plain(a) === plain(b);
}

/** A one-page PDF that says it's a sample, for Meta's reviewers. */
async function samplePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  page.drawText("Masti Tours & Travels", { x: 72, y: 760, size: 18, font });
  page.drawText("Sample document: a client's e-visa, invoice or credit note goes here.", { x: 72, y: 730, size: 11, font });
  return pdf.save();
}
