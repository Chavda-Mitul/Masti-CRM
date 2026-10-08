import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env, trustProxySetting } from "./config/env";
import { apiNotFound, errorHandler } from "./middleware/error";
import { requireJson } from "./middleware/requireJson";
import authRoutes from "./modules/auth/auth.routes";
import departmentRoutes from "./modules/departments/departments.routes";
import healthRoutes from "./modules/health/health.routes";
import userRoutes from "./modules/users/users.routes";

const app = express();

app.set("trust proxy", trustProxySetting());

app.use(helmet());
app.use(cors({ origin: env.CLIENT_URL.split(","), credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
if (env.NODE_ENV !== "test") app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

app.use("/api", requireJson);
app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/departments", departmentRoutes);
app.use("/api/users", userRoutes);

app.use("/api", apiNotFound);
app.use(errorHandler);

export default app;
