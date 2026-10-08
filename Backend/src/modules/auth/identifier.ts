import { isEmail, normaliseEmail, normaliseMobile } from "../../lib/contact";

export type Identifier = { kind: "email"; email: string } | { kind: "mobile"; mobile: string };

/** What the user typed in the "Mobile number or email" box. */
export function parseIdentifier(input: string): Identifier | null {
  const value = input.trim();
  if (value.includes("@")) {
    return isEmail(value) ? { kind: "email", email: normaliseEmail(value) } : null;
  }
  const mobile = normaliseMobile(value);
  return mobile ? { kind: "mobile", mobile } : null;
}
