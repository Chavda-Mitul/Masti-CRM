import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { parseHelperIds, parseVaultKey } from "../src/config/vaultKey";
import { audit } from "../src/lib/audit";
import { openSecret, sealSecret, SecretUnreadableError, VaultKeyMissingError, vaultReady } from "../src/lib/secretBox";
import { prisma, resetDb } from "./helpers";

const login = { loginId: "MASTI-AGENT-01", password: "Spring-Visa-2026!" };

describe("PORTAL_VAULT_KEY", () => {
  it("accepts 32 bytes in base64", () => {
    const parsed = parseVaultKey(` ${randomBytes(32).toString("base64")} `);
    expect("value" in parsed && parsed.value.length).toBe(32);
  });

  it("refuses text that isn't base64, and keys that aren't 32 bytes", () => {
    for (const bad of ["", "not base64!!", "abc def", randomBytes(31).toString("base64"), randomBytes(33).toString("base64")]) {
      expect(parseVaultKey(bad), bad).toHaveProperty("error");
    }
  });
});

describe("PORTAL_HELPER_IDS", () => {
  it("accepts Chrome extension IDs, comma-separated, without repeats", () => {
    expect(parseHelperIds("")).toEqual({ value: [] });
    const id = "cbgfmlcnmcldkginifhpfcgpgfclmhfg";
    expect(parseHelperIds(` ${id}, ${id} ,aaaabbbbccccddddeeeeffffgggghhhh`)).toEqual({ value: [id, "aaaabbbbccccddddeeeeffffgggghhhh"] });
  });

  it("refuses anything else", () => {
    for (const bad of ["abc", "CBGFMLCNMCLDKGINIFHPFCGPGFCLMHFG", "qbgfmlcnmcldkginifhpfcgpgfclmhfg", "cbgfmlcnmcldkginifhpfcgpgfclmhf"]) {
      expect(parseHelperIds(bad), bad).toHaveProperty("error");
    }
  });
});

describe("sealing a portal's ID and password", () => {
  const key = randomBytes(32);
  const label = "portal-login:11111111-1111-4111-8111-111111111111";

  it("opens what it sealed, and never shows the password in the sealed bytes", () => {
    const blob = sealSecret(login, label, key);
    expect(openSecret(blob, label, key)).toEqual(login);
    expect(blob.toString("latin1")).not.toContain(login.password);
    expect(blob.toString("latin1")).not.toContain(login.loginId);
  });

  it("gives a different blob each time", () => {
    expect(sealSecret(login, label, key).equals(sealSecret(login, label, key))).toBe(false);
  });

  it("refuses a changed IV, tag or text", () => {
    const blob = sealSecret(login, label, key);
    for (const at of [1, 13, blob.length - 1]) {
      const changed = Buffer.from(blob);
      changed[at] = changed[at]! ^ 0x01;
      expect(() => openSecret(changed, label, key), `byte ${at}`).toThrow(SecretUnreadableError);
    }
  });

  it("refuses another row's label, another key, an unknown version and a cut-short blob", () => {
    const blob = sealSecret(login, label, key);
    expect(() => openSecret(blob, "portal-login:22222222-2222-4222-8222-222222222222", key)).toThrow(SecretUnreadableError);
    expect(() => openSecret(blob, label, randomBytes(32))).toThrow(SecretUnreadableError);
    const v2 = Buffer.from(blob);
    v2[0] = 2;
    expect(() => openSecret(v2, label, key)).toThrow(SecretUnreadableError);
    expect(() => openSecret(blob.subarray(0, 29), label, key)).toThrow(SecretUnreadableError);
  });

  it("says when the server has no key", () => {
    expect(vaultReady(null)).toBe(false);
    expect(() => sealSecret(login, label, null)).toThrow(VaultKeyMissingError);
    expect(() => openSecret(Buffer.alloc(40), label, null)).toThrow(VaultKeyMissingError);
  });

  it("uses the test key from vitest.config.mts by default", () => {
    expect(vaultReady()).toBe(true);
    expect(openSecret(sealSecret(login, label), label)).toEqual(login);
  });
});

describe("the audit log", () => {
  beforeEach(resetDb);

  it("never keeps a portal's ID, password, sealed secret or ticket, at any depth", async () => {
    await audit({
      action: "portalLogin.test",
      entityType: "PortalLogin",
      before: { name: "France visa portal", loginId: "MASTI-AGENT-01", secret: "c2VhbGVk", nested: { password: "x", ticket: "t" } },
      after: { name: "France visa portal", list: [{ loginId: "MASTI-AGENT-01", ticket: "t" }] },
    });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "portalLogin.test" } });
    expect(row.before).toEqual({ name: "France visa portal", nested: {} });
    expect(row.after).toEqual({ name: "France visa portal", list: [{}] });
  });
});
