import { Router } from "express";
import { prisma } from "../config/prisma";
import { requireAuth, requireUserType } from "../middleware/auth";

const router = Router();

router.get("/", requireAuth, requireUserType("HEAD", "OFFICE"), async (_req, res) => {
  const departments = await prisma.department.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { code: true, name: true, sortOrder: true },
  });
  res.json({ departments });
});

export default router;
