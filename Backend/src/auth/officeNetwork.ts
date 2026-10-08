import { BlockList, isIP } from "node:net";
import { z } from "zod";
import { UserType } from "../../generated/prisma/client";
import { prisma } from "../config/prisma";
import type { UserWithDepartments } from "./user";

/**
 * "IP-based" CRM login (open question Q14): when enabled, users may only use the CRM from the office network.
 * Off by default. Users whose type is in exemptUserTypes (FIELD by default: the collection boy works outside) are not restricted.
 * Stored in the Setting table under this key.
 */
export const OFFICE_NETWORK_KEY = "officeNetwork";

export const officeNetworkSchema = z.object({
  enabled: z.boolean(),
  /** IPs or CIDR ranges, IPv4 or IPv6, e.g. "203.0.113.10" or "203.0.113.0/24". */
  allow: z.array(z.string()),
  exemptUserTypes: z.array(z.enum(UserType)),
});

export type OfficeNetworkSetting = z.infer<typeof officeNetworkSchema>;

export const DEFAULT_OFFICE_NETWORK: OfficeNetworkSetting = { enabled: false, allow: [], exemptUserTypes: ["FIELD"] };

const CACHE_MS = 15_000;
let cache: { value: OfficeNetworkSetting; at: number } | undefined;

/** Call after changing the setting so it applies immediately. */
export function clearOfficeNetworkCache() {
  cache = undefined;
}

export async function getOfficeNetworkSetting(): Promise<OfficeNetworkSetting> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const row = await prisma.setting.findUnique({ where: { key: OFFICE_NETWORK_KEY } });
  const parsed = officeNetworkSchema.safeParse(row?.value);
  const value = parsed.success ? parsed.data : DEFAULT_OFFICE_NETWORK;
  cache = { value, at: Date.now() };
  return value;
}

/** "::ffff:203.0.113.10" → "203.0.113.10" */
function normaliseIp(ip: string): string {
  return ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
}

export function ipAllowed(ip: string | undefined, allow: string[]): boolean {
  if (!ip) return false;
  const address = normaliseIp(ip);
  const family = isIP(address);
  if (!family) return false;
  const list = new BlockList();
  for (const entry of allow) {
    const [base, prefix] = entry.trim().split("/");
    const entryFamily = base ? isIP(base) : 0;
    if (!base || !entryFamily) continue;
    const type = entryFamily === 6 ? "ipv6" : "ipv4";
    if (prefix !== undefined) list.addSubnet(base, Number(prefix), type);
    else list.addAddress(base, type);
  }
  return list.check(address, family === 6 ? "ipv6" : "ipv4");
}

/** True if this user may use the CRM from this IP under the current office-network setting. */
export async function officeNetworkAllows(user: UserWithDepartments, ip: string | undefined): Promise<boolean> {
  const setting = await getOfficeNetworkSetting();
  if (!setting.enabled) return true;
  if (setting.exemptUserTypes.includes(user.type)) return true;
  return ipAllowed(ip, setting.allow);
}
