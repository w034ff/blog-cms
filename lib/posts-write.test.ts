import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    description: '',
    category: 'uncategorized',
    tags: [],
    draft: true,
    body: 'body',
    thumbnail: '',
    unlisted: false,
    ...overrides,
  });
}

const content: DraftContent = {
  title: 'Edited',
  description: 'desc',
  category: 'cat',
  tags: ['a', 'b'],
  thumbnail: '',
  unlisted: false,
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
});

describe('deletePost', () => {
  it('removes the row', () => {
    const id = seed();
    deletePost(id);
    expect(postExists(id)).toBe(false);
  });
});
