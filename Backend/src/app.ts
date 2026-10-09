import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env, trustProxySetting } from "./config/env";
import { apiNotFound, errorHandler } from "./middleware/error";
import { requireJson } from "./middleware/requireJson";
import authRoutes from "./modules/auth/auth.routes";
import clientRoutes from "./modules/clients/clients.routes";
import departmentRoutes from "./modules/departments/departments.routes";
import enquiryRoutes from "./modules/enquiries/enquiries.routes";
import healthRoutes from "./modules/health/health.routes";
import holidayRoutes from "./modules/holidays/holidays.routes";
import userRoutes from "./modules/users/users.routes";
import visaRoutes from "./modules/visa/visa.routes";
import visaMasterRoutes from "./modules/visaMasters/visaMasters.routes";

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
app.use("/api/clients", clientRoutes);
app.use("/api/holidays", holidayRoutes);
app.use("/api/masters", visaMasterRoutes);
app.use("/api/enquiries", enquiryRoutes);
app.use("/api/visa", visaRoutes);

app.use("/api", apiNotFound);
app.use(errorHandler);

export default app;
