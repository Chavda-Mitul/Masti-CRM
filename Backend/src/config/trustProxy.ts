import { isIP } from "node:net";

// TRUST_PROXY → Express's "trust proxy". It decides req.ip, which the office-network rule, the login rate limits and
// the audit log all rely on. No side effects here, so it can be tested on its own.

/** false: no proxy. A number: that many proxy hops. A list: the proxies' addresses or subnets. */
export type TrustProxy = false | number | string[];

/** proxy-addr's names for whole address ranges. */
const NAMED_RANGES = new Set(["loopback", "linklocal", "uniquelocal"]);

function isAddressOrSubnet(entry: string): boolean {
  if (NAMED_RANGES.has(entry)) return true;
  const [base, prefix, ...rest] = entry.split("/");
  const family = base ? isIP(base) : 0;
  if (!family || rest.length > 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * Parses TRUST_PROXY, or returns an error message.
 * "true" is refused: Express would then believe the left-most X-Forwarded-For entry, which the browser controls, so
 * anyone could claim an office IP, dodge the login limits and put any address in the audit log.
 */
export function parseTrustProxy(raw: string): { value: TrustProxy } | { error: string } {
  const value = raw.trim().toLowerCase();
  if (value === "" || value === "false" || value === "0") return { value: false };
  if (value === "true") {
    return { error: 'TRUST_PROXY=true trusts a header any browser can fake. Use the hop count (e.g. "1" for one nginx) or the proxy IPs.' };
  }
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    return hops <= 10 ? { value: hops } : { error: "TRUST_PROXY: a hop count above 10 is surely a mistake." };
  }
  const entries = value.split(",").map((e) => e.trim());
  const bad = entries.filter((e) => !isAddressOrSubnet(e));
  if (bad.length > 0) {
    return { error: `TRUST_PROXY: not an IP address or subnet: ${bad.map((e) => `"${e}"`).join(", ")}. Use a hop count or proxy IPs.` };
  }
  return { value: entries };
}
