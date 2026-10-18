CREATE TABLE `display_name_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`display_name` text NOT NULL,
	`kind` text NOT NULL,
	`changed_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `users` ADD `joined_via` text;--> statement-breakpoint
ALTER TABLE `users` ADD `email_hash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `created_at` text;