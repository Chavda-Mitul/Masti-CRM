import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env, trustProxySetting } from "./config/env";
import { requestLogger } from "./lib/logger";
import { apiNotFound, errorHandler } from "./middleware/error";
import { requireJson } from "./middleware/requireJson";
import authRoutes from "./modules/auth/auth.routes";
import clientRoutes from "./modules/clients/clients.routes";
import coveringLetterRoutes from "./modules/coveringLetters/coveringLetters.routes";
import departmentRoutes from "./modules/departments/departments.routes";
import enquiryRoutes from "./modules/enquiries/enquiries.routes";
import enquiryMasterRoutes from "./modules/enquiryMasters/enquiryMasters.routes";
import fieldRoutes from "./modules/fieldJobs/field.routes";
import healthRoutes from "./modules/health/health.routes";
import companyRoutes from "./modules/company/company.routes";
import holidayRoutes from "./modules/holidays/holidays.routes";
import noticeRoutes from "./modules/notices/notices.routes";
import portalHelperRoutes from "./modules/portalLogins/portalHelper.routes";
import portalLoginRoutes from "./modules/portalLogins/portalLogins.routes";
import todayRoutes from "./modules/today/today.routes";
import userRoutes from "./modules/users/users.routes";
import vendorRoutes from "./modules/vendors/vendors.routes";
import visaRoutes from "./modules/visa/visa.routes";
import visaMasterRoutes from "./modules/visaMasters/visaMasters.routes";

const app = express();

app.set("trust proxy", trustProxySetting());

// First, so every request has its code, even one the JSON parser refuses.
app.use(requestLogger);
app.use(helmet());
app.use(cors({ origin: env.CLIENT_URL.split(","), credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.use("/api", requireJson);
app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/departments", departmentRoutes);
app.use("/api/users", userRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/holidays", holidayRoutes);
app.use("/api/company", companyRoutes);
app.use("/api/masters", visaMasterRoutes);
app.use("/api/masters", enquiryMasterRoutes);
app.use("/api/masters", vendorRoutes);
app.use("/api/masters", coveringLetterRoutes);
app.use("/api/enquiries", enquiryRoutes);
app.use("/api/visa", visaRoutes);
app.use("/api/field", fieldRoutes);
app.use("/api/today", todayRoutes);
app.use("/api/notices", noticeRoutes);
app.use("/api/portal-logins", portalLoginRoutes);
// The one route without a session: the CRM helper collects a login with a one-time ticket (0024).
app.use("/api/portal-helper", portalHelperRoutes);

app.use("/api", apiNotFound);
app.use(errorHandler);

export default app;
