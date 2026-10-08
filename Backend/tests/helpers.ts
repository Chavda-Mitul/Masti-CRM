import request from "supertest";
import type { Access, DepartmentRole, UserType } from "../generated/prisma/client";
import app from "../src/app";
import { clearOfficeNetworkCache } from "../src/modules/auth/officeNetwork";
import { hashPassword } from "../src/modules/auth/password";
import { seedClientLookups } from "../src/modules/clients/clients.seed";
import { prisma } from "../src/config/prisma";

export const PASSWORD = "Correct-Horse-9";

const DEPARTMENTS = ["VISA", "HOLIDAYS", "HOTELS", "INSURANCE", "TICKETS", "ACCOUNTS"];

/** Wipes every table and recreates the departments and client lookups. TRUNCATE is allowed on the append-only audit log. */
export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "AuditLog", "Session", "FieldJob", "UserDepartment", "ClientNote", "ClientMember", "ClientPhone", "Client", ' +
      '"BillingCycle", "PaymentHabit", "Relation", "HolidayTarget", "Holiday", "ApiClient", "VisaChecklistItem", "VisaOffering", ' +
      '"DocumentMaster", "Embassy", "VisaType", "Country", "User", "Setting", "Department" RESTART IDENTITY CASCADE',
  );
  await prisma.department.createMany({
    data: DEPARTMENTS.map((code, i) => ({ code, name: code[0] + code.slice(1).toLowerCase(), sortOrder: i + 1 })),
  });
  await seedClientLookups(prisma);
  clearOfficeNetworkCache();
}

let hashed: Promise<string> | undefined;

interface NewUser {
  name?: string;
  mobile?: string | null;
  email?: string | null;
  type?: UserType;
  isActive?: boolean;
  mustChangePassword?: boolean;
  departments?: { code: string; role?: DepartmentRole; access?: Access }[];
}

/** Creates a user directly in the database. Password is PASSWORD. */
export async function createUser(input: NewUser = {}) {
  hashed ??= hashPassword(PASSWORD);
  const departments = await prisma.department.findMany();
  return prisma.user.create({
    data: {
      name: input.name ?? "Test User",
      mobile: input.mobile === undefined ? null : input.mobile,
      email: input.email === undefined ? null : input.email,
      type: input.type ?? "OFFICE",
      isActive: input.isActive ?? true,
      mustChangePassword: input.mustChangePassword ?? false,
      passwordHash: await hashed,
      departments: {
        create: (input.departments ?? []).map((d) => ({
          departmentId: departments.find((x) => x.code === d.code)!.id,
          role: d.role ?? "STAFF",
          access: d.access ?? "VIEW",
        })),
      },
    },
  });
}

/** A cookie-keeping client, logged in as the given identifier. */
export async function loginAs(identifier: string, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ identifier, password });
  if (res.status !== 200) throw new Error(`login failed (${res.status}): ${JSON.stringify(res.body)}`);
  return agent;
}

export { app, prisma, request };
