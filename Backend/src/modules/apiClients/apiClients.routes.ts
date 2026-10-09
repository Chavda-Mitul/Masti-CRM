import { Router } from "express";
import { actorOf, requireAuth, requireHead, requirePasswordChanged } from "../../middleware/auth";
import { createApiClientSchema, updateApiClientSchema } from "./apiClients.schemas";
import * as apiClientsService from "./apiClients.service";

/** Machine accounts, e.g. the holiday bot (docs/decisions/0005-system-masters.md §5). Head only. */
const router = Router();
router.use(requireAuth, requirePasswordChanged, requireHead);

router.get("/", async (_req, res) => {
  res.json({ clients: await apiClientsService.listApiClients() });
});

/** The key is in this response only. */
router.post("/", async (req, res) => {
  const body = createApiClientSchema.parse(req.body);
  res.status(201).json(await apiClientsService.createApiClient(body, actorOf(req)));
});

router.patch("/:id", async (req, res) => {
  const body = updateApiClientSchema.parse(req.body);
  res.json({ client: await apiClientsService.updateApiClient(req.params.id, body, actorOf(req)) });
});

/** The new key is in this response only; the old one stops working at once. */
router.post("/:id/rotate", async (req, res) => {
  res.json(await apiClientsService.rotateApiClientKey(req.params.id, actorOf(req)));
});

router.post("/:id/deactivate", async (req, res) => {
  res.json({ client: await apiClientsService.setApiClientActive(req.params.id, false, actorOf(req)) });
});

router.post("/:id/activate", async (req, res) => {
  res.json({ client: await apiClientsService.setApiClientActive(req.params.id, true, actorOf(req)) });
});

export default router;
