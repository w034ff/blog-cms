import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { posts } from '@/lib/db/schema';
import { db } from '@/lib/db';
import {
  autosavePost,
  commitPost,
  createPost,
  deletePost,
  postExists,
  slugExists,
} from '@/lib/posts-write';
import type { DraftContent } from '@/lib/types';

// Back the module under test with a real in-memory SQLite DB instead of the
// file-backed one. The factory runs once, so the whole file shares one DB; rows
// are cleared between tests below.
vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});

beforeEach(() => {
  db.delete(posts).run();
});

function seed(overrides: Partial<Parameters<typeof createPost>[0]> = {}): number {
  return createPost({
    slug: 'slug',
    title: 'Title',
    date: '2026-01-01',
    category: 'tech',
    tags: [],
    draft: true,
    body: 'body',
    thumbnail: '',
    kind: 'post',
    authorId: 1,
    ...overrides,
  });
}

const content: DraftContent = {
  title: 'Edited',
  category: 'blog',
  tags: ['a', 'b'],
  thumbnail: '',
  body: 'edited body',
};

function row(id: number) {
  return db.select().from(posts).where(eq(posts.id, id)).get();
}

describe('createPost / existence checks', () => {
  it('inserts a row, returns its id, and reflects in postExists/slugExists', () => {
    const id = seed({ slug: 'abc' });
    expect(id).toBeGreaterThan(0);
    expect(postExists(id)).toBe(true);
    expect(postExists(id + 1000)).toBe(false);
    expect(slugExists('abc')).toBe(true);
    expect(slugExists('missing')).toBe(false);
  });
});

describe('autosavePost', () => {
  it('writes straight to the live columns for a draft', () => {
    const id = seed({ draft: true });
    autosavePost(id, content);
    const r = row(id);
    expect(r?.title).toBe('Edited');
    expect(r?.body).toBe('edited body');
    expect(r?.tags).toEqual(['a', 'b']);
    // The draft path never uses the private working copy.
    expect(r?.draftContent).toBeNull();
  });

  it('writes to draft_content and leaves the live columns frozen for a published post', () => {
    const id = seed({ slug: 'pub', draft: false, title: 'Live', body: 'live body' });
    autosavePost(id, content);
    const r = row(id);
    expect(r?.title).toBe('Live');
    expect(r?.body).toBe('live body');
    expect(r?.draftContent?.title).toBe('Edited');
    expect(r?.draftContent?.body).toBe('edited body');
  });

  it('keeps the stored title when the incoming title is blank', () => {
    const id = seed({ draft: true, title: 'Keep' });
    autosavePost(id, { ...content, title: '   ' });
    const r = row(id);
    expect(r?.title).toBe('Keep'); // not overwritten with whitespace
    expect(r?.body).toBe('edited body'); // other fields still updated
  });

  // The same guard on the published branch, where the title to keep is the working copy's. An
  // author who retitles a published post and then clears the field to retype must not have the
  // unpublished title silently replaced by the live one.
  it('keeps the working copy’s title when the incoming title is blank on a published post', () => {
    const id = seed({ slug: 'pub-blank', draft: false, title: 'Live' });
    autosavePost(id, { ...content, title: 'Renamed' }); // an unpublished retitle
    autosavePost(id, { ...content, title: '   ' }); // cleared to retype
    const r = row(id);
    expect(r?.draftContent?.title).toBe('Renamed'); // not reverted to 'Live'
    expect(r?.title).toBe('Live'); // the live column is still frozen
  });

  it('falls back to the live title when a published post has no working copy yet', () => {
    const id = seed({ slug: 'pub-first', draft: false, title: 'Live' });
    autosavePost(id, { ...content, title: '   ' });
    expect(row(id)?.draftContent?.title).toBe('Live');
  });

  it('is a no-op when the row does not exist', () => {
    expect(() => autosavePost(9999, content)).not.toThrow();
  });
});

describe('commitPost', () => {
  it('writes content to the live columns, sets visibility, the date, and clears draft_content', () => {
    const id = seed({ slug: 'c', draft: false, title: 'Live', body: 'live body' });
    autosavePost(id, content); // stash a pending working copy first
    commitPost(
      id,
      { ...content, title: 'Final', body: 'final body' },
      false,
      '2026-02-02T00:00:00.000Z',
    );
    const r = row(id);
    expect(r?.title).toBe('Final');
    expect(r?.body).toBe('final body');
    expect(r?.date).toBe('2026-02-02T00:00:00.000Z');
    expect(r?.draft).toBe(false);
    expect(r?.draftContent).toBeNull();
  });

  it('can take a published post back to a draft', () => {
    const id = seed({ slug: 'u', draft: false });
    commitPost(id, content, true, '2026-01-01');
    expect(row(id)?.draft).toBe(true);
  });

  it('returns false and does not throw when the row does not exist', () => {
    expect(commitPost(9999, content, false, '2026-01-01')).toBe(false);
  });

  it('returns true when it updates a row', () => {
    const id = seed({ slug: 'v', draft: true });
    expect(commitPost(id, content, false, '2026-01-01')).toBe(true);
  });
});

// 記事一覧 sorts by editedAt (lib/db/schema.ts). It follows every author write; updatedAt, the public
// 更新日, must not follow the one that only touches the working copy.
describe('editedAt', () => {
  const T0 = new Date('2026-10-01T00:00:00.000Z');
  const T1 = new Date('2026-10-02T00:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is stamped on create', () => {
    expect(row(seed())?.editedAt).toBe(T0.toISOString());
  });

  it('moves on a published post’s autosave, which leaves updatedAt alone', () => {
    const id = seed({ draft: false });
    vi.setSystemTime(T1);
    autosavePost(id, content);
    expect(row(id)?.editedAt).toBe(T1.toISOString());
    expect(row(id)?.updatedAt).toBe(T0.toISOString());
  });

  it('moves with updatedAt on a draft’s autosave', () => {
    const id = seed({ draft: true });
    vi.setSystemTime(T1);
    autosavePost(id, content);
    expect(row(id)?.editedAt).toBe(T1.toISOString());
    expect(row(id)?.updatedAt).toBe(T1.toISOString());
  });

  it('moves with updatedAt on publish', () => {
    const id = seed({ draft: true });
    vi.setSystemTime(T1);
    commitPost(id, content, false, '2026-10-02');
    expect(row(id)?.editedAt).toBe(T1.toISOString());
    expect(row(id)?.updatedAt).toBe(T1.toISOString());
  });
});

describe('deletePost', () => {
  it('removes the row', () => {
    const id = seed();
    deletePost(id);
    expect(postExists(id)).toBe(false);
  });
});
