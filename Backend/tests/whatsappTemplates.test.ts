import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderTemplate, TemplateDraft, WhatsAppTemplates } from "../src/lib/whatsapp";
import { metaTemplateName, metaTemplateRequest, metaTemplates } from "../src/lib/whatsapp/metaTemplates";
import { syncTemplates, templateDraft, templateProblems } from "../src/modules/messages/messageTemplates";
import {
  FIELD_DOOR_CODE,
  MESSAGE_TEMPLATES,
  VISA_DOCUMENTS_RECEIVED,
  VISA_EVISA_READY,
  VISA_PRICE,
  VISA_REFUSAL_LETTER,
  VISA_VISA_COPY,
} from "../src/modules/messages/messages.seed";
import { prisma, resetDb } from "./helpers";

// The CRM's wordings as Meta's templates (docs/decisions/0020-whatsapp-sending.md Amendment 2): made from each
// wording, reviewed by Meta, and switched on in the CRM only when approved in the current words. Meta is a stand-in
// here, so nothing is ever submitted.

const stub = vi.hoisted(() => ({ provider: null as { name: string; templates?: WhatsAppTemplates } | null }));

vi.mock("../src/lib/whatsapp", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/whatsapp")>();
  return { ...real, whatsAppProvider: () => stub.provider };
});

/** A utility draft, with a sample for each placeholder unless told otherwise. */
const draft = (body: string, extra: Partial<TemplateDraft> = {}): TemplateDraft => ({
  code: "visa.test",
  body,
  kind: "utility",
  withDocument: false,
  samples: { client_name: "Rakesh Mehta", case_no: "VISA-2026-0041" },
  ...extra,
});

describe("the wordings as Meta takes them", () => {
  it("names each template after its code, in Meta's letters", () => {
    expect(metaTemplateName(VISA_DOCUMENTS_RECEIVED)).toBe("visa_documents_received");
    expect(metaTemplateName(FIELD_DOOR_CODE)).toBe("field_door_code");
  });

  it("makes a utility template in our words, with named values and their samples", () => {
    expect(metaTemplateRequest(draft("Dear {{client_name}}, your case {{case_no}} is ready."), "en_US")).toEqual({
      name: "visa_test",
      language: "en_US",
      category: "utility",
      parameter_format: "named",
      components: [
        {
          type: "body",
          text: "Dear {{client_name}}, your case {{case_no}} is ready.",
          example: {
            body_text_named_params: [
              { param_name: "client_name", example: "Rakesh Mehta" },
              { param_name: "case_no", example: "VISA-2026-0041" },
            ],
          },
        },
      ],
    });
  });

  it("gives a template that carries a file a document header, with the uploaded sample", () => {
    const request = metaTemplateRequest(draft("Dear {{client_name}}, your e-visa is attached.", { withDocument: true }), "en_US", "4::sample");
    expect(request.components[0]).toEqual({ type: "header", format: "document", example: { header_handle: ["4::sample"] } });
  });

  it("makes the door code an authentication template in Meta's words: no security line, its minutes, a Copy code button", () => {
    const code = templateDraft({ code: FIELD_DOOR_CODE, body: "{{code}} is your verification code.\n\nThis code expires in {{minutes}} minutes." }, 10);
    expect(code).toMatchObject({ kind: "authentication", codeMinutes: 10 });
    expect(metaTemplateRequest(code, "en_US")).toEqual({
      name: "field_door_code",
      language: "en_US",
      category: "authentication",
      components: [
        { type: "body", add_security_recommendation: false },
        { type: "footer", code_expiration_minutes: 10 },
        { type: "buttons", buttons: [{ type: "otp", otp_type: "copy_code", text: "Copy code" }] },
      ],
    });
  });

  it("finds nothing WhatsApp would refuse in any of the CRM's 23 wordings, and has a sample for every value", () => {
    expect(MESSAGE_TEMPLATES).toHaveLength(23);
    for (const template of MESSAGE_TEMPLATES) {
      expect({ code: template.code, problems: templateProblems(templateDraft(template, 10)) }).toEqual({ code: template.code, problems: [] });
    }
    for (const code of [VISA_EVISA_READY, VISA_REFUSAL_LETTER, VISA_VISA_COPY]) {
      expect({ code, withDocument: templateDraft(MESSAGE_TEMPLATES.find((t) => t.code === code)!, 10).withDocument }).toEqual({ code, withDocument: true });
    }
  });

  it("says in plain words what WhatsApp would refuse", () => {
    expect(templateProblems(draft("{{client_name}}, hello"))).toEqual(["It starts with a placeholder: WhatsApp wants words first."]);
    expect(templateProblems(draft("Hello {{client_name}}"))).toEqual(["It ends with a placeholder: WhatsApp wants words last."]);
    expect(templateProblems(draft("Hello {{client_name}} {{case_no}}."))).toEqual([
      "Two placeholders sit side by side: WhatsApp wants words between them.",
    ]);
    expect(templateProblems(draft("Hello {{visa}}."))).toEqual(["{{visa}} has no sample for the reviewers (TEMPLATE_SAMPLES)."]);
    expect(templateProblems(draft(`Hello ${"x".repeat(1100)}.`))[0]).toMatch(/^Its words are 1107 characters/);
  });
});

