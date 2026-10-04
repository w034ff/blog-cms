ALTER TABLE `users` ADD `role` text DEFAULT 'author' NOT NULL;--> statement-breakpoint
-- Every account so far is the one seeded from ADMIN_USERNAME (scripts/seed.mts): there was no way
-- to make another. So all of them are the admin, and a new row from here on defaults to author.
UPDATE `users` SET `role` = 'admin';
