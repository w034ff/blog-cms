CREATE TABLE `author_allowlist` (
	`email` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text,
	`password_hash` text,
	`role` text DEFAULT 'author' NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`suspended_at` text,
	`google_sub` text
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "username", "password_hash", "role", "display_name", "suspended_at", "google_sub") SELECT "id", "username", "password_hash", "role", "display_name", "suspended_at", NULL FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_sub_unique` ON `users` (`google_sub`);