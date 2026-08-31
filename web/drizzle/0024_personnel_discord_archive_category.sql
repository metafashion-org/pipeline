-- Lets an Inactive/Blacklisted personnel record remember which Discord
-- category their artist channel lived in before it got archived, so
-- reactivating them (status back to Active) restores it there instead of
-- guessing or leaving it stranded in "📦 Archive".
ALTER TABLE "personnel" ADD COLUMN "discord_prior_category_id" text;
