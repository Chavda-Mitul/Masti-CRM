export type Identifier = { kind: "email"; email: string } | { kind: "mobile"; mobile: string };

/** Lowercased, trimmed email. */
export function normaliseEmail(input: string): string {
  return input.trim().toLowerCase();
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

/** What the user typed in the "Mobile number or email" box. */
export function parseIdentifier(input: string): Identifier | null {
  const value = input.trim();
  if (value.includes("@")) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? { kind: "email", email: normaliseEmail(value) } : null;
  }
  const mobile = normaliseMobile(value);
  return mobile ? { kind: "mobile", mobile } : null;
}
