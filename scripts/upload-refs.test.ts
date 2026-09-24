import { describe, expect, it } from 'vitest';
import { createTestSqlite } from '@/test/db';
import { referencedInDb } from '@/scripts/upload-refs.mts';

// docs/revision-requirements.md §8 row 8, plus the columns that were already swept for.
describe('referencedInDb', () => {
  it('counts an image referenced only by a revision', () => {
    const db = createTestSqlite();
    db.prepare(
      `INSERT INTO posts (slug, title, date, body, draft_content, thumbnail)
       VALUES ('s', 't', '', '![](/uploads/body.png)', '{"body":"![](/uploads/pending.png)"}', '/uploads/thumb.png')`,
    ).run();
    db.prepare(
      `INSERT INTO post_revisions (post_id, created_at, reason, content)
       VALUES (1, 0, 'publish', '{"body":"![](/uploads/only-in-revision.png)"}')`,
    ).run();
    expect([...referencedInDb(db)].sort()).toEqual([
      'body.png',
      'only-in-revision.png',
      'pending.png',
      'thumb.png',
    ]);
  });

  it('reads a DB the revisions migration has not reached', () => {
    const db = createTestSqlite();
    db.exec('DROP TABLE post_revisions');
    db.prepare(
      `INSERT INTO posts (slug, title, date, body) VALUES ('s', 't', '', '![](/uploads/a.png)')`,
    ).run();
    expect([...referencedInDb(db)]).toEqual(['a.png']);
  });
});
