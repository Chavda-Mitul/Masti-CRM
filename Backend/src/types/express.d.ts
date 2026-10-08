import type { ApiScope } from "../../generated/prisma/enums";
import type { UserWithDepartments } from "../modules/users/user";

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth. */
      auth?: {
        user: UserWithDepartments;
        sessionId: string;
      };
      /** Set by requireApiClient on machine-to-machine routes (/api/inbound/*). */
      apiClient?: {
        id: string;
        name: string;
        scopes: ApiScope[];
      };
    }
  }
}

export {};
