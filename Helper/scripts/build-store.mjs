// npm run build:store -- --crm https://<Masti's CRM address>: after the normal build, the helper as it's uploaded to the
// Chrome Web Store, in dist-store/ (docs/decisions/0024-portal-logins.md, component 4). Helper/office-pc/README.md says
// what comes next.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { storeManifest } from "./storeManifest.ts";

try {
  const at = process.argv.indexOf("--crm");
  const crm = at === -1 ? undefined : process.argv[at + 1];
  if (!crm) throw new Error("Give the CRM's address: npm run build:store -- --crm https://crm.example.in");
  const manifest = storeManifest(JSON.parse(readFileSync("manifest.json", "utf8")), crm);

  rmSync("dist-store", { recursive: true, force: true });
  mkdirSync("dist-store");
  // Only the files built from src/ now, never one left in dist/ by an older build.
  for (const source of readdirSync("src").filter((name) => name.endsWith(".ts"))) {
    const file = source.replace(/\.ts$/, ".js");
    copyFileSync(`dist/${file}`, `dist-store/${file}`);
  }
  writeFileSync("dist-store/manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `Built dist-store/ (version ${manifest.version}) for ${new URL(crm).hostname}. Zip the files inside it and upload ` +
      "the zip to the Chrome Web Store: see Helper/office-pc/README.md.",
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
