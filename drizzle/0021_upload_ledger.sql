CREATE TABLE `uploads` (
	`name` text NOT NULL,
	`user_id` integer NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `name`)
);
