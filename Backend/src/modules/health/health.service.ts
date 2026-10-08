import { prisma } from "../../config/prisma";

export async function databaseStatus(): Promise<"up" | "down"> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return "up";
  } catch {
    return "down";
  }
}
