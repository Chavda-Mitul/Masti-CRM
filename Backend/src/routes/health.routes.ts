import { Router } from "express";
import { prisma } from "../config/prisma";

const router = Router();

router.get("/", async (_req, res) => {
  let database: "up" | "down" = "up";

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = "down";
  }

  res.status(database === "up" ? 200 : 503).json({
    status: database === "up" ? "ok" : "error",
    database,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

export default router;
