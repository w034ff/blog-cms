CREATE TABLE `bookmarks` (
	`user_id` integer NOT NULL,
	`post_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `post_id`)
);
--> statement-breakpoint
CREATE TABLE `likes` (
	`user_id` integer NOT NULL,
	`post_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `post_id`)
);
--> statement-breakpoint
CREATE TABLE `post_views` (
	`user_id` integer NOT NULL,
	`post_id` integer NOT NULL,
	`viewed_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `post_id`)
);
--> statement-breakpoint
ALTER TABLE `posts` ADD `author_id` integer;--> statement-breakpoint
-- Every row so far was written by the one admin there has been (drizzle/0012 made every account
-- an admin). The smallest id is that account; a database with no users yet leaves the rows null.
UPDATE `posts` SET `author_id` = (SELECT min(`id`) FROM `users` WHERE `role` = 'admin');
