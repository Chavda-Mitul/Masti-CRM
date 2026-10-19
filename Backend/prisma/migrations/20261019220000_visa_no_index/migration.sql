-- A sticker or e-visa number already on another case is a warning when a decision is recorded or changed
-- (docs/decisions/0012-visa-decision.md, amended 19 Oct 2026); this index finds it.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateIndex
CREATE INDEX "VisaCaseTraveller_visaNo_idx" ON "VisaCaseTraveller"("visaNo");
