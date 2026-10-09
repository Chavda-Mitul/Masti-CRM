-- A GSTIN carries its holder's GST state in its first two digits, and the state decides the GST type on invoices
-- (which are never edited). The service already refuses a different state; this also guards the Excel import.

-- The GSTIN is checksum-checked, so it wins over a state that contradicts it. Production has none.
UPDATE "Client" SET "stateCode" = left("gstin", 2)
WHERE "gstin" IS NOT NULL AND "stateCode" IS NOT NULL AND left("gstin", 2) <> "stateCode";

ALTER TABLE "Client" ADD CONSTRAINT "Client_gstin_matches_state" CHECK ("gstin" IS NULL OR "stateCode" IS NULL OR left("gstin", 2) = "stateCode");
