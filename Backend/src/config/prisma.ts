import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../../generated/prisma/client";
import { env } from "./env";

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });

/** The client or a transaction client. Helpers that write take one so callers can include them in a $transaction. */
export type Db = Prisma.TransactionClient | typeof prisma;
