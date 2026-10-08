import type { UserWithDepartments } from "../modules/users/user";

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth. */
      auth?: {
        user: UserWithDepartments;
        sessionId: string;
      };
    }
  }
}

export {};
