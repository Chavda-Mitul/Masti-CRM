import { Router } from "express";
import { requireAuth, requireUserType } from "../../middleware/auth";
import * as departmentsService from "./departments.service";

const router = Router();

router.get("/", requireAuth, requireUserType("HEAD", "OFFICE"), async (_req, res) => {
  res.json({ departments: await departmentsService.listActiveDepartments() });
});

export default router;
