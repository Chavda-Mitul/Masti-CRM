import { Router } from "express";
import { HttpError } from "../../lib/httpError";
import { readBody } from "../../lib/readBody";
import { actorOf, currentUser, requireAuth, requireHead, requirePasswordChanged, requireUserType } from "../../middleware/auth";
import * as documentsService from "./clientDocuments.service";
import {
  addClientDocumentQuerySchema,
  addNoteSchema,
  addPhoneSchema,
  changeMobileSchema,
  createClientSchema,
  createMemberSchema,
  isScanType,
  listClientsQuerySchema,
  lookupQuerySchema,
  updateClientSchema,
  updateClientSettingsSchema,
  updateMemberSchema,
} from "./clients.schemas";
import { paperConsentSchema } from "../consent/consent.schemas";
import * as consentService from "../consent/consent.service";
import * as clientsService from "./clients.service";
import * as membersService from "./members.service";

/**
 * The client master (docs/decisions/0004-client-master.md).
 * Clients are shared by every department, so there is no department check here; the service decides (access.ts):
 * the whole list is for the Head, HODs and Accounts, other staff open only the clients of their cases, changes need
 * EDIT in any department, and the Accounts fields need Accounts EDIT.
 * Field staff get nothing here.
 */
const router = Router();
router.use(requireAuth, requirePasswordChanged, requireUserType("HEAD", "OFFICE"));


// Fixed paths first, so they aren't taken for a client id.

router.get("/lookup", async (req, res) => {
  const { mobile } = lookupQuerySchema.parse(req.query);
  res.json(await clientsService.lookupByMobile(mobile, currentUser(req)));
});

router.get("/options", async (_req, res) => {
  res.json(await clientsService.getClientOptions());
});

router.get("/settings", async (_req, res) => {
  res.json({ settings: await clientsService.getSettings() });
});

router.put("/settings", requireHead, async (req, res) => {
  const body = updateClientSettingsSchema.parse(req.body);
  res.json({ settings: await clientsService.updateSettings(body, actorOf(req)) });
});

router.get("/", async (req, res) => {
  res.json(await clientsService.listClients(listClientsQuerySchema.parse(req.query), currentUser(req)));
});

router.post("/", async (req, res) => {
  const body = createClientSchema.parse(req.body);
  res.status(201).json({ client: await clientsService.createClient(body, actorOf(req)) });
});

router.get("/:id", async (req, res) => {
  res.json({ client: await clientsService.getClient(req.params.id, currentUser(req)) });
});

router.patch("/:id", async (req, res) => {
  const body = updateClientSchema.parse(req.body);
  res.json({ client: await clientsService.updateClient(req.params.id, body, actorOf(req)) });
});

router.put("/:id/mobile", async (req, res) => {
  const body = changeMobileSchema.parse(req.body);
  res.json({ client: await clientsService.changeMobile(req.params.id, body, actorOf(req)) });
});

router.get("/:id/readiness", async (req, res) => {
  res.json({ readiness: await clientsService.getReadiness(req.params.id, currentUser(req)) });
});

router.post("/:id/phones", async (req, res) => {
  const body = addPhoneSchema.parse(req.body);
  res.status(201).json({ phone: await clientsService.addPhone(req.params.id, body, actorOf(req)) });
});

router.delete("/:id/phones/:phoneId", async (req, res) => {
  await clientsService.removePhone(req.params.id, req.params.phoneId, actorOf(req));
  res.status(204).end();
});

router.post("/:id/members", async (req, res) => {
  const body = createMemberSchema.parse(req.body);
  res.status(201).json({ member: await membersService.createMember(req.params.id, body, actorOf(req)) });
});

router.patch("/:id/members/:memberId", async (req, res) => {
  const body = updateMemberSchema.parse(req.body);
  res.json({ member: await membersService.updateMember(req.params.id, req.params.memberId, body, actorOf(req)) });
});

router.post("/:id/members/:memberId/archive", async (req, res) => {
  res.json({ member: await membersService.archiveMember(req.params.id, req.params.memberId, actorOf(req)) });
});

// The printable record of a person's consent (docs/decisions/0022-consent-form.md, part 3b): anyone who can see the client.
router.get("/:id/members/:memberId/consent", async (req, res) => {
  res.json({ record: await consentService.consentRecord(req.params.id, req.params.memberId, currentUser(req)) });
});

// A consent signed on paper before the CRM (docs/decisions/0022-consent-form.md, part 3): the Head or the Visa HOD.
router.post("/:id/members/:memberId/paper-consent", async (req, res) => {
  const body = paperConsentSchema.parse(req.body);
  res.json({ member: await consentService.markPaperConsent(req.params.id, req.params.memberId, body, actorOf(req)) });
});

router.delete("/:id/members/:memberId/paper-consent", async (req, res) => {
  res.json({ member: await consentService.removePaperConsent(req.params.id, req.params.memberId, actorOf(req)) });
});

router.get("/:id/notes", async (req, res) => {
  res.json({ notes: await clientsService.listNotes(req.params.id, currentUser(req)) });
});

router.post("/:id/notes", async (req, res) => {
  const body = addNoteSchema.parse(req.body);
  res.status(201).json({ note: await clientsService.addNote(req.params.id, body, actorOf(req)) });
});

// The document vault (docs/decisions/0016-client-documents.md): the Head and HODs only; the service checks.

router.get("/:id/documents", async (req, res) => {
  res.json(await documentsService.listClientDocuments(req.params.id, currentUser(req)));
});

/**
 * Adds a scan: the file itself is the body (a PDF, JPEG or PNG), not a form; which paper and whose come in the query.
 * Access, the person, the paper and the size limit are checked before the body is read.
 */
router.post("/:id/documents", async (req, res) => {
  const contentType = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (!isScanType(contentType)) throw new HttpError(415, "Upload a PDF, JPEG or PNG.");
  const query = addClientDocumentQuerySchema.parse(req.query);
  const actor = actorOf(req);
  const { maxBytes, tooBig } = await documentsService.clientDocumentLimit(req.params.id, query, actor.user);
  const bytes = await readBody(req, maxBytes, tooBig);
  res.status(201).json(await documentsService.addClientDocument(req.params.id, query, contentType, bytes, actor));
});

router.get("/:id/documents/:clientDocumentId/link", async (req, res) => {
  res.json(await documentsService.openClientDocument(req.params.id, req.params.clientDocumentId, actorOf(req)));
});

export default router;
