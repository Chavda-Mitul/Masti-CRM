import { Router } from "express";
import * as healthService from "./health.service";

const router = Router();

router.get("/", async (_req, res) => {
  const database = await healthService.databaseStatus();

  res.status(database === "up" ? 200 : 503).json({
    status: database === "up" ? "ok" : "error",
    database,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

export default router;
