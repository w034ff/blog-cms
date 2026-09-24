CREATE TABLE `post_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`post_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`reason` text NOT NULL,
	`content` text NOT NULL
);
