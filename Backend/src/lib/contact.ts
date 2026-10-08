import { badRequest } from "./httpError";

// Clean-up and validation for mobile numbers and emails, shared by users, clients and login.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lowercased, trimmed email. */
export function normaliseEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function isEmail(input: string): boolean {
  return EMAIL_PATTERN.test(input);
}

/**
 * Indian mobile numbers normalised to +91XXXXXXXXXX.
 * Accepts "98250 41234", "098250-41234", "+91 98250 41234", "919825041234". Returns null if it isn't a valid number.
 */
export function normaliseMobile(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `+91${digits}`;
}

/** "" and null clear the field; undefined means "not sent". */
export function cleanMobile(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const mobile = normaliseMobile(value);
  if (!mobile) throw badRequest("Enter a valid 10-digit Indian mobile number.");
  return mobile;
}

/** "" and null clear the field; undefined means "not sent". */
export function cleanEmail(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const email = normaliseEmail(value);
  if (!isEmail(email)) throw badRequest("Enter a valid email address.");
  return email;
}
