// The helper as the Chrome Web Store gets it (docs/decisions/0024-portal-logins.md, component 4). The office PCs install
// it from there, unlisted, under Masti's own account. Only Masti's CRM may talk to it, and the development key goes: the
// store gives the helper its own ID. Node runs this file as it is (scripts/build-store.mjs), so it uses only types that
// can be stripped.

/** The parts of manifest.json changed here; everything else is kept as it is. */
export interface Manifest {
  key?: string;
  externally_connectable?: { matches: string[] };
  [field: string]: unknown;
}

/** Why an address can't be the CRM's, or null: https, a real host name, and nothing after it. */
export function crmAddressProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Give the CRM's address, like https://crm.example.in";
  }
  if (url.protocol !== "https:") return "The CRM's address must start with https://";
  if (!url.hostname.includes(".") || url.hostname.endsWith(".localhost")) return "Give the CRM's real address, not localhost.";
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    return "Give only the address, like https://crm.example.in, with nothing after it.";
  }
  return null;
}

/** manifest.json made fit for the store, for the CRM at this address. */
export function storeManifest(manifest: Manifest, crmAddress: string): Manifest {
  const problem = crmAddressProblem(crmAddress);
  if (problem) throw new Error(problem);
  const store: Manifest = { ...manifest, externally_connectable: { matches: [`https://${new URL(crmAddress).hostname}/*`] } };
  delete store.key;
  return store;
}