describe("Meta's templates, with Meta stood in", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const meta = metaTemplates({ accessToken: "token", businessAccountId: "1800835597791897", language: "en_US" });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), method: init?.method, body: init?.body }));

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("finds each wording's template by name and language, and tells whether its words are ours", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        data: [
          { id: "11", name: "visa_test", language: "en_US", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "Hello {{client_name}}, case {{case_no}}." }] },
          { id: "12", name: "visa_old", language: "en_US", status: "REJECTED", rejected_reason: "INVALID_FORMAT", components: [{ type: "BODY", text: "Old words." }] },
          { id: "13", name: "visa_test", language: "en_GB", status: "APPROVED", components: [] },
        ],
      }),
    );
    const found = await meta.find([
      draft("Hello {{client_name}}, case {{case_no}}."),
      draft("New words.", { code: "visa.old" }),
      draft("Hi.", { code: "visa.missing" }),
    ]);
    expect(found.get("visa.test")).toEqual({ name: "visa_test", id: "11", status: "APPROVED", reason: null, current: true });
    expect(found.get("visa.old")).toEqual({ name: "visa_old", id: "12", status: "REJECTED", reason: "INVALID_FORMAT", current: false });
    expect(found.get("visa.missing")).toBeNull();
    expect(calls()[0]!.url).toContain("/1800835597791897/message_templates?fields=");
  });

  it("creates a missing template on the WhatsApp account, and changes an existing one by its id", async () => {
    // A fresh answer each call: a response's body can be read only once.
    fetchMock.mockImplementation(async () => json({ id: "99", status: "PENDING", category: "UTILITY" }));
    await meta.submit(draft("Hello {{client_name}}, case {{case_no}}."), null);
    await meta.submit(draft("Hello {{client_name}}, case {{case_no}}."), { name: "visa_test", id: "11", status: "REJECTED", reason: null, current: false });

    const [create, change] = calls();
    expect(create).toMatchObject({ url: "https://graph.facebook.com/v26.0/1800835597791897/message_templates", method: "POST" });
    expect(JSON.parse(String(create!.body))).toMatchObject({ name: "visa_test", category: "utility", parameter_format: "named" });
    expect(change).toMatchObject({ url: "https://graph.facebook.com/v26.0/11", method: "POST" });
    // A change says again that the values are named, or Meta rejects it as INVALID_FORMAT.
    expect(Object.keys(JSON.parse(String(change!.body)))).toEqual(["parameter_format", "components"]);
    expect(JSON.parse(String(change!.body)).parameter_format).toBe("named");
  });

  it("uploads a sample PDF for a template with a file, to the token's app, and sends its handle", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ data: { app_id: "1234", type: "SYSTEM_USER" } }))
      .mockResolvedValueOnce(json({ id: "upload:abc" }))
      .mockResolvedValueOnce(json({ h: "4::sample-handle" }))
      .mockResolvedValueOnce(json({ id: "99", status: "PENDING" }));
    await meta.submit(draft("Dear {{client_name}}, your e-visa is attached.", { withDocument: true }), null);

    const [token, session, upload, create] = calls();
    expect(token!.url).toContain("/debug_token?input_token=token");
    expect(session).toMatchObject({ method: "POST" });
    expect(session!.url).toContain("/1234/uploads?file_name=sample.pdf&file_length=");
    expect(upload).toMatchObject({ url: "https://graph.facebook.com/v26.0/upload:abc", method: "POST" });
    expect(Buffer.from(upload!.body as Uint8Array).subarray(0, 5).toString()).toBe("%PDF-");
    expect(JSON.parse(String(create!.body)).components[0]).toEqual({ type: "header", format: "document", example: { header_handle: ["4::sample-handle"] } });
  });

  it("explains Meta's refusal in plain words", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { code: 190, message: "Error validating access token" } }, 401));
    await expect(meta.submit(draft("Hello {{client_name}}, case {{case_no}}."), null)).rejects.toThrow("Meta refused the access token");
  });
});

