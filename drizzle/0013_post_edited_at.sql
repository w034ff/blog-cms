ALTER TABLE `posts` ADD `edited_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- The last edit was not recorded before this column. `updated_at` is the closest known moment: a
-- draft's autosave and every publish moved it. A published post's unpublished edits since then are
-- not recoverable; its next autosave sets the real value.
UPDATE `posts` SET `edited_at` = `updated_at`;
