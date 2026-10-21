-- The consent form's link and the client's "I agree" (docs/decisions/0022-consent-form.md, part 2): the wording's
-- versions, the links sent on WhatsApp (only the token's SHA-256), and what each consent was given to.
-- The Consent table was empty (nothing wrote to it before), so its new columns are required.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable
ALTER TABLE "Consent" ADD COLUMN     "details" JSONB NOT NULL,
ADD COLUMN     "ip" TEXT,
ADD COLUMN     "linkId" TEXT NOT NULL,
ADD COLUMN     "userAgent" TEXT,
ADD COLUMN     "wordingId" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "ConsentWording" (
    "id" SERIAL NOT NULL,
    "body" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentWording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentLink" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "toMobile" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "replacedAt" TIMESTAMPTZ(3),
    "usedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ConsentLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsentLink_tokenHash_key" ON "ConsentLink"("tokenHash");

-- CreateIndex
CREATE INDEX "ConsentLink_memberId_createdAt_idx" ON "ConsentLink"("memberId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Consent_linkId_key" ON "Consent"("linkId");

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_wordingId_fkey" FOREIGN KEY ("wordingId") REFERENCES "ConsentWording"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ConsentLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentWording" ADD CONSTRAINT "ConsentWording_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentLink" ADD CONSTRAINT "ConsentLink_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ClientMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentLink" ADD CONSTRAINT "ConsentLink_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentLink" ADD CONSTRAINT "ConsentLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (Prisma can't express these).

-- A wording is never changed or removed: consents point at it. A new version replaces it. (TRUNCATE, for tests, still works.)
CREATE OR REPLACE FUNCTION consent_wording_kept() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ConsentWording is never changed or removed (% refused): add a new version instead', TG_OP;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ConsentWording_kept" BEFORE UPDATE OR DELETE ON "ConsentWording"
  FOR EACH ROW EXECUTE FUNCTION consent_wording_kept();
ALTER TABLE "ConsentWording" ADD CONSTRAINT "ConsentWording_body_text" CHECK (btrim("body") <> '' AND char_length("body") <= 8000);

-- A link is either agreed through or replaced by a newer one, never both.
ALTER TABLE "ConsentLink" ADD CONSTRAINT "ConsentLink_used_or_replaced" CHECK ("usedAt" IS NULL OR "replacedAt" IS NULL);
ALTER TABLE "ConsentLink" ADD CONSTRAINT "ConsentLink_toMobile_format" CHECK ("toMobile" ~ '^\+91[6-9][0-9]{9}$');
-- At most one link per person still open (neither used nor replaced).
CREATE UNIQUE INDEX "ConsentLink_one_open_per_member" ON "ConsentLink" ("memberId") WHERE "usedAt" IS NULL AND "replacedAt" IS NULL;
