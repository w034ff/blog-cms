CREATE TABLE `link_previews` (
	`url` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`fetched_at` integer NOT NULL
);
