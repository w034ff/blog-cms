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

  // docs/scribble-requirements.md §8 row 7: a scribble's images are not swept.
  it('counts an image referenced only by a scribble', () => {
    const db = createTestSqlite();
    db.prepare(
      `INSERT INTO posts (slug, title, date, body, kind)
       VALUES ('s', 't', '', '![](/uploads/scribble.png)', 'scribble')`,
    ).run();
    expect([...referencedInDb(db)]).toEqual(['scribble.png']);
  });

  it('reads a DB the revisions migration has not reached', () => {
    const db = createTestSqlite();
    db.exec('DROP TABLE post_revisions');
    db.prepare(
      `INSERT INTO posts (slug, title, date, body) VALUES ('s', 't', '', '![](/uploads/a.png)')`,
    ).run();
    expect([...referencedInDb(db)]).toEqual(['a.png']);
  });

  // docs/site-settings-requirements.md §6 id=9: the share image is referenced by no post.
  it('counts an image referenced only by a site setting', () => {
    const db = createTestSqlite();
    db.prepare(
      `INSERT INTO app_settings (key, value) VALUES ('site_share_image', '/uploads/share.png')`,
    ).run();
    expect([...referencedInDb(db)]).toEqual(['share.png']);
  });

  // docs/abuse-limits-requirements.md §8 row 8: the ledger names what was uploaded, not what is
  // used, so reading it would keep every image forever.
  it('does not count an image only because the ledger lists it', () => {
    const db = createTestSqlite();
    db.prepare(
      `INSERT INTO uploads (name, user_id, bytes, created_at)
       VALUES ('ledger-only.png', 1, 10, '2026-10-19T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO posts (slug, title, date, body) VALUES ('s', 't', '', '![](/uploads/used.png)')`,
    ).run();
    expect([...referencedInDb(db)]).toEqual(['used.png']);
  });
});
