import type { Request, RequestHandler } from "express";
import type { ApiScope } from "../../generated/prisma/enums";
import { forbidden, unauthorized } from "../lib/httpError";
import { ipAllowed } from "../modules/auth/officeNetwork";
import { apiKeyFromHeader } from "../modules/apiClients/apiKey";
import { findApiClientByKey, markApiClientUsed } from "../modules/apiClients/apiClients.service";

/**
 * Machine-to-machine routes (/api/inbound/*): needs "Authorization: Bearer mcrm_…" for an active machine account
 * with this scope, called from an allowed address. Sets req.apiClient. Session cookies are ignored here, and
 * session routes never accept a key (docs/decisions/0005-system-masters.md §5).
 */
export function requireApiClient(scope: ApiScope): RequestHandler {
  return async (req, _res, next) => {
    const key = apiKeyFromHeader(req.headers.authorization);
    if (!key) throw unauthorized("Send a valid API key: Authorization: Bearer mcrm_…");

    const client = await findApiClientByKey(key);
    if (!client?.isActive) throw unauthorized("This API key isn't valid or has been switched off.");
    if (!client.scopes.includes(scope)) throw forbidden("This API key isn't allowed to do this.");
    if (client.allowedIps.length > 0 && !ipAllowed(req.ip, client.allowedIps)) {
      throw forbidden("This API key can't be used from this address.");
    }

    await markApiClientUsed(client.id, req.ip ?? null);
    req.apiClient = { id: client.id, name: client.name, scopes: client.scopes };
    next();
  };
}

/** Use after requireApiClient. */
export function currentApiClient(req: Request) {
  if (!req.apiClient) throw unauthorized();
  return req.apiClient;
}
