-- Client.name is required in the database too (0004 Amendment, 9 Oct 2026). Staff saves already required it;
-- now integrations and the Excel import must supply one as well. It also keeps the client directory's paging sound:
-- it sorts by name, and a cursor row with no name made Prisma's keyset condition match every row.
--
-- (Prisma also proposes dropping "HolidayTarget_unique". Keep it: it is the NULLS NOT DISTINCT unique index from
-- 20261008133011_system_masters, which the schema can't express.)

-- Clients saved with only the mobile before 9 Oct get a placeholder staff can see and correct. Production has none.
UPDATE "Client" SET "name" = 'Client ' || "mobile" WHERE "name" IS NULL OR btrim("name") = '';

-- AlterTable
ALTER TABLE "Client" ALTER COLUMN "name" SET NOT NULL;

ALTER TABLE "Client" ADD CONSTRAINT "Client_name_not_blank" CHECK (btrim("name") <> '');
