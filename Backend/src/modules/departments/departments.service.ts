import { prisma } from "../../config/prisma";

export function listActiveDepartments() {
  return prisma.department.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { code: true, name: true, sortOrder: true },
  });
}
