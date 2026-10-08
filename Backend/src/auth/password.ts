import { hash, verify } from "@node-rs/argon2";
import { randomInt } from "node:crypto";

export const MIN_PASSWORD_LENGTH = 8;

/** argon2id with the library's recommended defaults. */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// A real argon2 hash of a random value, so login takes the same time whether or not the account exists.
let dummyHash: Promise<string> | undefined;
export function verifyAgainstDummy(password: string): Promise<boolean> {
  dummyHash ??= hash(`dummy-${randomInt(1_000_000_000)}`);
  return dummyHash.then((h) => verifyPassword(h, password));
}

// No look-alike characters (0/O, 1/l/I), so a temp password can be read out or typed from WhatsApp.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Readable temporary password, e.g. "Kp7w-x3Mf-9qTe". The user must change it at first login. */
export function generateTempPassword(): string {
  const group = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${group()}-${group()}-${group()}`;
}
