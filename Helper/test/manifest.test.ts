import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { turnOffPasswordSaving } from "../src/passwordSaving";

// The helper asks Chrome for as little as it needs, and only the CRM's pages can talk to it.

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));

/** Chrome's extension ID: the first 16 bytes of the public key's sha256, written with the letters a–p. */
const idOf = (key: string) =>
  [...createHash("sha256").update(Buffer.from(key, "base64")).digest().subarray(0, 16).toString("hex")]
    .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
    .join("");

describe("the manifest", () => {
  it("asks only to run in pages and to switch off Chrome's password saving", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(["scripting", "privacy"]);
    expect(manifest.host_permissions).toEqual(["https://*/*", "http://*/*"]);
    expect(manifest.background).toEqual({ service_worker: "background.js", type: "module" });
    expect(manifest).not.toHaveProperty("content_scripts");
    expect(manifest).not.toHaveProperty("optional_permissions");
  });

  it("lets only the CRM's pages talk to it: named hosts, and no other extension", () => {
    const { externally_connectable: connect } = manifest;
    expect(connect).not.toHaveProperty("ids");
    expect(connect.matches.length).toBeGreaterThan(0);
    for (const pattern of connect.matches as string[]) expect(pattern, pattern).toMatch(/^https?:\/\/[a-z0-9.-]+\/\*$/);
  });

  it("has the development key behind the helper ID in Backend/.env.example", () => {
    const example = readFileSync("../Backend/.env.example", "utf8");
    const ids = /^PORTAL_HELPER_IDS=(.*)$/m.exec(example)?.[1]?.split(",") ?? [];
    expect(ids).toContain(idOf(manifest.key));
  });
});

describe("Chrome's own Save password offer", () => {
  function fakeSetting(levelOfControl: string, value: boolean) {
    const set: unknown[] = [];
    return {
      set,
      setting: {
        get: async () => ({ levelOfControl, value }),
        set: async (details: unknown) => void set.push(details),
      } as unknown as Parameters<typeof turnOffPasswordSaving>[0],
    };
  }

  it("is switched off when the helper may", async () => {
    const free = fakeSetting("controllable_by_this_extension", true);
    await turnOffPasswordSaving(free.setting);
    expect(free.set).toEqual([{ value: false }]);
  });

  it("is left alone when it's already off, or when a policy or another extension decides", async () => {
    for (const [level, value] of [["controlled_by_this_extension", false], ["not_controllable", true], ["controlled_by_other_extensions", true]] as const) {
      const fake = fakeSetting(level, value);
      await turnOffPasswordSaving(fake.setting);
      expect(fake.set, level).toEqual([]);
    }
  });
});
