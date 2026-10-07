import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import healthRoutes from "./routes/health.routes";

const app = express();

app.use(helmet());
app.use(cors({ origin: env.CLIENT_URL.split(","), credentials: true }));
app.use(express.json());
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

app.use("/api/health", healthRoutes);

export default app;
