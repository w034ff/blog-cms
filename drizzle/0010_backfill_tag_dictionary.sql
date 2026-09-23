-- Every tag already in use becomes a dictionary entry (docs/editor-requirements.md §12.33), with
-- its name equal to its slug — the value is kept as the slug so /tags/<value> keeps working, and
-- the name can be renamed in /admin/tags afterwards. Read from all three places a post's tags
-- live, or restoring a revision would drop the tags only it still carried.
INSERT OR IGNORE INTO `tags` (`slug`, `name`)
SELECT DISTINCT `value`, `value` FROM (
  SELECT j.`value` FROM `posts`, json_each(`posts`.`tags`) AS j WHERE j.`type` = 'text'
  UNION
  SELECT j.`value` FROM `posts`, json_each(`posts`.`draft_content`, '$.tags') AS j
    WHERE `posts`.`draft_content` IS NOT NULL AND j.`type` = 'text'
  UNION
  SELECT j.`value` FROM `post_revisions`, json_each(`post_revisions`.`content`, '$.tags') AS j
    WHERE j.`type` = 'text'
)
WHERE trim(`value`) <> ''
ORDER BY `value`;
