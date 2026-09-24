CREATE TABLE `tag_aliases` (
	`alias` text PRIMARY KEY NOT NULL,
	`tag_id` integer NOT NULL,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
