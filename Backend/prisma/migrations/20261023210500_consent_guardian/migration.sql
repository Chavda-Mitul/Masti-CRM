-- A parent or guardian agrees for a child (docs/decisions/0022-consent-form.md amendment 2, change request 18): the
-- person who agrees on a child's behalf, on the child (kept with the form), on the link sent to them, and on the consent
-- they gave.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable
ALTER TABLE "ClientMember" ADD COLUMN     "consentGuardianId" TEXT;

-- AlterTable
ALTER TABLE "Consent" ADD COLUMN     "guardianId" TEXT;

-- AlterTable
ALTER TABLE "ConsentLink" ADD COLUMN     "guardianId" TEXT;

-- AddForeignKey
ALTER TABLE "ClientMember" ADD CONSTRAINT "ClientMember_consentGuardianId_fkey" FOREIGN KEY ("consentGuardianId") REFERENCES "ClientMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "ClientMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentLink" ADD CONSTRAINT "ConsentLink_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "ClientMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (Prisma can't express these).

-- Nobody agrees for themselves as their own guardian, on the form, the link or the consent.
ALTER TABLE "ClientMember" ADD CONSTRAINT "ClientMember_guardian_not_self" CHECK ("consentGuardianId" IS DISTINCT FROM "id");
ALTER TABLE "ConsentLink" ADD CONSTRAINT "ConsentLink_guardian_not_self" CHECK ("guardianId" IS DISTINCT FROM "memberId");
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_guardian_not_self" CHECK ("guardianId" IS DISTINCT FROM "memberId");

-- A consent on paper has no guardian: the signed paper at the office says who signed.
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_paper_no_guardian" CHECK ("source" = 'LINK' OR "guardianId" IS NULL);
