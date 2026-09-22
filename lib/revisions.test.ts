import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { postRevisions, posts } from '@/lib/db/schema';
import { db } from '@/lib/db';
import { autosavePost, commitPost, createPost, deletePost } from '@/lib/posts-write';
import { REVISION_KEEP, listRevisions, recordRevision, restoreRevision } from '@/lib/revisions';
import type { DraftContent } from '@/lib/types';

// docs/revision-requirements.md §8, rows 1-7. Backed by the real migrations in an in-memory DB,
// like lib/posts-write.test.ts.
vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});

beforeEach(() => {
  db.delete(postRevisions).run();
  db.delete(posts).run();
});

function content(overrides: Partial<DraftContent> = {}): DraftContent {
  return {
    title: 'Title',
    category: 'cat',
    tags: ['a'],
    thumbnail: '',
    body: 'body',
    ...overrides,
  };
}

function seed({ draft, body = 'live body' }: { draft: boolean; body?: string }): number {
  return createPost({
    slug: `slug-${Math.random()}`,
    ...content({ body }),
    date: draft ? '' : '2026-01-01T00:00:00.000Z',
    draft,
  });
}

function row(id: number) {
  const found = db.select().from(posts).where(eq(posts.id, id)).get();
  if (!found) throw new Error(`post ${id} is gone`);
  return found;
}

function reasonsAndBodies(id: number): [string, string][] {
  return listRevisions(id).map((revision) => [revision.reason, revision.content.body]);
}

describe('publish revisions (§8 row 1)', () => {
  it('keeps a published post’s live version when an update replaces it', () => {
    const id = seed({ draft: false });
    commitPost(id, content({ body: 'second' }), false, '2026-01-01T00:00:00.000Z');
    expect(reasonsAndBodies(id)).toEqual([['publish', 'live body']]);
  });

  it('keeps it when the post is taken back to a draft', () => {
    const id = seed({ draft: false });
    commitPost(id, content({ body: 'draft now' }), true, '2026-01-01T00:00:00.000Z');
    expect(reasonsAndBodies(id)).toEqual([['publish', 'live body']]);
  });

  it('keeps nothing on a draft’s first publish', () => {
    const id = seed({ draft: true });
    commitPost(id, content({ body: 'first' }), false, '2026-01-01T00:00:00.000Z');
    expect(listRevisions(id)).toEqual([]);
  });
});

describe('session revisions (§8 row 2)', () => {
  it('keeps what a session’s first save overwrites, for a draft', () => {
    const id = seed({ draft: true, body: 'opened' });
    autosavePost(id, content({ body: 'typed' }), { sessionStart: true });
    expect(reasonsAndBodies(id)).toEqual([['session', 'opened']]);
    expect(row(id).body).toBe('typed');
  });

  it('keeps the working copy a session’s first save overwrites, for a published post', () => {
    const id = seed({ draft: false });
    autosavePost(id, content({ body: 'pending' }));
    autosavePost(id, content({ body: 'next session' }), { sessionStart: true });
    expect(reasonsAndBodies(id)).toEqual([['session', 'pending']]);
  });

  it('keeps nothing without the flag', () => {
    const id = seed({ draft: true });
    autosavePost(id, content({ body: 'typed' }));
    expect(listRevisions(id)).toEqual([]);
  });

  it('keeps nothing for a published post with no working copy — its live version is still there', () => {
    const id = seed({ draft: false });
    autosavePost(id, content({ body: 'typed' }), { sessionStart: true });
    expect(listRevisions(id)).toEqual([]);
  });
});

describe('dedupe (§8 row 3)', () => {
  it('skips content the newest revision of the same pool already holds, CRLF included', () => {
    const id = seed({ draft: true });
    expect(recordRevision(id, 'session', content({ body: 'a\nb' }))).toBe(true);
    expect(recordRevision(id, 'restore', content({ body: 'a\r\nb' }))).toBe(false);
    expect(listRevisions(id)).toHaveLength(1);
  });

  it('compares within a pool only, so a published version is not left to the session pool', () => {
    const id = seed({ draft: true });
    recordRevision(id, 'session', content({ body: 'same' }));
    expect(recordRevision(id, 'publish', content({ body: 'same' }))).toBe(true);
  });

  it('stores the body with LF', () => {
    const id = seed({ draft: true });
    recordRevision(id, 'session', content({ body: 'a\r\nb' }));
    expect(listRevisions(id)[0].content.body).toBe('a\nb');
  });
});

