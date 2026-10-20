-- Family members' own numbers: the New enquiry lookup (equality) and the Clients search (any part).
-- 0004 amendment of 20 Oct 2026.

CREATE INDEX "ClientMember_mobile_idx" ON "ClientMember"("mobile");

CREATE INDEX "ClientMember_mobile_trgm_idx" ON "ClientMember" USING GIN ("mobile" gin_trgm_ops);
