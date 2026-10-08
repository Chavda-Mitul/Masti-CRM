import type { Prisma } from "../../../generated/prisma/client";

/** Prisma include that loads a user's department roles with the department rows. */
export const withDepartments = {
  departments: {
    include: { department: true },
    orderBy: { department: { sortOrder: "asc" } },
  },
} satisfies Prisma.UserInclude;

export type UserWithDepartments = Prisma.UserGetPayload<{ include: typeof withDepartments }>;

/**
 * The shape of a user sent to the browser. Never includes the password hash.
 * Memberships of switched-off departments are left out: they grant nothing (see can()), so the screens must not offer them.
 */
export function toUserDto(user: UserWithDepartments) {
  return {
    id: user.id,
    name: user.name,
    mobile: user.mobile,
    email: user.email,
    type: user.type,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    departments: user.departments
      .filter((d) => d.department.isActive)
      .map((d) => ({
        code: d.department.code,
        name: d.department.name,
        role: d.role,
        access: d.access,
      })),
  };
}

export type UserDto = ReturnType<typeof toUserDto>;
