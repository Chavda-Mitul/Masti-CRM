import { Router } from "express";
import { actorOf, currentUser, requireAuth, requirePasswordChanged, requireUserType } from "../../middleware/auth";
import { createPortalLoginSchema, peopleQuerySchema, updatePortalLoginSchema } from "./portalLogins.schemas";
import * as portalLoginsService from "./portalLogins.service";

/**
 * Settings → Portal logins (docs/decisions/0024-portal-logins.md). Every department's portals, so there is no department
 * check here: the service lets the Head and a department's HOD manage its portals, and shows staff the ones they're on
 * the list for. Field staff get nothing here.
 */
const router = Router();
router.use(requireAuth, requirePasswordChanged, requireUserType("HEAD", "OFFICE"));

// Fixed paths first, so they aren't taken for a portal id.

router.get("/people", async (req, res) => {
  const { department } = peopleQuerySchema.parse(req.query);
  res.json(await portalLoginsService.listPeople(department, currentUser(req)));
});

router.get("/", async (req, res) => {
  res.json(await portalLoginsService.listPortalLogins(currentUser(req)));
});

router.post("/", async (req, res) => {
  const body = createPortalLoginSchema.parse(req.body);
  res.status(201).json({ portal: await portalLoginsService.createPortalLogin(body, actorOf(req)) });
});

router.patch("/:id", async (req, res) => {
  const body = updatePortalLoginSchema.parse(req.body);
  res.json({ portal: await portalLoginsService.updatePortalLogin(req.params.id, body, actorOf(req)) });
});

router.post("/:id/remove", async (req, res) => {
  res.json({ portal: await portalLoginsService.removePortalLogin(req.params.id, actorOf(req)) });
});

export default router;
