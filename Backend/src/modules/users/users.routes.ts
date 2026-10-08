import { Router, type Request } from "express";
import { currentUser, requireAuth, requireHead, requirePasswordChanged } from "../../middleware/auth";
import { createUserSchema, updateUserSchema } from "./users.schemas";
import * as usersService from "./users.service";

/**
 * User management. Head only for now.
 * (Whether HODs can manage their own department's users is an open question.)
 */
const router = Router();
router.use(requireAuth, requirePasswordChanged, requireHead);

const actor = (req: Request): usersService.Actor => ({ user: currentUser(req), ip: req.ip ?? null });

router.get("/", async (_req, res) => {
  res.json({ users: await usersService.listUsers() });
});

router.get("/:id", async (req, res) => {
  res.json({ user: await usersService.getUser(req.params.id) });
});

router.post("/", async (req, res) => {
  const body = createUserSchema.parse(req.body);
  const { user, tempPassword } = await usersService.createUser(body, actor(req));
  res.status(201).json({ user, ...(tempPassword ? { tempPassword } : {}) });
});

router.patch("/:id", async (req, res) => {
  const body = updateUserSchema.parse(req.body);
  res.json({ user: await usersService.updateUser(req.params.id, body, actor(req)) });
});

router.post("/:id/deactivate", async (req, res) => {
  res.json({ user: await usersService.deactivateUser(req.params.id, actor(req)) });
});

router.post("/:id/activate", async (req, res) => {
  res.json({ user: await usersService.activateUser(req.params.id, actor(req)) });
});

router.post("/:id/reset-password", async (req, res) => {
  res.json(await usersService.resetPassword(req.params.id, actor(req)));
});

export default router;
