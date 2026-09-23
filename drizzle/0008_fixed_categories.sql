-- Categories become a fixed list (lib/content.ts CATEGORIES, docs/editor-requirements.md §12.32).
-- The free-text values in use map onto it; anything else goes to the default, 'tech'. The two
-- JSON copies of a post's content (the working copy and its revisions) are moved too, so a
-- restore or a diff does not bring the old value back.
UPDATE `posts` SET `category` = CASE `category`
  WHEN 'tech-notes' THEN 'tech'
  WHEN 'announcements' THEN 'blog'
  ELSE 'tech' END
WHERE `category` NOT IN ('tech', 'blog');
--> statement-breakpoint
UPDATE `posts` SET `draft_content` = json_set(`draft_content`, '$.category',
  CASE json_extract(`draft_content`, '$.category')
    WHEN 'tech-notes' THEN 'tech'
    WHEN 'announcements' THEN 'blog'
    ELSE 'tech' END)
WHERE `draft_content` IS NOT NULL
  AND coalesce(json_extract(`draft_content`, '$.category'), '') NOT IN ('tech', 'blog');
--> statement-breakpoint
UPDATE `post_revisions` SET `content` = json_set(`content`, '$.category',
  CASE json_extract(`content`, '$.category')
    WHEN 'tech-notes' THEN 'tech'
    WHEN 'announcements' THEN 'blog'
    ELSE 'tech' END)
WHERE coalesce(json_extract(`content`, '$.category'), '') NOT IN ('tech', 'blog');
