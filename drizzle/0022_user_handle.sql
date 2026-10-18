ALTER TABLE `users` ADD `handle` text;--> statement-breakpoint
ALTER TABLE `users` ADD `handle_chosen_at` text;--> statement-breakpoint
-- Every existing account starts on the automatic ID (docs/multi-author-requirements.md §13.2).
UPDATE `users` SET `handle` = 'user' || `id`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_handle_unique` ON `users` (`handle`);
