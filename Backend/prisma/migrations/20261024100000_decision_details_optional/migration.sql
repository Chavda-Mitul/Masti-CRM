-- "Record the decision" is Approved or Refused only (docs/decisions/0012-visa-decision.md, amended 23 Oct 2026, change
-- request 21): an approved visa's sticker (or e-visa) number and the dates it's valid are optional, added later with
-- Change on the Decision card. A refused or undecided traveller still has none; valid-to is still on or after
-- valid-from when both are there. The number's format (VisaCaseTraveller_visa_no_format) is unchanged.

-- Hand-written (Prisma can't express these). "IS NOT DISTINCT FROM": an undecided traveller (outcome NULL) must make the
-- first branch false, not NULL, or the CHECK would let it through with a number.
ALTER TABLE "VisaCaseTraveller" DROP CONSTRAINT "VisaCaseTraveller_outcome_details";
ALTER TABLE "VisaCaseTraveller" ADD CONSTRAINT "VisaCaseTraveller_outcome_details" CHECK (
  ("outcome" IS NOT DISTINCT FROM 'APPROVED' AND ("validFrom" IS NULL OR "validTo" IS NULL OR "validTo" >= "validFrom"))
  OR ("outcome" IS DISTINCT FROM 'APPROVED' AND "visaNo" IS NULL AND "validFrom" IS NULL AND "validTo" IS NULL)
);
