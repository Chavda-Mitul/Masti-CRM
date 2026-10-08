import { Router, type Request } from "express";
import { currentUser, requireAuth, requireHead, requirePasswordChanged, requireUserType } from "../../middleware/auth";
import type { Actor } from "./access";
import {
  addNoteSchema,
  addPhoneSchema,
  changeMobileSchema,
  createClientSchema,
  createMemberSchema,
  listClientsQuerySchema,
  lookupQuerySchema,
  updateClientSchema,
  updateClientSettingsSchema,
  updateMemberSchema,
} from "./clients.schemas";
import * as clientsService from "./clients.service";
import * as membersService from "./members.service";

/**
 * The client master (docs/decisions/0004-client-master.md).
 * Clients are shared by every department, so there is no department check: the Head and office staff can view;
 * the service decides who may change what (any department EDIT; Accounts fields need Accounts EDIT).
 * Field staff get nothing here.
 */
const router = Router();
router.use(requireAuth, requirePasswordChanged, requireUserType("HEAD", "OFFICE"));

const actor = (req: Request): Actor => ({ user: currentUser(req), ip: req.ip ?? null });

// Fixed paths first, so they aren't taken for a client id.

router.get("/lookup", async (req, res) => {
  const { mobile } = lookupQuerySchema.parse(req.query);
  res.json(await clientsService.lookupByMobile(mobile));
});

router.get("/options", async (_req, res) => {
  res.json(await clientsService.getClientOptions());
});

router.get("/settings", async (_req, res) => {
  res.json({ settings: await clientsService.getSettings() });
});

router.put("/settings", requireHead, async (req, res) => {
  const body = updateClientSettingsSchema.parse(req.body);
  res.json({ settings: await clientsService.updateSettings(body, actor(req)) });
});

router.get("/", async (req, res) => {
  res.json(await clientsService.listClients(listClientsQuerySchema.parse(req.query)));
});

router.post("/", async (req, res) => {
  const body = createClientSchema.parse(req.body);
  res.status(201).json({ client: await clientsService.createClient(body, actor(req)) });
});

router.get("/:id", async (req, res) => {
  res.json({ client: await clientsService.getClient(req.params.id) });
});

router.patch("/:id", async (req, res) => {
  const body = updateClientSchema.parse(req.body);
  res.json({ client: await clientsService.updateClient(req.params.id, body, actor(req)) });
});

router.put("/:id/mobile", async (req, res) => {
  const body = changeMobileSchema.parse(req.body);
  res.json({ client: await clientsService.changeMobile(req.params.id, body, actor(req)) });
});

router.get("/:id/readiness", async (req, res) => {
  res.json({ readiness: await clientsService.getReadiness(req.params.id) });
});

router.post("/:id/phones", async (req, res) => {
  const body = addPhoneSchema.parse(req.body);
  res.status(201).json({ phone: await clientsService.addPhone(req.params.id, body, actor(req)) });
});

router.delete("/:id/phones/:phoneId", async (req, res) => {
  await clientsService.removePhone(req.params.id, req.params.phoneId, actor(req));
  res.status(204).end();
});

router.post("/:id/members", async (req, res) => {
  const body = createMemberSchema.parse(req.body);
  res.status(201).json({ member: await membersService.createMember(req.params.id, body, actor(req)) });
});

router.patch("/:id/members/:memberId", async (req, res) => {
  const body = updateMemberSchema.parse(req.body);
  res.json({ member: await membersService.updateMember(req.params.id, req.params.memberId, body, actor(req)) });
});

router.post("/:id/members/:memberId/archive", async (req, res) => {
  res.json({ member: await membersService.archiveMember(req.params.id, req.params.memberId, actor(req)) });
});

router.get("/:id/notes", async (req, res) => {
  res.json({ notes: await clientsService.listNotes(req.params.id) });
});

router.post("/:id/notes", async (req, res) => {
  const body = addNoteSchema.parse(req.body);
  res.status(201).json({ note: await clientsService.addNote(req.params.id, body, actor(req)) });
});

export default router;
