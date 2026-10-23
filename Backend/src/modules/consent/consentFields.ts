import { z } from "zod";
import type { ClientMember, ConsentAnswer, ConsentField } from "../../../generated/prisma/client";
import type { Db } from "../../config/prisma";
import { fromDbDate } from "../../lib/dates";
import { CONSENT_ANSWER_MAX } from "./consent.schemas";

// The consent form's fields (docs/decisions/0022-consent-form.md amendment 1): a master the Head and the Visa HOD shape.
// What each kind of field takes, and where a person's answer lives: a fixed field's in its column on the person, any
// other's in ConsentAnswer.

/** The fields in use, in the form's order. */
export function activeConsentFields(db: Db) {
  return db.consentField.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
}

/** A field as the form draws it. */
export function toConsentFieldDto(f: ConsentField) {
  return { id: f.id, label: f.label, kind: f.kind, required: f.required, fixed: f.fixed };
}

/** The person as their answers need them: the fixed fields' columns, and the rest. */
export type AnsweringPerson = Pick<ClientMember, "dateOfBirth" | "residentialAddress" | "officeAddress"> & {
  consentAnswers: Pick<ConsentAnswer, "fieldId" | "value">[];
};

/** The person's answer to one field, or null: a date as YYYY-MM-DD. */
export function answerOf(field: Pick<ConsentField, "id" | "fixed">, person: AnsweringPerson): string | null {
  switch (field.fixed) {
    case "DATE_OF_BIRTH":
      return person.dateOfBirth ? fromDbDate(person.dateOfBirth) : null;
    case "HOME_ADDRESS":
      return person.residentialAddress;
    case "OFFICE_ADDRESS":
      return person.officeAddress;
    default:
      return person.consentAnswers.find((a) => a.fieldId === field.id)?.value ?? null;
  }
}

/** Each field's answer, keyed by the field's id, as the form fills in. */
export function answersOf(fields: Pick<ConsentField, "id" | "fixed">[], person: AnsweringPerson) {
  return Object.fromEntries(fields.map((f) => [String(f.id), answerOf(f, person)]));
}

/** The largest number: the income limit the form had before. */
const MAX_NUMBER = 2_000_000_000;
const isoDate = z.iso.date();

/**
 * One answer as staff typed it, checked against its field: `value` is what to keep (null for none), or `error` says
 * what's wrong, for the form. A link gets "https://" when it has none; a number loses its commas and spaces.
 */
export function cleanAnswer(
  field: Pick<ConsentField, "kind" | "required">,
  typed: string | null,
  today: string,
): { value: string | null; error?: undefined } | { error: string } {
  const text = typed?.trim() ?? "";
  if (!text) return field.required ? { error: "Fill this in." } : { value: null };
  switch (field.kind) {
    case "DATE":
      if (!isoDate.safeParse(text).success) return { error: "Use a valid date." };
      if (text > today) return { error: "This date is in the future." };
      return { value: text };
    case "NUMBER": {
      const digits = text.replace(/[,\s]/g, "");
      if (!/^\d+$/.test(digits)) return { error: "Digits only: a whole number." };
      const n = Number(digits);
      if (n > MAX_NUMBER) return { error: "That's too large." };
      return { value: String(n) };
    }
    case "LINK": {
      const link = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
      if (/\s/.test(link) || !isWebAddress(link)) return { error: "Enter a web address, like instagram.com/name." };
      if (link.length > CONSENT_ANSWER_MAX.LINK) return { error: `At most ${CONSENT_ANSWER_MAX.LINK} characters.` };
      return { value: link };
    }
    default: {
      const max = CONSENT_ANSWER_MAX[field.kind];
      return text.length > max ? { error: `At most ${max} characters.` } : { value: text };
    }
  }
}

/** http(s), with a host that has a dot in it (instagram.com, not "instagram"). */
function isWebAddress(link: string) {
  try {
    const url = new URL(link);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".");
  } catch {
    return false;
  }
}
