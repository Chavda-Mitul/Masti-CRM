import { Router } from "express";
import { actorOf, currentUser, requireAuth, requirePasswordChanged, requireUserType } from "../../middleware/auth";
import { createNoticeSchema, listNoticesQuerySchema, loginPopupSeenSchema, updateNoticeSchema } from "./notices.schemas";
import * as noticesService from "./notices.service";

/**
 * The notice board (docs/decisions/0017-today-dashboard.md Decision 11). Every department's notices, so there is no
 * department check here: the service lets a department's staff post to it, and the author, its HOD or the Head change a
 * notice. Field staff get nothing here.
 */
const router = Router();
router.use(requireAuth, requirePasswordChanged, requireUserType("HEAD", "OFFICE"));

// Fixed paths first, so they aren't taken for a notice id.

/** The visa team's login popup (Decision 12): what's new to this person; nothing for anyone else. */
router.get("/login-popup", async (req, res) => {
  res.json({ items: await noticesService.loginPopup(currentUser(req)) });
});

router.post("/login-popup/seen", async (req, res) => {
  const body = loginPopupSeenSchema.parse(req.body);
  res.json(await noticesService.dismissLoginPopup(body, actorOf(req)));
});

router.get("/", async (req, res) => {
  res.json(await noticesService.listNotices(listNoticesQuerySchema.parse(req.query), currentUser(req)));
});

router.post("/", async (req, res) => {
  const body = createNoticeSchema.parse(req.body);
  res.status(201).json({ notice: await noticesService.createNotice(body, actorOf(req)) });
});

router.patch("/:id", async (req, res) => {
  const body = updateNoticeSchema.parse(req.body);
  res.json({ notice: await noticesService.updateNotice(req.params.id, body, actorOf(req)) });
});

router.post("/:id/remove", async (req, res) => {
  res.json({ notice: await noticesService.removeNotice(req.params.id, actorOf(req)) });
});

export default router;
