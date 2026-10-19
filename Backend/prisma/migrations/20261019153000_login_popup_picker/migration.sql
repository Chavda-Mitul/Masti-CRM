-- Who put a notice in the visa team's login popup (docs/decisions/0017-today-dashboard.md Decision 12): it isn't news to
-- them, so their own popup leaves it out.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable
ALTER TABLE "Notice" ADD COLUMN     "loginPopupById" TEXT;

-- AddForeignKey
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_loginPopupById_fkey" FOREIGN KEY ("loginPopupById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (Prisma can't express these).

-- In the popup means picked by someone, and only then.
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_login_popup_picker" CHECK (("loginPopupAt" IS NULL) = ("loginPopupById" IS NULL));
