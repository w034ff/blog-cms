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

describe('autosave keeps no revisions (§8 row 2)', () => {
  it('overwrites a draft and a published post’s working copy without keeping either', () => {
    const draft = seed({ draft: true });
    autosavePost(draft, content({ body: 'typed' }));
    autosavePost(draft, content({ body: 'typed again' }));
    const published = seed({ draft: false });
    autosavePost(published, content({ body: 'pending' }));
    autosavePost(published, content({ body: 'pending again' }));
    expect(listRevisions(draft)).toEqual([]);
    expect(listRevisions(published)).toEqual([]);
  });
});

describe('dedupe (§8 row 3)', () => {
  it('skips content the newest revision of the same reason already holds, CRLF included', () => {
    const id = seed({ draft: true });
    expect(recordRevision(id, 'restore', content({ body: 'a\nb' }))).toBe(true);
    expect(recordRevision(id, 'restore', content({ body: 'a\r\nb' }))).toBe(false);
    expect(listRevisions(id)).toHaveLength(1);
  });

  it('compares within a reason only, so a published version is always kept as one', () => {
    const id = seed({ draft: true });
    recordRevision(id, 'restore', content({ body: 'same' }));
    expect(recordRevision(id, 'publish', content({ body: 'same' }))).toBe(true);
  });

  it('stores the body with LF', () => {
    const id = seed({ draft: true });
    recordRevision(id, 'restore', content({ body: 'a\r\nb' }));
    expect(listRevisions(id)[0].content.body).toBe('a\nb');
  });
});

describe('retention (§8 row 4)', () => {
  it('keeps REVISION_KEEP per reason, dropping the oldest', () => {
    const id = seed({ draft: true });
    const extra = 2;
    for (const reason of ['publish', 'restore'] as const) {
      for (let i = 0; i < REVISION_KEEP[reason] + extra; i += 1) {
        recordRevision(id, reason, content({ body: `${reason} ${i}` }));
      }
    }
    for (const reason of ['publish', 'restore'] as const) {
      const kept = listRevisions(id).filter((revision) => revision.reason === reason);
      expect(kept).toHaveLength(REVISION_KEEP[reason]);
      expect(kept.at(-1)?.content.body).toBe(`${reason} ${extra}`);
    }
  });

  it('counts each post on its own', () => {
    const a = seed({ draft: true });
    const b = seed({ draft: true });
    for (let i = 0; i < REVISION_KEEP.restore; i += 1) {
      recordRevision(a, 'restore', content({ body: `a ${i}` }));
    }
    recordRevision(b, 'restore', content({ body: 'b' }));
    expect(listRevisions(a)).toHaveLength(REVISION_KEEP.restore);
    expect(listRevisions(b)).toHaveLength(1);
  });
});

describe('restore (§8 rows 5-6)', () => {
  it('writes a revision to a draft’s live columns and keeps what it replaced', () => {
    // A post published once and taken back to a draft: the published version is its revision.
    const id = seed({ draft: false, body: 'old' });
    commitPost(id, content({ body: 'new' }), true, '2026-01-01T00:00:00.000Z');
    const [published] = listRevisions(id);
    expect(restoreRevision(id, published.id)).toBe(true);
    expect(row(id).body).toBe('old');
    expect(row(id).draft).toBe(true);
    expect(reasonsAndBodies(id)).toEqual([
      ['restore', 'new'],
      ['publish', 'old'],
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
    recordRevision(other, 'publish', content({ body: 'elsewhere' }));
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
    recordRevision(doomed, 'publish', content({ body: 'x' }));
    recordRevision(kept, 'publish', content({ body: 'y' }));
    deletePost(doomed);
    expect(listRevisions(doomed)).toEqual([]);
    expect(listRevisions(kept)).toHaveLength(1);
  });
});