describe("switching the wordings on", () => {
  /** Meta stood in: what it has for each code. */
  const theirs = new Map<string, ProviderTemplate | null>();
  const submit = vi.fn<WhatsAppTemplates["submit"]>();

  beforeEach(async () => {
    await resetDb();
    theirs.clear();
    submit.mockReset();
    stub.provider = {
      name: "meta",
      templates: {
        find: async (drafts) => new Map(drafts.map((d) => [d.code, theirs.get(d.code) ?? null])),
        submit,
      },
    };
  });

  const approved = (name: string, current = true): ProviderTemplate => ({ name, id: `id-${name}`, status: "APPROVED", reason: null, current });
  const row = (code: string) => prisma.messageTemplate.findUniqueOrThrow({ where: { code } });

  it("switches on a wording approved in its current words, and audits it; leaves the rest as plain words", async () => {
    theirs.set(VISA_DOCUMENTS_RECEIVED, approved("visa_documents_received"));
    theirs.set(VISA_PRICE, approved("visa_price", false));
    theirs.set(FIELD_DOOR_CODE, { name: "field_door_code", id: "id-code", status: "PENDING", reason: null, current: true });

    const reports = await syncTemplates({ submit: false });

    expect((await row(VISA_DOCUMENTS_RECEIVED)).providerTemplateId).toBe("visa_documents_received");
    expect((await row(VISA_PRICE)).providerTemplateId).toBeNull();
    expect((await row(FIELD_DOOR_CODE)).providerTemplateId).toBeNull();
    expect(reports.find((r) => r.code === VISA_PRICE)).toMatchObject({ on: false, status: "APPROVED", note: "Approved, but in older words: submit again." });
    expect(reports.find((r) => r.code === FIELD_DOOR_CODE)).toMatchObject({ on: false, status: "PENDING" });
    expect(reports.filter((r) => r.status === "NOT SUBMITTED")).toHaveLength(MESSAGE_TEMPLATES.length - 3);
    const entries = await prisma.auditLog.findMany({ where: { action: "message.template.provider" } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entityType: "MessageTemplate", actorId: null, after: { providerTemplateId: "visa_documents_received" } });
    expect(submit).not.toHaveBeenCalled();
  });

  it("switches a wording off again when its template is no longer approved", async () => {
    await prisma.messageTemplate.update({ where: { code: VISA_PRICE }, data: { providerTemplateId: "visa_price" } });
    theirs.set(VISA_PRICE, { name: "visa_price", id: "id-price", status: "PAUSED", reason: null, current: true });
    await syncTemplates({ submit: false });
    expect((await row(VISA_PRICE)).providerTemplateId).toBeNull();
  });

  it("submits the missing and the changed ones, but not one still under review or already current", async () => {
    theirs.set(VISA_DOCUMENTS_RECEIVED, approved("visa_documents_received"));
    theirs.set(VISA_PRICE, { name: "visa_price", id: "id-price", status: "REJECTED", reason: "INVALID_FORMAT", current: false });
    theirs.set(FIELD_DOOR_CODE, { name: "field_door_code", id: "id-code", status: "PENDING", reason: null, current: false });

    const reports = await syncTemplates({ submit: true });

    const submitted = submit.mock.calls.map(([d, existing]) => ({ code: d.code, existing: existing?.id ?? null }));
    expect(submitted).toContainEqual({ code: VISA_PRICE, existing: "id-price" });
    expect(submitted.filter((s) => s.existing === null)).toHaveLength(MESSAGE_TEMPLATES.length - 3);
    expect(submitted.map((s) => s.code)).not.toContain(VISA_DOCUMENTS_RECEIVED);
    expect(submitted.map((s) => s.code)).not.toContain(FIELD_DOOR_CODE);
    expect(reports.find((r) => r.code === FIELD_DOOR_CODE)!.note).toMatch(/while Meta reviews the old ones/);
    expect(reports.find((r) => r.code === VISA_PRICE)!.note).toBe("Changed words sent for review.");
  });

  it("sends a rejected template again even in our words, for Meta to review again", async () => {
    theirs.set(VISA_PRICE, { name: "visa_price", id: "id-price", status: "REJECTED", reason: "INVALID_FORMAT", current: true });
    await syncTemplates({ submit: true });
    expect(submit.mock.calls.map(([d, existing]) => ({ code: d.code, existing: existing?.id ?? null }))).toContainEqual({ code: VISA_PRICE, existing: "id-price" });
  });

  it("says plainly when the provider can't make templates", async () => {
    stub.provider = { name: "twilio" };
    await expect(syncTemplates({ submit: false })).rejects.toThrow("twilio's templates aren't made by the CRM");
    stub.provider = null;
    await expect(syncTemplates({ submit: false })).rejects.toThrow("WhatsApp is off");
  });
});