describe('retention (§8 row 4)', () => {
  it('keeps REVISION_KEEP per pool, dropping the oldest', () => {
    const id = seed({ draft: true });
    const extra = 2;
    for (let i = 0; i < REVISION_KEEP.other + extra; i += 1) {
      recordRevision(id, i % 2 === 0 ? 'session' : 'restore', content({ body: `other ${i}` }));
    }
    for (let i = 0; i < REVISION_KEEP.publish + extra; i += 1) {
      recordRevision(id, 'publish', content({ body: `publish ${i}` }));
    }
    const revisions = listRevisions(id);
    const other = revisions.filter((revision) => revision.reason !== 'publish');
    const published = revisions.filter((revision) => revision.reason === 'publish');
    expect(other).toHaveLength(REVISION_KEEP.other);
    expect(published).toHaveLength(REVISION_KEEP.publish);
    expect(other.at(-1)?.content.body).toBe(`other ${extra}`);
    expect(published.at(-1)?.content.body).toBe(`publish ${extra}`);
  });

  it('counts each post on its own', () => {
    const a = seed({ draft: true });
    const b = seed({ draft: true });
    for (let i = 0; i < REVISION_KEEP.other; i += 1) {
      recordRevision(a, 'session', content({ body: `a ${i}` }));
    }
    recordRevision(b, 'session', content({ body: 'b' }));
    expect(listRevisions(a)).toHaveLength(REVISION_KEEP.other);
    expect(listRevisions(b)).toHaveLength(1);
  });
});

describe('restore (§8 rows 5-6)', () => {
  it('writes a revision to a draft’s live columns and keeps what it replaced', () => {
    const id = seed({ draft: true, body: 'old' });
    autosavePost(id, content({ body: 'new' }), { sessionStart: true });
    const [opened] = listRevisions(id);
    expect(restoreRevision(id, opened.id)).toBe(true);
    expect(row(id).body).toBe('old');
    expect(reasonsAndBodies(id)).toEqual([
      ['restore', 'new'],
      ['session', 'old'],
    ]);
  });

  it('writes a revision to a published post’s working copy without publishing it', () => {
    const id = seed({ draft: false });
    commitPost(id, content({ body: 'second' }), false, '2026-01-01T00:00:00.000Z');
    const [first] = listRevisions(id);
    expect(restoreRevision(id, first.id)).toBe(true);
    const after = row(id);
    expect(after.body).toBe('second');
    expect(after.draft).toBe(false);
    expect(after.draftContent?.body).toBe('live body');
  });

  it('discards pending edits by restoring the live version, keeping them as a revision', () => {
    const id = seed({ draft: false });
    autosavePost(id, content({ body: 'pending' }));
    expect(restoreRevision(id, 'live')).toBe(true);
    expect(row(id).draftContent).toBeNull();
    expect(reasonsAndBodies(id)).toEqual([['restore', 'pending']]);
  });

  it('stores a restored copy identical to the live version as no working copy', () => {
    const id = seed({ draft: false });
    autosavePost(id, content({ body: 'pending' }));
    recordRevision(id, 'publish', content({ body: 'live body' }));
    const published = listRevisions(id).find((revision) => revision.reason === 'publish');
    expect(published && restoreRevision(id, published.id)).toBe(true);
    expect(row(id).draftContent).toBeNull();
  });

  it('refuses a draft’s live version, another post’s revision, and a missing post', () => {
    const draft = seed({ draft: true });
    const other = seed({ draft: true });
    recordRevision(other, 'session', content({ body: 'elsewhere' }));
    const [foreign] = listRevisions(other);
    expect(restoreRevision(draft, 'live')).toBe(false);
    expect(restoreRevision(draft, foreign.id)).toBe(false);
    expect(restoreRevision(draft + other + 1000, 'live')).toBe(false);
    expect(listRevisions(draft)).toEqual([]);
  });
});

describe('delete (§8 row 7)', () => {
  it('removes a post’s revisions with it and leaves other posts’ alone', () => {
    const doomed = seed({ draft: true });
    const kept = seed({ draft: true });
    recordRevision(doomed, 'session', content({ body: 'x' }));
    recordRevision(kept, 'session', content({ body: 'y' }));
    deletePost(doomed);
    expect(listRevisions(doomed)).toEqual([]);
    expect(listRevisions(kept)).toHaveLength(1);
  });
});
